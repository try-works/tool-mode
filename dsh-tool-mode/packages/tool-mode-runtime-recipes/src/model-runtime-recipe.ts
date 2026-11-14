/**
 * The declarative `model-runtime` recipe (Phase 2, AT-25).
 *
 * A code-free package ships JSON, not a module entry. That JSON is the ONLY thing between
 * the package and the host resolving a provider module, so this parser is the boundary:
 * a document that parses is a document the host may act on.
 *
 * Every rule below exists to make that sentence true:
 *
 * - **Unknown keys are refused, not ignored, at every level.** A key this format does not
 *   implement is either a typo or a field that means something in a future version;
 *   ignoring it runs a recipe that is not the one the author wrote.
 * - **`schemaVersion` must be exactly 1.** A future version may mean something different,
 *   and guessing is how a host executes a contract it does not implement.
 * - **`model.fileName` is a bare file name.** It is joined to the verified asset
 *   directory, so a separator or traversal segment would read outside the deployment's
 *   own assets.
 * - **`tool.inputSchema`/`outputSchema` are package-relative `./` paths that stay inside
 *   the package.** The host reads them from the installed tree, so an absolute path or a
 *   `..` segment would make one package read another package's files.
 * - **`processor.id` matches `^[a-z0-9]+(?:/[a-z0-9-]+)*$`.** It selects a processor the
 *   engine package owns; the shape is the identity, not a path, and the engine never
 *   builds a file name from it.
 * - **`provider.export` is a JavaScript identifier and not a reserved property name.**
 *   The loader reads a NAMED export; `constructor`, `prototype` and `__proto__` would
 *   reach the object protocol instead of a module export.
 * - **Limits are positive integers.** A zero timeout or a fractional byte ceiling is a
 *   limit that silently means something other than what it says.
 * - **The parsed recipe is deep-frozen.** A caller holding it cannot widen the limits or
 *   swap the provider after validation.
 *
 * The accelerators are REQUIRED. The runtime core models supported lanes explicitly
 * (`CatalogEntry.accelerators`), and defaulting a missing list to `["cpu"]` would invent
 * a deployment decision the recipe never stated.
 *
 * @module @try-works/tool-mode-runtime-recipes/model-runtime-recipe
 */

/*
 * This module IS the validation boundary for a hand-written JSON document: taking
 * `unknown`, proving each field's type at run time and naming what is wrong is its job.
 * The generic anti-slop rules assume a caller that already has a typed value, so they are
 * disabled only for this boundary, and every rejected document becomes a named issue
 * instead of a trust decision.
 */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type */

import { describeKind } from './diagnostics.ts'

/** The recipe kind this module owns. */
export const MODEL_RUNTIME_KIND = 'model-runtime'

/** The only schema version this build accepts. */
export const MODEL_RUNTIME_SCHEMA_VERSION = 1

/**
 * The artifact formats a model runtime provider may execute.
 *
 * Kept in step with the runtime core's `ModelFormat`. Restated rather than imported
 * because this package is the recipe FORMAT and must stay dependency-free at run time:
 * the host parses a document before any runtime package is resolved.
 */
export const MODEL_RUNTIME_FORMATS = ['onnx', 'tflite', 'gguf'] as const
/** One artifact format a provider may execute. */
export type ModelRuntimeFormat = (typeof MODEL_RUNTIME_FORMATS)[number]

/** The compute lanes a recipe may request. Same closed set as `CatalogEntry.accelerators`. */
export const MODEL_RUNTIME_ACCELERATORS = ['cpu', 'dml', 'webgpu'] as const
/** One compute lane a recipe may request. */
export type ModelRuntimeAccelerator = (typeof MODEL_RUNTIME_ACCELERATORS)[number]

/** The tool-name shape the host registry accepts (lower snake_case). */
export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/

/** The processor-id shape: `<family>` or `<family>/<variant>`, lower kebab. */
export const PROCESSOR_ID_PATTERN = /^[a-z0-9]+(?:\/[a-z0-9-]+)*$/

/** A JavaScript identifier, which is the only shape a named export can have. */
const NAMED_EXPORT_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Property names that exist on every object and are NOT module exports.
 *
 * Reading one of these would reach `Object.prototype` rather than the module, so a recipe
 * naming one is refused even though it is a syntactically valid identifier.
 */
const RESERVED_EXPORT_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/** One reason a document was refused. */
export interface ModelRuntimeRecipeIssue {
  /** The field, dotted, e.g. `tool.inputSchema`. Empty for a document-level problem. */
  readonly path: string
  /** What is wrong with it, in one sentence. */
  readonly message: string
}

