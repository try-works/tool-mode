/**
 * Agent-authored workflows and tools.
 *
 * The research gap this module closes: an agent could RUN a Code Mode program, but it
 * could not NAME, SAVE, VERSION or RE-USE one, and it could not define a new tool at all.
 * Two host surfaces are built on top of this module:
 *
 * - `tool_mode_workflows` saves versioned programs that can be run again by name;
 * - `tool_mode_tools` defines persistent `agent_*` tools whose stored program executes
 *   through the SAME confined runner `tool_mode_run` uses.
 *
 * Authored code is never executed here: `runAuthoredProgram` is a thin wrapper over the
 * host's {@link ProgramRunner}, so the grant, the denied-name policy, the sub-call trace,
 * the budgets and the CODE-09 exposure gate are the ones already enforced for
 * `tool_mode_run`. A file is never a grant: `tools[]` is the BINDING SUBSET the program
 * declares, and the runner refuses a name it cannot attain.
 *
 * Persistence is one JSON document written atomically (tmp + rename). A corrupt file is
 * REPORTED rather than fatal: the host keeps serving with an empty surface and the next
 * save repairs the file.
 *
 * @module agent-authoring
 */

/* oxlint-disable anti-slop/no-runtime-typeof -- SAFETY: this module IS the JSON boundary for an untrusted on-disk file; `typeof` is the parse for an untyped JSON value, and every branch either validates one field or refuses the entry. */
/* oxlint-disable anti-slop/no-known-value-widening -- the document version is a literal schema marker, carried as `typeof AUTHORING_SCHEMA_VERSION`. */

import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { compileSchema, type ToolContract } from '@try-works/tool-mode-contracts'

import type { JsonValue } from './adapters/types.ts'
import { generateProgramTypes } from './ptc-authority.ts'
import { defaultStateFile } from './state.ts'
import { externalRefusal, type ProgramRunner, type RunReport } from './tool-mode-run.ts'

/** The document schema this module reads and writes. */
export const AUTHORING_SCHEMA_VERSION = 1

/**
 * A workflow name: lower kebab/snake, 2-64 characters.
 *
 * Names are the address a caller re-runs a workflow by, so they are deliberately
 * narrower than "any string": no spaces, no uppercase, no leading digit.
 */
export const WORKFLOW_NAME_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/

/** An authored tool name: the reserved `agent_` namespace, then lowercase/digits/underscore. */
export const AGENT_TOOL_NAME_PATTERN = /^agent_[a-z0-9_]{2,60}$/

/** Why an authoring operation was refused. */
export type AuthoringErrorCode =
  | 'invalid-name'
  | 'invalid-description'
  | 'invalid-program'
  | 'invalid-tools'
  | 'invalid-schema'
  | 'unknown'
  | 'gated'
  | 'unavailable'
  | 'failed'
  | 'store'

/** A refusal from the authoring layer, with a code a caller can branch on. */
export class AuthoringError extends Error {
  override readonly name = 'AuthoringError'
  /**
   * @param code - the refusal class.
   * @param message - the actionable reason.
   */
  constructor(readonly code: AuthoringErrorCode, message: string) {
    super(message)
  }
}

/** One saved workflow, versioned on every update. */
export interface AgentWorkflow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: number
  readonly program: string
  readonly tools: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
  /** The catalog revision observed when the workflow was saved (CODE-05 provenance). */
  readonly catalogRevision: string
}

