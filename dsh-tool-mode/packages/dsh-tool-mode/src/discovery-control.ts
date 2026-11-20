/**
 * DECL-07 read-only discovery: `tool_mode_list` and `tool_mode_describe`.
 *
 * The two handlers are one surface: describe answers for exactly the names list
 * advertises, through the same binding resolver and the same readiness state.
 * This module receives the live view as callbacks; it never imports the
 * composition root.
 *
 * @module discovery-control
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-known-value-widening, anti-slop/no-shape-in-symbol-names, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this is the registry/catalog discovery boundary; entries are validated by the catalog/registry types and then cast at the DSH tool seam. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { STANDARD_CONTRACTS } from '@try-works/tool-mode-contracts'
import { modelOperations } from './catalog.ts'
import type { ResolvedModel } from './capability.ts'
import type { BuiltScopeContext } from './artifact-scope-context.ts'
import {
  workflowToolName,
  type AgentToolSummary,
  type AgentWorkflowSummary,
} from './agent-authoring.ts'
import type { SessionLedger } from './session-ledger.ts'
import { TOOL_MODE_DESCRIBE_CONTRACT, TOOL_MODE_LIST_CONTRACT } from './discovery-contracts.ts'
import { TOOL_MODE_RUN_CONTRACT } from './tool-mode-run.ts'
import { DECISION_COMBINE_CONTRACT } from './decision-combine.ts'
import { DECISION_EVALUATE_CONTRACT, DECISION_ROUTE_CONTRACT } from './decision-evaluate.ts'
import { JEV_CHOOSE_CONTRACT, JEV_JUDGMENTS_CONTRACT } from './jev.ts'
import { describeSkill, exampleFromSchema, typescriptBindings } from './discovery-describe.ts'
import { describeModelCard, describeModels } from './model-cards.ts'
import { modelSurface } from './model-surface.ts'
import { describeDataHandling } from './skills.ts'
import { canonicalExampleFor } from './tool-description.ts'

/** What the registry currently holds for one model id. */
export interface DiscoveryInstalledRecord {
  readonly toolName?: string
}

/** The live catalog/registry view, read per call. */
export interface DiscoveryView {
  readonly resolved: readonly ResolvedModel[]
  readonly installed: ReadonlyMap<string, DiscoveryInstalledRecord>
}

/** The authoring inventory list/describe may mention. */
export interface DiscoveryAuthoringSnapshot {
  readonly tools: readonly AgentToolSummary[]
  readonly workflows: readonly AgentWorkflowSummary[]
}

/** One contract's published identity. */
export interface DiscoveryContractFacts {
  readonly contract: string
  readonly contractVersion: string | null
}

/** Everything the read-only discovery pair needs, supplied by the composition root. */
export interface DiscoveryControlDeps {
  readonly ctx: Context
  readonly view: () => DiscoveryView
  readonly catalogRevision: () => string
  readonly bindableName: (name: string, scope?: BuiltScopeContext) => boolean
  readonly scopeFor?: ((exec: { agent?: unknown }) => BuiltScopeContext | undefined) | undefined
  readonly sessionIdOfAgent: (agent: unknown) => string | undefined
  readonly externalGrant: () => readonly string[] | undefined
  readonly recordDiscovery: (contract: 'tool_mode_list' | 'tool_mode_describe', exec: { agent?: unknown }) => void
  readonly authoringSnapshot?: ((exec: { agent?: unknown }) => DiscoveryAuthoringSnapshot | undefined) | undefined
  readonly sessionLedger: () => SessionLedger | undefined
  readonly toolContracts: () => ReadonlyMap<string, DiscoveryContractFacts>
  readonly declarativeRecipeDigests: ReadonlyMap<string, string>
  readonly workflowToolNames: ReadonlySet<string>
  readonly authoredToolNames: ReadonlySet<string>
  readonly ownedExtensionToolNames: ReadonlySet<string>
  /** Whether this extension currently has a prepared-cold deployment. */
  readonly coldFor?: ((extensionId: string | undefined) => boolean) | undefined
}

