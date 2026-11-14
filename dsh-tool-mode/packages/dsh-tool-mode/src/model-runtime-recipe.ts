/**
 * The `model-runtime` recipe: parsing, schema files and the provider factory binding
 * (docs/runtime/PHASE2.md).
 *
 * WHY THE HOST OWNS THE PARSER. The recipe decides what the host will register and which
 * module it will import, so it is a TRUST BOUNDARY. Validating it with code imported from
 * the extension would let the extension define what counts as valid; importing a dedicated
 * runtime-recipes package would put a Phase-2 runtime package in the host's dependency
 * graph, which AT-25 and ARCH-02 exist to prevent. The rules are therefore structural and
 * live here: data only, no engine, no model, no vendor SDK.
 *
 * WHAT THE HOST DOES DELEGATE — and the whole point of the recipe — is the ENGINE. The
 * factory is resolved with `createRequire` anchored at the EXTENSION's own package.json, so
 * a provider package that the extension installed is found, and one that only the host
 * happens to have is not treated as available. The host declares no runtime; the package
 * ships one and names it.
 *
 * @module @try-works/dsh-tool-mode/model-runtime-recipe
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { ModelProviderV1, PreparedAssetMapV1 } from '@try-works/tool-mode-extension-sdk'

/** The accelerators a recipe may request; the host decides which are actually available. */
export type ModelRuntimeAccelerator = 'cpu' | 'dml' | 'webgpu'

/** The artifact formats the lane knows how to name. */
export type ModelRuntimeFormat = 'onnx' | 'tflite' | 'gguf'

/** A parsed, validated `model-runtime` recipe. */
export interface ModelRuntimeRecipe {
  readonly kind: 'model-runtime'
  readonly schemaVersion: 1
  readonly provider: {
    readonly package: string
    readonly export: string
    readonly accelerators?: readonly ModelRuntimeAccelerator[]
  }
  readonly model: {
    readonly assetSet: string
    readonly fileName: string
    readonly format: ModelRuntimeFormat
  }
  readonly processor: { readonly id: string }
  readonly limits: { readonly maxInputBytes: number; readonly timeoutMs: number }
  readonly tool: {
    readonly name: string
    readonly description: string
    readonly inputSchema: string
    readonly outputSchema: string
  }
}

/** Why a recipe or its binding was refused. Each is a NAMED refusal, never a silent no-op. */
export type ModelRuntimeRefusalCode =
  | 'not-model-runtime'
  | 'unknown-key'
  | 'bad-schema-version'
  | 'bad-provider'
  | 'bad-model'
  | 'bad-processor'
  | 'bad-limits'
  | 'bad-tool'
  | 'schema-unreadable'
  | 'factory-unresolved'
  | 'factory-import-failed'
  | 'factory-not-function'

/** A refusal with the exact reason the operator needs. */
export interface ModelRuntimeRefusal {
  readonly ok: false
  readonly code: ModelRuntimeRefusalCode
  readonly detail: string
}

/** A parsed recipe, or a refusal. */
export type ModelRuntimeRecipeResult = { readonly ok: true; readonly recipe: ModelRuntimeRecipe } | ModelRuntimeRefusal

/** The engine binding a recipe names. */
export type ModelRuntimeProviderFactory = (
  recipe: ModelRuntimeRecipe,
  assets: Readonly<PreparedAssetMapV1>,
) => ModelProviderV1

const TOP_LEVEL_KEYS = new Set(['kind', 'schemaVersion', 'provider', 'model', 'processor', 'limits', 'tool'])
const PROVIDER_KEYS = new Set(['package', 'export', 'accelerators'])
const MODEL_KEYS = new Set(['assetSet', 'fileName', 'format'])
const PROCESSOR_KEYS = new Set(['id'])
const LIMITS_KEYS = new Set(['maxInputBytes', 'timeoutMs'])
const TOOL_KEYS = new Set(['name', 'description', 'inputSchema', 'outputSchema'])
const FORMATS = new Set<string>(['onnx', 'tflite', 'gguf'])
const ACCELERATORS = new Set<string>(['cpu', 'dml', 'webgpu'])
/** `namespace/processor-version`, lower-case, as documented in PHASE2. */
const PROCESSOR_ID = /^[a-z0-9]+(?:\/[a-z0-9-]+)*$/

