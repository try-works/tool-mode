/**
 * Phase 7: quality metadata states a failure mode, not a made-up success rate.
 *
 * Only evidence can produce a caveat: the durable usage store accepts a failure CLASS from a
 * failed receipt/authoring error code (code-shaped, bounded), never free prose. Fewer than
 * five uses renders no percentage; five uses render uses/failures and the known failure.
 */

import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { join } from 'node:path'

import { createArtifactUsageStore } from '../src/artifact-usage.ts'
import { buildDirectiveDigest } from '../src/library-digest.ts'
import type { AdoptionDigestCandidate } from '../src/adoption-digest-ranking.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const candidate = (overrides: Partial<AdoptionDigestCandidate> & { readonly name: string }): AdoptionDigestCandidate => ({
  callableName: 'workflow_' + overrides.name,
  description: 'Purpose of ' + overrides.name + '.',
  scope: 'workspace',
  uses: 1,
  failures: 0,
  ...overrides,
})

describe('quality metadata', () => {
  it('renders no percentage and no invented caveat below five uses', () => {
    const text = buildDirectiveDigest([candidate({ name: 'young', uses: 3, failures: 0 })])
    assert.doesNotMatch(text, /%/)
    assert.doesNotMatch(text, /Known failure/i)
  })

  it('shows no known failure and no percentage at one or four uses; both appear at five', () => {
    for (const uses of [1, 4]) {
      const text = buildDirectiveDigest([candidate({ name: 'young', uses, failures: 1, knownFailure: 'AUTHORING_SAVE_REFUSED' })])
      assert.doesNotMatch(text, /Known failure/i)
      assert.doesNotMatch(text, /%/)
      assert.doesNotMatch(text, /Evidence:/)
    }
    const five = buildDirectiveDigest([candidate({ name: 'grown', uses: 5, failures: 1, knownFailure: 'AUTHORING_SAVE_REFUSED' })])
    assert.match(five, /^Known failure: AUTHORING_SAVE_REFUSED\.$/m)
    assert.match(five, /5 uses/)
    assert.match(five, /20% failed/)
  })

  it('renders uses/failures and the bounded known failure at five uses with one failure', () => {
    const store = createArtifactUsageStore(join(tempDir(), 'usage.json'))
    for (let index = 0; index < 4; index += 1) {
      store.record({ receiptId: 'ok-' + String(index), name: 'flow', digest: 'd1', sessionId: 's' + String(index), outcome: 'ok' })
    }
    store.record({ receiptId: 'bad-1', name: 'flow', digest: 'd1', outcome: 'failed', failureClass: 'EXECUTOR_NOT_CONFIGURED' })
    const evidence = store.evidence('flow', 'd1')
    assert.deepEqual(evidence, { uses: 5, sessions: 4, failures: 1 })
    const quality = store.quality('flow', 'd1')
    assert.equal(quality.knownFailure, 'EXECUTOR_NOT_CONFIGURED')

    const base = candidate({
      name: 'flow', uses: evidence.uses, failures: evidence.failures, sessions: evidence.sessions,
    })
    const row = quality.knownFailure === undefined ? base : { ...base, knownFailure: quality.knownFailure }
    const text = buildDirectiveDigest([row])
    assert.match(text, /5 uses/)
    assert.match(text, /1 failure\b/)
    assert.match(text, /^Known failure: EXECUTOR_NOT_CONFIGURED\.$/m)
    assert.match(text, /20% failed/)
  })

  it('shows a class that is present and never invents an absent one', () => {
    const store = createArtifactUsageStore(join(tempDir(), 'usage.json'))
    store.record({ receiptId: 'a', name: 'bad', digest: 'd1', outcome: 'failed', failureClass: 'TOOL_BINDING_REFUSED' })
    store.record({ receiptId: 'b', name: 'clean', digest: 'd2', outcome: 'failed' })
    assert.equal(store.quality('bad', 'd1').knownFailure, 'TOOL_BINDING_REFUSED')
    assert.equal(store.quality('clean', 'd2').knownFailure, undefined)
    assert.deepEqual(store.quality('clean', 'd2').failureClasses, [])
  })

  it('rejects free prose as a failure class and keeps only bounded code-shaped values', () => {
    const store = createArtifactUsageStore(join(tempDir(), 'usage.json'))
    store.record({
      receiptId: 'prose', name: 'flow', digest: 'd1', outcome: 'failed',
      failureClass: 'the model produced an invalid workflow because it was confused',
    })
    assert.equal(store.quality('flow', 'd1').knownFailure, undefined)
    store.record({ receiptId: 'code', name: 'flow', digest: 'd1', outcome: 'failed', failureClass: 'AUTHORING_SAVE_REFUSED' })
    assert.equal(store.quality('flow', 'd1').knownFailure, 'AUTHORING_SAVE_REFUSED')
    assert.ok(store.quality('flow', 'd1').failureClasses.every(value => value.length <= 64))
  })

  it('keeps a low-quality artifact out of the directive candidate', () => {
    const text = buildDirectiveDigest([
      candidate({ name: 'broken', uses: 6, failures: 3, lastUsedAt: '2026-06-03T00:00:00.000Z' }),
      candidate({ name: 'steady', uses: 2, failures: 0, lastUsedAt: '2026-06-01T00:00:00.000Z' }),
    ])
    assert.match(text, /^Use workflow_steady\b/m)
    assert.doesNotMatch(text, /workflow_broken/)
  })

  it('scopes the metadata: another caller session never contributes a caveat', () => {
    const rows: AdoptionDigestCandidate[] = [
      candidate({ name: 'mine', scope: 'session', sessionId: 'caller-1', callableName: 'workflow_mine', uses: 6, failures: 1, knownFailure: 'TOOL_BINDING_REFUSED', lastUsedAt: '2026-06-02T00:00:00.000Z' }),
      candidate({ name: 'theirs', scope: 'session', sessionId: 'caller-2', callableName: 'workflow_theirs', uses: 6, failures: 5, knownFailure: 'EXECUTOR_NOT_CONFIGURED', lastUsedAt: '2026-06-04T00:00:00.000Z' }),
    ]
    const text = buildDirectiveDigest(rows, { sessionId: 'caller-1' })
    assert.match(text, /workflow_mine/)
    assert.doesNotMatch(text, /workflow_theirs|EXECUTOR_NOT_CONFIGURED/)
  })

  it('persists the bounded failure classes across a reload', () => {
    const file = join(tempDir(), 'usage.json')
    createArtifactUsageStore(file).record({ receiptId: 'r1', name: 'flow', digest: 'd1', outcome: 'failed', failureClass: 'AUTHORING_SAVE_REFUSED' })
    const reopened = createArtifactUsageStore(file)
    assert.deepEqual(reopened.quality('flow', 'd1').failureClasses, ['AUTHORING_SAVE_REFUSED'])
    assert.equal(reopened.quality('flow', 'd1').knownFailure, 'AUTHORING_SAVE_REFUSED')
  })
})
