/**
 * Optional capture of successful Code Mode runs, for define-from-run.
 *
 * Off by default. A capture stores the PROGRAM the agent wrote, the binding
 * names, and a SHAPE-ONLY schema derived from the run input — never the input
 * values. That is the minimum needed to turn one verified run into an editable
 * tool scaffold without making the capture a second copy of the caller's data.
 *
 * @module @try-works/dsh-tool-mode/run-capture
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { JsonValue } from './adapters/types.ts'
import { dirname } from 'node:path'

/** How many run captures are retained. */
export const MAX_RUN_CAPTURES = 50

/** The largest program a capture stores. */
const MAX_PROGRAM_BYTES = 64 * 1024

/** One successful run. */
export interface RunCapture {
  readonly runId: string
  readonly at: string
  readonly program: string
  readonly tools: readonly string[]
  /** A shape-only schema for the run input; never the input values. */
  readonly inputSchema: Record<string, JsonValue>
  /** Argument keys the run's tool calls were wired with (dotted paths, no values). */
  readonly parameterPaths?: readonly string[]
  /** The contracts the run actually called, in trace order. */
  readonly contracts: readonly string[]
  /** The input schema was OBSERVED from the run, never generated. */
  readonly schemaSource?: 'observed'
  /** How much the schema describes: observed, not exhaustive. */
  readonly schemaCompleteness?: 'observed'
  /** When the run input was captured, ISO 8601 (may differ from `at`). */
  readonly capturedAt?: string
}

/** One capture while its optional provenance is being attached. */
interface MutableRunCapture {
  runId: string
  at: string
  program: string
  tools: string[]
  inputSchema: Record<string, JsonValue>
  parameterPaths?: readonly string[]
  contracts: string[]
  schemaSource?: 'observed'
  schemaCompleteness?: 'observed'
  capturedAt?: string
}

/** The store. */
export interface RunCaptureStore {
  readonly file: string
  readonly issue: string | undefined
  list(): RunCapture[]
  get(runId: string): RunCapture | undefined
  record(input: Omit<RunCapture, 'at'> & { readonly at?: string }): RunCapture | undefined
}

interface CaptureDocument {
  readonly version: 1
  readonly captures: readonly RunCapture[]
}

function empty(): CaptureDocument {
  return { version: 1, captures: [] }
}

/** Derive a type-only schema from a JSON value; no values are copied. */
/**
 * The canonical shape of a run input, always a valid object schema.
 *
 * `schemaShape` answers honestly for what it saw, so a missing input yields `{}`. A draft
 * is a TOOL, and a tool needs an object schema, so the canonical form of "no input" is the
 * no-argument schema. Recording and hashing both use THIS function, which is what keeps a
 * draft's content identity equal to the identity `from-run` computes for the same run.
 * @param input - the run input; absent is legitimate.
 * @returns a schema whose `type` is always 'object'.
 */
export function canonicalInputSchema(input: unknown): Record<string, JsonValue> {
  return canonicalSchema(schemaShape(input))
}

/** The no-argument schema: what "no input" means to a tool. */
const NO_INPUT_SCHEMA: Record<string, JsonValue> = { type: 'object', properties: {} }

/**
 * Normalise an ALREADY-SHAPED schema to a valid object schema.
 *
 * `record()` receives a shape, not a value: re-shaping it would produce a schema OF a
 * schema. This only guarantees the `type: 'object'` contract, so the identity a draft is
 * hashed from equals the identity `from-run` recomputes.
 * @param schema - a schema produced by `schemaShape`.
 * @returns the same schema, or the no-argument schema when it is not an object schema.
 */
export function canonicalSchema(schema: Record<string, JsonValue>): Record<string, JsonValue> {
  return schema['type'] === 'object' ? schema : NO_INPUT_SCHEMA
}

export function schemaShape(value: unknown, depth = 0): Record<string, JsonValue> {
  if (depth > 8) return {}
  if (value === null) return { type: 'null' }
  if (Array.isArray(value)) return { type: 'array', items: value.length > 0 ? schemaShape(value[0], depth + 1) : {} }
  if (typeof value === 'string') return { type: 'string' }
  if (typeof value === 'number') return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' }
  if (typeof value === 'boolean') return { type: 'boolean' }
  if (typeof value === 'object') {
    const properties: Record<string, JsonValue> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      properties[key] = schemaShape(item, depth + 1)
    }
    return { type: 'object', properties, required: Object.keys(properties) }
  }
  return {}
}

function read(file: string): { document: CaptureDocument; issue: string | undefined } {
  if (!existsSync(file)) return { document: empty(), issue: undefined }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { document: empty(), issue: 'the run-capture file is not a JSON object' }
    }
    const captures = (parsed as { captures?: unknown }).captures
    if (!Array.isArray(captures)) return { document: empty(), issue: 'the run-capture file has no captures array' }
    return { document: { version: 1, captures: captures.filter(isCapture) }, issue: undefined }
  } catch (error) {
    return { document: empty(), issue: 'the run-capture file could not be read: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

function isCapture(value: unknown): value is RunCapture {
  if (value === null || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item['runId'] === 'string'
    && typeof item['at'] === 'string'
    && typeof item['program'] === 'string'
    && Array.isArray(item['tools'])
    && item['tools'].every(tool => typeof tool === 'string')
    && typeof item['inputSchema'] === 'object' && item['inputSchema'] !== null
    && Array.isArray(item['contracts'])
}

function write(file: string, document: CaptureDocument): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = file + '.tmp-' + process.pid.toString(36) + '-' + Date.now().toString(36)
  try {
    writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, file)
  } catch (error) {
    try { rmSync(temporary, { force: true }) } catch { /* best effort */ }
    throw error
  }
}

/**
 * Open the optional run-capture store.
 * @param options - the file path.
 * @returns the store.
 */
export function createRunCaptureStore(options: { readonly file: string }): RunCaptureStore {
  const loaded = read(options.file)
  let captures: RunCapture[] = [...loaded.document.captures].slice(-MAX_RUN_CAPTURES)
  return {
    file: options.file,
    issue: loaded.issue,
    list: () => [...captures],
    get: runId => captures.find(capture => capture.runId === runId),
    record(input) {
      if (Buffer.byteLength(input.program, 'utf8') > MAX_PROGRAM_BYTES) return undefined
      const capture: MutableRunCapture = {
        runId: input.runId,
        at: input.at ?? new Date().toISOString(),
        program: input.program,
        tools: [...input.tools],
        inputSchema: canonicalSchema(input.inputSchema),
        ...input.parameterPaths === undefined ? {} : { parameterPaths: [...input.parameterPaths] },
        contracts: [...input.contracts],
      }
      // Optional provenance is copied only when the capture supplied it; nothing is
      // inferred here, so an absent value stays absent rather than becoming a claim.
      if (input.schemaSource !== undefined) capture.schemaSource = input.schemaSource
      if (input.schemaCompleteness !== undefined) capture.schemaCompleteness = input.schemaCompleteness
      if (input.capturedAt !== undefined) capture.capturedAt = input.capturedAt
      captures = [...captures.filter(existing => existing.runId !== capture.runId), capture].slice(-MAX_RUN_CAPTURES)
      write(options.file, { version: 1, captures })
      return capture
    },
  }
}