/** Whether a value is a non-array object. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Refuse with a code and a reason. */
function refuse(code: ModelRuntimeRefusalCode, detail: string): ModelRuntimeRefusal {
  return { ok: false, code, detail }
}

/**
 * Whether an unvalidated recipe claims to be a `model-runtime` recipe.
 *
 * The host branches on this BEFORE any harness behaviour: a harness recipe (or one with no
 * `kind`) keeps the existing path untouched.
 * @param raw - the recipe as read from disk.
 * @returns whether this is the model-runtime lane's business.
 */
export function isModelRuntimeRecipe(raw: unknown): boolean {
  return isRecord(raw) && raw['kind'] === 'model-runtime'
}

/** Refuse any key a section does not define, naming it. */
function unknownKey(section: string, record: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): ModelRuntimeRefusal | undefined {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return refuse('unknown-key', `${section} declares the unknown key "${key}"`)
  }
  return undefined
}

/** A non-empty trimmed string, or undefined. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Whether a value is a package-relative schema path that cannot leave the package.
 * @param value - the declared path.
 * @returns whether it is safe to resolve against the install directory.
 */
function isContainedRelativePath(value: unknown): boolean {
  if (typeof value !== 'string' || !value.startsWith('./') || value.includes('\\')) return false
  if (isAbsolute(value)) return false
  const segments = value.split('/').filter(segment => segment.length > 0)
  return !segments.includes('..')
}

/**
 * Parse and validate a `model-runtime` recipe (PHASE2 rules).
 * @param raw - the recipe as read from disk.
 * @returns the typed recipe or a named refusal.
 */
