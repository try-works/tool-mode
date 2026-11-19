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
 * ## Scoping
 *
 * Authored artifacts are not one global namespace. Each row carries a {@link ArtifactScope}
 * (`session`, `workspace`, or `global`) and a scope key, and a caller's
 * {@link ArtifactScopeContext} resolves a name through `session > workspace > global`.
 * Resolution is never silent: a summary reports the scope that won AND the nearest lower row
 * it hides (`shadowing`), so "why am I running that version?" is answerable from the list.
 *
 * The invariants this module enforces:
 *
 * - a name may exist at several scopes; the nearest wins and the duplicate is allowed;
 * - two root sessions never resolve each other's session rows, under any name or id;
 * - deleting a nearer row unshadows the lower one instead of deleting it;
 * - promotion COPIES to a target scope, resets `version` to 1 and records `promotedFrom`,
 *   and never renames — a caller holding `workflow_x` keeps working;
 * - a legacy (v1) document is read as `global`/`host` on first read and rewritten as v2;
 * - a call with no context is the OLD behaviour exactly: global scope only.
 *
 * @module agent-authoring
 */

/* oxlint-disable anti-slop/no-runtime-typeof -- SAFETY: this module IS the JSON boundary for an untrusted on-disk file; `typeof` is the parse for an untyped JSON value, and every branch either validates one field or refuses the entry. */
/* oxlint-disable anti-slop/no-known-value-widening -- the document version is a literal schema marker, carried as `typeof AUTHORING_SCHEMA_VERSION`. */
/* oxlint-disable anti-slop/no-conditional-empty-object-spread -- `exactOptionalPropertyTypes` forbids assigning `undefined` to an optional property, so an absent optional field must be OMITTED. A conditional spread is the only form that omits without a mutable intermediate object, and every row interface here is readonly. Each site constructs a fully typed row, so the empty branch can only ever mean "this field is absent", never "drop a value". */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { compileSchema, type ToolContract } from '@try-works/tool-mode-contracts'

import type { JsonValue } from './adapters/types.ts'
import { generateProgramTypes } from './ptc-authority.ts'
import { defaultStateFile } from './state.ts'
import { externalRefusal, type ProgramRunner, type RunReport } from './tool-mode-run.ts'

/** The document schema this module WRITES. */
export const AUTHORING_SCHEMA_VERSION = 2

/**
 * The document schema this module still READS.
 *
 * v1 had no scoping: every row was implicitly host-global. Migration is a read-time
 * interpretation (`global`/`host`), never a data move or a rename.
 */
export const LEGACY_AUTHORING_SCHEMA_VERSION = 1

/**
 * The default lifetime of an unkept draft: 24 hours from `updatedAt`.
 *
 * Additive within schema 2: `status` and `expiresAt` are OPTIONAL row fields, so an older
 * build reading the same document drops them (the parsers rebuild rows field by field)
 * and treats the rows as kept. That is deliberate: bumping the document version instead
 * would make every older build quarantine the whole authoring file as 'unsupported
 * schema version' (readDocument), losing the user's artifacts from view on a downgrade.
 */
export const DEFAULT_DRAFT_TTL_MS = 86_400_000

/** Whether a row is a live library member or an unkept draft. */
export type ArtifactStatus = 'draft' | 'kept'

/**
 * The scope key that stands for "this host".
 *
 * Global rows are keyed by this constant rather than by the empty string so a missing
 * key is distinguishable from a deliberately global row.
 */
export const GLOBAL_SCOPE_KEY = 'host'

/**
 * A workflow name: lower kebab/snake, 2-64 characters.
 *
 * Names are the address a caller re-runs a workflow by, so they are deliberately
 * narrower than "any string": no spaces, no uppercase, no leading digit.
 */
export const WORKFLOW_NAME_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/

/** An authored tool name: the reserved `agent_` namespace, then lowercase/digits/underscore. */
export const AGENT_TOOL_NAME_PATTERN = /^agent_[a-z0-9_]{2,60}$/

/**
 * Where an authored artifact lives at rest.
 *
 * - `session` — private to one ROOT session (subagents share their root's);
 * - `workspace` — shared by sessions that resolve the same workspace key;
 * - `global` — this host, every session and workspace.
 */
export type ArtifactScope = 'session' | 'workspace' | 'global'

/** Every legal scope, in resolution order (nearest first). */
export const ARTIFACT_SCOPES: readonly ArtifactScope[] = ['session', 'workspace', 'global']

/**
 * What a caller's resolution needs to know.
 *
 * `scope` is the scope a WRITE lands at; `scopeKey` and `workspaceKey` are the keys
 * RESOLUTION uses. Keeping them together means a caller cannot accidentally write at one
 * scope while resolving through another's keys.
 */
export interface ArtifactScopeContext {
  /** The target scope for a write. */
  readonly scope: ArtifactScope
  /** The session id for `session`, the workspace key for `workspace` (see `workspaceKey`). */
  readonly scopeKey: string
  /** The workspace key, when the workspace differs from `scopeKey`. Falls back to `scopeKey`. */
  readonly workspaceKey?: string | undefined
  /** The root session id, recorded on the artifact for provenance. */
  readonly sessionId?: string | undefined
}

/**
 * Where a promoted artifact came from.
 *
 * `tools` is the binding subset the artifact was created with, so a later drift in the
 * resolved tool list is diagnosable rather than mysterious.
 */
export interface PromotedFrom {
  readonly scope: ArtifactScope
  readonly scopeKey: string
  /** The SOURCE version this copy was taken from. */
  readonly version: number
  /** When the promotion happened (ISO 8601). */
  readonly at: string
  /**
   * The session that performed the promotion, when one was known.
   *
   * Deliberately NOT `string | undefined`: under `exactOptionalPropertyTypes` an explicit
   * `| undefined` makes the property unassignable to a plain optional (`sessionId?: string`)
   * elsewhere in the host, and nothing here ever needs to SET it to undefined — the field is
   * omitted instead.
   */
  readonly sessionId?: string
  readonly tools: readonly string[]
}

/** Caller-supplied overrides for the recorded provenance; anything omitted is filled from the source. */
export type PromotedFromInput = Partial<PromotedFrom>

/** The nearest lower-scope row a resolved artifact hides. */
export interface ArtifactShadow {
  readonly scope: ArtifactScope
  readonly version: number
}

/** The nearest HIGHER-scope row that hides this one (U26). */
export interface ArtifactShadowedBy extends ArtifactShadow {
  /** The exact key of the hiding row: session id, workspace key, or host. */
  readonly scopeKey: string
}

/** How a list call reports rows. */
export interface ListOptions {
  /** Report every row visible to the context, not only the winning row per name. */
  readonly all?: boolean
}

/** What {@link AgentAuthoringStore.expireSession} removed. */
export interface ExpiredArtifacts {
  readonly workflows: readonly AgentWorkflow[]
  readonly tools: readonly AgentToolDefinition[]
}

/** The artifact a promotion produced, tagged by kind so a caller need not guess. */
export type PromotedArtifact =
  | { readonly kind: 'workflow'; readonly workflow: AgentWorkflow }
  | { readonly kind: 'tool'; readonly tool: AgentToolDefinition }

