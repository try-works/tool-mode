/**
 * Artifact promotion policy (task-62).
 *
 * Promotion evidence is derived from receipts (name + optional digest), and the policy is
 * pure: no I/O, no clock, no registry. These tests pin the two boundaries that matter — a
 * promotion may only move UP (session < workspace < global), and a global promotion is a
 * human decision that force cannot bypass.
 *
 * @module tests/artifact-promotion
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  canPromote,
  evaluatePromotion,
  evidenceFromReceipts,
  scopeRank,
  type ArtifactScope,
  type PromotionDecision,
  type PromotionReceipt,
  type PromotionRequest,
} from '../src/artifact-promotion.ts'

/** Assert a refusal and narrow it for the field assertions below. */
function expectRefusal(decision: PromotionDecision) {
  assert.equal(decision.ok, false)
  if (decision.ok) throw new Error('expected a refusal')
  return decision
}

describe('scope order', () => {
  it('ranks session below workspace below global', () => {
    assert.deepEqual(scopeRank, { session: 0, workspace: 1, global: 2 })
  })

  it('allows only strictly upward promotions', () => {
    assert.equal(canPromote('session', 'workspace').ok, true)
    assert.equal(canPromote('session', 'global').ok, true)
    assert.equal(canPromote('workspace', 'global').ok, true)

    const invalid: readonly (readonly [ArtifactScope, ArtifactScope])[] = [
      ['session', 'session'],
      ['workspace', 'workspace'],
      ['global', 'global'],
      ['workspace', 'session'],
      ['global', 'workspace'],
    ]
    for (const [from, to] of invalid) {
      const check = canPromote(from, to)
      assert.equal(check.ok, false, `${from} -> ${to} must be refused`)
      if (!check.ok) {
        assert.equal(check.code, 'E_SCOPE_UNKNOWN')
        assert.match(check.message, /upward/)
      }
    }
  })

  it('refuses a scope the union does not know', () => {
    // SAFETY: the runtime guard is the behavior under test; the union must not admit this
    // string at compile time, and the function must refuse it anyway.
    const unknown = 'gallery' as ArtifactScope
    const check = canPromote(unknown, 'global')
    assert.equal(check.ok, false)
    if (!check.ok) {
      assert.equal(check.code, 'E_SCOPE_UNKNOWN')
      assert.match(check.message, /unknown artifact scope/)
    }
  })
})

describe('approval policy', () => {
  it('requires artifactScopes.globalPromotion to be human for a global promotion', () => {
    const refused = expectRefusal(evaluatePromotion({
      from: 'workspace',
      to: 'global',
      globalPromotion: 'off',
      evidence: { uses: 2, sessions: 2, failures: 0 },
    }))
    assert.equal(refused.code, 'E_APPROVAL_REQUIRED')
    assert.match(refused.message, /artifactScopes\.globalPromotion/)
  })

  it('requires a human approval for a global promotion', () => {
    const base: PromotionRequest = {
      from: 'workspace',
      to: 'global',
      globalPromotion: 'human',
      evidence: { uses: 2, sessions: 2, failures: 0 },
    }
    for (const approval of [undefined, 'none'] as const) {
      const refused = approval === undefined
        ? expectRefusal(evaluatePromotion(base))
        : expectRefusal(evaluatePromotion({ ...base, approval }))
      assert.equal(refused.code, 'E_APPROVAL_REQUIRED')
      assert.match(refused.message, /artifactScopes\.globalPromotion/)
    }
  })

  it('allows a global promotion only with both human decisions and enough evidence', () => {
    const decision = evaluatePromotion({
      from: 'workspace',
      to: 'global',
      globalPromotion: 'human',
      approval: 'human',
      evidence: { uses: 2, sessions: 2, failures: 0 },
    })
    assert.equal(decision.ok, true)
    if (decision.ok) {
      assert.equal(decision.to, 'global')
      assert.equal(decision.forced, false)
    }
  })
})

describe('force', () => {
  it('rejects force for a global promotion even with approvals', () => {
    const refused = expectRefusal(evaluatePromotion({
      from: 'workspace',
      to: 'global',
      force: true,
      globalPromotion: 'human',
      approval: 'human',
      evidence: { uses: 2, sessions: 2, failures: 0 },
    }))
    assert.equal(refused.code, 'E_FORCE_TO_GLOBAL')
    assert.match(refused.message, /force/)
  })

  it('lets force bypass evidence for a workspace promotion', () => {
    const forced = evaluatePromotion({ from: 'session', to: 'workspace', force: true, globalPromotion: 'off' })
    assert.equal(forced.ok, true)
    if (forced.ok) {
      assert.equal(forced.forced, true)
      assert.deepEqual(forced.evidence, { uses: 0, sessions: 0, failures: 0 })
    }

    const forcedWithFailures = evaluatePromotion({
      from: 'session',
      to: 'workspace',
      force: true,
      globalPromotion: 'off',
      evidence: { uses: 0, sessions: 0, failures: 3 },
    })
    assert.equal(forcedWithFailures.ok, true)
  })

  it('does not let force turn an invalid move into a promotion', () => {
    const refused = expectRefusal(evaluatePromotion({
      from: 'workspace',
      to: 'workspace',
      force: true,
      globalPromotion: 'off',
    }))
    assert.equal(refused.code, 'E_SCOPE_UNKNOWN')
  })
})

