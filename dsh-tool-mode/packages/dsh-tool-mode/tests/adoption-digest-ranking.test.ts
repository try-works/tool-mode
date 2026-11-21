/**
 * Phase 3: the directive-digest ranking is pure and deterministic.
 *
 * R14: EVIDENCE is the primary key (uses, then fewer failures); kept-over-draft and an
 * author verification clause break ties before scope or recency. Recency and caller scope
 * are late tie-breaks, never a reason to prefer a 0-use draft over a used artifact. A
 * low-quality artifact (`uses > 0 && failures >= uses / 2`) is never a candidate.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ADOPTION_SCOPE_PRIORITY,
  isLowQuality,
  rankAdoptionCandidates,
  type AdoptionDigestCandidate,
} from '../src/adoption-digest-ranking.ts'

const candidate = (overrides: Partial<AdoptionDigestCandidate> & { readonly name: string }): AdoptionDigestCandidate => ({
  callableName: 'workflow_' + overrides.name,
  description: 'Does ' + overrides.name + '.',
  scope: 'workspace',
  uses: 1,
  failures: 0,
  ...overrides,
})

describe('adoption digest ranking', () => {
  it('prefers caller (session) scope, then workspace, then global', () => {
    assert.deepEqual(ADOPTION_SCOPE_PRIORITY, { session: 3, workspace: 2, global: 1 })
    const ranked = rankAdoptionCandidates([
      candidate({ name: 'g', scope: 'global', lastUsedAt: '2026-06-01T00:00:00.000Z' }),
      candidate({ name: 'w', scope: 'workspace', lastUsedAt: '2026-06-01T00:00:00.000Z' }),
      candidate({ name: 's', scope: 'session', sessionId: 'caller-1', lastUsedAt: '2026-06-01T00:00:00.000Z' }),
    ])
    assert.deepEqual(ranked.map(row => row.name), ['s', 'w', 'g'])
  })

  it('within one scope, the most recent use wins', () => {
    const ranked = rankAdoptionCandidates([
      candidate({ name: 'old', lastUsedAt: '2026-01-01T00:00:00.000Z' }),
      candidate({ name: 'new', lastUsedAt: '2026-06-01T00:00:00.000Z' }),
      candidate({ name: 'never' }),
    ])
    assert.deepEqual(ranked.map(row => row.name), ['new', 'old', 'never'])
  })

  it('breaks every remaining tie deterministically by callable name', () => {
    const rows = [
      candidate({ name: 'beta', lastUsedAt: '2026-06-01T00:00:00.000Z' }),
      candidate({ name: 'alpha', lastUsedAt: '2026-06-01T00:00:00.000Z' }),
    ]
    assert.deepEqual(rankAdoptionCandidates(rows).map(row => row.name), ['alpha', 'beta'])
    assert.deepEqual(rankAdoptionCandidates([...rows].reverse()).map(row => row.name), ['alpha', 'beta'])
  })

  it('keeps one row per callable name, taking the narrowest scope', () => {
    const ranked = rankAdoptionCandidates([
      candidate({ name: 'dup', scope: 'workspace', callableName: 'workflow_dup', lastUsedAt: '2026-06-01T00:00:00.000Z' }),
      candidate({ name: 'dup', scope: 'session', sessionId: 'caller-1', callableName: 'workflow_dup', lastUsedAt: '2026-01-01T00:00:00.000Z' }),
    ])
    assert.equal(ranked.length, 1)
    assert.equal(ranked[0]?.scope, 'session')
  })

  it('R14: evidence outranks a fresh draft and caller scope', () => {
    const ranked = rankAdoptionCandidates([
      candidate({
        name: 'fresh_kept', scope: 'session', sessionId: 'caller-1', uses: 0,
        lastUsedAt: '2026-11-22T00:00:00.000Z',
      }),
      candidate({ name: 'proven', scope: 'workspace', uses: 100, failures: 0 }),
    ])
    assert.deepEqual(ranked.map(row => row.name), ['proven', 'fresh_kept'])
  })

  it('R14: a verification clause wins an equal-evidence tie', () => {
    const ranked = rankAdoptionCandidates([
      candidate({ name: 'plain', uses: 5, failures: 0 }),
      candidate({ name: 'clause', uses: 5, failures: 0, verification: 'check the totals against the grid' }),
    ])
    assert.deepEqual(ranked.map(row => row.name), ['clause', 'plain'])
  })

  it('R14: a kept artifact outranks an auto-kept draft at equal evidence', () => {
    const ranked = rankAdoptionCandidates([
      candidate({ name: 'draft', uses: 2, unverified: true }),
      candidate({ name: 'kept', uses: 2 }),
    ])
    assert.deepEqual(ranked.map(row => row.name), ['kept', 'draft'])
  })

  it('never ranks a low-quality artifact as a candidate', () => {
    assert.equal(isLowQuality(candidate({ name: 'bad', uses: 4, failures: 2 })), true)
    assert.equal(isLowQuality(candidate({ name: 'half', uses: 6, failures: 3 })), true)
    assert.equal(isLowQuality(candidate({ name: 'ok', uses: 6, failures: 2 })), false)
    assert.equal(isLowQuality(candidate({ name: 'unused', uses: 0, failures: 0 })), false)
    const ranked = rankAdoptionCandidates([
      candidate({ name: 'bad', uses: 6, failures: 3, lastUsedAt: '2026-06-02T00:00:00.000Z' }),
      candidate({ name: 'ok', uses: 2, failures: 0, lastUsedAt: '2026-06-01T00:00:00.000Z' }),
    ])
    assert.deepEqual(ranked.map(row => row.name), ['ok'])
  })
})