/** A workflow as `list` reports it: everything but the program. */
export interface AgentWorkflowSummary {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: number
  readonly tools: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** One persisted authored tool. */
export interface AgentToolDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  /** The JSON Schema the caller's arguments are validated against. */
  readonly inputSchema: Record<string, JsonValue>
  readonly program: string
  readonly tools: readonly string[]
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** An authored tool as `list` reports it: everything but the program. */
export interface AgentToolSummary {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, JsonValue>
  readonly tools: readonly string[]
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** What a caller supplies to save a workflow. */
export interface SaveWorkflowInput {
  readonly name: string
  readonly description?: string | undefined
  readonly program: string
  readonly tools?: readonly string[]
  readonly catalogRevision?: string | undefined
}

/** What a caller supplies to define an authored tool. */
export interface SaveToolInput {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, JsonValue>
  readonly program: string
  readonly tools?: readonly string[]
}

/** The durable authoring store. */
export interface AgentAuthoringStore {
  readonly file: string
  /** A load-time problem, reported rather than fatal. */
  readonly issue: string | undefined
  /** Where a corrupt document was moved, when this instance quarantined one. */
  readonly quarantinePath?: string | undefined
  listWorkflows(): AgentWorkflowSummary[]
  getWorkflow(nameOrId: string): AgentWorkflow | undefined
  workflowEntries(): readonly AgentWorkflow[]
  saveWorkflow(input: SaveWorkflowInput): AgentWorkflow
  deleteWorkflow(nameOrId: string): boolean
  listTools(): AgentToolSummary[]
  getTool(nameOrId: string): AgentToolDefinition | undefined
  toolEntries(): readonly AgentToolDefinition[]
  saveTool(input: SaveToolInput): AgentToolDefinition
  deleteTool(nameOrId: string): boolean
}

/** The document on disk. */
interface AuthoringDocument {
  readonly version: typeof AUTHORING_SCHEMA_VERSION
  readonly workflows: readonly AgentWorkflow[]
  readonly tools: readonly AgentToolDefinition[]
}

/**
 * The default authoring file: beside the plugin's state file, so one deployment's
 * authored artifacts travel with its other durable state.
 * @param stateFile - the configured state file, when it is not the default.
 * @returns the authoring file path.
 */
export function defaultAgentAuthoringFile(stateFile?: string): string {
  return join(dirname(resolve(stateFile ?? defaultStateFile())), 'agent-authoring.json')
}

/**
 * Build the ToolContract projection an authored tool's parameters come from.
 * @param entry - the stored definition.
 * @returns the contract shape `toDshParameters` consumes.
 */
export function agentToolContract(entry: Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>): ToolContract {
  return {
    contract: `agent.${entry.name}`,
    version: '1.0.0',
    toolName: entry.name,
    description: entry.description,
    inputSchema: entry.inputSchema,
    outputSchema: {},
    semantics: { authored: true },
    limits: {},
    unsupported: [],
  }
}

/** True for a plain JSON object (never an array or null). */
function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The string members of a JSON array, or undefined when any member is not a string. */
function stringList(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return undefined
    out.push(item)
  }
  return out
}

/** Validate a workflow name. */
function requireWorkflowName(value: string): string {
  if (!WORKFLOW_NAME_PATTERN.test(value)) {
    throw new AuthoringError(
      'invalid-name',
      `"${value}" is not a workflow name: use lowercase kebab-case or snake_case, 2-64 characters (for example "double-value")`,
    )
  }
  return value
}

/** Validate an authored tool name. */
function requireAgentToolName(value: string): string {
  if (!AGENT_TOOL_NAME_PATTERN.test(value)) {
    throw new AuthoringError(
      'invalid-name',
      `"${value}" is not an authored tool name: it must match agent_[a-z0-9_]{2,60} (for example "agent_double")`,
    )
  }
  return value
}

/** Validate a non-empty description. */
function requireDescription(value: string, name: string): string {
  const description = value.trim()
  if (description.length === 0) {
    throw new AuthoringError('invalid-description', `${name} needs a non-empty description: a caller routes on it`)
  }
  return description
}

/** Validate a non-empty program body. */
function requireProgram(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new AuthoringError('invalid-program', `${name} needs a non-empty program body`)
  }
  return value
}

/** Validate the declared binding subset. */
function requireToolNames(value: readonly string[] | undefined, name: string): readonly string[] {
  const tools = value ?? []
  for (const tool of tools) {
    if (typeof tool !== 'string' || tool.trim().length === 0) {
      throw new AuthoringError('invalid-tools', `${name} declares a tool binding that is not a non-empty name`)
    }
  }
  if (tools.includes(name)) {
    throw new AuthoringError('invalid-tools', `${name} cannot bind itself: a tool's program must not call its own name`)
  }
  return [...tools]
}

/**
 * Validate the authored input schema.
 *
 * A tool whose schema the DSH registry cannot advertise would validate nothing at the
 * boundary, so the shape is checked here (object root, declared properties, consistent
 * `required`) and the schema is COMPILED so a malformed schema fails at define time
 * rather than on the first caller.
 * @param inputSchema - the candidate schema.
 * @returns the same schema object.
 */
