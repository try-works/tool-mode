/**
 * Extension restore: integrity, prepared-asset handles, readiness inspection and
 * activation, then first-party auto-provisioning.
 *
 * The ordering is the contract and lives here in one readable chain. The
 * composition root injects the store, lifecycle, asset surface and service.
 *
 * @module extension-lifecycle
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-shape-in-symbol-names, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this is the extension-store boundary: manifests are read from verified records and cast into the SDK contracts after discovery. */

import { appendFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  discoverExtension,
  ExtensionLifecycle,
  type ExtensionStore,
  type ModelReadiness,
} from '@try-works/tool-mode-extension-sdk'
import {
  FIRST_PARTY_EXTENSIONS,
  planProvisioning,
  runProvisioning,
  type ProvisioningExtensionState,
  type ProvisioningRequirementKind,
} from './first-party-provisioning.ts'
import type { ExtensionsDescribeResult } from './extensions-api.ts'
import { recordRestoreIntegrityFailure, selectInstalled } from './extensions-service.ts'
import type { PrepareAssetsSurface } from './prepared-assets.ts'
import type { ProviderBridge } from './provider-bridge.ts'
import type { ResolvedModel } from './capability.ts'

/** The restore-relevant deployment configuration. */
export interface ExtensionRestoreConfig {
  readonly disabledExtensions?: readonly string[] | undefined
  readonly autoProvisionExtensions?: boolean | undefined
  readonly extensionSourceDir?: string | undefined
}

/** The service calls restore/auto-provision need. */
export interface ExtensionRestoreService {
  describeFast(signal?: AbortSignal): Promise<ExtensionsDescribeResult>
  install(extensionId: string): Promise<unknown>
  prepare(extensionId: string): Promise<unknown>
  enable(extensionId: string): Promise<unknown>
}

/** Everything the restore chain needs from the composition root. */
export interface ExtensionRestoreDeps {
  readonly ctx: Context
  readonly store: ExtensionStore
  readonly config: ExtensionRestoreConfig
  readonly extensionStoreDir: string
  readonly extensionLifecycle: () => ExtensionLifecycle | undefined
  readonly prepareAssetsSurface: () => PrepareAssetsSurface | undefined
  readonly assetRestoreFailures: Map<string, string>
  readonly activationGenerations: Map<string, number>
  readonly extensionsService: ExtensionRestoreService
  readonly bridge: ProviderBridge
  readonly resolved: readonly ResolvedModel[]
}

/**
 * Restore every approved extension and then auto-provision first-party ones.
 * @param deps - store, lifecycle, asset surface and service.
 * @returns when the chain has settled.
 */
