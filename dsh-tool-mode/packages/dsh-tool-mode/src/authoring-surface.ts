/**
 * Agent authoring: save, version, run and promote Code Mode artifacts.
 *
 * `tool_mode_workflows` and `tool_mode_tools` share the authoring store, the
 * scope resolver, the published-name registries and the promotion evidence
 * rules. They receive those as explicit dependencies and never import the
 * composition root.
 *
 * @module authoring-surface
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this module is the JSON/registry boundary for agent-authored artifacts: it validates untrusted stored JSON and then casts DSH registry values at the plugin seam (the same boundary the previous in-index block documented). */

import type { Context } from '@deepseek-ai/cordis'
import type { AsyncLocalStorage } from 'node:async_hooks'
import { defineTool, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import {
  AGENT_TOOL_NAME_PATTERN,
  runAuthoredProgram,
  workflowToolName,
  DEFAULT_DRAFT_TTL_MS,
  draftNameForContent,
  type AgentAuthoringStore,
  type AgentToolDefinition,
  type AgentWorkflow,
  type ArtifactScope,
} from './agent-authoring.ts'
import { inferRunInputSchema, suggestAgentName } from './authoring-quality.ts'
import type { AuthoringLedger } from './authoring-ledger.ts'
import type { BuiltScopeContext } from './artifact-scope-context.ts'
import { evaluatePromotion } from './artifact-promotion.ts'
import type { RunCaptureStore } from './run-capture.ts'
import type { SandboxTempScope } from './sandbox-temp.ts'
import type { SessionLedger } from './session-ledger.ts'
import type { ProgramRunner, RunReport } from './tool-mode-run.ts'
import type { JsonValue } from './adapters/types.ts'

/** Scoping configuration the authoring actions read. */
export interface AuthoringScopeSettings {
  readonly globalPromotion?: 'human' | 'off' | undefined
  readonly promoteMinUses?: number | undefined
  readonly defaultScope?: 'session' | 'workspace' | 'global' | undefined
  readonly expireSessionArtifacts?: boolean | undefined
}

/** What the authoring tools need from the composition root. */
export interface AuthoringSurfaceDeps {
  readonly ctx: Context
  readonly store: AgentAuthoringStore
  /** The draft retention window in force; absent means the shipped default. */
  readonly adoption?: () => { readonly draftTtlMs: number }
  readonly ledger: AuthoringLedger
  readonly scopeFor: (exec: { agent?: unknown } | undefined, requested?: string) => BuiltScopeContext
  readonly sessionIdOfAgent: (agent: unknown) => string | undefined
  readonly sessionLedger: () => SessionLedger | undefined
  readonly registerWorkflow: (workflow: AgentWorkflow) => boolean
  readonly registerAuthored: (definition: AgentToolDefinition) => boolean
  readonly unregisterAuthored: (name: string) => boolean
  /** Release a stored-name workflow alias held by the registry, if any. */
  readonly releaseWorkflowAlias?: ((name: string) => boolean) | undefined
  readonly workflowDisposers: Map<string, () => void>
  readonly workflowToolNames: Set<string>
  readonly authoredToolNames: Set<string>
  readonly authoringRevision: () => string
  readonly evidenceFor: (name: string, digest?: string) => { readonly uses: number; readonly sessions: number; readonly failures: number }
  readonly recordArtifactFailure: (input: {
    readonly receiptId: string
    readonly name: string
    readonly digest: string
    readonly sessionId?: string
  }) => void
  readonly scopeSettings: AuthoringScopeSettings
  readonly globalApprovalGranted: boolean
  readonly sandboxTempScope: SandboxTempScope
  readonly scheduleSandboxTempPrune: () => void
  readonly programAgentContext: AsyncLocalStorage<{ readonly agent?: unknown; readonly token?: unknown }>
  readonly programContextOf: (exec: unknown) => { readonly agent?: unknown; readonly token?: unknown }
  readonly programRunner: ProgramRunner
  readonly recordAuthoredRun: (
    receiptId: string,
    revision: string,
    contract: string,
    report: RunReport,
    artifact?: { readonly name: string; readonly digest: string; readonly scope: ArtifactScope; readonly sessionId?: string },
  ) => void
  readonly host: { nextReceiptId: () => string }
  readonly runCaptureStore: RunCaptureStore | undefined
}

/**
 * Echo the requested scope when a write could not land there.
 * @param scope - the resolved scope.
 * @returns the disclosure fields, or an empty object.
 */
export function scopeDisclosure(scope: BuiltScopeContext): Record<string, string> {
  return scope.requestedScope === undefined || scope.requestedScope === scope.scope
    ? {}
    : {
        requestedScope: scope.requestedScope,
        ...scope.scopeReason === undefined ? {} : { scopeReason: scope.scopeReason },
      }
}

/** One visible artifact row a delete reports (scope, key and version). */
export interface ArtifactRowScope {
  readonly scope: ArtifactScope
  readonly scopeKey: string
  readonly version: number
}

/** The per-scope truth of one delete (U37). */
export interface ArtifactDeleteOutcome {
  /** True only when the requested row went AND no visible row of that name survives. */
  readonly deleted: boolean
  /** The same fact under the name the plan uses: the cleanup is complete. */
  readonly complete: boolean
  /** The rows this call actually removed. */
  readonly deletedScopes: readonly ArtifactRowScope[]
  /** The rows that still answer the name from the caller's resolution chain. */
  readonly remainingScopes: readonly ArtifactRowScope[]
  /** Present when nothing was removed: why the target scope had no row. */
  readonly reason?: string
}

/**
 * The published DELETE contract (U37).
 *
 * Additive (`additionalProperties: true`) because the same two tools publish every other
 * action's result; the declared keys are the delete ones a caller must be able to rely on.
 */
const AUTHORING_DELETE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    deleted: { type: 'boolean' },
    complete: { type: 'boolean' },
    deletedScopes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          scope: { type: 'string' },
          scopeKey: { type: 'string' },
          version: { type: 'number' },
        },
      },
    },
    remainingScopes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          scope: { type: 'string' },
          scopeKey: { type: 'string' },
          version: { type: 'number' },
        },
      },
    },
    reason: { type: 'string' },
  },
} as unknown as ValueSchemaSpec