export function requireInputSchema(inputSchema: Record<string, JsonValue>): Record<string, JsonValue> {
  if (inputSchema['type'] !== 'object') {
    throw new AuthoringError('invalid-schema', 'inputSchema must be an object schema (type: "object")')
  }
  const properties = inputSchema['properties']
  if (!isRecord(properties)) {
    throw new AuthoringError('invalid-schema', 'inputSchema must declare a "properties" object')
  }
  const required = inputSchema['required']
  if (required !== undefined) {
    if (!Array.isArray(required)) {
      throw new AuthoringError('invalid-schema', 'inputSchema "required" must be an array of property names')
    }
    for (const key of required) {
      if (typeof key !== 'string') {
        throw new AuthoringError('invalid-schema', 'inputSchema "required" must be an array of property names')
      }
      if (!(key in properties)) {
        throw new AuthoringError('invalid-schema', `inputSchema requires "${key}" but does not declare it`)
      }
    }
  }
  try {
    compileSchema(inputSchema)
  } catch (error) {
    throw new AuthoringError('invalid-schema', `inputSchema does not compile: ${error instanceof Error ? error.message : String(error)}`)
  }
  return inputSchema
}

/** Validate and normalize one authored tool definition. */
function normalizeTool(input: SaveToolInput): Omit<AgentToolDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt'> {
  const name = requireAgentToolName(input.name)
  return {
    name,
    description: requireDescription(input.description, name),
    inputSchema: requireInputSchema(input.inputSchema),
    program: requireProgram(input.program, name),
    tools: requireToolNames(input.tools, name),
  }
}

/** Parse a workflow entry loaded from disk; undefined when it is not usable. */
function parseWorkflowEntry(raw: JsonValue): AgentWorkflow | undefined {
  if (!isRecord(raw)) return undefined
  const { id, name, description, version, program, tools, createdAt, updatedAt, catalogRevision } = raw
  if (typeof id !== 'string' || typeof name !== 'string' || !WORKFLOW_NAME_PATTERN.test(name)) return undefined
  if (typeof description !== 'string' || typeof program !== 'string' || program.trim().length === 0) return undefined
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return undefined
  const toolNames = stringList(tools)
  if (toolNames === undefined) return undefined
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') return undefined
  if (typeof catalogRevision !== 'string') return undefined
  return { id, name, description, version, program, tools: toolNames, createdAt, updatedAt, catalogRevision }
}

/** Parse an authored tool entry loaded from disk; undefined when it is not usable. */
function parseToolEntry(raw: JsonValue): AgentToolDefinition | undefined {
  if (!isRecord(raw)) return undefined
  const { id, name, description, inputSchema, program, tools, version, createdAt, updatedAt } = raw
  if (typeof id !== 'string' || typeof name !== 'string' || !AGENT_TOOL_NAME_PATTERN.test(name)) return undefined
  if (typeof description !== 'string' || typeof program !== 'string' || program.trim().length === 0) return undefined
  if (!isRecord(inputSchema)) return undefined
  try {
    requireInputSchema(inputSchema)
  } catch {
    return undefined
  }
  const toolNames = stringList(tools)
  if (toolNames === undefined) return undefined
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return undefined
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') return undefined
  return { id, name, description, inputSchema, program, tools: toolNames, version, createdAt, updatedAt }
}

