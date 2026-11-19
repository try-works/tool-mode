/**
 * Phase 3: pure ranking for the directive digest.
 *
 * The digest may name only ONE artifact imperatively, so preference must be explainable and
 * stable. Priority is CALLER (the session scope) over workspace over global; within a scope
 * the most recent use wins; every remaining tie is broken by callable name. A low-quality
 * artifact (`uses > 0 && failures >= uses / 2`) is removed entirely: the digest must not
 * tell an agent to reuse something that fails half the time.
 *
 * This module performs no I/O and keeps no state, so the host can recompute the order on
 * every prompt assembly.
 *
 * @module adoption-digest-ranking
 */

import type { ArtifactScope } from './artifact-promotion.ts'

/** The scopes a digest candidate can come from (caller scope = the session scope). */
export type AdoptionScope = ArtifactScope

/** One caller-visible artifact, with the evidence the digest may mention. */
export interface AdoptionDigestCandidate {
  /** The stored name (for example `lang_counts`). */
  readonly name: string
  /** The callable name (for example `workflow_lang_counts`). */
  readonly callableName: string
  /** What the artifact is for; rendered as the directive purpose. */
  readonly description: string
  readonly scope: AdoptionScope
  readonly uses: number
  readonly failures: number
  /** Distinct sessions, when the caller has that evidence. */
  readonly sessions?: number
  /** ISO timestamp of the most recent use, when known. */
  readonly lastUsedAt?: string
  /**
   * Evidence-backed failure class (a failed receipt/authoring error code), never model prose.
   * The digest may render it as `Known failure: ...`.
   */
  readonly knownFailure?: string
  /** The caller session, required to make a session-scope row visible. */
  readonly sessionId?: string
  /** True for an auto-kept row that has not been verified by a human. */
  readonly unverified?: boolean
}

/** Higher wins. Session is the caller's own scope. */
export const ADOPTION_SCOPE_PRIORITY: Readonly<Record<AdoptionScope, number>> = Object.freeze({
  session: 3,
  workspace: 2,
  global: 1,
})

/**
 * Whether an artifact has enough contrary evidence to be excluded.
 * An unused artifact (uses 0) is not low-quality; it simply has no evidence yet.
 * @param candidate - the artifact evidence.
 * @returns true when failures have reached half of the uses.
 */
export function isLowQuality(candidate: AdoptionDigestCandidate): boolean {
  return candidate.uses > 0 && candidate.failures >= candidate.uses / 2
}

/** Parse a last-used timestamp to milliseconds; missing/invalid is oldest. */
function lastUsedMs(candidate: AdoptionDigestCandidate): number {
  if (candidate.lastUsedAt === undefined) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(candidate.lastUsedAt)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

/** One deterministic comparison, narrowest first. */
function compareCandidates(left: AdoptionDigestCandidate, right: AdoptionDigestCandidate): number {
  const byScope = ADOPTION_SCOPE_PRIORITY[right.scope] - ADOPTION_SCOPE_PRIORITY[left.scope]
  if (byScope !== 0) return byScope
  const byRecent = lastUsedMs(right) - lastUsedMs(left)
  if (byRecent !== 0) return byRecent
  const byName = left.callableName.localeCompare(right.callableName)
  if (byName !== 0) return byName
  return left.name.localeCompare(right.name)
}

/**
 * Rank digest candidates and drop the ones the digest must never recommend.
 *
 * Rows with no callable name and low-quality rows are removed. One row per callable name is
 * kept (the best-ranked spelling, normally the narrowest scope). The result is deterministic
 * for the same evidence and the input array is never mutated.
 * @param candidates - caller-visible artifacts.
 * @returns the ordered candidates; empty when nothing is eligible.
 */
export function rankAdoptionCandidates(candidates: readonly AdoptionDigestCandidate[]): readonly AdoptionDigestCandidate[] {
  const eligible = candidates.filter(candidate => candidate.callableName.length > 0 && !isLowQuality(candidate))
  const sorted = [...eligible].sort(compareCandidates)
  const seen = new Set<string>()
  const ranked: AdoptionDigestCandidate[] = []
  for (const candidate of sorted) {
    if (seen.has(candidate.callableName)) continue
    seen.add(candidate.callableName)
    ranked.push(candidate)
  }
  return ranked
}
