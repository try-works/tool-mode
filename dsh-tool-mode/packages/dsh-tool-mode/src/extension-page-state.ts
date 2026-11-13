/**
 * The Extensions-page row state derivation (RC3).
 *
 * ONE source of truth for how a describe() row renders. The host payload is
 * unchanged: `{ installed, active, blocked, reason, requirements[] }` — the
 * contradiction the RC3 audit found was purely a RENDERING one: the client
 * drew the lifecycle's `active: true` as a plain "active" badge and an ON
 * toggle even when the same row's `blocked` flag and an unmet requirement
 * said activation is refused.
 *
 * THE RULE (one sentence): a row that the host reports `blocked` — or that
 * carries any unmet requirement which blocks this row — is never rendered as
 * plainly "active"/ON; it renders the blocked badge and an OFF visual toggle
 * whose enabled/disabled state and title are unchanged.
 *
 * This module is dependency-free and pure so the SAME classification is
 * testable in Node and documented as the contract the client bundle
 * implements (the bundle inlines the identical rule; the test pins this
 * module, and the client's rule is kept verbatim-adjacent).
 *
 * @module @try-works/dsh-tool-mode/extension-page-state
 */

/** One requirement as the describe() payload carries it. */
export interface PageRequirement {
  readonly kind: string
  readonly satisfied: boolean
  readonly reason: string
}

/** The fields of the describe() row this derivation reads. */
export interface ExtensionPageRow {
  readonly installed: boolean
  readonly active: boolean
  readonly blocked: boolean
  readonly reason: string | null
  readonly requirements: readonly PageRequirement[]
}

/**
 * The requirement kinds that block a NOT-installed row.
 *
 * Mirrors the host service's classification (extensions-service.ts
 * `blocksRow`): store/source, dependencies, platform, harness-model and
 * runtime stop the INSTALL or make the eventual activation impossible.
 * Readiness/executable/integrity/activation/assets describe installed bytes
 * and are post-install facts, never pre-install blockers.
 */
const NOT_INSTALLED_BLOCKING_KINDS: ReadonlySet<string> = new Set([
  'store',
  'source',
  'dependencies',
  'platform',
  'harness-model',
  'runtime',
])

/**
 * Whether one UNMET requirement blocks THIS row.
 * @param installed - whether the store holds an installed copy.
 * @param requirement - the requirement to classify.
 */
export function requirementBlocksRow(installed: boolean, requirement: PageRequirement): boolean {
  if (requirement.satisfied) return false
  if (installed) return true
  return NOT_INSTALLED_BLOCKING_KINDS.has(requirement.kind)
}

/** The badge a row renders: the lifecycle fact, qualified by the block. */
export type PageBadge = 'not-installed' | 'active' | 'active-blocked' | 'inactive'

/** The derived rendering state for one describe() row. */
export interface ExtensionPageState {
  /** The badge text class: 'active' ONLY when active and not blocked. */
  readonly badge: PageBadge
  /** The visual toggle: ON only when active and not blocked (blocked rows render OFF). */
  readonly toggleOn: boolean
  /**
   * The lifecycle fact behind the badge/toggle, preserved so the aria state
   * and the action title can still say what the store observes.
   */
  readonly active: boolean
  /** The host's blocked flag, verbatim. */
  readonly blocked: boolean
  /** The unmet requirements that block this row (in host order). */
  readonly blockingReasons: readonly string[]
  /** The unmet requirements that are post-install notes for this row. */
  readonly noteReasons: readonly string[]
}

/**
 * Derive the page state for one describe() row.
 * @param row - the describe() payload.
 * @returns the badge/toggle/note derivation.
 */
export function extensionPageState(row: ExtensionPageRow): ExtensionPageState {
  const blocking: string[] = []
  const notes: string[] = []
  for (const requirement of row.requirements) {
    if (requirement.satisfied) continue
    ;(requirementBlocksRow(row.installed, requirement) ? blocking : notes).push(requirement.reason)
  }
  const blocked = row.blocked || blocking.length > 0
  const badge: PageBadge = !row.installed
    ? 'not-installed'
    : row.active && blocked
      ? 'active-blocked'
      : row.active
        ? 'active'
        : 'inactive'
  return {
    badge,
    toggleOn: row.active && !blocked,
    active: row.active,
    blocked,
    blockingReasons: blocking,
    noteReasons: notes,
  }
}