/**
 * The callable tool name a saved workflow publishes.
 *
 * Workflow names may contain hyphens; tool names may not, so the hyphen is mapped
 * to an underscore. The prefix keeps workflow tools distinguishable from authored
 * agent tools and from model tools.
 * @param name - the workflow name.
 * @returns the lower snake_case tool name.
 */
export function workflowToolName(name: string): string {
  return 'workflow_' + name.replace(/-/g, '_')
}

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
  /** The target scope already holds that name. */
  | 'scope-conflict'
  /** A scope or scope key that does not name a legal scope. */
  | 'scope-unknown'
  /** The artifact is absent at the scope the call named. */
  | 'artifact-not-found'
  /** Scoping is off for this host and a non-global scope was requested. */
  | 'scope-disabled'

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
  /** Draft lifecycle: absent means kept. Additive in schema 2; older builds drop it. */
  readonly status?: ArtifactStatus
  /** When an unkept draft expires (ISO 8601); absent on kept rows. */
  readonly expiresAt?: string
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: number
  readonly program: string
  readonly tools: readonly string[]
  /** The JSON Schema a caller's arguments are validated against. */
  readonly inputSchema: Record<string, JsonValue>
  readonly createdAt: string
  readonly updatedAt: string
  /** The catalog revision observed when the workflow was saved (CODE-05 provenance). */
  readonly catalogRevision: string
  /** The scope this row lives at. */
  readonly scope: ArtifactScope
  /** The scope key: session id, workspace key, or {@link GLOBAL_SCOPE_KEY}. */
  readonly scopeKey: string
  /** SHA-256 of the canonical content (description, program, tools, inputSchema). */
  readonly digest: string
  /** Set on a copy produced by a promotion; absent otherwise. */
  readonly promotedFrom?: PromotedFrom
  /** The root session that created the row, when one was known. */
  readonly createdBySession?: string | undefined
}

/** A workflow as `list` reports it: everything but the program. */
export interface AgentWorkflowSummary {
  /** Draft lifecycle: absent means kept. Additive in schema 2; older builds drop it. */
  readonly status?: ArtifactStatus
  /** When an unkept draft expires (ISO 8601); absent on kept rows. */
  readonly expiresAt?: string
  readonly id: string
  readonly name: string
  /** The name a caller invokes (workflow_<name>). */
  readonly callableName: string
  readonly description: string
  readonly version: number
  readonly tools: readonly string[]
  readonly inputSchema: Record<string, JsonValue>
  readonly createdAt: string
  readonly updatedAt: string
  /** The scope this row lives at. */
  readonly scope: ArtifactScope
  /** The scope key: session id, workspace key, or {@link GLOBAL_SCOPE_KEY}. */
  readonly scopeKey: string
  /** SHA-256 of the canonical content (description, program, tools, inputSchema). */
  readonly digest: string
  /** Set on a copy produced by a promotion; absent otherwise. */
  readonly promotedFrom?: PromotedFrom
  /** The root session that created the row, when one was known. */
  readonly createdBySession?: string | undefined
  /** The nearest lower-scope row this one hides, or null when it hides nothing. */
  readonly shadowing: ArtifactShadow | null
  /** The nearest higher-scope row that hides this one; absent when it is a winner. */
  readonly shadowedBy?: ArtifactShadowedBy
}

/** One persisted authored tool. */
export interface AgentToolDefinition {
  /** Draft lifecycle: absent means kept. Additive in schema 2; older builds drop it. */
  readonly status?: ArtifactStatus
  /** When an unkept draft expires (ISO 8601); absent on kept rows. */
  readonly expiresAt?: string
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
  /** The scope this row lives at. */
  readonly scope: ArtifactScope
  /** The scope key: session id, workspace key, or {@link GLOBAL_SCOPE_KEY}. */
  readonly scopeKey: string
  /** SHA-256 of the canonical content (description, program, tools, inputSchema). */
  readonly digest: string
  /** Set on a copy produced by a promotion; absent otherwise. */
  readonly promotedFrom?: PromotedFrom
  /** The root session that created the row, when one was known. */
  readonly createdBySession?: string | undefined
}

/** An authored tool as `list` reports it: everything but the program. */
export interface AgentToolSummary {
  /** Draft lifecycle: absent means kept. Additive in schema 2; older builds drop it. */
  readonly status?: ArtifactStatus
  /** When an unkept draft expires (ISO 8601); absent on kept rows. */
  readonly expiresAt?: string
  readonly id: string
  readonly name: string
  /** Authored tools are callable under their stored name. */
  readonly callableName: string
  readonly description: string
  readonly inputSchema: Record<string, JsonValue>
  readonly tools: readonly string[]
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  /** The scope this row lives at. */
  readonly scope: ArtifactScope
  /** The scope key: session id, workspace key, or {@link GLOBAL_SCOPE_KEY}. */
  readonly scopeKey: string
  /** SHA-256 of the canonical content (description, program, tools, inputSchema). */
  readonly digest: string
  /** Set on a copy produced by a promotion; absent otherwise. */
  readonly promotedFrom?: PromotedFrom
  /** The root session that created the row, when one was known. */
  readonly createdBySession?: string | undefined
  /** The nearest lower-scope row this one hides, or null when it hides nothing. */
  readonly shadowing: ArtifactShadow | null
  /** The nearest higher-scope row that hides this one; absent when it is a winner. */
  readonly shadowedBy?: ArtifactShadowedBy
}

/**
 * The deterministic draft name for one run.
 *
 * Derived rather than stored: the run id is hashed so a second success for the same run
 * finds the SAME row without adding a `runId` field to the row schema. The 8-hex body
 * keeps the whole name inside the host's 64-character authored-name cap.
 * @param runId - the run (receipt) id a capture was recorded under.
 * @returns `agent_from_draft_<first 8 hex of sha256(runId)>`.
 */
export function draftToolName(digest: string): string {
  return 'agent_from_draft_' + digest.slice(0, 8)
}

/** The content a draft's identity comes from. */
export interface DraftContent {
  readonly program: string
  readonly tools: readonly string[]
  readonly inputSchema: Record<string, JsonValue>
}

/**
 * The SHA-256 a draft is identified by: program, bindings and input schema.
 *
 * Content, not the run id. Two runs of the SAME program are the same draft (a re-run
 * refreshes `expiresAt` in place); a genuinely different program or schema is a different
 * draft. That is what makes "a second success updates rather than accumulates" true
 * without storing a run id on the row.
 * @param content - the captured program, bindings and shape-only schema.
 * @returns the lower-case hex SHA-256.
 */
export function draftContentDigest(content: DraftContent): string {
  return createHash('sha256').update(canonicalJson({
    program: content.program,
    tools: [...content.tools],
    inputSchema: content.inputSchema,
  }), 'utf8').digest('hex')
}

/**
 * The deterministic draft name for one captured content.
 * @param content - the captured program, bindings and shape-only schema.
 * @returns `agent_from_draft_<first 8 hex of the content digest>`.
 */
export function draftNameForContent(content: DraftContent): string {
  return draftToolName(draftContentDigest(content))
}

