/**
 * The registrar: turns each runnable catalog model into a DSH tool.
 *
 * The registrar owns the translation from the catalog's declarative tool spec
 * into a `defineTool` definition, including the parameter schema, the canonical
 * output contract and the model-facing rendering. Registration goes through
 * `ctx.tools.register`, whose returned disposer is the only unregister API, so
 * the plugin can add or drop a model's tool at runtime as capability changes.
 *
 * @module @try-works/dsh-tool-mode/registrar
 */

import {
  defineTool,
  parameterSchemaSpecToJsonSchema,
  type ParameterPropertySpec,
  type ParameterSchemaSpec,
} from '@deepseek-ai/dsh-tools'
import type { ModelCatalogEntry, ModelOperationSpec, ModelParamType, ModelToolSpec } from './types.ts'
import type { ModelAdapter } from './adapters/index.ts'
import { catalogToolDescription } from './tool-description.ts'

/**
 * P3 of the agent tool-selection plan: the ids whose model-facing schemas are known to be
 * worth deferring regardless of their measured size, plus the size threshold for everything
 * else. `semantic_*` is a prefix pattern (the four semantic contracts at this revision).
 */
export const DEFER_HEAVY_SCHEMA_TOOL_IDS: readonly string[] = Object.freeze([
  'multimodal_embed',
  'media_find_moments',
  'extract_with_repair',
  'structured_extract',
  'tools_plan',
  'semantic_*',
])

/** Defer when a declaration EXCEEDS this many UTF-8 bytes (default 1 KiB). */
export const DEFER_HEAVY_SCHEMA_THRESHOLD_BYTES = 1024

/** The registration-time switch: `config.deferHeavySchemas` (default off). */
export interface DeferLoadingOptions {
  readonly deferHeavySchemas?: boolean
}