/**
 * Which discovery bucket a catalog row belongs to (task-57).
 *
 * The split is STRUCTURAL: the SHARED readiness state decides, never the registry set.
 * `callable` already implies "registered" (task-52 made the registry fact an input to the
 * derivation), so testing the state covers both and cannot drift from `model_tools`; a
 * registry-only test would put a REGISTERED but non-callable row into `tools`, promising
 * more than the host will serve.
 * @param state - the shared model-tool readiness state.
 * @returns the bucket the row is published in.
 */
export function discoveryBucket(state: string): 'tools' | 'unavailable' {
  return state === 'callable' ? 'tools' : 'unavailable'
}

/**
 * Register the read-only discovery pair.
 * @param deps - live registry, catalog, binding and authoring callbacks.
 */
export function registerDiscoveryControlTools(deps: DiscoveryControlDeps): void {
  const ctx = deps.ctx
  const bindableName = deps.bindableName
  const scopeForAuthoringCaller = deps.scopeFor
  const externalGrant = deps.externalGrant
  const recordDiscovery = deps.recordDiscovery
  const authoringSnapshot = deps.authoringSnapshot
  const declarativeRecipeDigests = deps.declarativeRecipeDigests
  const workflowToolNames = deps.workflowToolNames
  const authoredToolNames = deps.authoredToolNames
  const ownedExtensionToolNames = deps.ownedExtensionToolNames
  const coldFor = deps.coldFor
  /**
   * DECL-07: the read-only discovery pair under the SPEC NAMES. Ordinary
   * tool-only clients get the permitted tools + readiness (list) and the
   * selected schemas/limits/locations (describe) without relying on skills
   * or server instructions. The existing model_tools actions stay as the
   * management aliases; these two are READ-ONLY and never mutate.
   */
  const catalogRevision = () => deps.catalogRevision()
  /**
   * THE ACTION THAT WOULD MAKE A CATALOG NAME CALLABLE (P4).
   *
   * Discovery used to answer a non-callable name with an empty schema, which reads as
   * "this tool has no arguments" rather than "this tool cannot run". The action names the
   * one operator move that changes the state, and says so plainly when nothing can.
   * @param state - the shared readiness state for the model.
   * @param extension - the implementing package, when the catalog binds one.
   * @returns a sentence naming the clearing action, or why none exists.
   */
  const clearingActionFor = (state: string, extension: string | undefined): string => {
    if (state === 'unavailable') {
      return 'none: no route on this host can serve this model, so installing it would not help; '
        + 'use a different model or a remote bridge'
    }
    if (state === 'not-installed') {
      return extension === undefined
        ? 'install the implementing extension, then enable the model tool with model_tools_manage (action "enable")'
        : `install ${extension}, then enable its model tool with model_tools_manage (action "enable")`
    }
    return extension === undefined
      ? 'enable the model tool with model_tools_manage (action "enable"); it can run on this host and is not enabled in this profile'
      : `enable the ${extension} model tool with model_tools_manage (action "enable"); it can run on this host and is not enabled in this profile`
  }
  /**
   * THE CONTRACT FACTS a discovery row publishes (task-52).
   *
   * `tool_mode_list` used to carry no `contractVersion`, so an artifact could not pin the
   * contract it was built on without a second `tool_mode_describe` call per tool. The host
   * contracts and the standard model contracts are static; extension and declarative tools
   * register theirs at publication (`toolContracts`). A tool with no contract publishes
   * null rather than an invented version.
   */
  const hostContractFacts = new Map<string, { readonly contract: string; readonly contractVersion: string | null }>([
    ...[TOOL_MODE_LIST_CONTRACT, TOOL_MODE_DESCRIBE_CONTRACT, TOOL_MODE_RUN_CONTRACT,
      DECISION_COMBINE_CONTRACT, DECISION_ROUTE_CONTRACT, DECISION_EVALUATE_CONTRACT,
      JEV_CHOOSE_CONTRACT, JEV_JUDGMENTS_CONTRACT].map(contract => [contract.toolName, {
        contract: contract.contract,
        contractVersion: contract.version,
      }] as const),
    ...STANDARD_CONTRACTS.map(contract => [contract.toolName, {
      contract: contract.contract,
      contractVersion: contract.version,
    }] as const),
  ])
  const contractFactsFor = (name: string): { readonly contract: string | null; readonly contractVersion: string | null } => {
    const declared = hostContractFacts.get(name) ?? deps.toolContracts().get(name)
    return declared === undefined
      ? { contract: null, contractVersion: null }
      : { contract: declared.contract, contractVersion: declared.contractVersion }
  }
  /**
   * Whether `tool_mode_describe` can return a non-empty schema for this tool.
   *
   * `tool_mode_list` must not carry the schemas themselves (too large), but a caller
   * deciding whether a describe call is worth making needs this one bit.
   */
  const schemaAvailableFor = (name: string): boolean => {
    const parameters = ctx.tools.schemas().find(schema => schema.name === name)?.parameters
    const output = ctx.tools.get(name)?.output.schema
    return Object.keys(parameters ?? {}).length > 0 || Object.keys(output ?? {}).length > 0
  }
  const describeOne = async (name: string, scope?: BuiltScopeContext) => {
    const { resolved, installed } = deps.view()
    const registrySchema = ctx.tools.schemas().find(schema => schema.name === name)
    const definition = ctx.tools.get(name)
    const modelItem = resolved.find(item => {
      const primary = installed.get(item.entry.id)?.toolName ?? item.entry.tool?.name ?? ''
      return primary === name
        || modelOperations(item.entry).some(operation => operation.tool.name === name)
    })
    const descriptor = modelItem === undefined ? undefined : describeModels([modelItem])[0]
    /**
     * A CATALOG NAME THE REGISTRY DOES NOT SERVE IS EXPLAINED, NOT DESCRIBED (P4).
     *
     * The old path fell through to an empty parameter object and an empty output schema,
     * which a caller reads as a real tool with no arguments. The honest answer is the
     * shared readiness state, the verdict's own reason, and the action that would clear
     * it — no schema, because there is nothing to call.
     */
    if (registrySchema === undefined && modelItem !== undefined && descriptor !== undefined) {
      const record = installed.get(modelItem.entry.id)
      // The branch itself means the registry does not serve this name: not published.
      const surface = modelSurface(modelItem.entry, modelItem.verdict, record !== undefined, false)
      return {
        name,
        callable: false as const,
        bindable: false as const,
        ...contractFactsFor(name),
        state: surface.state,
        reason: descriptor.reason,
        ...canonicalExampleFor(name) === undefined ? {} : { example: canonicalExampleFor(name) },
        action: clearingActionFor(surface.state, modelItem.entry.provider?.extension),
        model: describeModelCard(descriptor, modelItem.entry.provider?.extension ?? null),
        catalogRevision: catalogRevision(),
      }
    }
    const owner = undefined
    const inputSchema = registrySchema?.parameters ?? {}
    const outputSchema = definition?.output.schema ?? {}
    const skill = modelItem === undefined ? undefined : describeSkill(modelItem.entry.skill as never)
    const contract = STANDARD_CONTRACTS.find(candidate => candidate.toolName === name)
      ?? [TOOL_MODE_LIST_CONTRACT, TOOL_MODE_DESCRIBE_CONTRACT].find(candidate => candidate.toolName === name)
    return {
      name,
      callable: true as const,
      bindable: bindableName(name, scope),
      ...contractFactsFor(name),
      description: registrySchema?.description ?? descriptor?.summary ?? '',
      parameters: inputSchema,
      outputSchema,
      typescript: {
        input: typescriptBindings(name, 'Input', inputSchema),
        output: typescriptBindings(name, 'Output', outputSchema),
      },
      examples: [exampleFromSchema(inputSchema)],
      ...canonicalExampleFor(name) === undefined ? {} : { example: canonicalExampleFor(name) },
      // DECL-01/slice 5: the contract already carries these two; describe must not
      // drop the half a schema cannot express (semantics) or the refusal list.
      // The refusal list is bounded here because the value-schema DSL cannot
      // express an array maxItems.
      semantics: contract?.semantics ?? {},
      limits: contract?.limits ?? {},
      unsupported: (contract?.unsupported ?? []).slice(0, 64),
      dataHandling: modelItem === undefined
        ? 'This host-owned discovery tool reads the local registry; it does not send model input anywhere.'
        : describeDataHandling(modelItem.entry),
      recovery:
        'If a model tool is unavailable, prepare and enable it through the operator surface; fix validation errors '
        + 'instead of retrying unchanged; never silently substitute a remote provider.',
      ...skill === undefined ? {} : { skill },
      ...descriptor === undefined ? {} : {
        model: describeModelCard(descriptor, modelItem?.entry.provider?.extension ?? null),
      },
      ...owner === undefined ? {} : { ownerExtension: owner },
      executionLocation: 'device',
      executionKind: declarativeRecipeDigests.has(name) ? 'declarative' : 'extension',
      recipeDigest: declarativeRecipeDigests.get(name) ?? null,
      catalogRevision: catalogRevision(),
    }
  }
  ctx.tools.register(defineTool({
    name: 'tool_mode_list',
    description:
      'List the tools this caller may use. `tools` are the names that can be CALLED now; each row carries '
      + '`bindable`, true when a program may bind it (false for CODE-07 control tools and MCP-11 confidential '
      + 'tools), so a caller can tell callable from bindable without provoking a refusal. `unavailable` lists '
      + 'catalogued models that cannot be called here with its readiness state and reason. '
      + 'Read-only discovery (DECL-07): it never installs, prepares, activates or changes anything.',
    parameters: {
      scope: { type: 'string', description: 'Optional authoring filter: session | workspace | global | all (default resolved).' },
    } as unknown as ParameterSchemaSpec,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          catalogRevision: { type: 'string' },
          tools: { type: 'array' },
          unavailable: { type: 'array' },
          /** Authored artifacts and the read-only repeated-shape report. */
          authoring: { type: 'object', additionalProperties: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      recordDiscovery('tool_mode_list', exec)
      const { resolved, installed } = deps.view()
      const bindableScope = scopeForAuthoringCaller?.(exec)
      const callerGrant = externalGrant()
      const permitted = callerGrant === undefined ? undefined : new Set(callerGrant)
      /**
       * P4: THE REGISTRY, NOT THE CATALOG, DECIDES WHAT \`tools\` MAY CONTAIN.
       *
       * A catalog row whose tool is not registered cannot be bound: \
       * \`buildToolBindings\` refuses the WHOLE program when any requested name is
       * unattainable, so advertising one turned discovery into a trap. Registered rows are
       * \`tools\`; every other catalog row is explained in \`unavailable\` with the same
       * state and reason \`model_tools\` publishes.
       */
      const registered = new Set(ctx.tools.schemas().map(schema => schema.name))
      const tools = []
      const unavailable = []
      for (const item of resolved) {
        const record = installed.get(item.entry.id)
        const descriptor = describeModels([item])[0]!
        const toolName = record?.toolName ?? item.entry.tool?.name ?? item.entry.id
        if (permitted !== undefined && !permitted.has(toolName)) continue
        // The SAME derivation model_tools uses, so the two surfaces agree.
        const surface = modelSurface(item.entry, item.verdict, record !== undefined, registered.has(toolName))
        /**
         * THE SPLIT IS STRUCTURAL (task-57): the SHARED readiness state decides, not the
         * registry set. `callable` already implies "registered" (task-52 made the registry
         * fact an input), so testing the state covers both and cannot drift from
         * `model_tools`; the previous set test could put a REGISTERED but non-callable row
         * into `tools`, which promises more than the host will serve.
         */
        if (discoveryBucket(surface.state) === 'unavailable') {
          unavailable.push({
            name: toolName,
            model: item.entry.id,
            extension: item.entry.provider?.extension ?? null,
            state: surface.state,
            // The verdict's own wording, carried verbatim: one reason, never re-written.
            reason: descriptor.reason,
          })
          continue
        }
        tools.push({
          name: toolName,
          description: descriptor.summary,
          state: surface.state,
          toolName: item.entry.tool.name,
          readiness: item.verdict.runnable ? 'callable' : `unavailable: ${descriptor.reason}`,
          model: item.entry.id,
          extension: item.entry.provider?.extension ?? null,
          route: item.verdict.route,
          executionKind: declarativeRecipeDigests.has(toolName) ? 'declarative' : 'extension',
          recipeDigest: declarativeRecipeDigests.get(toolName) ?? null,
          ...contractFactsFor(toolName),
          schemaAvailable: schemaAvailableFor(toolName),
          bindable: bindableName(toolName, bindableScope),
          ...coldFor?.(item.entry.provider?.extension) === true ? { cold: true } : {},
        })
        // A model may declare more than its primary operation. Expose each
        // REGISTERED operation as its own discoverable row; an unregistered one
        // stays out of `tools` rather than being promised.
        for (const operation of modelOperations(item.entry)) {
          const operationName = operation.tool.name
          if (operationName === toolName || !registered.has(operationName)) continue
          if (permitted !== undefined && !permitted.has(operationName)) continue
          tools.push({
            name: operationName,
            description: operation.tool.description,
            state: 'callable',
            toolName: operationName,
            readiness: 'callable',
            model: item.entry.id,
            extension: item.entry.provider?.extension ?? null,
            route: item.verdict.route,
            executionKind: declarativeRecipeDigests.has(operationName) ? 'declarative' : 'extension',
            recipeDigest: declarativeRecipeDigests.get(operationName) ?? null,
            ...contractFactsFor(operationName),
            schemaAvailable: schemaAvailableFor(operationName),
            bindable: bindableName(operationName, bindableScope),
          } as never)
        }
      }
      /**
       * DECL-07: the list is the caller's PERMITTED TOOL SURFACE, not only the
       * catalog. Host tools (model_tools, tool_mode_run, the discovery pair) and
       * standard-contract tools registered by the host or an extension are
       * callable and were missing here: `tool_mode_describe` answered for them
       * while `tool_mode_list` did not mention them, so a caller asking "what can
       * I call?" got a list that disagreed with the registry.
       */
      const listed = new Set(tools.map(tool => tool.name))
      /**
       * Only tools THIS plugin serves: the registry it sees is the whole host
       * surface (browser, memory, schedule, other plugins), and DECL-07 is about
       * the Tool Mode surface, not every tool in the process. Standard contracts
       * the plugin serves, its own control tools, extension tools it published and
       * declarative recipe tools are the owned set.
       */
      const owned = new Set<string>([
        ...STANDARD_CONTRACTS.map(contract => contract.toolName),
        'tool_mode_list', 'tool_mode_describe', 'tool_mode_run', 'model_tools', 'model_tools_manage',
        'tool_mode_workflows', 'tool_mode_tools',
        'decision_combine', 'decision_evaluate', 'decision_route',
        ...workflowToolNames,
        ...authoredToolNames,
        ...ownedExtensionToolNames,
        ...declarativeRecipeDigests.keys(),
      ])
      for (const schema of ctx.tools.schemas()) {
        if (!owned.has(schema.name)) continue
        if (listed.has(schema.name)) continue
        if (permitted !== undefined && !permitted.has(schema.name)) continue
        tools.push({
          name: schema.name,
          description: schema.description ?? '',
          state: 'callable',
          toolName: schema.name,
          readiness: 'callable',
          model: null,
          extension: null,
          route: 'host',
          executionKind: 'host',
          recipeDigest: null,
          ...contractFactsFor(schema.name),
          schemaAvailable: schemaAvailableFor(schema.name),
          bindable: bindableName(schema.name, bindableScope),
        } as never)
      }
      const sessionId = deps.sessionIdOfAgent(exec.agent)
      if (sessionId !== undefined) deps.sessionLedger?.()?.offered(sessionId, tools.map(tool => tool.name))
      const listedAuthoring = authoringSnapshot?.(exec)
      const scopeFilter = typeof (args as { scope?: unknown }).scope === 'string'
        ? (args as { scope: string }).scope
        : undefined
      const authoring = listedAuthoring === undefined || scopeFilter === undefined || scopeFilter === 'all'
        ? listedAuthoring
        : {
            ...listedAuthoring,
            tools: listedAuthoring.tools.filter(row => row.scope === scopeFilter),
            workflows: listedAuthoring.workflows.filter(row => row.scope === scopeFilter),
          }
      const suggestions = (listedAuthoring as { suggestions?: readonly unknown[] } | undefined)?.suggestions
      if (sessionId !== undefined && suggestions !== undefined && suggestions.length > 0) {
        deps.sessionLedger?.()?.offer(sessionId)
      }
      const session = sessionId === undefined ? undefined : deps.sessionLedger?.()?.summary(sessionId)
      return {
        catalogRevision: catalogRevision(),
        tools,
        unavailable,
        ...authoring === undefined ? {} : { authoring },
        ...session === undefined ? {} : { authoring: { ...authoring, session } },
      } as never
    },
    presentCall() {
      return { card: 'generic', title: 'Tool mode list', kind: 'read', rawInput: '' }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'tool_mode_describe',
    description:
      'Describe one or more tools by name: the selected input/output schemas, the resolved model, limits, '
      + '`contract`/`contractVersion` and `bindable` (whether a program may bind it, without provoking a '
      + 'refusal), plus the catalog revision. A catalog name that cannot be called is explained with its '
      + 'readiness state, the reason and the action that would clear it, instead of a schema. '
      + 'Read-only discovery (DECL-07): it never installs, prepares, activates or changes anything.',
    parameters: {
      tools: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'The tool names to describe.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          catalogRevision: { type: 'string' },
          tools: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                // DECL-01/slice 5: declared so a client can rely on both fields even
                // though the entry keeps room for implementation-specific extras.
                semantics: { type: 'object', additionalProperties: true },
                unsupported: { type: 'array', items: { type: 'string' } },
                scope: { type: 'string' },
                shadowing: { type: 'object', additionalProperties: true },
                // Phase 0 (U37): an authored workflow is STORED under one name and
                // CALLED under another. Describe reports both instead of losing the
                // stored identity behind the callable spelling it echoes.
                storedName: { type: 'string' },
                callableName: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      recordDiscovery('tool_mode_describe', exec)
      const names = args.tools as string[]
      const authoring = authoringSnapshot?.(exec)
      const bindableScope = scopeForAuthoringCaller?.(exec)
      const callerGrant = externalGrant()
      const permitted = callerGrant === undefined ? undefined : new Set(callerGrant)
      const entries = []
      for (const requestedName of names) {
        if (permitted !== undefined && !permitted.has(requestedName)) {
          throw new Error(`tool ${JSON.stringify(requestedName)} is forbidden for this caller (EXT-32)`)
        }
        const row = authoring === undefined
          ? undefined
          : authoring.workflows.find(candidate => candidate.name === requestedName)
            ?? authoring.workflows.find(candidate => workflowToolName(candidate.name) === requestedName)
            ?? authoring.tools.find(candidate => candidate.name === requestedName)
        // An authored workflow is listed by its ARTIFACT name but callable by
        // workflow_<name>; describe accepts either spelling.
        const lookupName = row !== undefined && authoring?.workflows.includes(row) === true
          ? workflowToolName(row.name)
          : requestedName
        const described = await describeOne(lookupName, bindableScope)
        const isWorkflowRow = row !== undefined && authoring?.workflows.includes(row) === true
        const callableName = row === undefined
          ? lookupName
          : isWorkflowRow ? workflowToolName(row.name) : row.name
        /**
         * U44a: an AUTHORED artifact is described from its stored row, not only from the
         * registry projection. The documented list -> describe path must not dead-end on
         * the agent's own tools when a registration is scope-shadowed or awaiting restart.
         * The row carries the real input schema; `bindable` stays the live answer.
         */
        if (row !== undefined) {
          const bindable = bindableName(callableName, bindableScope)
          entries.push({
            ...described,
            name: callableName,
            callable: bindable,
            bindable,
            description: row.description,
            parameters: row.inputSchema,
            scope: row.scope,
            ...row.shadowing === null ? {} : { shadowing: row.shadowing },
            storedName: row.name,
            callableName,
            ...bindable ? {} : {
              reason: 'the authored artifact is stored but its registration is not visible to this caller; it may be scope-shadowed or await a restart',
              action: 'Call it from the scope that owns it, promote it to this workspace, or restart after the registration is created.',
            },
          })
          continue
        }
        // A KNOWN catalog name that cannot be called is EXPLAINED, not refused (P4).
        if (described.callable === false) {
          entries.push(described)
          continue
        }
        // describeOne returns an EMPTY description + empty parameters + no
        // model for an unknown name; a real tool always has at least one.
        if (described.description.length === 0
          && Object.keys(described.parameters).length === 0
          && described.model === undefined) {
          throw new Error(`unknown tool ${JSON.stringify(requestedName)}`)
        }
        entries.push(described)
      }
      return { catalogRevision: catalogRevision(), tools: entries } as never
    },
    presentCall(args) {
      return { card: 'generic', title: 'Tool mode describe', kind: 'read', rawInput: String((args.tools as string[] | undefined)?.join(',') ?? '') }
    },
  }))
}
