/**
 * First-party extension auto-provisioning (task-33).
 *
 * A fresh host should not require the operator to press Install/Prepare/Enable once per
 * first-party extension. This module supplies two THINGS and stays deliberately free of host
 * imports so the Lead can wire it into `apply` without a cycle:
 *
 * 1. {@link planProvisioning} — a PURE planner: given the described state of the extensions,
 *    the shipped ids and the config switch, it returns the ordered actions per id.
 * 2. {@link runProvisioning} — a SEQUENTIAL executor around host-supplied operations. It
 *    re-describes after install and after prepare (so a phase that became unnecessary is
 *    skipped), catches every error, logs it, and continues. It returns a truthful summary
 *    instead of throwing, because this runs in the background during plugin load.
 *
 * CONFIG CONTRACT (wired by the host later):
 * - `autoProvisionExtensions` (boolean, DEFAULT true) enables this module. When false, the
 *   planner returns no actions and the executor does nothing.
 * - `disabledExtensions` ALWAYS wins: a disabled extension is skipped even when not installed.
 * - Operator APPROVALS still win: this module never bypasses a refusal. If install/prepare
 *   requires approval and the host refuses, the operation throws and the executor records the
 *   failure and moves on; it never retries and never upgrades itself past the gate.
 * - Installation is not activation: only the explicit `enable` action activates an extension.
 *
 * NON-BLOCKING: the planner is synchronous and side-effect free; the executor is async and is
 * meant to be started by the host without awaiting it on the plugin-load path. Nothing in this
 * module schedules timers, reads files or opens sockets.
 *
 * @module @try-works/dsh-tool-mode/first-party-provisioning
 */

/** The action a plan orders for one extension. */
export type ProvisioningAction = 'install' | 'prepare' | 'enable'

/** The phase a failure is attributed to. `describe` means the fresh state was unreadable. */
export type ProvisioningPhase = ProvisioningAction | 'describe'

/**
 * The requirement kinds the host can report. Only `assets` and `executable` are cleared by a
 * preparation; the others are handled by install/enable or are not auto-provisionable.
 */
export type ProvisioningRequirementKind =
  | 'store'
  | 'source'
  | 'dependencies'
  | 'runtime'
  | 'assets'
  | 'executable'
  | 'harness-model'
  | 'platform'
  | 'integrity'
  | 'activation'

/** One prerequisite, as much of it as the planner needs. */
export interface ProvisioningRequirement {
  readonly kind: ProvisioningRequirementKind
  readonly satisfied: boolean
}

/** One described extension (the host's ExtensionState, narrowed to planner fields). */
export interface ProvisioningExtensionState {
  readonly id: string
  readonly installed: boolean
  readonly active: boolean
  readonly disabled: boolean
  readonly requirements: readonly ProvisioningRequirement[]
  readonly reason?: string | null
}

/** Everything the pure planner consumes. */
export interface ProvisioningInput {
  /** One row per extension the host knows about; a shipped id with no row is fresh. */
  readonly extensions: readonly ProvisioningExtensionState[]
  /** The first-party ids this build ships (normally {@link FIRST_PARTY_EXTENSIONS}). */
  readonly shipped: readonly string[]
  /** `config.autoProvisionExtensions` (default true). */
  readonly autoProvision: boolean
}

/** One id and the actions to run, in order. */
export interface ProvisioningPlanEntry {
  readonly id: string
  readonly actions: readonly ProvisioningAction[]
}

/**
 * The host operations the executor needs; every one may reject.
 *
 * Each operation returns `Promise<void>`: the executor deliberately ignores management
 * results (an install result's `active: false` is not activation) and decides what to do next
 * only from a FRESH `describe()`. Host wrappers stay one line: `async (id) => { await
 * service.install(id) }`.
 */
export interface ProvisioningDeps {
  readonly plan: readonly ProvisioningPlanEntry[]
  readonly install: (id: string) => Promise<void>
  readonly prepare: (id: string) => Promise<void>
  readonly enable: (id: string) => Promise<void>
  /** Re-read the described state (the skip decisions must never be made on stale rows). */
  readonly describe: () => Promise<readonly ProvisioningExtensionState[]>
  /** Bounded log sink; messages name the id and phase. */
  readonly log: (message: string) => void
}

/**
 * The shipped ids eligible for provisioning on this host.
 *
 * Only an ALREADY INSTALLED package or one physically present in the configured
 * source directory is eligible: a host without a source directory must never reach
 * for the registry from the plugin-load path. The caller supplies the two observed
 * sets.
 * @param shipped - the build's first-party ids.
 * @param sourceIds - ids present in the configured source directory.
 * @param installedIds - ids the store reports installed.
 * @returns the eligible ids, in shipped order.
 */
export function provisioningShippedIds(
  shipped: readonly string[],
  sourceIds: readonly string[],
  installedIds: readonly string[],
): readonly string[] {
  const available = new Set([...sourceIds, ...installedIds])
  return shipped.filter(id => available.has(id))
}

/** One failed step. */
export interface ProvisioningFailure {
  readonly id: string
  readonly phase: ProvisioningPhase
  readonly reason: string
}

/** The truthful outcome of one background provisioning pass. */
export interface ProvisioningSummary {
  readonly installed: number
  readonly prepared: number
  readonly enabled: number
  readonly skipped: number
  readonly failed: readonly ProvisioningFailure[]
}

