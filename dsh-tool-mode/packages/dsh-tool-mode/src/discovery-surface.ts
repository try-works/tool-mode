/**
 * The `model_tools` execution closure: catalog inspection, enable/disable,
 * receipts, diagnostics, MCP status, credentials and extension management.
 *
 * The composition root supplies the live catalog/registry view and every
 * management surface as explicit dependencies; this module never imports it.
 *
 * @module discovery-surface
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-shape-in-symbol-names, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this is the model-management JSON/registry boundary; untrusted stored JSON is validated, then registry values are cast at the DSH seam. */

import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { LifecycleAuditEvent } from '@try-works/tool-mode-extension-sdk'
import { MODEL_TOOLS_SPEC } from './model-tools-schema.ts'
import type { AcquisitionSource } from './asset-acquisition.ts'
import type { ModelCatalogEntry } from './types.ts'
import type { ResolvedModel } from './capability.ts'
import { CAPTURE_PATH } from './capture-path.ts'
import { buildDiagnostics } from './diagnostics.ts'
import { createHttpSource } from './http-acquisition.ts'
import type { InvocationAccounting } from './invocation-accounting.ts'
import { recordLicenseBasis } from './license-basis.ts'
import type { AuthoringReceipt } from './authoring-ledger.ts'
import type { ClientCredentialStore } from './mcp/credential-store.ts'
import type { McpHost } from './mcp/server.ts'
import { describeModels, type ModelDescriptor } from './model-cards.ts'
import { modelSurface } from './model-surface.ts'
import type { PrepareAssetsSurface } from './prepared-assets.ts'
import type { CatalogGeneration } from './publication.ts'
import type { InvocationReceipt, LifecycleRecord } from './receipt.ts'
import { receiptView } from './receipt-view.ts'
import { defaultStateFile, type PersistedState, type StateStore } from './state.ts'
import type { UpdateHostSurface } from './update-surface.ts'

/** Deployment facts the management actions read. */
export interface ModelToolsConfig {
  readonly stateFile?: string | undefined
  readonly captureProfile?: string | undefined
  readonly extensionStoreDir?: string | undefined
  readonly assetSourceFactory?: (() => AcquisitionSource) | undefined
}

/** One registered model row. */
export interface ModelToolsInstalled {
  readonly entry: ModelCatalogEntry
  readonly toolName: string
}

/** What the management closure needs from the composition root. */
export interface ModelToolsDeps {
  readonly ctx: Context
  readonly config: ModelToolsConfig
  readonly persisted: () => PersistedState
  readonly setPersisted: (next: PersistedState) => void
  readonly stateStore: StateStore
  readonly persist: boolean
  readonly resolved: readonly ResolvedModel[]
  readonly installed: ReadonlyMap<string, ModelToolsInstalled>
  readonly byId: ReadonlyMap<string, ResolvedModel>
  readonly configuredIds: readonly string[]
  readonly invocationReceipts: readonly InvocationReceipt[]
  readonly surfaceFor: (entry: ModelCatalogEntry) => Promise<CatalogGeneration | undefined>
  readonly install: (item: ResolvedModel) => Promise<boolean>
  readonly uninstall: (id: string) => boolean
  readonly remember: (id: string, enabled: boolean) => boolean
  readonly mcpHost: McpHost
  readonly mcpWithheldReasons: ReadonlyMap<string, string>
  readonly credentialStore: ClientCredentialStore | undefined
  readonly externalAccountings: readonly InvocationAccounting[]
  readonly lifecycleRecords: readonly LifecycleRecord[]
  readonly authoringReceipts: () => readonly AuthoringReceipt[]
  readonly recordLifecycleEvent: (event: LifecycleAuditEvent) => void
  readonly notifyCatalogChange: () => void
  readonly updateSurface: () => UpdateHostSurface | undefined
  readonly prepareAssetsSurface: () => PrepareAssetsSurface | undefined
}

/**
 * Build the `model_tools` definition.
 * @param deps - live catalog, registry and management surfaces.
 */
