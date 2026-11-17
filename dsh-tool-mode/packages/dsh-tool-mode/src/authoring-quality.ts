/**
 * Authoring quality for Code Mode tools.
 *
 * Three model-facing facts are decided here, not in the callers:
 *
 * - **From-run inference is OBSERVED, never typed by a generator.** A capture is
 *   shape-only by construction (no input values), so the inferred schema is
 *   reported as observed with no inferred enums or defaults. Absent input means an
 *   empty object schema, not a guess.
 * - **A card example is the author's text or nothing.** It is parsed and validated
 *   against the tool schema; when it is missing or wrong the card omits it with a
 *   named reason. A generated placeholder ("{param: example}") is never produced.
 * - **Capture is disclosed.** The disclosure states what is retained locally, how
 *   many captures are kept, how to opt out, and that input values are never stored.
 *
 * @module @try-works/dsh-tool-mode/authoring-quality
 */

import { compileSchema } from '@try-works/tool-mode-contracts'
import { MAX_RUN_CAPTURES, type RunCapture } from './run-capture.ts'

/** A JSON value, as the schemas are expressed. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue }

/** A JSON object, the shape of a schema or an example. */
export interface JsonObject {
  readonly [key: string]: JsonValue
}

/** The provenance of a schema inferred from a run capture. */
export interface InferredRunInputSchema {
  /** The observed shape; values were never captured, so nothing here is invented. */
  readonly schema: JsonObject
  /** Whether the schema came from generated typing. Always false: this is observation. */
  readonly typed: false
  /** Where the schema came from. */
  readonly schemaSource: 'observed'
  /** How much of the run input the schema describes. */
  readonly schemaCompleteness: 'observed'
  /** Whether at least one argument key was observed (a non-empty parameter set). */
  readonly parameterised: boolean
}

/** An empty object schema: the honest answer for a capture with no input. */
const EMPTY_INPUT_SCHEMA: JsonObject = { type: 'object', properties: {} }

/** A real object guard without a typeof narrowing. */
function isJsonObject(value: JsonValue): value is JsonObject {
  return Object.prototype.toString.call(value) === '[object Object]'
}

/** A deep copy of one JSON object, with its object type preserved. */
function copyJsonObject(value: JsonObject): JsonObject {
  const copied: JsonObject = JSON.parse(JSON.stringify(value))
  return copied
}

/** Build an object schema from observed argument paths (keys only). */
function schemaFromPaths(paths: readonly string[]): Record<string, JsonValue> {
  const properties: Record<string, JsonValue> = {}
  const required: string[] = []
  for (const path of [...new Set(paths)].sort()) {
    const segments = path.split('.').filter(segment => segment.length > 0 && segment !== '[]')
    const head = segments[0]
    if (head === undefined) continue
    if (segments.length === 1) {
      properties[head] = {}
      required.push(head)
      continue
    }
    // Nested paths are observed as an object; the leaf stays unconstrained
    // because only keys were retained, never values or types.
    let cursor = properties
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]!
      const existing = cursor[segment]
      if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
        cursor[segment] = { type: 'object', properties: {} }
      }
      const object = cursor[segment] as Record<string, JsonValue>
      const child = object['properties']
      if (child === null || typeof child !== 'object' || Array.isArray(child)) {
        object['properties'] = {}
      }
      cursor = object['properties'] as Record<string, JsonValue>
    }
    cursor[segments[segments.length - 1]!] = {}
  }
  return {
    type: 'object',
    properties,
    ...required.length === 0 ? {} : { required: [...new Set(required)] },
  }
}

/**
 * Infer the input schema from one successful run capture.
 *
 * The capture already stores a SHAPE-ONLY schema (see run-capture.ts), so this is
 * a copy rather than a generator: no enum, default or const is added, and no input
 * value exists to copy. A capture without an object schema gets the empty object
 * schema.
 * @param capture - the run capture.
 * @returns the observed schema and its provenance.
 */
export function inferRunInputSchema(capture: RunCapture): InferredRunInputSchema {
  // JSON round-trip first: the capture stores plain JSON, and this keeps the value
  // typed without a cast while also detaching it from the stored document.
  const candidate: JsonValue = JSON.parse(JSON.stringify(capture.inputSchema))
  const fromInput = isJsonObject(candidate) && candidate['type'] === 'object' ? copyJsonObject(candidate) : EMPTY_INPUT_SCHEMA
  const observedPaths = capture.parameterPaths ?? []
  const fromPaths = schemaFromPaths(observedPaths)
  const pathProperties = fromPaths['properties']
  const inputProperties = fromInput['properties']
  const pathCount = pathProperties !== null && typeof pathProperties === 'object' && !Array.isArray(pathProperties)
    ? Object.keys(pathProperties).length
    : 0
  const inputCount = inputProperties !== null && typeof inputProperties === 'object' && !Array.isArray(inputProperties)
    ? Object.keys(inputProperties).length
    : 0
  // The captured input schema wins when it has keys; otherwise the call argument
  // paths are the only parameter evidence (a program may hardcode its input).
  const schema: JsonObject = inputCount > 0 ? fromInput : pathCount > 0 ? fromPaths : EMPTY_INPUT_SCHEMA
  const properties = schema['properties']
  const parameterised = properties !== null && typeof properties === 'object' && !Array.isArray(properties)
    && Object.keys(properties).length > 0
  return {
    schema,
    typed: false,
    schemaSource: 'observed',
    schemaCompleteness: 'observed',
    parameterised,
  }
}