/** Read and validate the document, reporting (never throwing) a corrupt file. */
function readDocument(file: string): {
  readonly document: AuthoringDocument
  readonly issue: string | undefined
  /** True only when the BYTES are unusable and must be preserved under a quarantine name. */
  readonly corrupt: boolean
} {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error['code'] === 'ENOENT') {
      return { document: { version: AUTHORING_SCHEMA_VERSION, workflows: [], tools: [] }, issue: undefined, corrupt: false }
    }
    // Unreadable is not necessarily corrupt: the bytes may be fine and the permissions not.
    return {
      document: { version: AUTHORING_SCHEMA_VERSION, workflows: [], tools: [] },
      issue: `the authoring file cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      corrupt: false,
    }
  }
  if (text.trim().length === 0) {
    return { document: { version: AUTHORING_SCHEMA_VERSION, workflows: [], tools: [] }, issue: undefined, corrupt: false }
  }
  let parsed: JsonValue
  try {
    // SAFETY: JSON.parse produces a JSON value; every field is validated below before use.
    parsed = JSON.parse(text) as JsonValue
  } catch (error) {
    return {
      document: { version: AUTHORING_SCHEMA_VERSION, workflows: [], tools: [] },
      issue: `the authoring file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      corrupt: true,
    }
  }
  if (!isRecord(parsed)) {
    return { document: { version: AUTHORING_SCHEMA_VERSION, workflows: [], tools: [] }, issue: 'the authoring file is not a JSON object', corrupt: true }
  }
  if (parsed['version'] !== AUTHORING_SCHEMA_VERSION) {
    return {
      document: { version: AUTHORING_SCHEMA_VERSION, workflows: [], tools: [] },
      issue: `the authoring file has unsupported schema version ${String(parsed['version'])}`,
      corrupt: true,
    }
  }
  const workflows = (Array.isArray(parsed['workflows']) ? parsed['workflows'] : [])
    .map(parseWorkflowEntry)
    .filter((entry): entry is AgentWorkflow => entry !== undefined)
  const tools = (Array.isArray(parsed['tools']) ? parsed['tools'] : [])
    .map(parseToolEntry)
    .filter((entry): entry is AgentToolDefinition => entry !== undefined)
  const declared = (Array.isArray(parsed['workflows']) ? parsed['workflows'].length : 0)
    + (Array.isArray(parsed['tools']) ? parsed['tools'].length : 0)
  const kept = workflows.length + tools.length
  return {
    document: { version: AUTHORING_SCHEMA_VERSION, workflows, tools },
    issue: kept === declared ? undefined : `ignored ${declared - kept} invalid entr${declared - kept === 1 ? 'y' : 'ies'} in the authoring file`,
    corrupt: false,
  }
}

/** Write the document atomically: a crash leaves the old file, never a half-written one. */
function writeDocument(file: string, document: AuthoringDocument): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.tmp-${process.pid.toString(36)}-${Date.now().toString(36)}`
    // Owner-only, like the receipt store: authored programs can embed prompts and URLs.
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    try {
      renameSync(temporary, file)
    } catch (error) {
      try {
        rmSync(temporary, { force: true })
      } catch {
        // The temporary file is a lock-file-like leftover; the original error is the report.
      }
      throw error
    }
  } catch (error) {
    throw new AuthoringError('store', `the authoring file cannot be written: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Render one saved workflow as its summary. */
function summarizeWorkflow(workflow: AgentWorkflow): AgentWorkflowSummary {
  return {
    id: workflow.id, name: workflow.name, description: workflow.description, version: workflow.version,
    tools: workflow.tools, createdAt: workflow.createdAt, updatedAt: workflow.updatedAt,
  }
}

/** Render one authored tool as its summary. */
function summarizeTool(tool: AgentToolDefinition): AgentToolSummary {
  return {
    id: tool.id, name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
    tools: tool.tools, version: tool.version, createdAt: tool.createdAt, updatedAt: tool.updatedAt,
  }
}

/** Find an entry by NAME or ID; names are the stable address, ids the immutable one. */
function byNameOrId<T extends { readonly id: string; readonly name: string }>(entries: readonly T[], key: string): T | undefined {
  return entries.find(entry => entry.name === key) ?? entries.find(entry => entry.id === key)
}

/**
 * Create the durable authoring store.
 * @param options - the file path and an optional logger for a load-time issue.
 * @returns the store.
 */