/** Who provides the model: an installed engine package and the factory it exports. */
export interface ModelRuntimeRecipeProvider {
  /** The bare package name of the engine package, resolved from the extension directory. */
  readonly package: string
  /** The named export that builds the SDK provider. */
  readonly export: string
  /** The compute lanes the deployment may use, in the author's order. */
  readonly accelerators: readonly ModelRuntimeAccelerator[]
}

/** The artifact the deployment loads. */
export interface ModelRuntimeRecipeModel {
  /** The asset-set id the host verifies and stages. */
  readonly assetSet: string
  /** A bare file name inside that asset set. */
  readonly fileName: string
  /** The artifact format. */
  readonly format: ModelRuntimeFormat
}

/** The processor the engine package owns for this model. */
export interface ModelRuntimeRecipeProcessor {
  /** A processor id, not a path: e.g. `shapes/points-v1`. */
  readonly id: string
}

/** The limits in force for one invocation. */
export interface ModelRuntimeRecipeLimits {
  /** The largest accepted input, in bytes. */
  readonly maxInputBytes: number
  /** The wall-clock ceiling for one invocation, in milliseconds. */
  readonly timeoutMs: number
}

/** The tool this recipe registers. */
export interface ModelRuntimeRecipeTool {
  /** The registered tool name (lower snake_case). */
  readonly name: string
  /** The one-line description shown to callers. */
  readonly description: string
  /** A package-relative JSON Schema path for the tool input. */
  readonly inputSchema: string
  /** A package-relative JSON Schema path for the tool output. */
  readonly outputSchema: string
}

/** A validated, deep-frozen declarative model-runtime recipe. */
export interface ModelRuntimeRecipe {
  readonly kind: typeof MODEL_RUNTIME_KIND
  readonly schemaVersion: typeof MODEL_RUNTIME_SCHEMA_VERSION
  readonly provider: ModelRuntimeRecipeProvider
  readonly model: ModelRuntimeRecipeModel
  readonly processor: ModelRuntimeRecipeProcessor
  readonly limits: ModelRuntimeRecipeLimits
  readonly tool: ModelRuntimeRecipeTool
}

/** What {@link parseModelRuntimeRecipe} returns. */
export type ModelRuntimeRecipeParseResult =
  | { readonly ok: true; readonly recipe: ModelRuntimeRecipe }
  | { readonly ok: false; readonly issues: readonly ModelRuntimeRecipeIssue[] }

/** The only top-level keys a recipe may carry. */
export const MODEL_RUNTIME_TOP_LEVEL_KEYS: readonly string[] = [
  'kind',
  'schemaVersion',
  'provider',
  'model',
  'processor',
  'limits',
  'tool',
]

/** The only keys `provider` may carry. */
export const MODEL_RUNTIME_PROVIDER_KEYS: readonly string[] = ['package', 'export', 'accelerators']

/** The only keys `model` may carry. */
export const MODEL_RUNTIME_MODEL_KEYS: readonly string[] = ['assetSet', 'fileName', 'format']

/** The only keys `processor` may carry. */
export const MODEL_RUNTIME_PROCESSOR_KEYS: readonly string[] = ['id']

/** The only keys `limits` may carry. */
export const MODEL_RUNTIME_LIMITS_KEYS: readonly string[] = ['maxInputBytes', 'timeoutMs']

/** The only keys `tool` may carry. */
export const MODEL_RUNTIME_TOOL_KEYS: readonly string[] = ['name', 'description', 'inputSchema', 'outputSchema']

/** A field read: a validated value, or `ok: false` after the issue was recorded. */
type FieldRead<A> = { readonly ok: true; readonly value: A } | { readonly ok: false }

/** Whether a value is a plain JSON object (not an array, class instance, Date, Map...). */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Record one issue and report the field as unreadable. */
function refuse(issues: ModelRuntimeRecipeIssue[], path: string, message: string): FieldRead<never> {
  issues.push({ path, message })
  return { ok: false }
}

/** Refuse every key the format does not implement. */
function checkClosedKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
  issues: ModelRuntimeRecipeIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push({
        path: path === '' ? key : `${path}.${key}`,
        message: `unknown key ${JSON.stringify(key)}; the allowed keys are ${allowed.join(', ')}`,
      })
    }
  }
}

/** Read one required string. */
function readString(
  value: unknown,
  path: string,
  issues: ModelRuntimeRecipeIssue[],
  requirement: string,
): FieldRead<string> {
  if (typeof value !== 'string') {
    return refuse(issues, path, `must be ${requirement}; received ${describeKind(value)}`)
  }
  if (value.length === 0) {
    return refuse(issues, path, `must be ${requirement}; received an empty string`)
  }
  return { ok: true, value }
}

