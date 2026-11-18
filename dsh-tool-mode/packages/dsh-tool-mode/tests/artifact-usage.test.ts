/**
 * Durable artifact usage: the evidence a promotion gate can trust.
 *
 * Receipts remain the provenance record, but they are bounded and may be evicted.
 * This store counts uses per (name, digest), deduplicated by receipt id, so five
 * sessions are five uses even after hundreds of unrelated calls.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createArtifactUsageStore } from '../src/artifact-usage.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

describe('artifact usage store', () => {
  it('counts distinct uses and distinct sessions per digest', () => {
    const file = join(tempDir(), 'usage.json')
    const store = createArtifactUsageStore(file)
    for (const session of ['s1', 's2', 's3', 's4', 's5']) {
      store.record({ receiptId: 'r-' + session, name: 'flow', digest: 'd1', sessionId: session, outcome: 'ok' })
    }
    assert.deepEqual(store.evidence('flow', 'd1'), { uses: 5, sessions: 5, failures: 0 })
  })

  it('deduplicates the same receipt id', () => {
    const store = createArtifactUsageStore(join(tempDir(), 'usage.json'))
    const input = { receiptId: 'same', name: 'flow', digest: 'd1', sessionId: 's1', outcome: 'ok' as const }
    store.record(input)
    store.record(input)
    assert.deepEqual(store.evidence('flow', 'd1'), { uses: 1, sessions: 1, failures: 0 })
  })

  it('does not accrue old evidence to a new digest', () => {
    const store = createArtifactUsageStore(join(tempDir(), 'usage.json'))
    store.record({ receiptId: 'old', name: 'flow', digest: 'd1', sessionId: 's1', outcome: 'ok' })
    assert.deepEqual(store.evidence('flow', 'd2'), { uses: 0, sessions: 0, failures: 0 })
  })

  it('counts a failed run as a use and a failure, not a session', () => {
    const store = createArtifactUsageStore(join(tempDir(), 'usage.json'))
    store.record({ receiptId: 'ok', name: 'flow', digest: 'd1', sessionId: 's1', outcome: 'ok' })
    store.record({ receiptId: 'bad', name: 'flow', digest: 'd1', outcome: 'failed' })
    assert.deepEqual(store.evidence('flow', 'd1'), { uses: 2, sessions: 1, failures: 1 })
  })

  it('persists across a reload', () => {
    const file = join(tempDir(), 'usage.json')
    createArtifactUsageStore(file).record({ receiptId: 'one', name: 'flow', digest: 'd1', sessionId: 's1', outcome: 'ok' })
    const reopened = createArtifactUsageStore(file)
    assert.deepEqual(reopened.evidence('flow', 'd1'), { uses: 1, sessions: 1, failures: 0 })
    assert.ok(JSON.parse(readFileSync(file, 'utf8')))
  })

  it('bounds retained session ids without changing the total', () => {
    const store = createArtifactUsageStore(join(tempDir(), 'usage.json'), { maxSessions: 3 })
    for (let index = 0; index < 10; index += 1) {
      store.record({ receiptId: 'r' + index, name: 'flow', digest: 'd1', sessionId: 's' + index, outcome: 'ok' })
    }
    assert.equal(store.evidence('flow', 'd1').uses, 10)
    assert.equal(store.evidence('flow', 'd1').sessions, 10)
  })
})