/** The prefix every from-run tool name carries. */
const FROM_RUN_PREFIX = 'agent_from_'

/** The longest authored tool name the host accepts. */
const MAX_AGENT_NAME_LENGTH = 64

/**
 * Suggest a valid authored tool name for one captured run.
 *
 * The result always matches the host's authored-tool rule and is at most 64
 * characters: the run id is lowercased, every character outside `[a-z0-9_]` becomes
 * an underscore, runs of underscores are collapsed, and the body is truncated to
 * fit. An empty body falls back to `run` rather than producing an invalid name.
 * @param runId - the run whose name is being suggested.
 * @returns a valid `agent_from_<sanitized>` name.
 */
export function suggestAgentName(runId: string): string {
  const bodyLimit = MAX_AGENT_NAME_LENGTH - FROM_RUN_PREFIX.length
  const body = runId
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, bodyLimit)
  const safeBody = body.length >= 2 ? body : 'run'
  return FROM_RUN_PREFIX + safeBody
}

/** Why a card example was omitted. */
export type CardExampleOmittedReason =
  /** The author supplied no example. */
  | 'no-explicit-example'
  /** The supplied example is not JSON. */
  | 'invalid-example-json'
  /** The supplied example does not satisfy the tool's input schema. */
  | 'example-schema-mismatch'

/** The tool fields the card example needs. */
export interface CardExampleTool {
  /** The authored tool name, for diagnostics. */
  readonly name?: string | undefined
  /** The input schema the example must satisfy. */
  readonly inputSchema: Readonly<Record<string, JsonValue>>
  /** The explicit example the author supplied, when they supplied one. */
  readonly example?: string | undefined
}

/** The card example to render, or the named reason it is omitted. */
export interface CardExampleResult {
  /** The author's explicit example text, verbatim. */
  readonly example?: string
  /** Why no example is rendered. */
  readonly omittedReason?: CardExampleOmittedReason
}

/**
 * Render the card example for one authored tool.
 *
 * Only an EXPLICIT example is returned, and only after it parses and satisfies the
 * tool's input schema. Nothing is generated: the previous placeholder
 * `{"param":"example"}` is a lie about the tool's arguments and is never produced.
 * @param tool - the authored tool.
 * @returns the example text, or an omitted reason and no example.
 */
export function cardExample(tool: CardExampleTool): CardExampleResult {
  const explicit = tool.example
  if (explicit === undefined || explicit.trim().length === 0) return { omittedReason: 'no-explicit-example' }
  let parsed: JsonValue
  try {
    parsed = JSON.parse(explicit)
  } catch {
    return { omittedReason: 'invalid-example-json' }
  }
  const violations = compileSchema(tool.inputSchema)(parsed)
  if (violations.length > 0) return { omittedReason: 'example-schema-mismatch' }
  return { example: explicit }
}

/** The run-capture settings a disclosure describes. */
export interface CaptureConfig {
  /** Whether successful run programs are captured; the config default is true. */
  readonly captureRunPrograms?: boolean | undefined
  /** The file captures are stored in, when the operator set one. */
  readonly runCaptureFile?: string | undefined
}

/** What the operator is told about run capture. */
export interface CaptureDisclosure {
  /** Whether capture is on. */
  readonly enabled: boolean
  /** The configured file, or null when the default location is used. */
  readonly file: string | null
  /** How many captures are retained. */
  readonly maxCaptures: number
  /** Whether the operator can turn capture off. */
  readonly optOut: boolean
  /** The model/operator-facing notice. */
  readonly notice: string
}

/**
 * Disclose what run capture retains and what it never retains.
 *
 * The notice is spoken to the operator before they enable anything: the program
 * text is kept LOCALLY for define-from-run, input values are never stored, and
 * `captureRunPrograms: false` opts out. A disabled deployment says so instead of
 * describing retention that is not happening.
 * @param config - the capture settings.
 * @returns the disclosure.
 */
export function captureDisclosure(config: CaptureConfig = {}): CaptureDisclosure {
  const enabled = config.captureRunPrograms !== false
  const configured = config.runCaptureFile
  const file = configured !== undefined && configured.trim().length > 0 ? configured : null
  const location = file === null ? 'beside the authoring file' : 'in ' + file
  const notice = enabled
    ? 'Successful run programs are retained locally ' + location + ' for define-from-run: only the '
      + 'program text, its tool bindings and a SHAPE-ONLY input schema are stored, and input values '
      + 'are never stored. Set captureRunPrograms: false to opt out.'
    : 'Run capture is disabled (captureRunPrograms: false): no program text or input schema is retained locally.'
  return { enabled, file, maxCaptures: MAX_RUN_CAPTURES, optOut: true, notice }
}