/** Read one required section object. */
function readSection(
  root: Readonly<Record<string, unknown>>,
  key: string,
  issues: ModelRuntimeRecipeIssue[],
): FieldRead<Readonly<Record<string, unknown>>> {
  if (!Object.hasOwn(root, key)) return refuse(issues, key, 'is required')
  const value = root[key]
  if (!isPlainObject(value)) {
    return refuse(issues, key, `must be an object; received ${describeKind(value)}`)
  }
  return { ok: true, value }
}

/** Read the provider section. */
function readProvider(
  section: Readonly<Record<string, unknown>>,
  issues: ModelRuntimeRecipeIssue[],
): FieldRead<ModelRuntimeRecipeProvider> {
  checkClosedKeys(section, MODEL_RUNTIME_PROVIDER_KEYS, 'provider', issues)
  const packageName = readString(
    section.package,
    'provider.package',
    issues,
    'a bare package name such as "@try-works/tool-mode-runtime-litert"',
  )
  const exported = readExport(section.export, issues)
  const accelerators = readAccelerators(section.accelerators, issues)
  if (!packageName.ok || !exported.ok || !accelerators.ok) return { ok: false }
  return {
    ok: true,
    value: { package: packageName.value, export: exported.value, accelerators: accelerators.value },
  }
}

/** Read the factory export name, which must be a usable named export. */
function readExport(value: unknown, issues: ModelRuntimeRecipeIssue[]): FieldRead<string> {
  const name = readString(value, 'provider.export', issues, 'a non-empty string naming a module export')
  if (!name.ok) return name
  if (!NAMED_EXPORT_PATTERN.test(name.value)) {
    return refuse(
      issues,
      'provider.export',
      `must be a JavaScript identifier naming a module export; received ${JSON.stringify(name.value)}`,
    )
  }
  if (RESERVED_EXPORT_NAMES.has(name.value)) {
    return refuse(
      issues,
      'provider.export',
      `must name a module export, not the reserved property ${JSON.stringify(name.value)}`,
    )
  }
  return name
}

/** Read the accelerator lanes. */
function readAccelerators(
  value: unknown,
  issues: ModelRuntimeRecipeIssue[],
): FieldRead<readonly ModelRuntimeAccelerator[]> {
  const allowed = MODEL_RUNTIME_ACCELERATORS.join(', ')
  if (!Array.isArray(value) || value.length === 0) {
    return refuse(
      issues,
      'provider.accelerators',
      `must be a non-empty array of ${allowed}; received ${describeKind(value)}`,
    )
  }
  const lanes: ModelRuntimeAccelerator[] = []
  let failed = false
  for (const [index, lane] of value.entries()) {
    if (typeof lane !== 'string' || !isAccelerator(lane)) {
      issues.push({
        path: `provider.accelerators[${index}]`,
        message: `must be one of ${allowed}; received ${describeKind(lane)}`,
      })
      failed = true
      continue
    }
    lanes.push(lane)
  }
  if (failed) return { ok: false }
  return { ok: true, value: lanes }
}

/** Whether a value is one of the declared accelerator lanes. */
function isAccelerator(value: string): value is ModelRuntimeAccelerator {
  return MODEL_RUNTIME_ACCELERATORS.some((lane) => lane === value)
}

/** Whether a value is one of the declared artifact formats. */
function isFormat(value: string): value is ModelRuntimeFormat {
  return MODEL_RUNTIME_FORMATS.some((format) => format === value)
}

/** Read the model section. */
function readModel(
  section: Readonly<Record<string, unknown>>,
  issues: ModelRuntimeRecipeIssue[],
): FieldRead<ModelRuntimeRecipeModel> {
  checkClosedKeys(section, MODEL_RUNTIME_MODEL_KEYS, 'model', issues)
  const assetSet = readString(section.assetSet, 'model.assetSet', issues, 'a non-empty asset-set id')
  const fileName = readFileName(section.fileName, issues)
  const format = readFormat(section.format, issues)
  if (!assetSet.ok || !fileName.ok || !format.ok) return { ok: false }
  return { ok: true, value: { assetSet: assetSet.value, fileName: fileName.value, format: format.value } }
}

