/**
 * The host lane that turns a parsed `model-runtime` recipe into a callable tool
 * (docs/runtime/PHASE2.md § Host lane).
 *
 * WHAT THIS MODULE OWNS, and what it deliberately does not:
 *
 * - It owns the CONTRACT between the recipe and DSH: the tool's name and description, the
 *   projection of the recipe's JSON-Schema input into what DSH can advertise, the FULL
 *   schema enforced at call time (the projection is intentionally looser), and the output
 *   check that stops a malformed payload from being published as a result.
 * - It does NOT own the engine. The provider is a `ModelProviderV1` created by the factory
 *   the recipe names, which was resolved from the extension's own package (AT-25).
 *
 * TIMING IS PART OF THE DESIGN. Creating a tool resolves the provider module but does not
 * import or run it; the import and the provider's `load` happen on the FIRST CALL. That keeps
 * activation lightweight (EXT-19) while still refusing — at registration — a package whose
 * engine is not installed, because resolution is synchronous.
 *
 * @module @try-works/dsh-tool-mode/model-runtime-lane
 */

import { assertAgainstSchema, compileSchema, projectSchemaToDsh } from '@try-works/tool-mode-contracts'
import type { InvocationContextV1, JsonObject, ModelProviderV1, PreparedAssetMapV1 } from '@try-works/tool-mode-extension-sdk'

import {
  importProviderFactory,
  readModelRuntimeSchema,
  resolveProviderModule,
  type ModelRuntimeRecipe,
  type ModelRuntimeProviderFactory,
  type ModelRuntimeRefusal,
} from './model-runtime-recipe.ts'

/** What the host hands the lane when it registers one implementation's tool. */
export interface ModelRuntimeToolDeps {
  /** The extension that owns the tool, for diagnostics. */
  readonly extensionId: string
  /** The implementation id the recipe belongs to (the manifest's, not the tool name). */
  readonly implementationId: string
  /** The installed package directory. */
  readonly installPath: string
  /** The parsed recipe. */
  readonly recipe: ModelRuntimeRecipe
  /** The host-verified prepared assets for this extension; empty until prepared. */
  readonly assets: () => Readonly<PreparedAssetMapV1>
  /** Build the call-scoped context the SDK contract requires. */
  readonly invocationContext: (exec: { readonly signal?: AbortSignal } | undefined) => InvocationContextV1
  /** Record a teardown failure without throwing out of a disposer. */
  readonly onError?: (message: string) => void
}

/** A registered tool's host-side half: what DSH advertises and what it runs. */
export interface ModelRuntimeToolHandle {
  readonly name: string
  readonly description: string
  /** The DSH-advertisable parameters projected from the recipe's input schema. */
  readonly parameters: Readonly<Record<string, unknown>>
  /** The recipe's own input schema, for the MCP advertisement (enforced in full above). */
  readonly inputSchema: Readonly<Record<string, unknown>>
  /** The recipe's own output schema, for the MCP advertisement. */
  readonly outputSchema: Readonly<Record<string, unknown>>
  readonly execute: (args: unknown, exec?: { readonly signal?: AbortSignal }) => Promise<unknown>
  readonly dispose: () => Promise<void>
}

/** The lane's outcome: a tool, or a named refusal the host turns into a refusal at registration. */
export type ModelRuntimeToolResult =
  | { readonly ok: true; readonly tool: ModelRuntimeToolHandle }
  | ModelRuntimeRefusal

/** DSH tool arguments are JSON; this only satisfies the index-signature boundary type. */
function asJsonObject(value: unknown): JsonObject {
  // SAFETY: the arguments arrived from the DSH registry (JSON by construction) and were just
  // validated against the recipe's schema, so a JSON round-trip is lossless.
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

/**
 * Build the tool for one model-runtime implementation.
 *
 * @param deps - the installed package, the parsed recipe and the host's context/asset hooks.
 * @returns the tool handle or a named refusal.
 */
export function createModelRuntimeTool(deps: ModelRuntimeToolDeps): ModelRuntimeToolResult {
  const inputSchema = readModelRuntimeSchema(deps.installPath, deps.recipe.tool.inputSchema)
  if (!inputSchema.ok) return inputSchema
  const outputSchema = readModelRuntimeSchema(deps.installPath, deps.recipe.tool.outputSchema)
  if (!outputSchema.ok) return outputSchema
  // Resolve (not import) the engine now: a package whose factory is missing is refused at
  // registration rather than at the first caller's expense.
  const providerModule = resolveProviderModule({ installPath: deps.installPath, recipe: deps.recipe })
  if (!providerModule.ok) return providerModule

  const name = deps.recipe.tool.name
  const inputValidator = compileSchema(inputSchema.schema)
  const outputValidator = compileSchema(outputSchema.schema)
  const parameters = projectSchemaToDsh(inputSchema.schema).parameters as unknown as Readonly<Record<string, unknown>>

  let factoryPromise: Promise<ModelRuntimeProviderFactory> | undefined
  let providerPromise: Promise<ModelProviderV1> | undefined
  let disposed = false

  /** Import the factory once; a failure is retried on the next call rather than cached forever. */
  const ensureFactory = async (): Promise<ModelRuntimeProviderFactory> => {
    factoryPromise ??= (async () => {
      const imported = await importProviderFactory({ installPath: deps.installPath, recipe: deps.recipe })
      if (!imported.ok) throw new Error(`${imported.code}: ${imported.detail}`)
      return imported.factory
    })()
    return factoryPromise
  }

  /** Create and LOAD the provider once; a failed load is retried rather than reported as ready. */
  const ensureProvider = async (signal: AbortSignal | undefined): Promise<ModelProviderV1> => {
    providerPromise ??= (async () => {
      const factory = await ensureFactory()
      const assets = deps.assets()
      const provider = factory(deps.recipe, assets)
      await provider.load({ assets, signal: signal ?? new AbortController().signal })
      return provider
    })()
    const pending = providerPromise
    pending.catch(() => {
      if (providerPromise === pending) providerPromise = undefined
    })
    return pending
  }

  return {
    ok: true,
    tool: {
      name,
      description: deps.recipe.tool.description,
      parameters,
      inputSchema: inputSchema.schema,
      outputSchema: outputSchema.schema,
      async execute(args: unknown, exec?: { readonly signal?: AbortSignal }): Promise<unknown> {
        if (disposed) throw new Error(`${name}: the owning extension was disposed`)
        // The FULL schema, before any engine work: the DSH advertisement is a projection.
        assertAgainstSchema(`${name} input`, inputValidator, args ?? {})
        const provider = await ensureProvider(exec?.signal)
        const payload = await provider.invoke({
          implementationId: deps.implementationId,
          input: asJsonObject(args ?? {}),
          context: deps.invocationContext(exec),
        })
        assertAgainstSchema(`${name} output`, outputValidator, payload)
        return payload
      },
      async dispose(): Promise<void> {
        if (disposed) return
        disposed = true
        const pending = providerPromise
        providerPromise = undefined
        if (pending === undefined) return
        try {
          const provider = await pending
          await provider.dispose()
        } catch (error) {
          // A disposer must not throw: deactivation continues, and the reason is recorded.
          deps.onError?.(`${deps.extensionId}: ${name} teardown failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    },
  }
}