export function parseModelRuntimeRecipe(raw: unknown): ModelRuntimeRecipeResult {
  if (!isModelRuntimeRecipe(raw)) {
    return refuse('not-model-runtime', 'the recipe does not declare kind "model-runtime", so the harness path applies')
  }
  if (!isRecord(raw)) return refuse('not-model-runtime', 'the recipe is not an object')
  const top = unknownKey('the recipe', raw, TOP_LEVEL_KEYS)
  if (top !== undefined) return top
  if (raw['schemaVersion'] !== 1) {
    return refuse('bad-schema-version', `schemaVersion must be 1; this recipe declares ${JSON.stringify(raw['schemaVersion'])}`)
  }

  const provider = raw['provider']
  if (!isRecord(provider)) return refuse('bad-provider', 'provider must be an object')
  const providerUnknown = unknownKey('provider', provider, PROVIDER_KEYS)
  if (providerUnknown !== undefined) return providerUnknown
  const packageName = nonEmptyString(provider['package'])
  if (packageName === undefined) return refuse('bad-provider', 'provider.package must be a non-empty string')
  const exportName = nonEmptyString(provider['export'])
  if (exportName === undefined) return refuse('bad-provider', 'provider.export must be a non-empty string')
  const rawAccelerators = provider['accelerators']
  let accelerators: readonly ModelRuntimeAccelerator[] | undefined
  if (rawAccelerators !== undefined) {
    if (!Array.isArray(rawAccelerators) || rawAccelerators.length === 0) {
      return refuse('bad-provider', 'provider.accelerators must be a non-empty array when declared')
    }
    const declared: ModelRuntimeAccelerator[] = []
    for (const accelerator of rawAccelerators) {
      if (typeof accelerator !== 'string' || !ACCELERATORS.has(accelerator)) {
        return refuse('bad-provider', `provider.accelerators admits cpu, dml and webgpu; got ${JSON.stringify(accelerator)}`)
      }
      declared.push(accelerator as ModelRuntimeAccelerator)
    }
    accelerators = declared
  }

  const model = raw['model']
  if (!isRecord(model)) return refuse('bad-model', 'model must be an object')
  const modelUnknown = unknownKey('model', model, MODEL_KEYS)
  if (modelUnknown !== undefined) return modelUnknown
  const assetSet = nonEmptyString(model['assetSet'])
  if (assetSet === undefined) return refuse('bad-model', 'model.assetSet must be a non-empty string')
  const fileName = nonEmptyString(model['fileName'])
  if (fileName === undefined) return refuse('bad-model', 'model.fileName must be a non-empty string')
  if (fileName.includes('/') || fileName.includes('\\') || fileName === '.' || fileName === '..') {
    return refuse('bad-model', `model.fileName must be a bare file name; got ${JSON.stringify(fileName)}`)
  }
  const format = model['format']
  if (typeof format !== 'string' || !FORMATS.has(format)) {
    return refuse('bad-model', `model.format admits onnx, tflite and gguf; got ${JSON.stringify(format)}`)
  }

  const processor = raw['processor']
  if (!isRecord(processor)) return refuse('bad-processor', 'processor must be an object')
  const processorUnknown = unknownKey('processor', processor, PROCESSOR_KEYS)
  if (processorUnknown !== undefined) return processorUnknown
  const processorId = nonEmptyString(processor['id'])
  if (processorId === undefined) return refuse('bad-processor', 'processor.id must be a non-empty string')
  if (!PROCESSOR_ID.test(processorId)) {
    return refuse('bad-processor', `processor.id must match ${PROCESSOR_ID.source}; got ${JSON.stringify(processorId)}`)
  }

  const limits = raw['limits']
  if (!isRecord(limits)) return refuse('bad-limits', 'limits must be an object')
  const limitsUnknown = unknownKey('limits', limits, LIMITS_KEYS)
  if (limitsUnknown !== undefined) return limitsUnknown
  for (const key of ['maxInputBytes', 'timeoutMs']) {
    const value = limits[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return refuse('bad-limits', `limits.${key} must be a positive integer; got ${JSON.stringify(value)}`)
    }
  }

  const tool = raw['tool']
  if (!isRecord(tool)) return refuse('bad-tool', 'tool must be an object')
  const toolUnknown = unknownKey('tool', tool, TOOL_KEYS)
  if (toolUnknown !== undefined) return toolUnknown
  const toolName = nonEmptyString(tool['name'])
  if (toolName === undefined) return refuse('bad-tool', 'tool.name must be a non-empty string')
  const description = nonEmptyString(tool['description'])
  if (description === undefined) return refuse('bad-tool', 'tool.description must be a non-empty string')
  for (const key of ['inputSchema', 'outputSchema']) {
    if (!isContainedRelativePath(tool[key])) {
      return refuse('bad-tool', `tool.${key} must be a package-relative "./..." path that stays inside the package; got ${JSON.stringify(tool[key])}`)
    }
  }

  return {
    ok: true,
    recipe: {
      kind: 'model-runtime',
      schemaVersion: 1,
      provider: { package: packageName, export: exportName, ...(accelerators === undefined ? {} : { accelerators }) },
      model: { assetSet, fileName, format: format as ModelRuntimeFormat },
      processor: { id: processorId },
      limits: { maxInputBytes: limits['maxInputBytes'] as number, timeoutMs: limits['timeoutMs'] as number },
      tool: {
        name: toolName,
        description,
        inputSchema: tool['inputSchema'] as string,
        outputSchema: tool['outputSchema'] as string,
      },
    },
  }
}

/** The result of reading one schema file. */
export type ModelRuntimeSchemaResult =
  | { readonly ok: true; readonly schema: Readonly<Record<string, unknown>> }
  | ModelRuntimeRefusal

/**
 * Read one package-relative schema file, refusing anything that could leave the package.
 * @param installPath - the installed package directory.
 * @param relative - the recipe's `./...` path.
 * @returns the parsed schema or a named refusal.
 */