export function createAgentAuthoringStore(options: { readonly file: string }): AgentAuthoringStore {
  let document: AuthoringDocument
  const loaded = readDocument(options.file)
  document = loaded.document
  const issue = loaded.issue
  // A CORRUPT document is moved aside before anything can overwrite it. Best effort: if
  // the rename fails, the bytes stay in place (still corrupt, still preserved) and the
  // issue explains what was wrong.
  let quarantinePath: string | undefined
  if (loaded.corrupt && existsSync(options.file)) {
    const target = `${options.file}.quarantined-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
    try {
      renameSync(options.file, target)
      quarantinePath = target
    } catch {
      // The original bytes remain where they were; nothing was destroyed.
    }
  }

  const persist = (next: AuthoringDocument): void => {
    writeDocument(options.file, next)
    document = next
  }

  return {
    file: options.file,
    issue,
    quarantinePath,
    listWorkflows: () => document.workflows.map(summarizeWorkflow),
    getWorkflow: key => byNameOrId(document.workflows, key),
    workflowEntries: () => document.workflows,
    saveWorkflow(input) {
      const name = requireWorkflowName(input.name)
      const program = requireProgram(input.program, name)
      const tools = requireToolNames(input.tools, name)
      const now = new Date().toISOString()
      const existing = document.workflows.find(workflow => workflow.name === name)
      const entry: AgentWorkflow = {
        id: existing?.id ?? `wf_${randomUUID()}`,
        name,
        description: input.description?.trim() ?? existing?.description ?? '',
        version: (existing?.version ?? 0) + 1,
        program,
        tools,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        catalogRevision: input.catalogRevision ?? existing?.catalogRevision ?? '',
      }
      persist({
        ...document,
        workflows: existing === undefined
          ? [...document.workflows, entry]
          : document.workflows.map(workflow => workflow.name === name ? entry : workflow),
      })
      return entry
    },
    deleteWorkflow(key) {
      const existing = byNameOrId(document.workflows, key)
      if (existing === undefined) return false
      persist({ ...document, workflows: document.workflows.filter(workflow => workflow.id !== existing.id) })
      return true
    },
    listTools: () => document.tools.map(summarizeTool),
    getTool: key => byNameOrId(document.tools, key),
    toolEntries: () => document.tools,
    saveTool(input) {
      const normalized = normalizeTool(input)
      const now = new Date().toISOString()
      const existing = document.tools.find(tool => tool.name === normalized.name)
      const entry: AgentToolDefinition = {
        id: existing?.id ?? `agent_${randomUUID()}`,
        ...normalized,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      persist({
        ...document,
        tools: existing === undefined
          ? [...document.tools, entry]
          : document.tools.map(tool => tool.name === normalized.name ? entry : tool),
      })
      return entry
    },
    deleteTool(key) {
      const existing = byNameOrId(document.tools, key)
      if (existing === undefined) return false
      persist({ ...document, tools: document.tools.filter(tool => tool.id !== existing.id) })
      return true
    },
  }
}

/** What one authored run needs. */
export interface AuthoredRunOptions {
  readonly program: string
  readonly tools: readonly string[]
  readonly input?: JsonValue | undefined
  readonly runner: ProgramRunner
  readonly receiptId: string
  readonly catalogRevision: string
}

/**
 * Run one authored program through the host's confined runner.
 *
 * This is the AUTHORING sibling of `serveProgram`: same gate, same runner, same report
 * shape, but a program may declare ZERO tool bindings (a pure transform is a legitimate
 * workflow). `serveProgram` refuses an empty `tools[]` because that is the CODE-02
 * contract's choice; the store must not inherit it.
 * @param options - the stored program, its binding subset, the input and the runner.
 * @returns the same report `tool_mode_run` produces.
 * @throws AuthoringError when the gate is closed, the backend is missing, or the run fails.
 */
export async function runAuthoredProgram(options: AuthoredRunOptions): Promise<RunReport> {
  const refusal = externalRefusal(options.runner)
  if (refusal !== undefined) throw new AuthoringError('gated', refusal.message)
  if (options.program.trim().length === 0) {
    throw new AuthoringError('invalid-program', 'the stored program body is empty')
  }
  const prepared = await options.runner.prepare()
  if (!prepared.mounted && prepared.reason === 'backend-unavailable') {
    throw new AuthoringError('unavailable', 'the Node PTC backend is unavailable on this deployment, so no program can run')
  }
  const started = Date.now()
  const request = options.input === undefined
    ? { program: options.program, requested: options.tools }
    : { program: options.program, requested: options.tools, input: options.input }
  const outcome = await options.runner.run(request)
  if (!outcome.ok) throw new AuthoringError('failed', `${outcome.code}: ${outcome.message}`)
  return {
    result: outcome.value ?? null,
    logs: [
      ...outcome.logs,
      `tool_mode_accounting:${JSON.stringify({ toolCalls: outcome.toolCalls, calls: outcome.calls })}`,
    ],
    meta: {
      receiptId: options.receiptId,
      elapsedMs: Date.now() - started,
      toolCalls: outcome.toolCalls,
      calls: outcome.calls,
      catalogRevision: options.catalogRevision,
      warnings: [],
      typescript: generateProgramTypes(options.tools),
    },
  }
}