/** The declaration fields the size decision is made over. */
export interface ModelFacingDeclaration {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

/** UTF-8 bytes of the model-facing declaration (name + description + parameters). */
export function toolSchemaBytes(declaration: ModelFacingDeclaration): number {
  return Buffer.byteLength(JSON.stringify(declaration), 'utf8')
}

/** Whether one id matches the explicit list (exact, or a trailing-`*` prefix). */
function matchesExplicitId(toolName: string, ids: readonly string[]): boolean {
  return ids.some(id => id === toolName || (id.endsWith('*') && toolName.startsWith(id.slice(0, -1))))
}

/**
 * Decide whether one tool's declaration should be deferred (pure).
 *
 * A disabled switch selects nothing. Otherwise an explicit id wins regardless of size, and
 * any other declaration is selected only when it EXCEEDS the threshold (equal stays eager).
 * @param input - tool name, measured bytes, the config switch and optional overrides.
 * @returns whether the definition should carry `deferLoading: true`.
 */
export function shouldDeferHeavySchema(input: {
  readonly toolName: string
  readonly schemaBytes: number
  readonly enabled: boolean
  readonly explicitIds?: readonly string[]
  readonly thresholdBytes?: number
}): boolean {
  if (!input.enabled) return false
  if (matchesExplicitId(input.toolName, input.explicitIds ?? DEFER_HEAVY_SCHEMA_TOOL_IDS)) return true
  return input.schemaBytes > (input.thresholdBytes ?? DEFER_HEAVY_SCHEMA_THRESHOLD_BYTES)
}

/** The tool spec a catalog entry declares, resolved into a registration. */
export interface RegisteredModelTool {
  readonly modelId: string
  readonly toolName: string
  readonly dispose: () => void
}

/**
 * Compile one declared parameter into the registry's parameter spec.
 * @param type - the declared JSON-level type.
 * @param description - the model-facing description.
 * @param required - whether the parameter must be supplied.
 * @returns the parameter property spec.
 */
function parameterSpec(
  type: ModelParamType,
  description: string,
  required: boolean,
): ParameterPropertySpec {
  const base = type === 'string[]'
    ? { type: 'array' as const, items: { type: 'string' as const } }
    : { type }
  return {
    ...base,
    description,
    ...required ? { required: true as const } : {},
  } as ParameterPropertySpec
}

/**
 * Build the parameter schema for one model's tool.
 *
 * Every catalog parameter is advertised as OPTIONAL here: the catalog has no
 * explicit requiredness metadata, and inferring it from parameter order was a
 * model-specific assumption BASE-04 forbids. The adapter validates the model's
 * primary input as a required non-empty value, so an omitted argument is still
 * refused — just by the adapter's rule rather than by an inferred schema flag.
 * Types come from the catalog declaration, so a numeric or list parameter reaches
 * the model as the type it actually is rather than as a string it re-parses.
 * @param entry - the catalog entry.
 * @returns the DSH parameter schema spec.
 */
export function buildParameters(entry: ModelCatalogEntry, tool: ModelToolSpec = entry.tool): ParameterSchemaSpec {
  const params = tool.params
  const schema: Record<string, ParameterPropertySpec> = {}
  for (const [name, param] of Object.entries(params)) {
    if (param === undefined) continue
    schema[name] = parameterSpec(param.type ?? 'string', param.description, false)
  }
  return schema as ParameterSchemaSpec
}

/**
 * Render the tool result for the model.
 *
 * The canonical value is the source of truth; this projection only chooses how
 * to present it. Tongue's shaped result gets a sentence the model can act on
 * directly, while everything else falls back to stable JSON so no information
 * is lost to a lossy humanization.
 * @param entry - the catalog entry.
 * @param value - the canonical value the adapter returned.
 * @returns the model-facing content blocks.
 */
/**
 * Render a canonical value as model-facing content blocks.
 *
 * Keyed on the CONTRACT, never on the model id. A model-specific presentation
 * branch is a model-specific postprocessing recipe living in the host, which
 * EXT-01 forbids — and it would also mean a second implementation of the same
 * contract rendered differently, contradicting the point of having a contract.
 * Anything unrecognised falls through to the canonical JSON, so a new contract
 * degrades to readable data rather than to nothing.
 * @param entry - the catalog entry, for its contract binding.
 * @param value - the canonical value the adapter returned.
 * @returns the model-facing content blocks.
 */
export function renderResult(
  entry: ModelCatalogEntry,
  value: Record<string, unknown>,
  contract: string | null = entry.contract,
): { type: 'text'; text: string }[] {
  if (contract === 'text.language_detect' && typeof value.language === 'string') {
    const candidates = Array.isArray(value.candidates) ? value.candidates : []
    const detail = candidates
      .filter((candidate): candidate is { language: string; probability: number } =>
        typeof candidate === 'object' && candidate !== null
        && typeof (candidate as { language?: unknown }).language === 'string')
      .map(candidate => `${candidate.language} ${(candidate.probability * 100).toFixed(1)}%`)
      .join(', ')
    // Both spellings are accepted: an implementation reports its own vocabulary and
    // the host translates, so this reads whichever one reached here.
    const tooClose = value.tooCloseToCall === true || value.isTooCloseToCall === true
      ? ' (too close to call)'
      : ''
    return [{
      type: 'text',
      text: `Detected language: ${value.language}${tooClose}`
        + (detail.length > 0 ? `\nCandidates: ${detail}` : ''),
    }]
  }
  if (contract === 'stt.transcribe' && typeof value.text === 'string') {
    const wordCount = typeof value.wordCount === 'number' ? value.wordCount : 0
    return [{
      type: 'text',
      text: value.text.length > 0
        ? value.text
        : `(no speech recognized; ${wordCount} words)`,
    }]
  }
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** The JSON-Schema type of the canonical value a model tool returns. */
function outputSchemaFor(entry: ModelCatalogEntry): {
  type: 'object'
  additionalProperties: true
} {
  // One open object schema for every model: the adapters return model-specific
  // fields, and the registry validates the declared shape without forbidding a
  // field a future adapter adds.
  void entry
  return { type: 'object', additionalProperties: true }
}

/**
 * Register one model's tool on the calling context.
 * @param ctx - the context whose tool registry receives the definition; its scope decides visibility.
 * @param entry - the catalog entry to expose.
 * @param adapter - the adapter that invokes the model.
 * @param options - the deferral switch, from `config.deferHeavySchemas` (default off).
 * @returns the model id, the tool name, and the disposer returned by the registry.
 */
export function registerModelTool(
  ctx: { tools: { register(definition: unknown): () => void } },
  entry: ModelCatalogEntry,
  adapter: ModelAdapter,
  options: DeferLoadingOptions = {},
  operation?: ModelOperationSpec,
): RegisteredModelTool {
  const tool = operation?.tool ?? entry.tool
  const contract = operation?.contract ?? entry.contract
  const description = catalogToolDescription(entry, tool)
  const parameters = buildParameters(entry, tool)
  const deferLoading = shouldDeferHeavySchema({
    toolName: tool.name,
    schemaBytes: toolSchemaBytes({
      name: tool.name,
      description,
      parameters: parameterSchemaSpecToJsonSchema(parameters),
    }),
    enabled: options.deferHeavySchemas === true,
  })
  const deferMarker = deferLoading ? { deferLoading: true as const } : {}
  const definition = defineTool({
    name: tool.name,
    description,
    parameters,
    ...deferMarker,
    output: {
      schema: outputSchemaFor(entry),
      render: (_args, value) => renderResult(entry, value as Record<string, unknown>, contract),
    },
    async execute(args, exec) {
      const value = await adapter.invoke({
        args: args as Record<string, unknown>,
        signal: exec.signal,
        ...operation === undefined ? {} : { operationId: operation.id },
      })
      return value
    },
    presentCall(args) {
      const primary = Object.values(args as Record<string, unknown>)[0]
      const preview = typeof primary === 'string' ? primary : undefined
      return {
        card: 'generic',
        title: `${entry.name}${entry.input === 'text' ? '' : ` (${entry.input})`}`,
        kind: 'read',
        ...preview !== undefined && entry.input === 'text' ? { rawInput: preview } : {},
      }
    },
  })
  const dispose = ctx.tools.register(definition)
  return { modelId: entry.id, toolName: tool.name, dispose }
}