/** Read the artifact format. */
function readFormat(value: unknown, issues: ModelRuntimeRecipeIssue[]): FieldRead<ModelRuntimeFormat> {
  const format = readString(value, 'model.format', issues, 'a non-empty artifact format')
  if (!format.ok) return format
  if (!isFormat(format.value)) {
    return refuse(
      issues,
      'model.format',
      `must be one of ${MODEL_RUNTIME_FORMATS.join(', ')}; received ${JSON.stringify(format.value)}`,
    )
  }
  return { ok: true, value: format.value }
}

/** Read `model.fileName`, which is joined to an asset directory and must be one name. */
function readFileName(value: unknown, issues: ModelRuntimeRecipeIssue[]): FieldRead<string> {
  const fileName = readString(value, 'model.fileName', issues, 'a bare file name')
  if (!fileName.ok) return fileName
  const problem = bareFileNameProblem(fileName.value)
  if (problem !== undefined) return refuse(issues, 'model.fileName', problem)
  return fileName
}

/** Why a string is not a bare file name, or undefined when it is one. */
function bareFileNameProblem(value: string): string | undefined {
  if (value === '.' || value === '..') {
    return `must be a file name, not ${JSON.stringify(value)}`
  }
  if (value.includes('/') || value.includes('\\')) {
    return `must be a bare file name with no path separators; received ${JSON.stringify(value)}`
  }
  if (value.includes('\0')) return 'must not contain a NUL byte'
  if (value.includes(':')) {
    return `must be a bare file name without a drive or stream separator; received ${JSON.stringify(value)}`
  }
  return undefined
}

/** Read the processor section. */
function readProcessor(
  section: Readonly<Record<string, unknown>>,
  issues: ModelRuntimeRecipeIssue[],
): FieldRead<ModelRuntimeRecipeProcessor> {
  checkClosedKeys(section, MODEL_RUNTIME_PROCESSOR_KEYS, 'processor', issues)
  const id = readString(section.id, 'processor.id', issues, 'a non-empty processor id')
  if (!id.ok) return id
  if (!PROCESSOR_ID_PATTERN.test(id.value)) {
    return refuse(
      issues,
      'processor.id',
      `must match ${String(PROCESSOR_ID_PATTERN)}; received ${JSON.stringify(id.value)}`,
    )
  }
  return { ok: true, value: { id: id.value } }
}

/** Read the limits section. */
function readLimits(
  section: Readonly<Record<string, unknown>>,
  issues: ModelRuntimeRecipeIssue[],
): FieldRead<ModelRuntimeRecipeLimits> {
  checkClosedKeys(section, MODEL_RUNTIME_LIMITS_KEYS, 'limits', issues)
  const maxInputBytes = readPositiveInteger(section.maxInputBytes, 'limits.maxInputBytes', issues)
  const timeoutMs = readPositiveInteger(section.timeoutMs, 'limits.timeoutMs', issues)
  if (!maxInputBytes.ok || !timeoutMs.ok) return { ok: false }
  return { ok: true, value: { maxInputBytes: maxInputBytes.value, timeoutMs: timeoutMs.value } }
}

/** Read one positive integer limit. */
function readPositiveInteger(value: unknown, path: string, issues: ModelRuntimeRecipeIssue[]): FieldRead<number> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return refuse(issues, path, `must be a positive integer; received ${describeKind(value)}`)
  }
  return { ok: true, value }
}

/** Read the tool section. */
function readTool(
  section: Readonly<Record<string, unknown>>,
  issues: ModelRuntimeRecipeIssue[],
): FieldRead<ModelRuntimeRecipeTool> {
  checkClosedKeys(section, MODEL_RUNTIME_TOOL_KEYS, 'tool', issues)
  const name = readToolName(section.name, issues)
  const description = readString(section.description, 'tool.description', issues, 'a non-empty description')
  const inputSchema = readSchemaPath(section.inputSchema, 'tool.inputSchema', issues)
  const outputSchema = readSchemaPath(section.outputSchema, 'tool.outputSchema', issues)
  if (!name.ok || !description.ok || !inputSchema.ok || !outputSchema.ok) return { ok: false }
  return {
    ok: true,
    value: {
      name: name.value,
      description: description.value,
      inputSchema: inputSchema.value,
      outputSchema: outputSchema.value,
    },
  }
}

/** Read the registered tool name. */
function readToolName(value: unknown, issues: ModelRuntimeRecipeIssue[]): FieldRead<string> {
  const name = readString(value, 'tool.name', issues, 'a non-empty tool name')
  if (!name.ok) return name
  if (!TOOL_NAME_PATTERN.test(name.value)) {
    return refuse(
      issues,
      'tool.name',
      `must match ${String(TOOL_NAME_PATTERN)} (lower snake_case); received ${JSON.stringify(name.value)}`,
    )
  }
  return name
}