export async function restoreExtensions(deps: ExtensionRestoreDeps): Promise<void> {
  const ctx = deps.ctx
  const store = deps.store
  const config = deps.config
  const extensionStoreDir = deps.extensionStoreDir
  const extensionLifecycle = deps.extensionLifecycle
  const prepareAssetsSurface = deps.prepareAssetsSurface
  const assetRestoreFailures = deps.assetRestoreFailures
  const activationGenerations = deps.activationGenerations
  const extensionsService = deps.extensionsService
  const bridge = deps.bridge
  const resolved = deps.resolved
  const installedRecords = store.listInstalled().value
const recordInspectedReadiness = async (
  lifecycle: ExtensionLifecycle,
  extensionId: string,
): Promise<void> => {
  /**
   * DECLARATIVE PACKAGES HAVE NO PROVIDER TO INSPECT.
   *
   * A code-free package declares a model-runtime recipe; the host's declarative
   * lane serves it, and its readiness is the prepared-assets fact
   * (`prepared-cold` after prepare, `needs-preparation` before). The provider
   * bridge inspects a package's `./tool-mode` module, which a code-free package
   * does not have, so inspecting it marks every deployment `failed` and then
   * activation refuses with "the model deployment X is in a failed state" —
   * even though the assets are prepared and the recipe would run. Skip the
   * inspection for exactly that execution kind and leave the recorded readiness
   * to the asset surface.
   */
  /**
   * A RESTART MUST NOT RE-INSPECT WHAT THE LAST RUN ALREADY VERIFIED.
   *
   * Inspection imports the extension and creates its provider, which is the
   * expensive part of a cold start. If every declared deployment already has a
   * callable persisted readiness AND the asset restore above succeeded, the
   * previous process's inspection is still sound; re-running it serializes the
   * boot on work that cannot change the answer. A failed or missing readiness
   * still inspects (the honest re-check), and a manifest change adds a declared
   * id that has no callable value, which also forces inspection.
   */
  const persistedReadiness = lifecycle.states()
    .find(candidate => candidate.extensionId === extensionId)?.readiness ?? {}
  const callableReadiness = new Set<ModelReadiness>([
    'prepared-cold', 'loading', 'ready', 'busy',
  ])
  const declaredForInspection = (() => {
    const record = installedRecords.find(candidate => candidate.extensionId === extensionId)
    if (record === undefined) return [] as string[]
    try {
      return discoverExtension(record.installPath).manifest.models.map(model => model.id)
    } catch {
      return [] as string[]
    }
  })()
  if (declaredForInspection.length > 0
    && declaredForInspection.every(modelId => callableReadiness.has(persistedReadiness[modelId] as ModelReadiness))) {
    ctx.logger.info(
      `model-tools: ${extensionId} readiness is already callable (prepared-cold or better); `
      + 'provider inspection is deferred to the first explicit check',
    )
    return
  }
  const installedForInspection = installedRecords.find(
    candidate => candidate.extensionId === extensionId,
  )
  if (installedForInspection !== undefined) {
    try {
      const kind = discoverExtension(installedForInspection.installPath).manifest.execution.kind
      if (kind === 'declarative') {
        ctx.logger.info(
          `model-tools: ${extensionId} is declared for the declarative lane; provider inspection is skipped `
          + 'and its readiness stays the prepared-assets verdict',
        )
        return
      }
    } catch {
      // An unreadable manifest is not silently assumed declarative: fall through
      // to inspection, whose failure is the honest answer.
    }
  }
  /**
   * Every inspection is TIME-BOUNDED: the restore chain is sequential, and one
   * extension whose inspect() hangs would stall activation for every later
   * extension indefinitely. The timeout turns a hang into a recorded `failed`
   * deployment, which is honest and lets the rest of the chain proceed.
   */
  const inspectionSignal = () => AbortSignal.timeout(15_000)
  const inspected: Record<string, ModelReadiness> = {}
  const entries = resolved.filter(item => item.entry.provider?.extension === extensionId)
  for (const item of entries) {
    // Key by the MANIFEST model id, not the catalog entry id: the durable state is
    // keyed by what the manifest declares, and an alias row whose entry id differs
    // from its provider.modelId would otherwise be silently dropped.
    const modelId = item.entry.provider?.modelId ?? item.entry.id
    try {
      const inspection = await bridge.inspect(item.entry, inspectionSignal())
      if (inspection?.readiness !== undefined) inspected[modelId] = inspection.readiness
    } catch (error) {
      // A FAILED inspection is a failed deployment, not "keep the old answer": a
      // previously-recorded prepared-cold surviving an inspection error would
      // publish a tool whose prerequisites just went missing, and the first call
      // would fail. This matches the catalog-path readinessOf, which maps a thrown
      // or absent inspection to 'failed'. In managed mode the inspection ran in
      // the WORKER process, so this catch covers the worker's fault too.
      ctx.logger.warn(
        `model-tools: readiness inspection failed for ${item.entry.name}: `
        + `${error instanceof Error ? error.message : String(error)}`,
      )
      if (process.env.DSH_DEBUG_INSPECT === '1') console.error('INSPECT-FAIL', item.entry.id, error)
      inspected[modelId] = 'failed'
    }
  }

  /**
   * Extensions WITHOUT catalog rows (EmbeddingGemma, Needle) declare models the
   * catalog never binds. Inspect them through their own manifest: the store record
   * gives the install path, discovery reads the declared model ids, and the
   * extension-level inspection route activates the public entry like dispatch does.
   */
  const record = installedRecords.find(candidate => candidate.extensionId === extensionId)
  if (record !== undefined) {
    let declaredIds: readonly string[] = []
    try {
      declaredIds = discoverExtension(record.installPath).manifest.models.map(model => model.id)
    } catch (error) {
      ctx.logger.warn(
        `model-tools: could not read ${extensionId} manifest for inspection: `
        + `${error instanceof Error ? error.message : String(error)}`,
      )
    }
    for (const modelId of declaredIds) {
      // Only a value the CATALOG path recorded wins; a catalog-path `failed` (a
      // stale or wrong catalog binding) must not suppress the manifest-path
      // inspection, which inspects the verified store copy this extension actually is.
      if (inspected[modelId] !== undefined) continue
      try {
        // Inspect the STORE COPY, not whatever the package name resolves to in
        // node_modules: the restore loop just verified these bytes, and running the
        // unverified dependency copy instead would invert the integrity gate.
        // The VERIFIED asset map rides along (when this deployment has one) so a
        // provider whose inspect cannot see it reports the truth instead of
        // needs-preparation on a prepared machine (Needle).
        const inspection = await bridge.inspectExtension(
          record.installPath,
          modelId,
          inspectionSignal(),
          prepareAssetsSurface()?.assetMapFor(extensionId),
        )
        if (inspection?.readiness !== undefined) inspected[modelId] = inspection.readiness
      } catch (error) {
        ctx.logger.warn(
          `model-tools: readiness inspection failed for ${extensionId} model ${modelId}: `
          + `${error instanceof Error ? error.message : String(error)}`,
        )
        if (process.env.DSH_DEBUG_INSPECT === '1') console.error('INSPECT-FAIL-EXT', extensionId, error)
        inspected[modelId] = 'failed'
      }
    }
  }
  if (Object.keys(inspected).length > 0) await lifecycle.recordReadiness(extensionId, inspected)
}

/**
 * Extensions the operator switched OFF in Settings.
 *
 * Checked at the restore decision because this loop is the host's only
 * activation surface: filtering after activation would let the extension
 * register its tools and then be denied, which is the two-sources-of-truth
 * mistake the publication path already forbids.
 */
const disabledExtensions = new Set(config.disabledExtensions ?? [])
/**
 * THE VERSION THE OPERATOR MEANS, not the first one recorded.
 *
 * `installedRecords.find(...)` returns the OLDEST record for an identity, so a
 * restart used to activate a superseded version while `describe()` reported the
 * newest — the host served stale code and no report disagreed. The service's own
 * selection (EXT-30 pointer, else the last appended record) is the single answer.
 */
const restorePointers = store.readProfilePointers('default')
const restoreActiveVersions = restorePointers.corrupt ? {} : restorePointers.value.activeVersions
const toRestore = store.readProfileState('default').value
  .filter(entry => entry.desiredActivation === 'active' && !disabledExtensions.has(entry.extensionId))
  .map(entry => ({
    extensionId: entry.extensionId,
    version: selectInstalled(installedRecords, restoreActiveVersions, entry.extensionId)?.version,
  }))
  .filter((entry): entry is { extensionId: string; version: string } => entry.version !== undefined)

/**
 * `apply` is SYNCHRONOUS, so restoration runs as a settled chain rather than blocking
 * plugin load. That is also the right behaviour: a host must not stall on each
 * extension's activation, and RUN-06 says one broken extension must not prevent the
 * rest from working — so every failure is logged and the chain continues.
 */
const lifecycleForRestore = extensionLifecycle()
void (async () => {
  for (const entry of toRestore) {
    try {
      /**
       * INTEGRITY BEFORE ANY EXTENSION CODE RUNS. Inspection imports the extension
       * module and runs its `create()`, so it must come AFTER the same byte-integrity
       * gate activation applies — otherwise a tampered installed package executes
       * first and is only refused afterwards.
       */
      const record = installedRecords.find(candidate =>
        candidate.extensionId === entry.extensionId && candidate.version === entry.version)
      if (record !== undefined) {
        /**
         * ASYNC, CACHED DIGEST: this is the boot path. The synchronous
         * `verifyUnchanged` hashes the whole installed tree on the event loop; with
         * 16 extensions and multi-GB dependency trees that held the loader open for
         * minutes before the auth URL appeared. The async form uses the SDK's
         * worker-pool digest and reuses a fingerprint-matching verification, so the
         * restore chain yields instead of blocking the host's first paint.
         */
        const integrity = await store.verifyUnchangedAsync(record)
        if (!integrity.unchanged) {
          const reason = integrity.diagnostic ?? 'the installed content changed'
          /**
           * A SKIPPED RESTORE IS NOT "ACTIVE". The previous state row could still
           * say active from an earlier boot, and the catalogue would then keep the
           * extension's tool names reserved while no tool is published — a ghost
           * capability. Record the failure and withdraw the tool list first.
           */
          recordRestoreIntegrityFailure(store, entry.extensionId)
          ctx.logger.warn(                `model-tools: not restoring ${entry.extensionId}: [INTEGRITY_MISMATCH] ${reason}`,
          )
          continue
        }
      }
      /**
       * RESTORE THE PREPARED-ASSET HANDLES **BEFORE** INSPECTION.
       *
       * Store readiness (`prepared-cold`) is persisted, but the map the dispatch
       * hands to an extension lives in THIS process and only `prepare()` fills it.
       * Inspection (`inspect()`) is what decides the readiness recorded below, and a
       * model-backed extension reports `needs-preparation` (or `failed`) when its
       * asset handles are absent. Rebuilding them from the cache directories is a
       * stat walk, so it belongs at the START of the restore chain; doing it after
       * inspection made every restart record a stale `needs-preparation` and required
       * a manual prepare before the tools could publish.
       *
       * A failure is recorded (and logged) rather than thrown: the extension still
       * verifies its own bytes on load, and one broken extension must not stop the
       * others (RUN-06).
       */
      try {
        const restored = prepareAssetsSurface()?.restore(entry.extensionId)
        if (restored !== undefined && restored.ok === false) {
          // Remember WHY: the row must name a missing/resized cache file rather than
          // the generic "needs its model assets prepared".
          assetRestoreFailures.set(entry.extensionId, restored.reason)
          // A failed restore means the cache no longer matches the persisted
          // prepared-cold state (typically because assetCacheRoot moved). Do not
          // keep advertising prepared-cold: downgrade to needs-preparation so the
          // page offers Prepare instead of repeating a restore error forever.
          if (lifecycleForRestore !== undefined) {
            try {
              const plan = prepareAssetsSurface()?.plan(entry.extensionId)
              if (plan !== undefined) {
                await lifecycleForRestore.recordReadiness(entry.extensionId, {
                  [plan.identity.modelId]: 'needs-preparation',
                })
              }
            } catch { /* a missing plan is reported by the restore reason already */ }
          }
          ctx.logger.info(`model-tools: ${entry.extensionId} assets not restored: ${restored.reason}`)
        } else {
          assetRestoreFailures.delete(entry.extensionId)
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        assetRestoreFailures.set(entry.extensionId, reason)
        ctx.logger.warn(
          `model-tools: could not restore ${entry.extensionId}'s prepared assets: ${reason}`,
        )
      }
      /**
       * RECORD what inspection knows BEFORE activation publishes. The lifecycle
       * defaults every declared deployment to `needs-preparation`, so without this
       * a model-backed package can never publish a callable tool. Inspection is the
       * read-only EXT-18 surface — it may import the extension but loads no assets —
       * so this stays inside RUN-05's "read declarations, prepare nothing" boundary.
       * It runs AFTER the asset-handle restore above, so it observes the real map.
       */
      if (lifecycleForRestore === undefined) {
        throw new Error('the extension lifecycle is not mounted, so activation cannot proceed')
      }
      await recordInspectedReadiness(lifecycleForRestore, entry.extensionId)
      const activated = await lifecycleForRestore.activate(entry.extensionId, entry.version)
      // EXT-20: the activation generation is captured here so the managed-worker
      // registry can bind a process to exactly this activation and dispose it when
      // a later one is observed.
      activationGenerations.set(entry.extensionId, activated.generation)
    } catch (error) {
      ctx.logger.warn(
        `model-tools: could not restore ${entry.extensionId}: `
        + `${error instanceof Error ? error.message : String(error)}`,
      )
      /**
       * The logger is not always visible to the operator (and was silent in the
       * isolated profile), so a restore failure also lands beside the store. This
       * is a diagnostic record only: it does not change activation.
       */
      if (extensionStoreDir.length > 0) {
        try {
          appendFileSync(
            join(extensionStoreDir, 'restore-failures.log'),
            `${new Date().toISOString()} ${entry.extensionId}@${entry.version}: `
            + `${error instanceof Error ? error.message : String(error)}\n`,
          )
        } catch {
          // The store may be read-only; the logged failure above remains.
        }
      }
    }
  }

  /**
   * AUTO-PROVISION FIRST-PARTY EXTENSIONS (default on).
   *
   * Runs AFTER the restore chain, inside the same settled async task, so it never
   * races an activation. Only extensions that are already installed OR present in
   * the configured source directory are attempted, so a production host without a
   * source directory never reaches for the registry from the load path. The
   * planner and executor handle ordering, disabled/approval refusals, re-describe
   * skips and per-extension error isolation; this block only supplies the host
   * operations and maps the described rows onto the planner's shape.
   */
  if (extensionStoreDir.length > 0 && config.autoProvisionExtensions === true) {
    try {
      const disabledExtensions = new Set(config.disabledExtensions ?? [])
      const describeProvisioning = async (): Promise<readonly ProvisioningExtensionState[]> => {
        const described = await extensionsService.describeFast()
        return described.extensions.map(row => ({
          id: row.id,
          installed: row.installed,
          active: row.active,
          disabled: disabledExtensions.has(row.id),
          requirements: (row.requirements ?? []).map(requirement => ({
            /**
             * The host's requirement kind is an open string projected from the
             * service; the planner's union names the kinds it can act on and only
             * ever prepares assets/executable. Carrying an unknown kind as
             * "satisfied" keeps it from inventing a preparation step for a
             * prerequisite this host cannot clear.
             */
            kind: requirement.kind as ProvisioningRequirementKind,
            satisfied: requirement.satisfied,
          })),
          reason: row.reason,
        }))
      }
      const firstPartyInstalled = new Set(
        (await describeProvisioning()).filter(row => row.installed).map(row => row.id),
      )
      const sourceDir = (config.extensionSourceDir ?? '').trim()
      const firstPartyInSource = new Set<string>()
      if (sourceDir.length > 0) {
        try {
          const root = resolve(sourceDir)
          for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            const directory = join(root, entry.name)
            try {
              if (!statSync(join(directory, 'tool-mode.extension.json')).isFile()) continue
              const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: unknown }
              if (typeof manifest.name === 'string') firstPartyInSource.add(manifest.name)
            } catch {
              // An unreadable package is not installable from this source directory.
            }
          }
        } catch {
          // An unreadable source directory means no source-provisioned installs.
        }
      }
      const shipped = FIRST_PARTY_EXTENSIONS.filter(
        id => firstPartyInSource.has(id) || firstPartyInstalled.has(id),
      )
      const plan = planProvisioning({
        extensions: await describeProvisioning(),
        shipped,
        autoProvision: true,
      })
      if (plan.length > 0) {
        const summary = await runProvisioning({
          plan,
          install: async id => { await extensionsService.install(id) },
          prepare: async id => { await extensionsService.prepare(id) },
          enable: async id => { await extensionsService.enable(id) },
          describe: describeProvisioning,
          log: message => ctx.logger.info(`model-tools: ${message}`),
        })
        ctx.logger.info(
          `model-tools: auto-provisioning planned=${String(plan.length)} installed=${String(summary.installed)} `
          + `prepared=${String(summary.prepared)} enabled=${String(summary.enabled)} `
          + `skipped=${String(summary.skipped)} failed=${String(summary.failed.length)}`,
        )
        for (const failure of summary.failed) {
          ctx.logger.warn(
            `model-tools: auto-provisioning ${failure.id} ${failure.phase} failed: ${failure.reason}`,
          )
        }
      }
    } catch (error) {
      ctx.logger.warn(
        `model-tools: auto-provisioning could not run: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
})()
}