/** Every visible row for one name in one artifact kind, nearest scope first. */
function visibleRowScopes(
  store: AgentAuthoringStore,
  kind: 'workflow' | 'tool',
  name: string,
  context: BuiltScopeContext['context'],
): ArtifactRowScope[] {
  const rows = kind === 'workflow'
    ? store.listWorkflows(context, { all: true })
    : store.listTools(context, { all: true })
  return rows
    .filter(row => row.name === name)
    .map(row => ({ scope: row.scope, scopeKey: row.scopeKey, version: row.version }))
}

/**
 * Does this name belong to the OTHER artifact kind?
 *
 * The wrong verb used to answer `{deleted:false}` with no reason naming the right tool
 * (U40). This resolver answers that question so the handler can POINT; it never mutates.
 * @param store - the authoring store.
 * @param kind - the kind the caller's verb deletes.
 * @param name - the requested name (stored or callable).
 * @param context - the caller's resolution chain.
 * @returns the other kind and its callable name, when the name belongs to it.
 */
function otherKindFor(
  store: AgentAuthoringStore,
  kind: 'workflow' | 'tool',
  name: string,
  context: BuiltScopeContext['context'],
): { readonly kind: 'workflow' | 'tool'; readonly callableName: string } | undefined {
  if (name.length === 0) return undefined
  if (kind === 'tool') {
    const workflow = store.getWorkflow(name, context)
    if (workflow !== undefined) return { kind: 'workflow', callableName: workflowToolName(workflow.name) }
    const callable = store.listWorkflows(context, { all: true }).find(row => row.callableName === name)
    return callable === undefined ? undefined : { kind: 'workflow', callableName: callable.callableName }
  }
  const tool = store.getTool(name, context)
  return tool === undefined ? undefined : { kind: 'tool', callableName: tool.name }
}

/** The pointing refusal a delete gets when the name belongs to the other kind. */
function wrongKindDelete(
  requestedKind: 'workflow' | 'tool',
  name: string,
  other: { readonly kind: 'workflow' | 'tool'; readonly callableName: string },
): Error {
  const verb = other.kind === 'workflow' ? 'tool_mode_workflows' : 'tool_mode_tools'
  const actual = other.kind === 'workflow' ? 'a workflow' : 'an authored tool'
  const requested = requestedKind === 'workflow' ? 'workflow' : 'authored tool'
  return new Error(
    `E_WRONG_ARTIFACT_KIND: "${name}" is ${actual}, not a ${requested}. `
    + `Delete it with ${verb} action "delete" (name "${other.callableName}"); `
    + `${requestedKind === 'workflow' ? 'tool_mode_workflows' : 'tool_mode_tools'} deletes only its own artifact kind and changed nothing.`,
  )
}

/**
 * Delete ONE scope-exact row and report what remained (U37).
 *
 * `deleted` is true only when the row went AND no visible row of that name survives: a
 * default delete that leaves a promoted copy is a PARTIAL cleanup, and saying otherwise
 * made an agent believe a cleanup had happened when it had not.
 * @param store - the authoring store.
 * @param kind - which artifact kind to delete.
 * @param entry - the resolved row (its name is the delete key).
 * @param target - the scope-exact target context the delete writes at.
 * @param caller - the CALLER's full resolution chain, for what remains VISIBLE.
 * @returns the per-scope outcome.
 */
function deleteArtifactRows(
  store: AgentAuthoringStore,
  kind: 'workflow' | 'tool',
  entry: { readonly name: string },
  target: BuiltScopeContext['context'],
  caller: BuiltScopeContext['context'],
): ArtifactDeleteOutcome {
  // BEFORE is read from the caller's chain: a workspace-scoped delete must still report
  // the session row that survives and keeps answering the name.
  const before = visibleRowScopes(store, kind, entry.name, caller)
  const removed = kind === 'workflow'
    ? store.deleteWorkflow(entry.name, target)
    : store.deleteTool(entry.name, target)
  const remaining = visibleRowScopes(store, kind, entry.name, caller)
  const deletedScopes = removed
    ? before.filter(row => !remaining.some(left => left.scope === row.scope && left.scopeKey === row.scopeKey))
    : []
  const deleted = removed && remaining.length === 0
  return {
    deleted,
    complete: deleted,
    deletedScopes,
    remainingScopes: remaining,
    ...removed ? {} : {
      reason: `no ${kind} row named "${entry.name}" exists at the caller's target scope; `
        + 'delete is scope-exact: pass scope:"session"|"workspace"|"global" to choose the row. '
        + 'The remainingScopes field lists the rows that still answer the name.',
    },
  }
}

/** The delete result plus the scope-disclosure fields the write path may add. */
/** R8: only the two documented claims are accepted; anything else is refused, not guessed. */
function verifiabilityOf(value: unknown): 'per-item' | 'aggregate' | undefined {
  if (value === undefined || value === null) return undefined
  if (value === 'per-item' || value === 'aggregate') return value
  throw new Error('verifiability must be "per-item" or "aggregate"; got ' + JSON.stringify(value))
}

/**
 * Read a stored row's claim without throwing.
 *
 * A row written by an older build (or edited by hand) simply carries no claim, which is the
 * same as `per-item`: nothing is inferred.
 * @param entry - the stored row.
 * @returns the stored claim, or undefined.
 */
function storedVerifiability(entry: object): 'per-item' | 'aggregate' | undefined {
  const value = (entry as { readonly verifiability?: unknown }).verifiability
  return value === 'per-item' || value === 'aggregate' ? value : undefined
}

/**
 * A caller-visible authored tool row: `purpose` is DIGEST-ONLY (task-80).
 *
 * The store keeps the purpose and the DIGEST renders it, but no discovery or authoring
 * response may return it: the Phase 8 silent arm must not be able to discover what the
 * artifact is for, or the experiment's ceiling returns.
 * @param entry - the stored row.
 * @returns the same row without `purpose`.
 */
