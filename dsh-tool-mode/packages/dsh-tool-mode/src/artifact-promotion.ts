/**
 * Artifact promotion policy (task-62).
 *
 * An artifact can be promoted from its origin scope toward wider reuse:
 * session → workspace → global. The policy is PURE: it derives evidence from receipt-shaped
 * records and decides, with no I/O, no clock and no registry access. Two boundaries are
 * deliberately strict:
 *
 * - a promotion may only move UP, so a same-scope or downward request is refused;
 * - a global promotion is a human decision. The config policy
 *   (`artifactScopes.globalPromotion`) and the caller's `approval` must BOTH be `human`,
 *   and `force` is never a shortcut to global.
 *
 * `force` exists only for a workspace promotion: it is the explicit operator override for
 * evidence that receipts cannot supply, and it bypasses the use/failure floor. It cannot
 * bypass the scope rule or global approval.
 *
 * @module artifact-promotion
 */

/** The three reuse scopes, ordered from narrowest to widest. */
export type ArtifactScope = 'session' | 'workspace' | 'global'

/** Monotonic scope order: every promotion must strictly increase this rank. */
export const scopeRank: Readonly<{ session: number; workspace: number; global: number }> =
  Object.freeze({ session: 0, workspace: 1, global: 2 })

/** What receipts observed for one artifact. */
export interface PromotionEvidence {
  /** Total matching receipts. */
  readonly uses: number
  /**
   * Distinct non-empty `rootSessionId` values among the matching receipts. This is a LOWER
   * BOUND: a receipt without a root session still counts as a use (and a failure), it just
   * cannot contribute a session.
   */
  readonly sessions: number
  /** Matching receipts whose outcome is anything other than `'ok'` (absent/null included). */
  readonly failures: number
}

/** The artifact identity evidence is matched against. */
export interface PromotionArtifact {
  /** Exact artifact name the receipt must name. */
  readonly name: string
  /** When present, a receipt's digest must be absent or equal; a different digest excludes it. */
  readonly digest?: string
}

/**
 * The receipt facts this policy reads.
 *
 * This is a structural subset of an invocation receipt: only the provenance needed for
 * promotion evidence, so the policy does not depend on the receipt store or its version.
 */
export interface PromotionReceipt {
  readonly artifactName?: string | null | undefined
  readonly artifactDigest?: string | null | undefined
  readonly rootSessionId?: string | null | undefined
  readonly outcome?: string | null | undefined
}

/** Default use floor when the caller does not override `minUses`. */
export const DEFAULT_MIN_USES = 2

/** The refusal vocabulary. */
export type PromotionErrorCode =
  | 'E_SCOPE_UNKNOWN'
  | 'E_APPROVAL_REQUIRED'
  | 'E_FORCE_TO_GLOBAL'
  | 'EVIDENCE_INSUFFICIENT'

/** A refused promotion, with the counts that justify an evidence refusal. */
export interface PromotionRefusal {
  readonly ok: false
  readonly code: PromotionErrorCode
  readonly message: string
  /** Present on EVIDENCE_INSUFFICIENT: what the receipts showed. */
  readonly observed?: PromotionEvidence
  /** Present on EVIDENCE_INSUFFICIENT: the floor that was not met. */
  readonly required?: { readonly minUses: number; readonly maxFailures: number }
}

/** An allowed promotion. */
export interface PromotionAllowed {
  readonly ok: true
  readonly from: ArtifactScope
  readonly to: ArtifactScope
  /** True when a workspace `force` bypassed the evidence floor. */
  readonly forced: boolean
  /** The evidence that was considered (zeroes when forced without evidence). */
  readonly evidence: PromotionEvidence
}

/** The promotion decision. */
export type PromotionDecision = PromotionAllowed | PromotionRefusal

/** The scope-order check alone. */
export type PromotionScopeCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'E_SCOPE_UNKNOWN'; readonly message: string }

/** Everything the policy needs to decide one promotion. */
export interface PromotionRequest {
  readonly from: ArtifactScope
  readonly to: ArtifactScope
  /** Observed evidence; absent means a zero-use artifact. */
  readonly evidence?: PromotionEvidence
  /** Workspace-only override of the evidence floor; never valid for global. */
  readonly force?: boolean
  /** The configured global-promotion policy (`artifactScopes.globalPromotion`). */
  readonly globalPromotion: 'human' | 'off'
  /** The approval recorded for this request; `human` is required for global. */
  readonly approval?: 'human' | 'none'
  /** Optional use floor; defaults to {@link DEFAULT_MIN_USES}. */
  readonly minUses?: number
}

const ZERO_EVIDENCE: PromotionEvidence = Object.freeze({ uses: 0, sessions: 0, failures: 0 })

/** The rank of a scope string, or undefined when it is not a scope this policy knows. */
function rankOf(scope: string): number | undefined {
  if (scope === 'session') return scopeRank.session
  if (scope === 'workspace') return scopeRank.workspace
  if (scope === 'global') return scopeRank.global
  return undefined
}