export function createModelToolsControl(deps: ModelToolsDeps) {
  const ctx = deps.ctx
  const config = deps.config
  const persisted = deps.persisted
  const stateStore = deps.stateStore
  const persist = deps.persist
  const resolved = deps.resolved
  const installed = deps.installed
  const byId = deps.byId
  const configuredIds = deps.configuredIds
  const invocationReceipts = deps.invocationReceipts
  const surfaceFor = deps.surfaceFor
  const install = deps.install
  const uninstall = deps.uninstall
  const remember = deps.remember
  const mcpHost = deps.mcpHost
  const mcpWithheldReasons = deps.mcpWithheldReasons
  const credentialStore = deps.credentialStore
  const externalAccountings = deps.externalAccountings
  const lifecycleRecords = deps.lifecycleRecords
  const authoringReceipts = deps.authoringReceipts
  const recordLifecycleEvent = deps.recordLifecycleEvent
  const notifyCatalogChange = deps.notifyCatalogChange
  const updateSurface = deps.updateSurface
  const prepareAssetsSurface = deps.prepareAssetsSurface
  return defineTool({
  ...MODEL_TOOLS_SPEC,
  async execute(args, exec): Promise<never> {
    void exec
    const action = args.action
    const modelId = args.model as string | undefined
    const sub = args.sub
    const clientId = args.clientId
    const stagedVersion = args.version

    /** The user's remembered choice for one model. */
    const choiceOf = (id: string): 'none' | 'enabled' | 'disabled' =>
      persisted().enabled.includes(id) ? 'enabled' : persisted().disabled.includes(id) ? 'disabled' : 'none'

    /**
     * The provenance and readiness a discovery surface must expose (EXT-32).
     *
     * ALWAYS returns the full shape, including for a model with no contract
     * binding: the fields are declared required in the output schema, so a
     * partial object would be refused — and a caller reading `readiness` should
     * get an answer for every model rather than having to handle its absence.
     */
    const provenanceOf = async (
      entry: ModelCatalogEntry,
      callable: boolean,
      knownSurface?: CatalogGeneration,
    ) => {
      const surface = knownSurface ?? await surfaceFor(entry)
      const published = surface?.tools[0]
      const notice = surface?.readiness.find(item => item.modelId === entry.id)
      const withheld = surface === undefined
        ? undefined
        : surface.withheld.find(item => item.subject === published?.name) ?? surface.withheld[0]
      return {
        provenance: {
          contract: entry.contract,
          // Which PACKAGE implements this model, and which model inside it. Read
          // from the catalog binding, so it is reported even for a model that is
          // not the selected provider and therefore has no published tool.
          extension: entry.provider?.extension ?? null,
          modelId: entry.provider?.modelId ?? null,
          publishedTool: published?.name ?? null,
          // Copied into a mutable array: the surface's own list is readonly, and
          // a discovery result is a plain JSON value.
          alternatives: [...(published?.alternatives ?? [])],
        },
        readiness: notice?.readiness ?? 'unknown',
        // The registry is the authority on callable; readiness is a separate fact.
        // An extension-provided model has a callable tool but no catalog readiness
        // notice, and copying the notice's absent verdict reported callable:false
        // while the tool worked.
        callable,
        ...withheld === undefined ? {} : {
          withheld: { code: withheld.code, message: withheld.message },
        },
      }
    }

    /**
     * The current snapshot, with per-model installed and remembered state.
     *
     * `tool` reports the name actually REGISTERED, not the catalog's per-model
     * name: under a contract two implementations share one tool, and reporting
     * the catalog name would tell a caller to call something that does not exist.
     */
    /**
     * TASK-49: THE REGISTRY DECIDES "CALLABLE", not the catalog verdict.
     *
     * Read once per execute so one row cannot disagree with another about what is
     * registered at this instant.
     */
    const publishedToolNames = new Set(ctx.tools.schemas().map(schema => schema.name))
    const snapshot = async (items: readonly ResolvedModel[]) => Promise.all(items.map(async item => {
      const record = installed.get(item.entry.id)
      /**
       * ONE readiness derivation, shared with tool_mode_list: the two discovery
       * surfaces cannot disagree about whether this model tool is callable.
       */
      // The ACTUAL published name, not the catalog's model-specific alias: a
      // contract-bound extension publishes the contract tool (stt_transcribe),
      // while the catalog row is still named transcribe_audio. Using the alias
      // made a working tool report unavailable (U22).
      const publishedSurface = await surfaceFor(item.entry)
      const publishedName = publishedSurface?.tools[0]?.name
        ?? record?.toolName
        ?? item.entry.tool?.name
        ?? item.entry.id
      const surface = modelSurface(
        item.entry,
        item.verdict,
        record !== undefined,
        publishedToolNames.has(publishedName),
      )
      return {
        ...(describeModels([item])[0] as ModelDescriptor),
        state: surface.state,
        /** The package that implements it, or null when no extension does. */
        extension: item.entry.provider?.extension ?? null,
        /** The catalog's stable tool identity; `tool` is the NAME actually registered. */
        toolName: item.entry.tool.name,
        tool: publishedName,
        ...await provenanceOf(item.entry, surface.state === 'callable', publishedSurface),
        installed: record !== undefined,
        choice: choiceOf(item.entry.id),
      }
    }))
    /**
     * The most recent invocation receipts (EXT-35).
     *
     * Exposed through discovery so the provenance is observable rather than
     * merely recorded: a receipt nobody can read is indistinguishable from no
     * receipt at all.
     */
    const receipts = () => invocationReceipts.map(receiptView)

    const counts = () => ({
      installed: installed.size,
      runnable: resolved.filter(item => item.verdict.runnable).length,
      ...persist ? { stateFile: config.stateFile ?? defaultStateFile() } : {},
    })

    if (action === 'mcp') {
      return { models: [], ...counts(), mcp: mcpHost.listTools().map(tool => ({
        name: tool.name,
        // Presence of the OUTPUT schema is the MCP-09 fact worth exposing: DSH
        // model-facing projection omits it, so this is the evidence that the
        // export is built from the contract instead.
        hasOutputSchema: tool.outputSchema !== undefined,
        title: tool.title ?? null,
      })) } as never
    }

    if (action === 'diagnostics') {
      /**
       * THE OBS-04 SURFACE, WIRED RATHER THAN MERELY BUILT.
       *
       * `buildDiagnostics` is only worth having if something calls it, and this repository
       * has produced fully-tested components with zero callers three times already
       * (`ptc-authority.ts`, `ptc-runtime.ts`, and the recipes broker). Reporting through
       * the control tool the agent already has keeps the surface reachable without adding a
       * second way in.
       */
      const registered = ctx.tools.schemas().map(schema => schema.name).sort()
      const exported = mcpHost.listTools().map(tool => tool.name).sort()
      const exportedSet = new Set(exported)
      const withheldTools = registered.filter(name => !exportedSet.has(name))
      const withheldReasons = Object.fromEntries(withheldTools.map(name => [
        name,
        mcpWithheldReasons.get(name)
          ?? 'this host tool is not a Tool Mode contract, a TMX extension tool or an opted-in custom tool; '
          + 'explicit review is required before it can be exported to MCP',
      ]))
      return {
        models: [],
        ...counts(),
        diagnostics: buildDiagnostics({
          mcpMounted: true,
          /**
           * The endpoint is OMITTED rather than set to `undefined`, because the input type
           * is exact-optional. The host serves its own agent and the endpoint is a
           * deployment decision this plugin does not own, so it is reported as ABSENT —
           * which the surface distinguishes from "MCP is off".
           */
          exportedTools: exported,
          // The withheld half is the security-relevant half, and it is derivable: anything
          // registered that is NOT exported was withheld deliberately.
          withheldTools: registered.filter(name => !exportedSet.has(name)),
          withheldReasons,
          platform: {
            os: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
          },
        }),
        /**
         * THE CAPTURE PATH, on the surface an operator actually reads (OBS-03).
         *
         * Reported here rather than in a document because a reader asking "what is recorded"
         * must see the surfaces this plugin does NOT control — a sibling logging plugin and
         * the DSH LLM service — not only its own writes. A list of our own writes would be
         * taken as complete, which is the misreading OBS-03 exists to prevent.
         */
        capture: {
          profile: (config.captureProfile ?? 'standard') as string,
          surfaces: CAPTURE_PATH.map(surface => ({
            surface: surface.surface,
            writtenByThisPlugin: surface.writtenByThisPlugin,
            control: surface.control,
          })),
        },
      } as never
    }

    if (action === 'credentials') {
      /**
       * SEC-01 CREDENTIAL SURFACE, model-visible and therefore SECRET-FREE.
       *
       * `model_tools` is the operator's management surface. It was never
       * published over MCP, but it IS model-visible: a generated secret
       * returned here would land in the model's transcript. Generation is
       * therefore REFUSED on this surface with guidance to the human-only
       * CLI, which prints the secret exactly once to the operator's
       * terminal. The generation primitive itself lives in
       * credential-store.ts (`generateCredential`) for the CLI and tests.
       */
      if (credentialStore === undefined) {
        throw new Error(
          'credential generation requires persistence (SEC-01): this deployment runs with persistence disabled, '
          + 'and a credential a restart would forget must never be issued',
        )
      }
      if (sub === 'generate') {
        return {
          models: [],
          ...counts(),
          credentialNote:
            'Credential generation is refused on this model-visible surface (SEC-01): a generated secret must '
            + 'never enter a model transcript. Run the human-only CLI instead — `dsh-tool-mode-credentials '
            + 'generate --scheme static-token --client-id <id>` (or --scheme oauth-resource-server) — which '
            + 'prints the secret exactly once to the operator\'s terminal and persists it owner-only.',
        } as never
      }
      if (sub === 'list') {
        return {
          models: [],
          ...counts(),
          // SECRETS ARE NEVER RE-ECHOED: the list carries identity only.
          credentials: credentialStore.list().map(entry => ({
            clientId: entry.clientId,
            scheme: entry.scheme,
            createdAt: entry.createdAt,
          })),
        } as never
      }
      if (sub === 'revoke') {
        if (typeof clientId !== 'string' || clientId.length === 0) {
          throw new Error('credentials revoke requires a clientId')
        }
        const existed = credentialStore.get(clientId) !== undefined
        credentialStore.delete(clientId)
        return {
          models: [],
          ...counts(),
          changed: existed,
          action: `credentials revoke ${clientId}`,
          persisted: existed,
        } as never
      }
      throw new Error('credentials requires a sub: generate, list or revoke')
    }

    if (action === 'receipts') {
      return {
        models: [],
        ...counts(),
        receipts: receipts(),
        external: externalAccountings.map(accounting => ({
          receiptId: accounting.receiptId,
          failureClass: accounting.failureClass,
          reason: accounting.reason,
          totalMs: accounting.timings.totalMs,
          inputBytes: accounting.sizes.inputBytes,
          outputBytes: accounting.sizes.outputBytes,
          engineVersion: accounting.measuredOn.engineVersion,
          // SEC-04: the CLIENT's own identity, so the operator can tell who
          // called — identity only, never the payload.
          ...accounting.grantId === undefined ? {} : { grantId: accounting.grantId },
          ...accounting.clientId === undefined ? {} : { clientId: accounting.clientId },
        })),
        lifecycle: lifecycleRecords,
        authoring: authoringReceipts(),
      } as never
    }

    if (action === 'reset') {
      // Forgetting a choice is what makes the config authoritative again.
      if (modelId !== undefined) {
        if (!byId.has(modelId)) throw new Error(`unknown model "${modelId}"`)
        deps.setPersisted({
          enabled: persisted().enabled.filter(id => id !== modelId),
          disabled: persisted().disabled.filter(id => id !== modelId),
        })
      } else {
        deps.setPersisted({ enabled: [], disabled: [] })
      }
      if (persist) stateStore.write(persisted())
      // Re-apply the config's own selection, so a reset takes effect now
      // rather than only at the next start.
      for (const item of resolved) {
        if (configuredIds.includes(item.entry.id)) await install(item)
        else uninstall(item.entry.id)
      }
      const models = modelId === undefined ? resolved : [byId.get(modelId) as ResolvedModel]
      return {
        models: await snapshot(models),
        ...counts(),
        changed: true,
        action,
        persisted: persist,
      } as never
    }

    if (action === 'describe' || action === 'enable' || action === 'disable') {
      if (modelId === undefined) throw new Error(`${action} requires a "model" id`)
      const item = byId.get(modelId)
      if (item === undefined) throw new Error(`unknown model "${modelId}"`)
      if (action === 'describe') {
        return { models: await snapshot([item]), ...counts() } as never
      }
      const changed = action === 'enable' ? await install(item) : uninstall(modelId)
      if (action === 'enable' && !changed) {
        // Say why rather than reporting a silent no-op: the caller asked for
        // a tool and did not get one.
        throw new Error(
          `${item.entry.name} cannot be installed here. ${item.verdict.reason}`,
        )
      }
      // Only remember a choice that actually took effect: persisting a
      // failed enable would install it silently on the next start.
      const remembered = remember(modelId, action === 'enable')
      return {
        models: await snapshot([item]),
        ...counts(),
        changed,
        action,
        persisted: remembered,
      } as never
    }

    /**
     * LIC-03: the human permission-basis recording surface. The basis
     * (native use, external export, distribution, telemetry) is recorded
     * per provider with the approving principal, durably, in the isolated
     * state dir. It is a RECORD — the export eligibility itself stays on
     * the existing publication gate (the operator's exportTools
     * selection); the basis is what a reviewer reads before flipping it.
     */
    if ((action as string) === 'extensions-license-basis') {
      if (modelId === undefined) throw new Error('extensions-license-basis requires the provider id in "model"')
      const basis = args.licenseBasis as { native?: boolean; export?: boolean; distribution?: boolean; telemetry?: boolean } | undefined
      const principal = typeof args.principal === 'string' && args.principal.length > 0 ? args.principal : 'unattributed'
      if (basis === undefined) throw new Error('extensions-license-basis requires the "licenseBasis" fields')
      const record = recordLicenseBasis(
        dirname(resolve(config.stateFile ?? defaultStateFile())),
        modelId,
        basis,
        principal,
      )
      return {
        models: [],
        ...counts(),
        action,
        changed: true,
        licenseBasis: record,
        providerId: modelId,
      } as never
    }

    if (action === 'extensions-pending' || action === 'extensions-approve' || action === 'extensions-deny'
      || action === 'extensions-commit' || action === 'extensions-rollback') {
      /**
       * EXT-30 slice 3: the MANAGEMENT channel is the ONLY update path (AT-39)
       * — these actions live inside model_tools, never on the model-callable
       * MCP surface. The surface is wired when the extension store exists.
       */
      const surface = updateSurface()
      if (surface === undefined) {
        throw new Error('extension updates require the extension store (config.extensionStoreDir); it is not configured')
      }
      if (action === 'extensions-pending') {
        return {
          models: [],
          ...counts(),
          pending: surface.listPendingUpdates().map(entry => ({
            extensionId: entry.extensionId,
            stagedVersion: entry.stagedVersion,
            currentVersion: entry.currentVersion,
            stagedAt: entry.stagedAt,
            ...entry.report.licenseDelta === undefined ? {} : { licenseDelta: entry.report.licenseDelta },
            permissionDeltas: entry.report.permissionDeltas,
            requiresApproval: entry.report.requiresApproval,
            ...entry.approval === undefined ? {} : { approval: entry.approval },
          })),
        } as never
      }
      if (modelId === undefined) throw new Error(`${action} requires the extension id in "model"`)
      if (stagedVersion === undefined && action !== 'extensions-rollback') {
        throw new Error(`${action} requires a "version"`)
      }
      const version = stagedVersion as string // narrowed by the guard above for every action but rollback
      if (action === 'extensions-approve' || action === 'extensions-deny') {
        surface.decide(modelId, version, action === 'extensions-approve'
          ? { approved: true }
          : { approved: false, reason: 'denied through the management channel' })
        return {
          models: [],
          ...counts(),
          action,
          changed: true,
        } as never
      }
      let result
      try {
        result = action === 'extensions-commit'
          ? await surface.commit(modelId, version)
          : await surface.rollback(modelId)
        recordLifecycleEvent({
          operation: 'update', extensionId: modelId, version: result.activeVersion, outcome: 'succeeded',
        })
      } catch (error) {
        recordLifecycleEvent({
          operation: 'update',
          extensionId: modelId,
          version,
          outcome: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
      // P26-09/MCP-07: a committed pointer or a rollback both REPUBLISH the
      // extension surface through the lifecycle — the catalog changed, and
      // every subscriber is notified.
      notifyCatalogChange()
      // The lossless-JSON contract: undefined fields are omitted, never present.
      return {
        models: [],
        ...counts(),
        action,
        updateResult: {
          extensionId: result.extensionId,
          activeVersion: result.activeVersion,
          ...result.previousVersion === undefined ? {} : { previousVersion: result.previousVersion },
          ...'hookFailure' in result && result.hookFailure !== undefined ? { hookFailure: result.hookFailure } : {},
        },
      } as never
    }

    if (action === 'extensions-prepare-plan' || action === 'extensions-prepare' || action === 'extensions-purge-assets') {
      /**
       * RES-02: the preparation plan is DISCLOSED (bytes, storage, license,
       * executable gate) before the acquisition; the acquisition itself IS
       * the operator's consent, through the management channel only. A REAL
       * acquisition uses the ranged HTTP source (opt-in); the suite injects
       * a local source and never reaches the network.
       */
      const surface = prepareAssetsSurface()
      if (surface === undefined) {
        throw new Error('asset preparation requires the extension store (config.extensionStoreDir); it is not configured')
      }
      if (modelId === undefined) throw new Error(`${action} requires the extension id in "model"`)
      if (action === 'extensions-purge-assets') {
        const purged = await surface.purge(modelId)
        return {
          models: [],
          ...counts(),
          action,
          purged: purged.removed,
        } as never
      }
      if (action === 'extensions-prepare-plan') {
        const plan = surface.plan(modelId)
        return {
          models: [],
          ...counts(),
          action,
          plan: {
            extensionId: plan.identity.extensionId,
            modelId: plan.identity.modelId,
            modelRevision: plan.identity.modelRevision,
            assets: plan.assets.map(asset => ({
              assetId: asset.assetId,
              bytes: asset.bytes,
              source: asset.source,
              executable: asset.executable,
            })),
            totalBytes: plan.totalBytes,
            storageBytes: plan.storageBytes,
            requiresExecutableApproval: plan.requiresExecutableApproval,
            license: plan.license,
          },
        } as never
      }
      const outcome = await surface.prepare(modelId, {
        source: config.assetSourceFactory?.() ?? createHttpSource(),
        allowExecutable: args.allowExecutable === true,
        signal: exec?.signal ?? new AbortController().signal,
      })
      if (!outcome.ok) throw new Error(`the preparation failed: ${outcome.reason}`)
      return {
        models: [],
        ...counts(),
        action,
        prepared: true,
        groups: outcome.groups.map(group => ({ groupId: group.groupId, path: group.path, digests: group.digests })),
      } as never
    }

    const models = action === 'installed'
      ? await snapshot(resolved.filter(item => installed.has(item.entry.id)))
      : await snapshot(resolved)
    return { models, ...counts() } as never
  },
  presentCall(args) {
    return { card: 'generic', title: `Model tools: ${args.action}`, kind: 'read', rawInput: args.model ?? args.action }
  },
})
}