/** Injected clock, so retention tests never sleep. */
export interface DraftClock {
  /** Epoch milliseconds; defaults to the wall clock. */
  readonly now?: number
  /** Overrides {@link DEFAULT_DRAFT_TTL_MS}. */
  readonly ttlMs?: number
}

/** Options for one draft promotion. */
export interface PromoteDraftOptions {
  /** The name the promoted tool takes; defaults to the draft's own name. */
  readonly name?: string
  /** Where the draft resolves from; omitted means the caller's chain. */
  readonly from?: ArtifactScopeContext
  /** The target scope; omitted means the caller's write target. */
  readonly to?: ArtifactScopeContext
  /** Keep the draft row after copying (default false: a promotion consumes the draft). */
  readonly keepSource?: boolean
  /** Epoch milliseconds; defaults to the wall clock. */
  readonly now?: number
}

/** What a caller supplies to save a draft distilled from a run. */
export interface SaveDraftInput {
  readonly runId: string
  readonly program: string
  readonly tools?: readonly string[]
  readonly inputSchema: Record<string, JsonValue>
  readonly description?: string | undefined
  readonly catalogRevision?: string | undefined
}

/** What a caller supplies to save a workflow. */
export interface SaveWorkflowInput {
  readonly name: string
  readonly description?: string | undefined
  readonly program: string
  readonly tools?: readonly string[]
  readonly inputSchema?: Record<string, JsonValue> | undefined
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

/**
 * The durable authoring store.
 *
 * Every read and write takes an OPTIONAL {@link ArtifactScopeContext}. Omitting it is not
 * "no scoping": it is the precise old behaviour — resolve and write at `global` only — so a
 * caller that predates scoping cannot accidentally see a session's private artifacts.
 */
export interface AgentAuthoringStore {
  readonly file: string
  /** A load-time problem, reported rather than fatal. */
  readonly issue: string | undefined
  /** Where a corrupt document was moved, when this instance quarantined one. */
  readonly quarantinePath?: string | undefined

  /**
   * List workflows, resolved per name through the caller's scope chain.
   * @param context - the caller's scope keys; omitted means global only.
   * @param options - `all: true` reports every visible row instead of the winners.
   * @returns one summary per name (or every visible row), each carrying scope and shadowing.
   */
  listWorkflows(context?: ArtifactScopeContext, options?: ListOptions): AgentWorkflowSummary[]
  getWorkflow(nameOrId: string, context?: ArtifactScopeContext): AgentWorkflow | undefined
  workflowEntries(context?: ArtifactScopeContext): readonly AgentWorkflow[]
  saveWorkflow(input: SaveWorkflowInput, context?: ArtifactScopeContext): AgentWorkflow
  deleteWorkflow(nameOrId: string, context?: ArtifactScopeContext): boolean

  listTools(context?: ArtifactScopeContext, options?: ListOptions): AgentToolSummary[]
  getTool(nameOrId: string, context?: ArtifactScopeContext): AgentToolDefinition | undefined
  toolEntries(context?: ArtifactScopeContext): readonly AgentToolDefinition[]
  saveTool(input: SaveToolInput, context?: ArtifactScopeContext): AgentToolDefinition

  /**
   * Save (or refresh) the draft distilled from one successful run.
   *
   * The row is named by {@link draftToolName} so a repeat success for the same run UPDATES
   * the draft instead of accumulating duplicates. Identity is scope-exact: a second
   * session's draft for the same run is a different row, by construction.
   * @param input - the captured program, bindings and shape-only schema.
   * @param context - the caller's scope chain; omitted means global only.
   * @param clock - injected clock/ttl, so tests do not sleep.
   * @returns the stored draft row.
   */
  saveDraft(input: SaveDraftInput, context?: ArtifactScopeContext, clock?: DraftClock): AgentToolDefinition

  /**
   * Remove every expired, unkept draft visible to `context` and return what was removed.
   *
   * Bounded per call: the sweep is a janitor, not a full-table rewrite. Kept rows and
   * promoted copies are never candidates.
   * @param options - injected clock/ttl.
   * @param context - the scope chain to sweep; omitted means global only.
   * @returns the removed draft rows.
   */
  expireDrafts(options: DraftClock, context?: ArtifactScopeContext): readonly AgentToolDefinition[]

  /**
   * Promote one run's draft in a single write, optionally renaming it.
   *
   * The digest is preserved (content did not change), the draft is consumed unless
   * `keepSource`, and the rename lands in the same atomic persist as the copy.
   * @param runId - the run whose draft is promoted.
   * @param options - name, scopes, keepSource and clock.
   * @returns the promoted artifact, tagged by kind.
   * @throws AuthoringError `artifact-not-found` when no draft exists for the run.
   */
  promoteDraft(runId: string, options: PromoteDraftOptions): PromotedArtifact
  deleteTool(nameOrId: string, context?: ArtifactScopeContext): boolean

  /**
   * Copy an artifact to another scope without renaming it.
   *
   * The target refuses a name it already holds (`scope-conflict`). `keepSource` defaults to
   * true: promotion COPIES, and moving is the explicit `keepSource: false` case.
   * @param name - the artifact name (the `agent_` prefix selects a tool, otherwise a workflow).
   * @param fromContext - where to resolve the source; omitted means global only.
   * @param toContext - the target scope; its `scope` selects the target.
   * @param promotedFrom - provenance overrides; missing fields are filled from the source.
   * @param keepSource - keep the source row after a successful copy (default true).
   * @returns the copied artifact, tagged by kind.
   */
  promote(
    name: string,
    fromContext: ArtifactScopeContext | undefined,
    toContext: ArtifactScopeContext | undefined,
    promotedFrom?: PromotedFromInput,
    keepSource?: boolean,
  ): PromotedArtifact

  /**
   * Remove the row resolution finds for `name`, handing resolution back to the lower scope.
   * @param name - the artifact name.
   * @param context - the caller's scope keys; omitted means global only.
   * @returns true when a row was removed.
   * @throws AuthoringError `artifact-not-found` when nothing resolves.
   */
  demote(name: string, context?: ArtifactScopeContext): boolean

  /**
   * Remove every session-scoped row for one root session and return them.
   *
   * This is the expiry primitive: the caller decides whether to offer promotion first. It
   * never touches workspace or global rows, and never auto-promotes.
   * @param sessionId - the ROOT session id (the session scope key).
   * @returns the removed rows, by kind.
   */
  expireSession(sessionId: string): ExpiredArtifacts