/**
 * Whether a promotion may move from `from` to `to`.
 *
 * Only a strictly upward move is a promotion. Same-scope and downward requests are refused
 * as invalid (E_SCOPE_UNKNOWN), and so is any value outside the three scopes.
 * @param from - the artifact's current scope.
 * @param to - the requested scope.
 * @returns the check outcome.
 */
export function canPromote(from: ArtifactScope, to: ArtifactScope): PromotionScopeCheck {
  const fromRank = rankOf(from)
  const toRank = rankOf(to)
  if (fromRank === undefined || toRank === undefined) {
    const unknown = fromRank === undefined ? from : to
    return { ok: false, code: 'E_SCOPE_UNKNOWN', message: `unknown artifact scope "${unknown}"` }
  }
  if (toRank <= fromRank) {
    return {
      ok: false,
      code: 'E_SCOPE_UNKNOWN',
      message: `cannot promote from "${from}" to "${to}": promotions must move upward (session -> workspace -> global)`,
    }
  }
  return { ok: true }
}

/**
 * Decide one promotion.
 *
 * Order matters and is part of the contract:
 * 1. scope order (E_SCOPE_UNKNOWN for unknown, same or downward);
 * 2. `force` to global is refused outright (E_FORCE_TO_GLOBAL);
 * 3. global requires BOTH `globalPromotion === 'human'` and `approval === 'human'`
 *    (E_APPROVAL_REQUIRED, naming `artifactScopes.globalPromotion`);
 * 4. unless a workspace promotion is forced, `uses >= minUses` and `failures === 0`
 *    (EVIDENCE_INSUFFICIENT with observed and required counts).
 * @param request - the promotion request and its evidence.
 * @returns the decision.
 */
export function evaluatePromotion(request: PromotionRequest): PromotionDecision {
  const scope = canPromote(request.from, request.to)
  if (!scope.ok) return scope

  const evidence = request.evidence ?? ZERO_EVIDENCE
  const forced = request.force === true
  const requestedMinUses = request.minUses
  const minUses = requestedMinUses !== undefined && Number.isInteger(requestedMinUses) && requestedMinUses >= 0
    ? requestedMinUses
    : DEFAULT_MIN_USES

  if (request.to === 'global' && forced) {
    return {
      ok: false,
      code: 'E_FORCE_TO_GLOBAL',
      message: 'force is only allowed for a workspace promotion; a global promotion requires '
        + 'artifactScopes.globalPromotion to be "human" and a human approval, never force',
    }
  }

  if (request.to === 'global') {
    const policy = request.globalPromotion === 'human' ? 'human' : 'off'
    const approval = request.approval === 'human' ? 'human' : 'none'
    if (policy !== 'human' || approval !== 'human') {
      return {
        ok: false,
        code: 'E_APPROVAL_REQUIRED',
        message: 'promotion to global requires a human decision: artifactScopes.globalPromotion is '
          + `"${policy}" and approval is "${approval}". Set artifactScopes.globalPromotion to "human" `
          + 'and pass approval: "human".',
      }
    }
  }

  if (!forced && (evidence.uses < minUses || evidence.failures !== 0)) {
    return {
      ok: false,
      code: 'EVIDENCE_INSUFFICIENT',
      message: `promotion to ${request.to} requires at least ${minUses} uses with 0 failures; `
        + `observed ${evidence.uses} uses and ${evidence.failures} failures (${evidence.sessions} sessions).`,
      observed: evidence,
      required: { minUses, maxFailures: 0 },
    }
  }

  return { ok: true, from: request.from, to: request.to, forced, evidence }
}

/**
 * Derive promotion evidence from receipt-shaped records.
 *
 * Matching rules:
 * - the receipt must name the artifact exactly (`artifactName === artifact.name`);
 * - when the artifact carries a `digest`, a receipt is counted when its digest is absent
 *   (null/undefined) or equal. A DIFFERENT digest excludes it. When the artifact has no
 *   digest, every name match counts.
 *
 * `uses` counts every matching receipt. `failures` counts those whose `outcome` is not
 * `'ok'`; an absent/null outcome is treated as a failure because promotion must not assume
 * success from missing provenance. `sessions` counts distinct non-empty `rootSessionId`
 * values — its documented limitation is that receipts without one still count as uses but
 * contribute no session, so it is a lower bound, not a count of every user session.
 * @param receipts - the receipt-shaped records to scan.
 * @param artifact - the artifact identity to match.
 * @returns the observed evidence.
 */
export function evidenceFromReceipts(
  receipts: readonly PromotionReceipt[],
  artifact: PromotionArtifact,
): PromotionEvidence {
  const sessions = new Set<string>()
  let uses = 0
  let failures = 0

  for (const receipt of receipts) {
    if (receipt.artifactName !== artifact.name) continue
    const receiptDigest = receipt.artifactDigest
    if (artifact.digest !== undefined
      && receiptDigest !== null
      && receiptDigest !== undefined
      && receiptDigest !== artifact.digest) {
      continue
    }
    uses += 1
    if (receipt.outcome !== 'ok') failures += 1
    const session = receipt.rootSessionId
    if (session !== null && session !== undefined && session.length > 0) sessions.add(session)
  }

  return { uses, sessions: sessions.size, failures }
}
