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
  readonly ledger: AuthoringLedger
  readonly scopeFor: (exec: { agent?: unknown } | undefined, requested?: string) => BuiltScopeContext
  readonly sessionIdOfAgent: (agent: unknown) => string | undefined
  readonly sessionLedger: () => SessionLedger | undefined
  readonly registerWorkflow: (workflow: AgentWorkflow) => boolean
  readonly registerAuthored: (definition: AgentToolDefinition) => boolean
  readonly unregisterAuthored: (name: string) => boolean
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

/**
 * Register the authoring tools.
 * @param deps - store, ledger, registration hooks and execution callbacks.
 */
export function registerAuthoringTools(deps: AuthoringSurfaceDeps): void {
  const ctx = deps.ctx
  const authoringStore = deps.store
  const authoringLedger = deps.ledger
  const scopeFor = deps.scopeFor
  const sessionIdOfAgent = deps.sessionIdOfAgent
  const sessionLedger = deps.sessionLedger
  const registerWorkflow = deps.registerWorkflow
  const registerAuthored = deps.registerAuthored
  const unregisterAuthored = deps.unregisterAuthored
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
      description: 'save: create or update (bumps the version). clone: copy to a new name. list/get/delete/run: by name or id. promote/demote: move the artifact between scopes.',
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
  } as unknown as ParameterSchemaSpec,
  output: {
    schema: { type: 'object', additionalProperties: true } as unknown as ValueSchemaSpec,
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
      const entry = getWorkflowByEitherName(nameOrId, scope.context)
      if (entry === undefined) {
        return {
          deleted: false,
          reason: `no workflow "${nameOrId}" at the caller's ${scope.scope} scope (${scope.context.scopeKey}); `
            + 'delete removes only a row at the caller\'s resolved scope -- pass scope:"session"|"workspace"|"global" '
            + 'to target another one ("from" is demote-only and is ignored here).',
          checkedScopes: [{ scope: scope.scope, scopeKey: scope.context.scopeKey }],
        } as never
      }
      const deleted = authoringStore.deleteWorkflow(entry.name, scope.context)
      if (!deleted) {
        return {
          deleted: false,
          reason: `no workflow "${nameOrId}" at the caller's ${scope.scope} scope (${scope.context.scopeKey}); `
            + 'delete removes only a row at the caller\'s resolved scope -- pass scope:"session"|"workspace"|"global" '
            + 'to target another one ("from" is demote-only and is ignored here).',
          checkedScopes: [{ scope: scope.scope, scopeKey: scope.context.scopeKey }],
        } as never
      }
      if (deleted && entry !== undefined) {
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
          operation: 'delete', artifactKind: 'workflow', name: entry.name, version: entry.version, scope: entry.scope,
        })
      }
      return { deleted, ...scopeDisclosure(scope) } as never
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
      description: 'define: create/update and register. clone: copy to a new name. from-run: scaffold a tool from a captured successful run. list/get/delete: by name or id. promote/demote: move between scopes.',
    },
    name: { type: 'string', description: 'The authored tool name: agent_ followed by lowercase letters, digits or underscores.' },
    description: { type: 'string', description: 'What the tool does; shown to callers.' },
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
  } as unknown as ParameterSchemaSpec,
  output: {
    schema: { type: 'object', additionalProperties: true } as unknown as ValueSchemaSpec,
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
      const entry = authoringStore.saveTool({
        name: target,
        description: typeof request['description'] === 'string' ? request['description'] : source.description,
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
      if (stored === undefined && !authoredToolNames.has(nameOrId) && ctx.tools.schemas().some(schema => schema.name === nameOrId)) {
        throw new Error('a tool named "' + nameOrId + '" is already registered; choose another agent_* name')
      }
      const entry = authoringStore.saveTool({
        name: nameOrId,
        description: typeof request['description'] === 'string' ? request['description'] : '',
        inputSchema: inputSchema as Record<string, JsonValue>,
        program: typeof request['program'] === 'string' ? request['program'] : '',
        tools: Array.isArray(request['tools']) ? request['tools'].filter((tool): tool is string => typeof tool === 'string') : [],
      }, scope.context)
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
      const tools = rawScope === undefined || rawScope === 'all'
        ? rows
        : authoringStore.listTools(scope.context, { all: true })
          .filter(row => row.scope === rawScope)
      return { tools, scope: scope.scope } as never
    }
    if (action === 'get') {
      const entry = authoringStore.getTool(nameOrId, scope.context)
      if (entry === undefined) throw new Error('unknown authored tool "' + nameOrId + '"; list the tools to see what exists')
      return { tool: entry, scope: entry.scope } as never
    }
    if (action === 'delete') {
      const entry = authoringStore.getTool(nameOrId, scope.context)
      if (entry === undefined) {
        return {
          deleted: false,
          reason: `no authored tool "${nameOrId}" at the caller's ${scope.scope} scope (${scope.context.scopeKey}); `
            + 'delete removes only a row at the caller\'s resolved scope -- pass scope:"session"|"workspace"|"global" '
            + 'to target another one ("from" is demote-only and is ignored here).',
          checkedScopes: [{ scope: scope.scope, scopeKey: scope.context.scopeKey }],
        } as never
      }
      const deleted = authoringStore.deleteTool(nameOrId, scope.context)
      if (!deleted) {
        return {
          deleted: false,
          reason: `no authored tool "${nameOrId}" at the caller's ${scope.scope} scope (${scope.context.scopeKey}); `
            + 'delete removes only a row at the caller\'s resolved scope -- pass scope:"session"|"workspace"|"global" '
            + 'to target another one ("from" is demote-only and is ignored here).',
          checkedScopes: [{ scope: scope.scope, scopeKey: scope.context.scopeKey }],
        } as never
      }
      if (deleted) {
        const stillThere = authoringStore.getTool(nameOrId, scope.context) !== undefined
          || authoringStore.getTool(nameOrId) !== undefined
        if (!stillThere) unregisterAuthored(entry.name)
        authoringLedger.record({
          operation: 'delete', artifactKind: 'tool', name: entry.name, version: entry.version, scope: entry.scope,
        })
      }
      return { deleted, ...scopeDisclosure(scope) } as never
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
        return { demoted: true, tool: authoringStore.getTool(nameOrId, scope.context) ?? null } as never
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
      return { promoted: true, tool: promoted.tool, evidence: decision.evidence } as never
    }
    throw new Error('unknown action "' + String(action) + '"; expected define, clone, from-run, list, get, delete, promote or demote')
  },
}))
}