  /** Every session-scoped workflow for one root session (unresolved, in save order). */
  sessionWorkflows(sessionId: string): readonly AgentWorkflow[]
  /** Every session-scoped authored tool for one root session (unresolved, in save order). */
  sessionTools(sessionId: string): readonly AgentToolDefinition[]
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
    // A program's value is arbitrary JSON. Declaring every JSON root (rather than
    // opaque text or an object-only shape) lets a caller see a real interface while
    // still allowing a program to return a bare string, number or array.
    outputSchema: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
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

/** The validated content of an authored tool, before it is given identity and scope. */
interface NormalizedTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, JsonValue>
  readonly program: string
  readonly tools: readonly string[]
}

/** Validate and normalize one authored tool definition. */
function normalizeTool(input: SaveToolInput): NormalizedTool {
  const name = requireAgentToolName(input.name)
  return {
    name,
    description: requireDescription(input.description, name),
    inputSchema: requireInputSchema(input.inputSchema),
    program: requireProgram(input.program, name),
    tools: requireToolNames(input.tools, name),
  }
}

/** The scoping fields a stored row carries; a v1 row gets the global defaults. */
interface RowProvenance {
  readonly scope: ArtifactScope
  readonly scopeKey: string
  readonly promotedFrom?: PromotedFrom
  readonly createdBySession?: string
}

/**
 * Read the scoping fields off a stored row.
 *
 * Absent means "written before scoping existed", which migrates to `global`/`host`. PRESENT
 * but malformed means the row is not usable: silently re-scoping a row whose scope field was
 * corrupted would move an artifact between namespaces, which is worse than dropping it.
 * @param raw - the stored object.
 * @returns the provenance, or undefined when the row must be ignored.
 */
function parseProvenance(raw: { readonly [key: string]: JsonValue }): RowProvenance | undefined {
  const rawScope = raw['scope']
  const scope = rawScope === undefined ? 'global' : parseScope(rawScope)
  if (scope === undefined) return undefined
  const rawKey = raw['scopeKey']
  const scopeKey = rawKey === undefined
    ? GLOBAL_SCOPE_KEY
    : typeof rawKey === 'string' && rawKey.length > 0 ? rawKey : undefined
  if (scopeKey === undefined) return undefined
  const promotedFrom = parsePromotedFrom(raw['promotedFrom'])
  if (raw['promotedFrom'] !== undefined && promotedFrom === undefined) return undefined
  const createdBySession = raw['createdBySession']
  if (createdBySession !== undefined && typeof createdBySession !== 'string') return undefined
  return {
    scope,
    scopeKey,
    ...(promotedFrom === undefined ? {} : { promotedFrom }),
    ...(createdBySession === undefined ? {} : { createdBySession }),
  }
}

/** Parse a workflow entry loaded from disk; undefined when it is not usable. */
/**
 * Optional draft fields, parsed additively. An absent status means KEPT: that is the
 * schema-2 default, so a document written before drafts (or by an older build) reads as
 * kept rows rather than as drafts that could expire.
 * @param raw - one row from disk.
 * @returns the draft fields that are present and valid.
 */
function draftFields(raw: JsonValue): { readonly status?: ArtifactStatus; readonly expiresAt?: string } {
  if (!isRecord(raw)) return {}
  const status = raw['status']
  const expiresAt = raw['expiresAt']
  return {
    ...(status === 'draft' || status === 'kept' ? { status } : {}),
    ...(typeof expiresAt === 'string' ? { expiresAt } : {}),
  }
}

function parseWorkflowEntry(raw: JsonValue): AgentWorkflow | undefined {
  if (!isRecord(raw)) return undefined
  const { id, name, description, version, program, tools, inputSchema, createdAt, updatedAt, catalogRevision } = raw
  if (typeof id !== 'string' || typeof name !== 'string' || !WORKFLOW_NAME_PATTERN.test(name)) return undefined
  const schema = inputSchema === undefined ? { type: 'object', properties: {} } : inputSchema
  if (!isRecord(schema)) return undefined
  try { requireInputSchema(schema) } catch { return undefined }
  if (typeof description !== 'string' || typeof program !== 'string' || program.trim().length === 0) return undefined
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return undefined
  const toolNames = stringList(tools)
  if (toolNames === undefined) return undefined
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') return undefined
  if (typeof catalogRevision !== 'string') return undefined
  const provenance = parseProvenance(raw)
  if (provenance === undefined) return undefined
  return {
    ...draftFields(raw),
    id, name, description, version, program, tools: toolNames,
    inputSchema: schema,
    createdAt, updatedAt, catalogRevision,
    scope: provenance.scope,
    scopeKey: provenance.scopeKey,
    digest: artifactDigest({ description, program, tools: toolNames, inputSchema: schema }),
    ...(provenance.promotedFrom === undefined ? {} : { promotedFrom: provenance.promotedFrom }),
    ...(provenance.createdBySession === undefined ? {} : { createdBySession: provenance.createdBySession }),
  }
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
  const provenance = parseProvenance(raw)
  if (provenance === undefined) return undefined
  return {
    ...draftFields(raw),
    id, name, description, inputSchema, program, tools: toolNames, version, createdAt, updatedAt,
    scope: provenance.scope,
    scopeKey: provenance.scopeKey,
    digest: artifactDigest({ description, program, tools: toolNames, inputSchema }),
    ...(provenance.promotedFrom === undefined ? {} : { promotedFrom: provenance.promotedFrom }),
    ...(provenance.createdBySession === undefined ? {} : { createdBySession: provenance.createdBySession }),
  }
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
  // v1 is READ, not rejected: it had no scoping, so its rows are host-global. Anything else
  // is genuinely unknown, and quarantining is safer than guessing at a future schema.
  const documentVersion = parsed['version']
  if (documentVersion !== AUTHORING_SCHEMA_VERSION && documentVersion !== LEGACY_AUTHORING_SCHEMA_VERSION) {
    return {
      document: { version: AUTHORING_SCHEMA_VERSION, workflows: [], tools: [] },
      issue: `the authoring file has unsupported schema version ${String(documentVersion)}: ` +
        `this build reads ${LEGACY_AUTHORING_SCHEMA_VERSION} or ${AUTHORING_SCHEMA_VERSION}`,
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

/** The fields every scoped row shares, whatever its kind. */
interface ScopedRow {
  readonly id: string
  readonly name: string
  readonly scope: ArtifactScope
  readonly scopeKey: string
  readonly version: number
}

/** One (scope, key) pair in a caller's resolution chain. */
interface ScopedKey {
  readonly scope: ArtifactScope
  readonly key: string
}

/** The content a digest covers: everything a caller would call "the artifact's meaning". */
export interface ArtifactDigestInput {
  readonly description: string
  readonly program: string
  readonly tools: readonly string[]
  readonly inputSchema: Record<string, JsonValue>
}

/**
 * Render a JSON value canonically: object keys sorted, arrays in order.
 *
 * Canonicalisation is what makes the digest about CONTENT. Without it, saving the same
 * schema with its properties written in a different order would look like a change, and a
 * promotion would appear to alter the artifact it copied.
 * @param value - any JSON value.
 * @returns a stable string encoding.
 */
function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return JSON.stringify(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  const members = Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
  return `{${members.join(',')}}`
}

/**
 * The content digest of an authored artifact.
 *
 * It covers description, program, tools and inputSchema, and deliberately NOT version,
 * scope, timestamps or the id: a promotion copies the digest unchanged (the content did not
 * change), while re-saving a bumped version also keeps it. A changed digest therefore means
 * the artifact's content changed, which is the only thing worth alerting on.
 * @param input - the content fields.
 * @returns the lower-case hex SHA-256.
 */
export function artifactDigest(input: ArtifactDigestInput): string {
  return createHash('sha256').update(canonicalJson({
    description: input.description,
    program: input.program,
    tools: [...input.tools],
    inputSchema: input.inputSchema,
  }), 'utf8').digest('hex')
}

/** The scope a JSON field names, or undefined when it names none. */
function parseScope(value: JsonValue | undefined): ArtifactScope | undefined {
  return value === 'session' || value === 'workspace' || value === 'global' ? value : undefined
}

/**
 * Validate a caller's context, so a JavaScript caller cannot smuggle an unknown scope past
 * the type system.
 * @param context - the candidate.
 * @returns the same context.
 * @throws AuthoringError `scope-unknown` naming the observed and allowed values.
 */
function requireContext(context: ArtifactScopeContext | undefined): ArtifactScopeContext | undefined {
  if (context === undefined) return undefined
  if (!ARTIFACT_SCOPES.includes(context.scope)) {
    throw new AuthoringError(
      'scope-unknown',
      `"${String(context.scope)}" is not an artifact scope: use one of ${ARTIFACT_SCOPES.join(', ')}`,
    )
  }
  if (typeof context.scopeKey !== 'string' || context.scopeKey.length === 0) {
    throw new AuthoringError(
      'scope-unknown',
      `scope "${context.scope}" needs a non-empty scopeKey (observed ${JSON.stringify(context.scopeKey)}): ` +
      'the session id for session scope, the workspace key for workspace scope',
    )
  }
  return context
}

/**
 * Refuse a non-global scope on a host that has scoping switched off.
 * @param context - the validated context, or undefined.
 * @param enabled - the store's `scopeEnabled` option.
 */
function assertScopesEnabled(context: ArtifactScopeContext | undefined, enabled: boolean): void {
  if (enabled || context === undefined || context.scope === 'global') return
  throw new AuthoringError(
    'scope-disabled',
    `scoping is disabled for this host (config "artifactScopes.enabled": false), so scope "${context.scope}" cannot be used; ` +
    `the allowed scope is "global"`,
  )
}

/** The scope key a write lands at for this context. */
function targetKey(context: ArtifactScopeContext | undefined): ScopedKey {
  if (context === undefined || context.scope === 'global') return { scope: 'global', key: GLOBAL_SCOPE_KEY }
  if (context.scope === 'session') return { scope: 'session', key: context.scopeKey }
  return { scope: 'workspace', key: context.workspaceKey ?? context.scopeKey }
}

/**
 * The caller's resolution chain, nearest first: session, workspace, global.
 *
 * With no context the chain is global alone. That is the compatibility rule, and it is why a
 * context-less caller can never resolve — or delete — a session's private artifact.
 * @param context - the validated context, or undefined.
 * @returns the chain.
 */
function visibleChain(context: ArtifactScopeContext | undefined): ScopedKey[] {
  if (context === undefined) return [{ scope: 'global', key: GLOBAL_SCOPE_KEY }]
  return [
    { scope: 'session', key: context.scopeKey },
    { scope: 'workspace', key: context.workspaceKey ?? context.scopeKey },
    { scope: 'global', key: GLOBAL_SCOPE_KEY },
  ]
}

/** True when this row is in one of the caller's visible (scope, key) pairs. */
function isVisible(row: ScopedRow, context: ArtifactScopeContext | undefined): boolean {
  return visibleChain(context).some(key => key.scope === row.scope && key.key === row.scopeKey)
}

/** The row a name resolves to: first hit in the caller's chain, or undefined. */
function findResolved<T extends ScopedRow>(entries: readonly T[], name: string, context: ArtifactScopeContext | undefined): T | undefined {
  for (const key of visibleChain(context)) {
    const hit = entries.find(entry => entry.name === name && entry.scope === key.scope && entry.scopeKey === key.key)
    if (hit !== undefined) return hit
  }
  return undefined
}

/**
 * Find a row by NAME or ID; names are the stable address, ids the immutable one.
 *
 * Both lookups are constrained to what the caller can see, so an id is not a skeleton key
 * into another session's artifacts.
 */
function findByNameOrId<T extends ScopedRow>(entries: readonly T[], key: string, context: ArtifactScopeContext | undefined): T | undefined {
  const byName = findResolved(entries, key, context)
  if (byName !== undefined) return byName
  const byId = entries.find(entry => entry.id === key)
  if (byId === undefined) return undefined
  return isVisible(byId, context) ? byId : undefined
}

/**
 * Find a row by NAME or ID at EXACTLY one (scope, key).
 *
 * Deletion uses this rather than {@link findByNameOrId}: "deleting at one scope" must not
 * reach through to a lower-scope row of the same name, or a second delete would silently
 * remove host-global state that the first call had merely unshadowed.
 * @param entries - the rows of one kind.
 * @param key - the name or id.
 * @param target - the exact scope to delete at.
 * @returns the row, when it is there.
 */
function findAtScope<T extends ScopedRow>(entries: readonly T[], key: string, target: ScopedKey): T | undefined {
  const atScope = (entry: T): boolean => entry.scope === target.scope && entry.scopeKey === target.key
  return entries.find(entry => entry.name === key && atScope(entry))
    ?? entries.find(entry => entry.id === key && atScope(entry))
}

/** One winning row per name, in the order the names first appear. */
function resolveAll<T extends ScopedRow>(entries: readonly T[], context: ArtifactScopeContext | undefined): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of entries) {
    if (seen.has(row.name) || !isVisible(row, context)) continue
    const winner = findResolved(entries, row.name, context)
    if (winner === undefined) continue
    seen.add(row.name)
    out.push(winner)
  }
  return out
}

/**
 * The nearest lower-scope row a resolved row hides, or null.
 * @param entries - every row of this kind in the document.
 * @param row - the row that won resolution.
 * @param context - the caller's chain.
 * @returns the hidden row's scope and version.
 */
function shadowingFor<T extends ScopedRow>(entries: readonly T[], row: T, context: ArtifactScopeContext | undefined): ArtifactShadow | null {
  const chain = visibleChain(context)
  const index = chain.findIndex(key => key.scope === row.scope && key.key === row.scopeKey)
  if (index < 0) return null
  for (const key of chain.slice(index + 1)) {
    const hidden = entries.find(entry =>
      entry.name === row.name && entry.scope === key.scope && entry.scopeKey === key.key && entry.id !== row.id)
    if (hidden !== undefined) return { scope: hidden.scope, version: hidden.version }
  }
  return null
}

/**
 * The nearest HIGHER-scope row that hides this one (U26).
 *
 * The inverse of {@link shadowingFor}: a winner reports what it hides, a hidden row
 * reports what hides it. Both are derived from the same caller chain so one list call
 * can explain every row, including when `all: true` returns the whole union.
 * @param entries - every row of this kind in the document.
 * @param row - the row being annotated.
 * @param context - the caller's chain.
 * @returns the hiding row, or null when this row is a winner.
 */
function shadowedByFor<T extends ScopedRow>(entries: readonly T[], row: T, context: ArtifactScopeContext | undefined): ArtifactShadowedBy | null {
  const chain = visibleChain(context)
  const index = chain.findIndex(key => key.scope === row.scope && key.key === row.scopeKey)
  if (index <= 0) return null
  // chain is nearest-first; walk its higher rows nearest-first so global reports the
  // workspace row hiding it, not a session row three levels up.
  for (const key of chain.slice(0, index).reverse()) {
    const higher = entries.find(entry =>
      entry.name === row.name && entry.scope === key.scope && entry.scopeKey === key.key)
    if (higher !== undefined) {
      return { scope: higher.scope, scopeKey: higher.scopeKey, version: higher.version }
    }
  }
  return null
}

/** Render one saved workflow as its summary. */
function summarizeWorkflow(workflow: AgentWorkflow, entries: readonly AgentWorkflow[], context: ArtifactScopeContext | undefined): AgentWorkflowSummary {
  const hiddenBy = shadowedByFor(entries, workflow, context)
  return {
    id: workflow.id, name: workflow.name, callableName: workflowToolName(workflow.name),
    description: workflow.description, version: workflow.version,
    tools: workflow.tools, inputSchema: workflow.inputSchema, createdAt: workflow.createdAt, updatedAt: workflow.updatedAt,
    scope: workflow.scope, scopeKey: workflow.scopeKey, digest: workflow.digest,
    ...(workflow.status === undefined ? {} : { status: workflow.status }),
    ...(workflow.expiresAt === undefined ? {} : { expiresAt: workflow.expiresAt }),
    ...(workflow.promotedFrom === undefined ? {} : { promotedFrom: workflow.promotedFrom }),
    ...(workflow.createdBySession === undefined ? {} : { createdBySession: workflow.createdBySession }),
    shadowing: shadowingFor(entries, workflow, context),
    ...(hiddenBy === null ? {} : { shadowedBy: hiddenBy }),
  }
}

/** Render one authored tool as its summary. */
function summarizeTool(tool: AgentToolDefinition, entries: readonly AgentToolDefinition[], context: ArtifactScopeContext | undefined): AgentToolSummary {
  const hiddenBy = shadowedByFor(entries, tool, context)
  return {
    id: tool.id, name: tool.name, callableName: tool.name,
    description: tool.description, inputSchema: tool.inputSchema,
    tools: tool.tools, version: tool.version, createdAt: tool.createdAt, updatedAt: tool.updatedAt,
    scope: tool.scope, scopeKey: tool.scopeKey, digest: tool.digest,
    ...(tool.status === undefined ? {} : { status: tool.status }),
    ...(tool.expiresAt === undefined ? {} : { expiresAt: tool.expiresAt }),
    ...(tool.promotedFrom === undefined ? {} : { promotedFrom: tool.promotedFrom }),
    ...(tool.createdBySession === undefined ? {} : { createdBySession: tool.createdBySession }),
    shadowing: shadowingFor(entries, tool, context),
    ...(hiddenBy === null ? {} : { shadowedBy: hiddenBy }),
  }
}

/** Parse optional promotion provenance from a stored row; undefined when it is malformed. */
function parsePromotedFrom(raw: JsonValue | undefined): PromotedFrom | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) return undefined
  const scope = parseScope(raw['scope'])
  const scopeKey = raw['scopeKey']
  const version = raw['version']
  const at = raw['at']
  const sessionId = raw['sessionId']
  const tools = stringList(raw['tools'])
  if (scope === undefined || typeof scopeKey !== 'string' || scopeKey.length === 0) return undefined
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return undefined
  if (typeof at !== 'string' || tools === undefined) return undefined
  if (sessionId !== undefined && typeof sessionId !== 'string') return undefined
  return { scope, scopeKey, version, at, tools, ...(sessionId === undefined ? {} : { sessionId }) }
}