/** Read one package-relative schema path. */
function readSchemaPath(value: unknown, path: string, issues: ModelRuntimeRecipeIssue[]): FieldRead<string> {
  const relative = readString(value, path, issues, 'a package-relative path such as "./schemas/tool.input.json"')
  if (!relative.ok) return relative
  const problem = packageRelativeProblem(relative.value)
  if (problem !== undefined) return refuse(issues, path, problem)
  return relative
}

/**
 * Why a string is not a package-relative path that stays inside the package.
 *
 * Checked segment by segment rather than with a single substring test: `./a/../b`
 * leaves and re-enters the tree, and a `..` inside a later segment is the same traversal
 * as one at the front.
 */
function packageRelativeProblem(value: string): string | undefined {
  if (!value.startsWith('./')) {
    return `must start with "./" so it is package-relative; received ${JSON.stringify(value)}`
  }
  const rest = value.slice(2)
  if (rest === '') return 'must name a file after "./"'
  if (rest.includes('\\')) return `must use "/" separators; received ${JSON.stringify(value)}`
  if (rest.includes('\0')) return 'must not contain a NUL byte'
  for (const segment of rest.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      return `must stay inside the package; ${JSON.stringify(value)} contains an empty or traversal segment`
    }
  }
  return undefined
}

/** Freeze every level of a recipe a caller may hold. */
function freezeRecipe(recipe: ModelRuntimeRecipe): ModelRuntimeRecipe {
  Object.freeze(recipe.provider.accelerators)
  Object.freeze(recipe.provider)
  Object.freeze(recipe.model)
  Object.freeze(recipe.processor)
  Object.freeze(recipe.limits)
  Object.freeze(recipe.tool)
  return Object.freeze(recipe)
}

/**
 * Validate one raw `model-runtime` recipe.
 *
 * Collects EVERY problem before returning, so a package author fixes the document in one
 * pass instead of one field per run.
 *
 * @param raw - the value decoded from the package's recipe JSON
 * @returns the frozen recipe, or every reason it was refused
 */
export function parseModelRuntimeRecipe(raw: unknown): ModelRuntimeRecipeParseResult {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      issues: [
        {
          path: '',
          message: `a model-runtime recipe must be a JSON object; received ${describeKind(raw)}`,
        },
      ],
    }
  }

  const issues: ModelRuntimeRecipeIssue[] = []
  checkClosedKeys(raw, MODEL_RUNTIME_TOP_LEVEL_KEYS, '', issues)

  if (!Object.hasOwn(raw, 'kind')) {
    issues.push({ path: 'kind', message: 'is required' })
  } else if (raw.kind !== MODEL_RUNTIME_KIND) {
    issues.push({
      path: 'kind',
      message: `must be ${JSON.stringify(MODEL_RUNTIME_KIND)}; received ${describeKind(raw.kind)}`,
    })
  }

  if (!Object.hasOwn(raw, 'schemaVersion')) {
    issues.push({ path: 'schemaVersion', message: 'is required' })
  } else if (raw.schemaVersion !== MODEL_RUNTIME_SCHEMA_VERSION) {
    issues.push({
      path: 'schemaVersion',
      message: `must be ${MODEL_RUNTIME_SCHEMA_VERSION}; received ${describeKind(raw.schemaVersion)}`,
    })
  }

  const providerSection = readSection(raw, 'provider', issues)
  const modelSection = readSection(raw, 'model', issues)
  const processorSection = readSection(raw, 'processor', issues)
  const limitsSection = readSection(raw, 'limits', issues)
  const toolSection = readSection(raw, 'tool', issues)

  const provider = providerSection.ok ? readProvider(providerSection.value, issues) : providerSection
  const model = modelSection.ok ? readModel(modelSection.value, issues) : modelSection
  const processor = processorSection.ok ? readProcessor(processorSection.value, issues) : processorSection
  const limits = limitsSection.ok ? readLimits(limitsSection.value, issues) : limitsSection
  const tool = toolSection.ok ? readTool(toolSection.value, issues) : toolSection

  if (!provider.ok || !model.ok || !processor.ok || !limits.ok || !tool.ok) {
    return { ok: false, issues }
  }
  if (issues.length > 0) return { ok: false, issues }

  return {
    ok: true,
    recipe: freezeRecipe({
      kind: MODEL_RUNTIME_KIND,
      schemaVersion: MODEL_RUNTIME_SCHEMA_VERSION,
      provider: provider.value,
      model: model.value,
      processor: processor.value,
      limits: limits.value,
      tool: tool.value,
    }),
  }
}