/**
 * The first-party extension package ids this build ships. A coverage test scans
 * every `packages/extension-<name>/tool-mode.extension.json`, so adding a package without adding it here
 * fails the suite.
 */
export const FIRST_PARTY_EXTENSIONS: readonly string[] = Object.freeze([
  '@try-works/extension-clear-recipe',
  '@try-works/extension-declarative-recipes',
  '@try-works/extension-desert-ant-tongue',
  '@try-works/extension-desert-ant-voz',
  '@try-works/extension-ear-recipe',
  '@try-works/extension-embeddinggemma',
  '@try-works/extension-emo-recipe',
  '@try-works/extension-laya',
  '@try-works/extension-minilm-embed',
  '@try-works/extension-minilm-rerank',
  '@try-works/extension-mirage',
  '@try-works/extension-moderator-recipe',
  '@try-works/extension-needle',
  '@try-works/extension-redact',
  '@try-works/extension-shapes-recipe',
  '@try-works/extension-uhm-recipe',
])

/** Whether a preparation is still required: an unmet asset or executable requirement. */
const needsPreparation = (requirements: readonly ProvisioningRequirement[]): boolean =>
  requirements.some((requirement) => !requirement.satisfied && (requirement.kind === 'assets' || requirement.kind === 'executable'))

/**
 * Plan the ordered auto-provisioning actions (pure).
 *
 * Per shipped, non-disabled, inactive id: `install` when not installed; `prepare` when the
 * row is installed (or will be installed) and an assets/executable requirement is unmet;
 * `enable` when installed, inactive and not disabled. Disabled ids are skipped entirely,
 * active ids need nothing, and the result is sorted by id with at most one action per kind.
 * @param input - described state, shipped ids and the config switch.
 * @returns entries for ids that need work, in execution order (empty when autoProvision false).
 */
export function planProvisioning(input: ProvisioningInput): readonly ProvisioningPlanEntry[] {
  if (!input.autoProvision) return []
  const described = new Map(input.extensions.map((extension) => [extension.id, extension]))
  const shipped = [...new Set(input.shipped)].sort()
  const entries: ProvisioningPlanEntry[] = []
  for (const id of shipped) {
    const extension = described.get(id)
    const installed = extension?.installed ?? false
    const active = extension?.active ?? false
    const disabled = extension?.disabled ?? false
    if (disabled || active) continue
    const actions: ProvisioningAction[] = []
    if (!installed) actions.push('install')
    if (needsPreparation(extension?.requirements ?? [])) actions.push('prepare')
    if (!active) actions.push('enable')
    if (actions.length > 0) entries.push({ id, actions })
  }
  return entries
}

/** Render an unknown thrown value as a bounded reason. */
const reasonOf = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message.length > 0 ? cause.message : cause.name
  return String(cause)
}

/**
 * Execute a provisioning plan sequentially, re-describing between phases.
 *
 * Every operation is awaited in isolation: an error is logged and recorded under its phase,
 * and the run continues with the remaining actions and ids. No step is retried. A step is
 * skipped when the FRESH row already satisfies it (installed, no preparation gap, active, or
 * disabled); disabled always wins. After a describe failure the remaining actions for that id
 * are abandoned (a skip decision cannot be made on unreadable state) but the next id runs.
 * @param deps - the plan and host operations; all may reject.
 * @returns counts plus every failure, never a throw.
 */
export async function runProvisioning(deps: ProvisioningDeps): Promise<ProvisioningSummary> {
  let installed = 0
  let prepared = 0
  let enabled = 0
  let skipped = 0
  const failed: ProvisioningFailure[] = []

  const describe = async (): Promise<{
    readonly rows?: readonly ProvisioningExtensionState[]
    readonly error?: string
  }> => {
    try {
      return { rows: await deps.describe() }
    } catch (cause) {
      const reason = reasonOf(cause)
      deps.log('describe failed: ' + reason)
      return { error: reason }
    }
  }

  const initial = await describe()
  let rows: readonly ProvisioningExtensionState[] = initial.rows ?? []

  for (const entry of deps.plan) {
    let row = rows.find((candidate) => candidate.id === entry.id)
    for (const action of entry.actions) {
      if (row?.disabled === true) {
        skipped += 1
        deps.log(entry.id + ' ' + action + ': skipped, the extension is disabled')
        continue
      }
      const satisfied =
        action === 'install'
          ? row?.installed === true
          : action === 'prepare'
            ? row !== undefined && !needsPreparation(row.requirements)
            : row !== undefined && (row.active || row.disabled)
      if (satisfied) {
        skipped += 1
        deps.log(entry.id + ' ' + action + ': skipped, already satisfied')
        continue
      }
      try {
        await deps[action](entry.id)
        if (action === 'install') installed += 1
        else if (action === 'prepare') prepared += 1
        else enabled += 1
        deps.log(entry.id + ' ' + action + ': ok')
      } catch (cause) {
        const reason = reasonOf(cause)
        failed.push({ id: entry.id, phase: action, reason })
        deps.log(entry.id + ' ' + action + ': failed: ' + reason)
      }
      const refreshed = await describe()
      if (refreshed.rows === undefined) {
        failed.push({ id: entry.id, phase: 'describe', reason: refreshed.error ?? 'the state could not be re-read' })
        break
      }
      rows = refreshed.rows
      row = rows.find((candidate) => candidate.id === entry.id)
    }
  }

  return { installed, prepared, enabled, skipped, failed }
}