/** The refusal for an artifact that does not resolve where the caller asked. */
function notFoundError(kind: 'workflow' | 'tool', name: string, context: ArtifactScopeContext | undefined): AuthoringError {
  const where = context === undefined ? 'global (no context was supplied)' : `${context.scope} (scopeKey "${context.scopeKey}")`
  return new AuthoringError(
    'artifact-not-found',
    `no ${kind} named "${name}" resolves at ${where}: it does not exist at that scope or any lower one visible from it`,
  )
}

/** The refusal for a promotion target that already holds the name. */
function conflictError(kind: 'workflow' | 'tool', name: string, target: ScopedKey, version: number): AuthoringError {
  return new AuthoringError(
    'scope-conflict',
    `${kind} "${name}" already exists at ${target.scope} scope (scopeKey "${target.key}", version ${version}): ` +
    'promotion never overwrites a target row; delete that row or choose another scope',
  )
}

/**
 * Build the provenance pointer a promoted copy records.
 *
 * Missing fields are filled from the SOURCE row, not from the target: the pointer answers
 * "where did this copy come from", and the target is where it now lives.
 */
function promotionOrigin(
  source: ScopedRow & { readonly tools: readonly string[]; readonly createdBySession?: string | undefined },
  override: PromotedFromInput | undefined,
  from: ArtifactScopeContext | undefined,
  at: string,
): PromotedFrom {
  const sessionId = override?.sessionId ?? source.createdBySession ?? from?.sessionId
  return {
    scope: override?.scope ?? source.scope,
    scopeKey: override?.scopeKey ?? source.scopeKey,
    version: override?.version ?? source.version,
    at: override?.at ?? at,
    tools: override?.tools ?? [...source.tools],
    ...(sessionId === undefined ? {} : { sessionId }),
  }
}