export function readModelRuntimeSchema(installPath: string, relative: string): ModelRuntimeSchemaResult {
  if (!isContainedRelativePath(relative)) {
    return refuse('bad-tool', `${JSON.stringify(relative)} is not a package-relative schema path`)
  }
  const root = resolve(installPath)
  const absolute = resolve(root, relative)
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    return refuse('bad-tool', `${JSON.stringify(relative)} resolves outside the package`)
  }
  let text: string
  try {
    text = readFileSync(absolute, 'utf8')
  } catch (error) {
    return refuse('schema-unreadable', `the tool schema ${JSON.stringify(relative)} could not be read from ${absolute}: ${error instanceof Error ? error.message : String(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return refuse('schema-unreadable', `the tool schema ${JSON.stringify(relative)} is not JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(parsed)) {
    return refuse('schema-unreadable', `the tool schema ${JSON.stringify(relative)} must be a JSON object`)
  }
  return { ok: true, schema: parsed }
}

/** The result of resolving the recipe's provider module (a path, not an import). */
export type ProviderModuleResult =
  | { readonly ok: true; readonly resolved: string }
  | ModelRuntimeRefusal

/**
 * Resolve the recipe's provider module from the EXTENSION's own package, without importing it.
 *
 * Resolution is synchronous, which is what lets `registerDeclarative` — a synchronous host
 * hook — refuse a package that cannot be resolved AT REGISTRATION, instead of registering a
 * tool that cannot run. The import itself stays deferred to first call, so activation remains
 * lightweight (EXT-19).
 * @param options - the install directory and the parsed recipe.
 * @returns the resolved module path or a named refusal.
 */
export function resolveProviderModule(options: {
  readonly installPath: string
  readonly recipe: ModelRuntimeRecipe
}): ProviderModuleResult {
  const anchor = join(options.installPath, 'package.json')
  const require = createRequire(anchor)
  const specifier = options.recipe.provider.package
  try {
    return { ok: true, resolved: require.resolve(specifier) }
  } catch (error) {
    return refuse(
      'factory-unresolved',
      `the provider package ${JSON.stringify(specifier)} cannot be resolved from the extension package directory (${anchor}): `
      + `${error instanceof Error ? error.message : String(error)}. The host declares no engine of its own (AT-25)`,
    )
  }
}

/** The result of importing the recipe's provider factory. */
export type ProviderFactoryResult =
  | { readonly ok: true; readonly factory: ModelRuntimeProviderFactory }
  | ModelRuntimeRefusal

/**
 * Import the provider factory the recipe names, resolving from the EXTENSION's own package.
 *
 * The anchor is the extension's `package.json`, not the host's module graph: a package that
 * declares an engine dependency resolves it from its own install, and the host never
 * carries one (AT-25, ARCH-02).
 * @param options - the install directory and the parsed recipe.
 * @returns the factory or a named refusal.
 */
export async function importProviderFactory(options: {
  readonly installPath: string
  readonly recipe: ModelRuntimeRecipe
}): Promise<ProviderFactoryResult> {
  const resolvedModule = resolveProviderModule(options)
  if (!resolvedModule.ok) return resolvedModule
  const resolved = resolvedModule.resolved
  let namespace: Record<string, unknown>
  try {
    namespace = await import(pathToFileURL(resolved).href) as Record<string, unknown>
  } catch (error) {
    return refuse('factory-import-failed', `the provider module ${resolved} failed to import: ${error instanceof Error ? error.message : String(error)}`)
  }
  const candidate = namespace[options.recipe.provider.export]
  if (typeof candidate !== 'function') {
    return refuse(
      'factory-not-function',
      `the provider module ${resolved} does not export a function named ${JSON.stringify(options.recipe.provider.export)}`,
    )
  }
  return { ok: true, factory: candidate as ModelRuntimeProviderFactory }
}