function visibleToolRow<T extends { readonly purpose?: string }>(entry: T): Omit<T, 'purpose'> {
  const { purpose, ...row } = entry
  void purpose
  return row
}

export interface ArtifactDeleteDisclosure extends ArtifactDeleteOutcome {
  readonly requestedScope?: string
  readonly scopeReason?: string
}

/** Render one delete outcome as the tool result. */
function deleteDisclosure(outcome: ArtifactDeleteOutcome, scope: BuiltScopeContext): ArtifactDeleteDisclosure {
  const disclosure = scopeDisclosure(scope)
  return {
    deleted: outcome.deleted,
    complete: outcome.complete,
    deletedScopes: [...outcome.deletedScopes],
    remainingScopes: [...outcome.remainingScopes],
    ...outcome.reason === undefined ? {} : { reason: outcome.reason },
    ...disclosure['requestedScope'] === undefined ? {} : { requestedScope: disclosure['requestedScope'] },
    ...disclosure['scopeReason'] === undefined ? {} : { scopeReason: disclosure['scopeReason'] },
  }
}

/**
 * Register the authoring tools.
 * @param deps - store, ledger, registration hooks and execution callbacks.
 */
export function registerAuthoringTools(deps: AuthoringSurfaceDeps): void {
  const ctx = deps.ctx
  const authoringStore = deps.store
  /** The draft retention window in force, or the shipped default. */
  const draftTtl = (): number => deps.adoption?.().draftTtlMs ?? DEFAULT_DRAFT_TTL_MS
  const authoringLedger = deps.ledger
  const scopeFor = deps.scopeFor
  const sessionIdOfAgent = deps.sessionIdOfAgent
  const sessionLedger = deps.sessionLedger
  const registerWorkflow = deps.registerWorkflow
  const registerAuthored = deps.registerAuthored
  const unregisterAuthored = deps.unregisterAuthored
  const releaseWorkflowAlias = deps.releaseWorkflowAlias
  const workflowDisposers = deps.workflowDisposers
  const workflowToolNames = deps.workflowToolNames
  const authoredToolNames = deps.authoredToolNames
  const authoringRevision = deps.authoringRevision
  const evidenceFor = deps.evidenceFor
  const recordArtifactFailure = deps.recordArtifactFailure
  /** Accept either the stored name or workflow_<name>; stored name wins. */
  const getWorkflowByEitherName = (key: string, context: BuiltScopeContext['context']) => {
    const direct = authoringStore.getWorkflow(key, context)
    if (direct !== undefined) return direct
    // Callable names replace hyphens with underscores; invert via the visible rows
    // rather than string surgery, which would corrupt legitimate underscores.
    const match = authoringStore.listWorkflows(context, { all: true })
      .find(row => row.callableName === key)
    return match === undefined ? undefined : authoringStore.getWorkflow(match.name, context)
  }
  const scopeSettings = deps.scopeSettings
  const globalApprovalGranted = deps.globalApprovalGranted
  const sandboxTempScope = deps.sandboxTempScope
  const scheduleSandboxTempPrune = deps.scheduleSandboxTempPrune
  const programAgentContext = deps.programAgentContext
  const programContextOf = deps.programContextOf
  const programRunner = deps.programRunner
  const recordAuthoredRun = deps.recordAuthoredRun
  const host = deps.host
  const runCaptureStore = deps.runCaptureStore
ctx.tools.register(defineTool({
  name: 'tool_mode_workflows',
  description:
    'Save, version and re-run Code Mode programs (agent-authored workflows). WHEN TO USE: '
    + 'save a program you have verified so it can be run again by name instead of retyped; '
    + 'list or get saved workflows; run one against fresh input. Only registered Tool Mode '
    + 'tools may be bound: tools is a binding subset, not a grant. Storing is allowed while '
    + 'hosted code execution is gated; RUNNING is refused until the operator opens the gate.',
  parameters: {
    action: {
      type: 'string',
      required: true,
      enum: ['save', 'clone', 'list', 'get', 'delete', 'run', 'promote', 'demote'],
      description: 'save: create or update (bumps the version). clone: copy to a new name. list/get/delete/run: by name or id. delete is scope-exact and reports deletedScopes/remainingScopes; a wrong-kind name POINTS at its own tool. promote/demote: move the artifact between scopes.',
    },
    name: { type: 'string', description: 'Workflow name (lowercase kebab/snake, 2-64 chars) or its id.' },
    target: { type: 'string', description: 'Clone only: the new workflow name.' },
    description: { type: 'string', description: 'What the workflow does; shown by list.' },
    program: { type: 'string', description: 'The Code Mode program body (async function body with top-level await/return).' },
    tools: {
      type: 'array',
      items: { type: 'string' },
      description: 'The tool names the saved program will call; may be empty for a pure transform.',
    },
    input: { type: 'json', description: 'Run only: structured data bound as the program input variable.' },
    inputSchema: { type: 'json', description: 'Save only: JSON Schema for the callable workflow tool arguments.' },
    scope: { type: 'string', description: 'session | workspace | global (default artifactScopes.defaultScope). list also accepts all.' },
    to: { type: 'string', description: 'promote only: the destination scope (workspace or global).' },
    from: { type: 'string', description: 'demote only: the scope to remove (default the caller scope).' },
    force: { type: 'boolean', description: 'promote only: bypass evidence for a workspace promotion; never valid for global.' },
    keepSource: { type: 'boolean', description: 'promote only: keep the source row (default true).' },
    all: { type: 'boolean', description: 'list only: include shadowed rows as well as the winners.' },
    limit: { type: 'number', description: 'list only: page size (default 20, max 100).' },
    cursor: { type: 'string', description: 'list only: nextCursor from a previous page.' },
  } as unknown as ParameterSchemaSpec,
  output: {
    schema: AUTHORING_DELETE_OUTPUT_SCHEMA,
    render: (_args: Record<string, unknown>, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  async execute(args, exec) {
    const request = args as Record<string, unknown>
    const sessionId = sessionIdOfAgent(exec.agent)
    const action = request['action']
    const nameOrId = typeof request['name'] === 'string' ? request['name'] : ''
    const rawScope = typeof request['scope'] === 'string' ? request['scope'] : undefined
    const requestedScope = rawScope === 'all' ? undefined : rawScope
    const includeAll = rawScope === 'all' || request['all'] === true
    // LIST reports the CALLER's resolution chain and filters it by scope; it must
    // not narrow the context to the filter, or a session row shadowing the requested
    // workspace row becomes invisible (U24/P1.2).
    const scope = action === 'list' ? scopeFor(exec) : scopeFor(exec, requestedScope)
    if (action === 'clone') {
      const target = typeof request['target'] === 'string' ? request['target'] : ''
      if (target.length === 0) throw new Error('clone needs a target workflow name')
      const source = authoringStore.getWorkflow(nameOrId, scope.context)
      if (source === undefined) throw new Error('unknown source workflow "' + nameOrId + '"')
      if (authoringStore.getWorkflow(target, scope.context) !== undefined) {
        throw new Error('workflow "' + target + '" already exists; choose a new target name')
      }
      const entry = authoringStore.saveWorkflow({
        name: target,
        description: typeof request['description'] === 'string' ? request['description'] : source.description,
        program: typeof request['program'] === 'string' ? request['program'] : source.program,
        tools: Array.isArray(request['tools'])
          ? request['tools'].filter((tool): tool is string => typeof tool === 'string')
          : source.tools,
        ...typeof request['inputSchema'] === 'object' && request['inputSchema'] !== null && !Array.isArray(request['inputSchema'])
          ? { inputSchema: request['inputSchema'] as Record<string, JsonValue> }
          : { inputSchema: source.inputSchema },
        catalogRevision: authoringRevision(),
      }, scope.context)
      registerWorkflow(entry)
      if (sessionId !== undefined) sessionLedger?.()?.authored(sessionId)
      authoringLedger.record({
        operation: 'clone', artifactKind: 'workflow', name: entry.name, version: entry.version,
        scope: entry.scope,
      })
      return {
        cloned: true,
        ...scopeDisclosure(scope),
        workflow: { id: entry.id, name: entry.name, version: entry.version, updatedAt: entry.updatedAt, scope: entry.scope },
      } as never
    }
    if (action === 'save') {
      const entry = authoringStore.saveWorkflow({
        name: nameOrId,
        description: typeof request['description'] === 'string' ? request['description'] : undefined,
        program: typeof request['program'] === 'string' ? request['program'] : '',
        tools: Array.isArray(request['tools']) ? request['tools'].filter((tool): tool is string => typeof tool === 'string') : [],
        ...typeof request['inputSchema'] === 'object' && request['inputSchema'] !== null && !Array.isArray(request['inputSchema'])
          ? { inputSchema: request['inputSchema'] as Record<string, JsonValue> }
          : {},
        catalogRevision: authoringRevision(),
      }, scope.context)
      registerWorkflow(entry)
      if (sessionId !== undefined) sessionLedger?.()?.authored(sessionId)
      authoringLedger.record({
        operation: 'save', artifactKind: 'workflow', name: entry.name, version: entry.version,
        scope: entry.scope,
      })
      return {
        saved: true,
        ...scopeDisclosure(scope),
        workflow: { id: entry.id, name: entry.name, version: entry.version, updatedAt: entry.updatedAt, scope: entry.scope },
      } as never
    }
    if (action === 'list') {
      const rows = authoringStore.listWorkflows(scope.context, { all: includeAll })
      // Scope filtering selects rows from the annotated union: every hidden row
      // carries shadowedBy from the store, in "all" mode as well (U26).
      const workflows = rawScope === undefined || rawScope === 'all'
        ? rows
        : authoringStore.listWorkflows(scope.context, { all: true })
          .filter(row => row.scope === rawScope)
      return { workflows, scope: scope.scope, shadowing: 'reported per row' } as never
    }
    if (action === 'get') {
      const entry = getWorkflowByEitherName(nameOrId, scope.context)
      if (entry === undefined) throw new Error('unknown workflow "' + nameOrId + '"; list the workflows to see what exists')
      return { workflow: entry, scope: entry.scope } as never
    }
    if (action === 'delete') {
      const callerScope = scopeFor(exec)
      const entry = getWorkflowByEitherName(nameOrId, scope.context)
      if (entry === undefined) {
        const other = otherKindFor(authoringStore, 'workflow', nameOrId, scope.context)
        if (other !== undefined) throw wrongKindDelete('workflow', nameOrId, other)
        return {
          deleted: false,
          complete: false,
          deletedScopes: [],
          remainingScopes: [],
          reason: `no workflow "${nameOrId}" at the caller's ${scope.scope} scope (${scope.context.scopeKey}); `
            + 'delete removes only a row at the caller\'s resolved scope -- pass scope:"session"|"workspace"|"global" '
            + 'to target another one ("from" is demote-only and is ignored here).',
          checkedScopes: [{ scope: scope.scope, scopeKey: scope.context.scopeKey }],
        } as never
      }
      const outcome = deleteArtifactRows(authoringStore, 'workflow', entry, scope.context, callerScope.context)
      if (outcome.deletedScopes.length > 0) {
        // Keep the published dispatcher while any scope still holds this name;
        // deleting one row must unshadow, not withdraw the callable.
        const stillThere = authoringStore.getWorkflow(entry.name, scope.context) !== undefined
          || authoringStore.getWorkflow(entry.name) !== undefined
        if (!stillThere) {
          const toolName = workflowToolName(entry.name)
          workflowDisposers.get(toolName)?.()
          workflowDisposers.delete(toolName)
          workflowToolNames.delete(toolName)
        }
        authoringLedger.record({
          operation: 'delete', artifactKind: 'workflow', name: entry.name, version: entry.version,
          scope: outcome.deletedScopes[0]?.scope ?? entry.scope,
        })
      }
      return deleteDisclosure(outcome, scope) as never
    }
    if (action === 'run') {
      const entry = getWorkflowByEitherName(nameOrId, scope.context)
      if (entry === undefined) throw new Error('unknown workflow "' + nameOrId + '"; list the workflows to see what exists')
      const receiptId = host.nextReceiptId()
      const revision = authoringRevision()
      const started = Date.now()
      let report: RunReport
      try {
        report = await sandboxTempScope.run(() => programAgentContext.run(
          programContextOf(exec),
          () => runAuthoredProgram({
            program: entry.program,
            tools: entry.tools,
            input: request['input'] === undefined ? undefined : request['input'] as JsonValue,
            runner: programRunner,
            receiptId,
            catalogRevision: revision,
          }),
        ))
        scheduleSandboxTempPrune()
      } catch (error) {
        authoringLedger.record({
          operation: 'run', artifactKind: 'workflow', name: entry.name, version: entry.version,
          outcome: 'failed', durationMs: Date.now() - started,
        })
        recordArtifactFailure({
          receiptId,
          name: entry.name,
          digest: entry.digest,
          ...scope.rootSessionId === undefined ? {} : { sessionId: scope.rootSessionId },
        })
        throw error
      }
      authoringLedger.record({
        operation: 'run', artifactKind: 'workflow', name: entry.name, version: entry.version,
        durationMs: Date.now() - started,
      })
      recordAuthoredRun(receiptId, revision, 'tool_mode_workflows', report, {
        name: entry.name,
        digest: entry.digest,
        scope: entry.scope,
        ...scope.rootSessionId === undefined ? {} : { sessionId: scope.rootSessionId },
      })
      return {
        runId: receiptId,
        workflow: { id: entry.id, name: entry.name, version: entry.version, scope: entry.scope },
        result: report.result,
        logs: report.logs,
        meta: report.meta,
      } as never
    }
    if (action === 'promote' || action === 'demote') {
      const from = typeof request['from'] === 'string' ? request['from'] : undefined
      const sourceScope = action === 'demote' && from !== undefined ? scopeFor(exec, from) : scope
      const entry = getWorkflowByEitherName(nameOrId, sourceScope.context)
      if (entry === undefined) throw new Error('unknown workflow "' + nameOrId + '"')
      if (action === 'demote') {
        if (entry.scope === 'global' && !globalApprovalGranted) {
          throw new Error('E_APPROVAL_REQUIRED: removing a global artifact requires a human decision '
            + '(DSH_ARTIFACT_GLOBAL_APPROVAL=1 in the host environment)')
        }
        authoringStore.demote(entry.name, sourceScope.context)
        authoringLedger.record({
          operation: 'demote', artifactKind: 'workflow', name: entry.name, version: entry.version,
          scope: entry.scope,
          ...requestedScope === undefined ? {} : { targetScope: requestedScope as ArtifactScope },
        })
        return { demoted: true, workflow: authoringStore.getWorkflow(entry.name, scope.context) ?? null } as never
      }
      const to = typeof request['to'] === 'string' ? request['to'] : ''
      const target = scopeFor(exec, to)
      const evidence = evidenceFor(entry.name, entry.digest)
      const decision = evaluatePromotion({
        from: entry.scope,
        to: target.scope,
        evidence,
        ...request['force'] === true ? { force: true } : {},
        globalPromotion: scopeSettings.globalPromotion ?? 'human',
        approval: globalApprovalGranted ? 'human' : 'none',
        minUses: scopeSettings.promoteMinUses ?? 2,
      })
      if (!decision.ok) throw new Error(decision.code + ': ' + decision.message)
      const promoted = authoringStore.promote(
        entry.name,
        scope.context,
        target.context,
        {
          scope: entry.scope,
          scopeKey: entry.scopeKey,
          version: entry.version,
          at: new Date().toISOString(),
          ...scope.rootSessionId === undefined ? {} : { sessionId: scope.rootSessionId },
          tools: entry.tools,
        },
        request['keepSource'] !== false,
      )
      if (promoted.kind !== 'workflow') throw new Error('promotion produced the wrong artifact kind')
      registerWorkflow(promoted.workflow)
      authoringLedger.record({
        operation: 'promote', artifactKind: 'workflow', name: promoted.workflow.name,
        version: promoted.workflow.version, scope: promoted.workflow.scope, targetScope: target.scope,
        evidence: decision.evidence,
        uses: decision.evidence.uses,
        sessions: decision.evidence.sessions,
        promotedFrom: promoted.workflow.promotedFrom,
      })
      return { promoted: true, workflow: promoted.workflow, evidence: decision.evidence } as never
    }
    throw new Error('unknown action "' + String(action) + '"; expected save, clone, list, get, delete, run, promote or demote')
  },
}))

ctx.tools.register(defineTool({
  name: 'tool_mode_tools',
  description:
    'Define persistent agent_* tools (stored program + JSON input schema). WHEN TO USE: '
    + 'define once for later calls; list/get/delete definitions. The program runs through the '
    + 'same confined runner as tool_mode_run; its tools list is a binding subset, not a grant; '
    + 'execution is refused until the hosted-code gate opens. Defining registers it immediately '
    + 'for direct calls and later programs; a running program keeps its original bindings. Read '
    + 'model capability cards with model_tools action "describe" before composing.',
  parameters: {
    action: {
      type: 'string',
      required: true,
      enum: ['define', 'clone', 'from-run', 'list', 'get', 'delete', 'promote', 'demote'],
      description: 'define: create/update and register. clone: copy to a new name. from-run: scaffold a tool from a captured successful run. list/get/delete: by name or id. delete is scope-exact and reports deletedScopes/remainingScopes; a wrong-kind name POINTS at its own tool. promote/demote: move between scopes.',
    },
    name: { type: 'string', description: 'The authored tool name: agent_ followed by lowercase letters, digits or underscores.' },
    description: { type: 'string', description: 'What the tool does; shown to callers.' },
    /**
     * DIGEST-ONLY purpose (Phase 8). It never becomes the callable tool's description; the
     * artifact digest renders it so the experiment's digest arms see a meaningful purpose
     * while its silent arm sees only the opaque name/description.
     */
    purpose: { type: 'string', description: 'Optional purpose shown ONLY in the artifact digest, never as the tool description.' },
    verification: { type: 'string', description: 'Optional verification or known-failure note rendered by the artifact digest; not a correctness claim.' },
    /**
     * R8: the author's CLAIM about output granularity. `aggregate` tells the digest the
     * output is a total/aggregate and cannot be verified per item from the output alone; the
     * digest then names the callable per-item route. Never inferred from program text.
     */
    verifiability: {
      type: 'string',
      enum: ['per-item', 'aggregate'],
      description: 'Optional claim: "aggregate" means the output is aggregate-only and the digest should say so; "per-item" or absent makes no claim.',
    },
    inputSchema: { type: 'json', description: 'JSON Schema for the call arguments (object root with declared properties).' },
    program: { type: 'string', description: 'The Code Mode program body; the call arguments arrive as the input variable.' },
    tools: {
      type: 'array',
      items: { type: 'string' },
      description: 'The tool names the stored program will call; may be empty. Never the tool itself.',
    },
    target: { type: 'string', description: 'Clone only: the new agent_* tool name.' },
    runId: { type: 'string', description: 'from-run: the run id to distill; no effect on other actions.' },
    scope: { type: 'string', description: 'session | workspace | global (default artifactScopes.defaultScope). list also accepts all.' },
    to: { type: 'string', description: 'promote only: the destination scope (workspace or global).' },
    from: { type: 'string', description: 'demote only: the scope to remove (default the caller scope).' },
    force: { type: 'boolean', description: 'promote only: bypass evidence for a workspace promotion; never valid for global.' },
    keepSource: { type: 'boolean', description: 'promote only: keep the source row (default true).' },
    all: { type: 'boolean', description: 'list only: include shadowed rows as well as the winners.' },
    limit: { type: 'number', description: 'list only: page size (default 20, max 100).' },
    cursor: { type: 'string', description: 'list only: nextCursor from a previous page.' },
  } as unknown as ParameterSchemaSpec,
  output: {
    schema: AUTHORING_DELETE_OUTPUT_SCHEMA,
    render: (_args: Record<string, unknown>, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  async execute(args, exec) {
    let request = args as Record<string, unknown>
    const sessionId = sessionIdOfAgent(exec.agent)
    let action = request['action']
    let nameOrId = typeof request['name'] === 'string' ? request['name'] : ''
    const rawScope = typeof request['scope'] === 'string' ? request['scope'] : undefined
    const requestedScope = rawScope === 'all' ? undefined : rawScope
    const includeAll = rawScope === 'all' || request['all'] === true
    // LIST reports the CALLER's resolution chain and filters it by scope; it must
    // not narrow the context to the filter, or a session row shadowing the requested
    // workspace row becomes invisible (U24/P1.2).
    const scope = action === 'list' ? scopeFor(exec) : scopeFor(exec, requestedScope)
    if (action === 'clone') {
      const target = typeof request['target'] === 'string' ? request['target'] : ''
      if (target.length === 0) throw new Error('clone needs a target agent_* tool name')
      const source = authoringStore.getTool(nameOrId, scope.context)
      if (source === undefined) throw new Error('unknown source tool "' + nameOrId + '"')
      if (authoringStore.getTool(target, scope.context) !== undefined) {
        throw new Error('tool "' + target + '" already exists; choose a new target name')
      }
      const cloneVerifiability = request['verifiability'] === undefined
        ? storedVerifiability(source)
        : verifiabilityOf(request['verifiability'])
      const entry = authoringStore.saveTool({
        name: target,
        description: typeof request['description'] === 'string' ? request['description'] : source.description,
        ...(source.verification === undefined ? {} : { verification: source.verification }),
        ...cloneVerifiability === undefined ? {} : { verifiability: cloneVerifiability },
        inputSchema: typeof request['inputSchema'] === 'object' && request['inputSchema'] !== null && !Array.isArray(request['inputSchema'])
          ? request['inputSchema'] as Record<string, JsonValue>
          : source.inputSchema,
        program: typeof request['program'] === 'string' ? request['program'] : source.program,
        tools: Array.isArray(request['tools'])
          ? request['tools'].filter((tool): tool is string => typeof tool === 'string')
          : source.tools,
      }, scope.context)
      if (!registerAuthored(entry)) {
        authoringStore.deleteTool(entry.id)
        throw new Error('the cloned tool could not be registered; see the host log')
      }
      if (sessionId !== undefined) sessionLedger?.()?.authored(sessionId)
      authoringLedger.record({
        operation: 'clone', artifactKind: 'tool', name: entry.name, version: entry.version, scope: entry.scope,
      })
      return {
        cloned: true,
        ...scopeDisclosure(scope),
        tool: { id: entry.id, name: entry.name, version: entry.version, updatedAt: entry.updatedAt, scope: entry.scope },
      } as never
    }
    if (action === 'from-run') {
      if (runCaptureStore === undefined) {
        throw new Error('from-run needs captureRunPrograms: true on this deployment')
      }
      const runId = typeof request['runId'] === 'string' ? request['runId'] : ''
      const capture = runCaptureStore.get(runId)
      if (capture === undefined) {
        throw new Error('no captured run "' + runId + '"; enable captureRunPrograms and run the program once first')
      }
      // Phase 4: the DRAFT for this run's CONTENT is promoted in ONE call, and a caller-
      // supplied name is the name it keeps. No draft falls through to the define path.
      try {
        const proposedVerifiability = verifiabilityOf(request['verifiability'])
        const promoteOptions = {
          ...(nameOrId.length === 0 ? {} : { name: nameOrId }),
          from: scope.context,
          to: scope.context,
          ...(typeof request['verification'] === 'string' ? { verification: request['verification'] } : {}),
          ...proposedVerifiability === undefined ? {} : { verifiability: proposedVerifiability },
        }
        const promoted = authoringStore.promoteDraft(
          draftNameForContent({ program: capture.program, tools: capture.tools, inputSchema: capture.inputSchema }),
          promoteOptions,
        )
        const tool = promoted.kind === 'tool' ? promoted.tool : undefined
        // A promoted row that is not registered answers `unknown tool` until a restart, so
        // a refusal rolls the promotion back instead of returning a broken promise (F1).
        if (tool !== undefined && !registerAuthored(tool)) {
          authoringStore.deleteTool(tool.name, scope.context)
          throw new Error('the promoted tool "' + tool.name + '" could not be registered; the promotion was rolled back')
        }
        // Keep the from-run response shape stable whether the row came from a
        // draft or the define fallback: callers rely on defined/schemaInferred/
        // typed/parameterised to understand what was created.
        const explicitSchema = typeof request['inputSchema'] === 'object'
          && request['inputSchema'] !== null
          && !Array.isArray(request['inputSchema'])
        const inferred = inferRunInputSchema(capture)
        const parameterised = /\binput\b/.test(capture.program) && (explicitSchema || inferred.parameterised)
        return {
          promoted: true,
          defined: true,
          ...scopeDisclosure(scope),
          tool: tool === undefined
            ? null
            : { id: tool.id, name: tool.name, version: tool.version, updatedAt: tool.updatedAt, scope: tool.scope },
          ...explicitSchema ? { parameterised } : { schemaInferred: true, typed: false, parameterised },
        } as never
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error['code']) : ''
        if (code !== 'artifact-not-found') throw error
      }
      if (nameOrId.length === 0) nameOrId = suggestAgentName(capture.runId)
      const inferred = inferRunInputSchema(capture)
      const explicitSchema = typeof request['inputSchema'] === 'object'
        && request['inputSchema'] !== null
        && !Array.isArray(request['inputSchema'])
      const parameterised = /\binput\b/.test(capture.program) && (explicitSchema || inferred.parameterised)
      const toolSchema = !explicitSchema && !parameterised
        ? { type: 'object', properties: {} }
        : explicitSchema ? request['inputSchema'] as Record<string, JsonValue> : inferred.schema
      request = {
        ...request,
        action: 'define',
        name: nameOrId,
        program: capture.program,
        tools: capture.tools,
        description: typeof request['description'] === 'string' && request['description'].length > 0
          ? request['description']
          : 'Distilled from successful run ' + capture.runId + ' (contracts: ' + capture.contracts.join(', ') + ').',
        inputSchema: toolSchema,
        schemaInferred: !explicitSchema,
        parameterised,
      }
      action = 'define'
    }
    if (action === 'define') {
      const nameIssue = AGENT_TOOL_NAME_PATTERN.test(nameOrId)
        ? undefined
        : '"' + nameOrId + '" is not an authored tool name: it must match agent_[a-z0-9_]{2,60} '
          + '(for example "agent_double")'
      const inputSchema = request['inputSchema']
      const schemaIssue = typeof inputSchema !== 'object' || inputSchema === null || Array.isArray(inputSchema)
        ? 'inputSchema must be a JSON object schema (type: "object" with declared properties)'
        : undefined
      if (nameIssue !== undefined && schemaIssue !== undefined) {
        throw new Error(nameIssue + '; ' + schemaIssue)
      }
      if (nameIssue !== undefined) throw new Error(nameIssue)
      if (schemaIssue !== undefined) throw new Error(schemaIssue)
      // Collision is checked BEFORE persisting: a definition that cannot own its name is
      // refused, not stored to fail later. A re-define of one of OUR tools is an update.
      const stored = authoringStore.getTool(nameOrId, scope.context)
      // R1-A collision: a workflow's stored-name alias yields to a real authored tool.
      if (stored === undefined) releaseWorkflowAlias?.(nameOrId)
      if (stored === undefined && !authoredToolNames.has(nameOrId) && ctx.tools.schemas().some(schema => schema.name === nameOrId)) {
        throw new Error('a tool named "' + nameOrId + '" is already registered; choose another agent_* name')
      }
      const purpose = typeof request['purpose'] === 'string' ? request['purpose'] : undefined
      const verification = typeof request['verification'] === 'string' ? request['verification'] : undefined
      const verifiability = verifiabilityOf(request['verifiability'])
      const saveInput = {
        name: nameOrId,
        description: typeof request['description'] === 'string' ? request['description'] : '',
        ...purpose === undefined ? {} : { purpose },
        ...verification === undefined ? {} : { verification },
        ...verifiability === undefined ? {} : { verifiability },
        inputSchema: inputSchema as Record<string, JsonValue>,
        program: typeof request['program'] === 'string' ? request['program'] : '',
        tools: Array.isArray(request['tools']) ? request['tools'].filter((tool): tool is string => typeof tool === 'string') : [],
      }
      const entry = authoringStore.saveTool(saveInput, scope.context)
      // The dispatcher resolves the caller's scope at call time. Only the first
      // row for a name needs a registration; later scope shadows reuse it.
      if (!authoredToolNames.has(entry.name) && !registerAuthored(entry)) {
        if (stored === undefined) authoringStore.deleteTool(entry.id)
        throw new Error('the tool ' + entry.name + ' was defined but could not be registered; see the host log')
      }
      if (sessionId !== undefined) sessionLedger?.()?.authored(sessionId)
      authoringLedger.record({
        operation: 'define', artifactKind: 'tool', name: entry.name, version: entry.version, scope: entry.scope,
      })
      return {
        defined: true,
        ...scopeDisclosure(scope),
        tool: { id: entry.id, name: entry.name, version: entry.version, updatedAt: entry.updatedAt, scope: entry.scope },
        ...request['schemaInferred'] === true
          ? { schemaInferred: true, typed: false, parameterised: request['parameterised'] === true }
          : { parameterised: request['parameterised'] === true },
      } as never
    }
    if (action === 'list') {
      const rows = authoringStore.listTools(scope.context, { all: includeAll })
      // Scope filtering selects rows from the annotated union (U26).
      const listed = rawScope === undefined || rawScope === 'all'
        ? rows
        : authoringStore.listTools(scope.context, { all: true })
          .filter(row => row.scope === rawScope)
      // A draft is listable and callable; `draft` makes that visible without changing
      // how it is named or resolved, and `retention` states the policy in force. The page
      // is bounded so a large auto-kept library cannot become a large control-tool result.
      const requestedLimit = typeof request['limit'] === 'number' ? request['limit'] : 20
      const limit = Math.min(100, Math.max(1, Math.floor(requestedLimit)))
      const rawCursor = typeof request['cursor'] === 'string' ? Number(request['cursor']) : 0
      const cursor = Number.isFinite(rawCursor) ? Math.max(0, Math.floor(rawCursor)) : 0
      const page = listed.slice(cursor, cursor + limit)
      const tools = page.map(row => ({ ...visibleToolRow(row), draft: row.status === 'draft' }))
      const nextCursor = cursor + limit < listed.length ? String(cursor + limit) : undefined
      return {
        tools, total: listed.length, limit,
        ...(nextCursor === undefined ? {} : { nextCursor }),
        scope: scope.scope, retention: { draftTtlMs: draftTtl() },
      } as never
    }
    if (action === 'get') {
      const entry = authoringStore.getTool(nameOrId, scope.context)
      if (entry === undefined) throw new Error('unknown authored tool "' + nameOrId + '"; list the tools to see what exists')
      return { tool: visibleToolRow(entry), scope: entry.scope } as never
    }
    if (action === 'delete') {
      const callerScope = scopeFor(exec)
      const entry = authoringStore.getTool(nameOrId, scope.context)
      if (entry === undefined) {
        const other = otherKindFor(authoringStore, 'tool', nameOrId, scope.context)
        if (other !== undefined) throw wrongKindDelete('tool', nameOrId, other)
        return {
          deleted: false,
          complete: false,
          deletedScopes: [],
          remainingScopes: [],
          reason: `no authored tool "${nameOrId}" at the caller's ${scope.scope} scope (${scope.context.scopeKey}); `
            + 'delete removes only a row at the caller\'s resolved scope -- pass scope:"session"|"workspace"|"global" '
            + 'to target another one ("from" is demote-only and is ignored here).',
          checkedScopes: [{ scope: scope.scope, scopeKey: scope.context.scopeKey }],
        } as never
      }
      const outcome = deleteArtifactRows(authoringStore, 'tool', entry, scope.context, callerScope.context)
      if (outcome.deletedScopes.length > 0) {
        if (outcome.remainingScopes.length === 0 && authoringStore.getTool(entry.name) === undefined) {
          unregisterAuthored(entry.name)
        }
        authoringLedger.record({
          operation: 'delete', artifactKind: 'tool', name: entry.name, version: entry.version,
          scope: outcome.deletedScopes[0]?.scope ?? entry.scope,
        })
      }
      return deleteDisclosure(outcome, scope) as never
    }
    if (action === 'promote' || action === 'demote') {
      const from = typeof request['from'] === 'string' ? request['from'] : undefined
      const sourceScope = action === 'demote' && from !== undefined ? scopeFor(exec, from) : scope
      const entry = authoringStore.getTool(nameOrId, sourceScope.context)
      if (entry === undefined) throw new Error('unknown authored tool "' + nameOrId + '"')
      if (action === 'demote') {
        if (entry.scope === 'global' && !globalApprovalGranted) {
          throw new Error('E_APPROVAL_REQUIRED: removing a global artifact requires a human decision '
            + '(DSH_ARTIFACT_GLOBAL_APPROVAL=1 in the host environment)')
        }
        authoringStore.demote(entry.name, sourceScope.context)
        authoringLedger.record({
          operation: 'demote', artifactKind: 'tool', name: entry.name, version: entry.version, scope: entry.scope,
        })
        const demoted = authoringStore.getTool(nameOrId, scope.context)
        return { demoted: true, tool: demoted === undefined ? null : visibleToolRow(demoted) } as never
      }
      const to = typeof request['to'] === 'string' ? request['to'] : ''
      const target = scopeFor(exec, to)
      const evidence = evidenceFor(entry.name, entry.digest)
      const decision = evaluatePromotion({
        from: entry.scope,
        to: target.scope,
        evidence,
        ...request['force'] === true ? { force: true } : {},
        globalPromotion: scopeSettings.globalPromotion ?? 'human',
        approval: globalApprovalGranted ? 'human' : 'none',
        minUses: scopeSettings.promoteMinUses ?? 2,
      })
      if (!decision.ok) throw new Error(decision.code + ': ' + decision.message)
      const promoted = authoringStore.promote(
        entry.name,
        scope.context,
        target.context,
        {
          scope: entry.scope,
          scopeKey: entry.scopeKey,
          version: entry.version,
          at: new Date().toISOString(),
          ...scope.rootSessionId === undefined ? {} : { sessionId: scope.rootSessionId },
          tools: entry.tools,
        },
        request['keepSource'] !== false,
      )
      if (promoted.kind !== 'tool') throw new Error('promotion produced the wrong artifact kind')
      if (!registerAuthored(promoted.tool)) {
        throw new Error('the promoted tool could not be registered; see the host log')
      }
      authoringLedger.record({
        operation: 'promote', artifactKind: 'tool', name: promoted.tool.name,
        version: promoted.tool.version, scope: promoted.tool.scope, targetScope: target.scope,
        evidence: decision.evidence,
        uses: decision.evidence.uses,
        sessions: decision.evidence.sessions,
        promotedFrom: promoted.tool.promotedFrom,
      })
      return { promoted: true, tool: visibleToolRow(promoted.tool), evidence: decision.evidence } as never
    }
    throw new Error('unknown action "' + String(action) + '"; expected define, clone, from-run, list, get, delete, promote or demote')
  },
}))
}