/**
 * Create the durable authoring store.
 * @param options - the file path, and whether scoping is enabled for this host.
 * @returns the store.
 */
export function createAgentAuthoringStore(options: { readonly file: string; readonly scopeEnabled?: boolean }): AgentAuthoringStore {
  const scopesEnabled = options.scopeEnabled ?? true
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

    listWorkflows(context, listOptions) {
      const resolved = requireContext(context)
      assertScopesEnabled(resolved, scopesEnabled)
      const rows = listOptions?.all === true
        ? document.workflows.filter(row => isVisible(row, resolved))
        : resolveAll(document.workflows, resolved)
      return rows.map(row => summarizeWorkflow(row, document.workflows, resolved))
    },
    getWorkflow(key, context) {
      const resolved = requireContext(context)
      assertScopesEnabled(resolved, scopesEnabled)
      return findByNameOrId(document.workflows, key, resolved)
    },
    workflowEntries(context) {
      const resolved = requireContext(context)
      assertScopesEnabled(resolved, scopesEnabled)
      return resolveAll(document.workflows, resolved)
    },
    saveWorkflow(input, context) {
      const resolved = requireContext(context)
      assertScopesEnabled(resolved, scopesEnabled)
      const name = requireWorkflowName(input.name)
      const program = requireProgram(input.program, name)
      const tools = requireToolNames(input.tools, name)
      const target = targetKey(resolved)
      const now = new Date().toISOString()
      // The UPDATE key is (name, scope, scopeKey): the same name at another scope is a
      // different artifact, not an edit of this one.
      const existing = document.workflows.find(row =>
        row.name === name && row.scope === target.scope && row.scopeKey === target.key)
      const description = input.description?.trim() ?? existing?.description ?? ''
      const inputSchema = requireInputSchema(input.inputSchema ?? existing?.inputSchema ?? { type: 'object', properties: {} })
      const createdBySession = existing?.createdBySession
        ?? resolved?.sessionId
        ?? (target.scope === 'session' ? target.key : undefined)
      const entry: AgentWorkflow = {
        id: existing?.id ?? 'wf_' + randomUUID(),
        name,
        description,
        version: (existing?.version ?? 0) + 1,
        program,
        tools,
        inputSchema,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        catalogRevision: input.catalogRevision ?? existing?.catalogRevision ?? '',
        scope: target.scope,
        scopeKey: target.key,
        digest: artifactDigest({ description, program, tools, inputSchema }),
        ...(existing?.promotedFrom === undefined ? {} : { promotedFrom: existing.promotedFrom }),
        ...(createdBySession === undefined ? {} : { createdBySession }),
      }
      persist({
        ...document,
        workflows: existing === undefined
          ? [...document.workflows, entry]
          : document.workflows.map(row => row.id === existing.id ? entry : row),
      })
      return entry
    },
    deleteWorkflow(key, context) {
      const resolved = requireContext(context)
      assertScopesEnabled(resolved, scopesEnabled)
      const existing = findAtScope(document.workflows, key, targetKey(resolved))
      if (existing === undefined) return false
      persist({ ...document, workflows: document.workflows.filter(row => row.id !== existing.id) })
      return true
    },

    listTools(context, listOptions) {
      const resolved = requireContext(context)
      assertScopesEnabled(resolved, scopesEnabled)
      const rows = listOptions?.all === true
        ? document.tools.filter(row => isVisible(row, resolved))
        : resolveAll(document.tools, resolved)
      return rows.map(row => summarizeTool(row, document.tools, resolved))
    },
    getTool(key, context) {
      const resolved = requireContext(context)
      assertScopesEnabled(resolved, scopesEnabled)
      return findByNameOrId(document.tools, key, resolved)
    },
    toolEntries(context) {
      const resolved = requireContext(context)
      assertScopesEnabled(resolved, scopesEnabled)
      return resolveAll(document.tools, resolved)
    },
    saveDraft(input, context, clock) {
    const resolved = requireContext(context)
    assertScopesEnabled(resolved, scopesEnabled)
    const target = targetKey(resolved)
    const nowMs = clock?.now ?? Date.now()
    const at = new Date(nowMs).toISOString()
    const program = requireProgram(input.program, input.runId)
    const tools = requireToolNames(input.tools, input.runId)
    const inputSchema = requireInputSchema(input.inputSchema)
    const description = input.description?.trim() ?? 'Distilled from successful run ' + input.runId + '.'
    // Deterministic identity from the CONTENT, then deterministic collision handling: a
    // KEPT row owns the base name, so the draft takes the first free numeric suffix. A
    // re-run of the same content finds its own row here and updates it in place.
    const base = draftNameForContent({ program, tools, inputSchema })
    let name = base
    for (let suffix = 2; suffix <= 100; suffix += 1) {
      const owner = document.tools.find(row =>
        row.name === name && row.scope === target.scope && row.scopeKey === target.key)
      if (owner === undefined || owner.status === 'draft') break
      name = base + '_' + String(suffix)
    }
    const existing = document.tools.find(row =>
      row.name === name && row.scope === target.scope && row.scopeKey === target.key)
    const createdBySession = existing?.createdBySession
      ?? resolved?.sessionId
      ?? (target.scope === 'session' ? target.key : undefined)
    const entry: AgentToolDefinition = {
      id: existing?.id ?? 'agent_' + randomUUID(),
      name,
      description,
      inputSchema,
      program,
      tools,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      scope: target.scope,
      scopeKey: target.key,
      digest: artifactDigest({ description, program, tools, inputSchema }),
      status: 'draft',
      expiresAt: new Date(nowMs + (clock?.ttlMs ?? DEFAULT_DRAFT_TTL_MS)).toISOString(),
      ...(createdBySession === undefined ? {} : { createdBySession }),
    }
    persist({
      ...document,
      tools: existing === undefined
        ? [...document.tools, entry]
        : document.tools.map(row => row.id === existing.id ? entry : row),
    })
    return entry
  },
  expireDrafts(options, context) {
    const resolved = requireContext(context)
    assertScopesEnabled(resolved, scopesEnabled)
    const at = new Date(options?.now ?? Date.now()).toISOString()
    const doomed = document.tools.filter(row =>
      row.status === 'draft'
      && typeof row.expiresAt === 'string'
      && row.expiresAt <= at
      // No context means the HOST janitor (mount-time / session-end), which must sweep
      // every scope; a scoped caller is confined to what it can see, so one session can
      // never expire another session's drafts.
      && (resolved === undefined || isVisible(row, resolved)))
    const removed = doomed.slice(0, 200)
    if (removed.length === 0) return []
    const ids = new Set(removed.map(row => row.id))
    persist({ ...document, tools: document.tools.filter(row => !ids.has(row.id)) })
    return removed
  },
  promoteDraft(draftName, options) {
    const from = requireContext(options.from)
    const to = requireContext(options.to)
    assertScopesEnabled(from, scopesEnabled)
    assertScopesEnabled(to, scopesEnabled)
    const target = targetKey(to)
    const at = new Date(options.now ?? Date.now()).toISOString()
    // The caller resolves the draft by its content-derived name; a suffix probe covers the
    // rare collision where a KEPT row already owned the base name when the draft was made.
    let source: AgentToolDefinition | undefined
    for (let index = 1; index <= 100 && source === undefined; index += 1) {
      const candidate = index === 1 ? draftName : draftName + '_' + String(index)
      const row = findResolved(document.tools, candidate, from)
      if (row !== undefined && row.status === 'draft') source = row
      // Stop at the first absent candidate: suffixes are dense by construction.
      else if (row === undefined) break
    }
    if (source === undefined) {
      throw new AuthoringError('artifact-not-found', 'no draft named "' + draftName + '"; a successful run must be captured first')
    }
    const name = options.name ?? source.name
    if (!AGENT_TOOL_NAME_PATTERN.test(name)) {
      throw new AuthoringError('invalid-name', '"' + name + '" is not an authored tool name: it must match agent_[a-z0-9_]{2,60}')
    }
    const conflict = document.tools.find(row =>
      row.name === name && row.scope === target.scope && row.scopeKey === target.key && row.id !== source.id)
    if (conflict !== undefined) throw conflictError('tool', name, target, conflict.version)
    const promotedFrom: PromotedFrom = {
      scope: source.scope,
      scopeKey: source.scopeKey,
      version: source.version,
      at,
      // Required by the type: the binding subset travels with the provenance so a later
      // drift in the resolved tool list stays diagnosable. Same list, no new claim.
      tools: source.tools,
      ...(to?.sessionId === undefined ? {} : { sessionId: to.sessionId }),
    }
    // keepSource returns the SAME row as a kept member (no second name at one scope);
    // the default consumes the draft, so a kept library never accumulates duplicates.
    if (options.keepSource === true) {
      const kept: AgentToolDefinition = {
        id: source.id,
        name,
        description: source.description,
        inputSchema: source.inputSchema,
        program: source.program,
        tools: source.tools,
        version: source.version,
        createdAt: source.createdAt,
        updatedAt: at,
        scope: source.scope,
        scopeKey: source.scopeKey,
        digest: source.digest,
        status: 'kept',
        promotedFrom,
        ...(source.createdBySession === undefined ? {} : { createdBySession: source.createdBySession }),
      }
      persist({ ...document, tools: document.tools.map(row => row.id === source.id ? kept : row) })
      return { kind: 'tool', tool: kept }
    }
    const copy: AgentToolDefinition = {
      id: 'agent_' + randomUUID(),
      name,
      description: source.description,
      inputSchema: source.inputSchema,
      program: source.program,
      tools: source.tools,
      version: 1,
      createdAt: at,
      updatedAt: at,
      scope: target.scope,
      scopeKey: target.key,
      digest: source.digest,
      status: 'kept',
      promotedFrom,
      ...(source.createdBySession === undefined ? {} : { createdBySession: source.createdBySession }),
    }
    persist({
      ...document,
      tools: [...document.tools.filter(row => row.id !== source.id), copy],
    })
    return { kind: 'tool', tool: copy }
  },
  saveTool(input, context) {
      const resolved = requireContext(context)
      assertScopesEnabled(resolved, scopesEnabled)
      const normalized = normalizeTool(input)
      const target = targetKey(resolved)
      const now = new Date().toISOString()
      const existing = document.tools.find(row =>
        row.name === normalized.name && row.scope === target.scope && row.scopeKey === target.key)
      const createdBySession = existing?.createdBySession
        ?? resolved?.sessionId
        ?? (target.scope === 'session' ? target.key : undefined)
      const entry: AgentToolDefinition = {
        id: existing?.id ?? 'agent_' + randomUUID(),
        name: normalized.name,
        description: normalized.description,
        inputSchema: normalized.inputSchema,
        program: normalized.program,
        tools: normalized.tools,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        scope: target.scope,
        scopeKey: target.key,
        digest: artifactDigest({
          description: normalized.description,
          program: normalized.program,
          tools: normalized.tools,
          inputSchema: normalized.inputSchema,
        }),
        ...(existing?.promotedFrom === undefined ? {} : { promotedFrom: existing.promotedFrom }),
        ...(createdBySession === undefined ? {} : { createdBySession }),
      }
      persist({
        ...document,
        tools: existing === undefined
          ? [...document.tools, entry]
          : document.tools.map(row => row.id === existing.id ? entry : row),
      })
      return entry
    },
    deleteTool(key, context) {
      const resolved = requireContext(context)
      assertScopesEnabled(resolved, scopesEnabled)
      const existing = findAtScope(document.tools, key, targetKey(resolved))
      if (existing === undefined) return false
      persist({ ...document, tools: document.tools.filter(row => row.id !== existing.id) })
      return true
    },

    promote(name, fromContext, toContext, provenance, keepSource = true) {
      const from = requireContext(fromContext)
      const to = requireContext(toContext)
      assertScopesEnabled(from, scopesEnabled)
      assertScopesEnabled(to, scopesEnabled)
      const target = targetKey(to)
      const at = new Date().toISOString()
      const copiedSession = to?.sessionId ?? (target.scope === 'session' ? target.key : undefined)

      // The agent_ prefix is reserved, so it selects the kind unambiguously: an authored
      // tool can never be named like a workflow, and vice versa.
      if (AGENT_TOOL_NAME_PATTERN.test(name)) {
        const source = findResolved(document.tools, name, from)
        if (source === undefined) throw notFoundError('tool', name, from)
        const conflict = document.tools.find(row =>
          row.name === name && row.scope === target.scope && row.scopeKey === target.key)
        if (conflict !== undefined) throw conflictError('tool', name, target, conflict.version)
        const copy: AgentToolDefinition = {
          id: 'agent_' + randomUUID(),
          name: source.name,
          description: source.description,
          inputSchema: source.inputSchema,
          program: source.program,
          tools: source.tools,
          version: 1,
          createdAt: at,
          updatedAt: at,
          scope: target.scope,
          scopeKey: target.key,
          digest: source.digest,
          promotedFrom: promotionOrigin(source, provenance, from, at),
          ...(copiedSession === undefined ? {} : { createdBySession: copiedSession }),
        }
        persist({
          ...document,
          tools: [
            ...document.tools.filter(row => keepSource === false ? row.id !== source.id : true),
            copy,
          ],
        })
        return { kind: 'tool', tool: copy }
      }

      const source = findResolved(document.workflows, name, from)
      if (source === undefined) throw notFoundError('workflow', name, from)
      const conflict = document.workflows.find(row =>
        row.name === name && row.scope === target.scope && row.scopeKey === target.key)
      if (conflict !== undefined) throw conflictError('workflow', name, target, conflict.version)
      const copy: AgentWorkflow = {
        id: 'wf_' + randomUUID(),
        name: source.name,
        description: source.description,
        version: 1,
        program: source.program,
        tools: source.tools,
        inputSchema: source.inputSchema,
        createdAt: at,
        updatedAt: at,
        catalogRevision: source.catalogRevision,
        scope: target.scope,
        scopeKey: target.key,
        digest: source.digest,
        promotedFrom: promotionOrigin(source, provenance, from, at),
        ...(copiedSession === undefined ? {} : { createdBySession: copiedSession }),
      }
      persist({
        ...document,
        workflows: [
          ...document.workflows.filter(row => keepSource === false ? row.id !== source.id : true),
          copy,
        ],
      })
      return { kind: 'workflow', workflow: copy }
    },

    // Demote removes the row resolution FINDS, so repeating it walks one layer down at a
    // time. That is the requested semantic ("removes the resolved row"), and it is why
    // delete is scope-exact instead: two different operations, two different intents.
    demote(name, context) {
      const resolved = requireContext(context)
      assertScopesEnabled(resolved, scopesEnabled)
      if (AGENT_TOOL_NAME_PATTERN.test(name)) {
        const hit = findResolved(document.tools, name, resolved)
        if (hit === undefined) throw notFoundError('tool', name, resolved)
        persist({ ...document, tools: document.tools.filter(row => row.id !== hit.id) })
        return true
      }
      const hit = findResolved(document.workflows, name, resolved)
      if (hit === undefined) throw notFoundError('workflow', name, resolved)
      persist({ ...document, workflows: document.workflows.filter(row => row.id !== hit.id) })
      return true
    },

    expireSession(sessionId) {
      const isDoomed = (row: ScopedRow): boolean =>
        row.scope === 'session' && row.scopeKey === sessionId
      const removedWorkflows = document.workflows.filter(isDoomed)
      const removedTools = document.tools.filter(isDoomed)
      // Removing rows is a write; do not touch the file when there is nothing to expire.
      if (removedWorkflows.length > 0 || removedTools.length > 0) {
        persist({
          ...document,
          workflows: document.workflows.filter(row => !isDoomed(row)),
          tools: document.tools.filter(row => !isDoomed(row)),
        })
      }
      return { workflows: removedWorkflows, tools: removedTools }
    },

    sessionWorkflows: sessionId => document.workflows.filter(row => row.scope === 'session' && row.scopeKey === sessionId),
    sessionTools: sessionId => document.tools.filter(row => row.scope === 'session' && row.scopeKey === sessionId),
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
      dataFlow: outcome.dataFlow,
      dataFlowCoverage: outcome.dataFlowCoverage,
      catalogRevision: options.catalogRevision,
      warnings: [],
      typescript: generateProgramTypes(options.tools),
    },
  }
}