describe('evidence requirement', () => {
  it('requires the use floor and zero failures when not forced', () => {
    const tooFewUses = expectRefusal(evaluatePromotion({
      from: 'session',
      to: 'workspace',
      globalPromotion: 'off',
      evidence: { uses: 1, sessions: 1, failures: 0 },
    }))
    assert.equal(tooFewUses.code, 'EVIDENCE_INSUFFICIENT')
    assert.deepEqual(tooFewUses.observed, { uses: 1, sessions: 1, failures: 0 })
    assert.deepEqual(tooFewUses.required, { minUses: 2, maxFailures: 0 })

    const failedUses = expectRefusal(evaluatePromotion({
      from: 'session',
      to: 'workspace',
      globalPromotion: 'off',
      evidence: { uses: 4, sessions: 3, failures: 1 },
    }))
    assert.equal(failedUses.code, 'EVIDENCE_INSUFFICIENT')
    assert.deepEqual(failedUses.observed, { uses: 4, sessions: 3, failures: 1 })
  })

  it('honours a caller-supplied minUses', () => {
    const strict = expectRefusal(evaluatePromotion({
      from: 'session',
      to: 'workspace',
      globalPromotion: 'off',
      minUses: 3,
      evidence: { uses: 2, sessions: 2, failures: 0 },
    }))
    assert.equal(strict.code, 'EVIDENCE_INSUFFICIENT')
    assert.deepEqual(strict.required, { minUses: 3, maxFailures: 0 })

    const oneUse = evaluatePromotion({
      from: 'session',
      to: 'workspace',
      globalPromotion: 'off',
      minUses: 1,
      evidence: { uses: 1, sessions: 1, failures: 0 },
    })
    assert.equal(oneUse.ok, true)
  })

  it('treats absent evidence as zero uses', () => {
    const refused = expectRefusal(evaluatePromotion({ from: 'session', to: 'workspace', globalPromotion: 'off' }))
    assert.equal(refused.code, 'EVIDENCE_INSUFFICIENT')
    assert.deepEqual(refused.observed, { uses: 0, sessions: 0, failures: 0 })
  })

  it('allows a promotion that meets the floor with no failures', () => {
    const decision = evaluatePromotion({
      from: 'session',
      to: 'workspace',
      globalPromotion: 'off',
      evidence: { uses: 2, sessions: 2, failures: 0 },
    })
    assert.equal(decision.ok, true)
  })
})

describe('evidence from receipts', () => {
  const artifact = { name: 'review.md', digest: 'sha256:aaa' }
  const receipts: readonly PromotionReceipt[] = [
    { artifactName: 'review.md', artifactDigest: 'sha256:aaa', rootSessionId: 's1', outcome: 'ok' },
    { artifactName: 'review.md', artifactDigest: null, rootSessionId: 's1', outcome: 'ok' },
    { artifactName: 'review.md', artifactDigest: 'sha256:bbb', rootSessionId: 's2', outcome: 'ok' },
    { artifactName: 'other.md', artifactDigest: 'sha256:aaa', rootSessionId: 's3', outcome: 'ok' },
    { artifactName: 'review.md', artifactDigest: 'sha256:aaa', rootSessionId: 's2', outcome: 'failed' },
    { artifactName: 'review.md', artifactDigest: 'sha256:aaa', rootSessionId: null, outcome: null },
    { artifactName: 'review.md', artifactDigest: 'sha256:aaa', rootSessionId: '', outcome: 'ok' },
  ]

  it('counts only receipts for the artifact name and a matching or absent digest', () => {
    // Rows 1, 2, 5, 6, 7 match; row 3 is another digest and row 4 another artifact.
    assert.deepEqual(evidenceFromReceipts(receipts, artifact), { uses: 5, sessions: 2, failures: 2 })
  })

  it('matches on name alone when no digest is supplied', () => {
    // Every review.md row, including the other digest.
    assert.deepEqual(evidenceFromReceipts(receipts, { name: 'review.md' }), { uses: 6, sessions: 2, failures: 2 })
  })

  it('counts distinct, present root sessions only', () => {
    // s1 twice collapses to one; null and the empty string are not sessions, but their uses
    // and failures still count (the documented limitation).
    const onlySessions = evidenceFromReceipts([
      { artifactName: 'x', rootSessionId: 's1', outcome: 'ok' },
      { artifactName: 'x', rootSessionId: 's1', outcome: 'ok' },
      { artifactName: 'x', rootSessionId: null, outcome: 'ok' },
      { artifactName: 'x', rootSessionId: '', outcome: 'ok' },
    ], { name: 'x' })
    assert.deepEqual(onlySessions, { uses: 4, sessions: 1, failures: 0 })
  })

  it('counts every non-ok outcome as a failure', () => {
    const outcomes = evidenceFromReceipts([
      { artifactName: 'x', outcome: 'ok' },
      { artifactName: 'x', outcome: 'failed' },
      { artifactName: 'x', outcome: null },
      { artifactName: 'x' },
    ], { name: 'x' })
    assert.deepEqual(outcomes, { uses: 4, sessions: 0, failures: 3 })
  })

  it('returns zeroes when nothing matches', () => {
    assert.deepEqual(evidenceFromReceipts(receipts, { name: 'missing.md', digest: 'sha256:aaa' }), {
      uses: 0,
      sessions: 0,
      failures: 0,
    })
  })
})
