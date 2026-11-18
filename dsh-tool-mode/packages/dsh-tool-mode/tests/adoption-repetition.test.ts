import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createRepetitionTracker } from '../src/adoption-candidates.ts'

function record(tracker: ReturnType<typeof createRepetitionTracker>, args: unknown, runId?: string) {
  return tracker.record({ sessionId: 's1', toolName: 'lang_detect', args, ...runId === undefined ? {} : { runId } })
}

describe('repetition tracker', () => {
  it('offers once after three identical shapes', () => {
    const tracker = createRepetitionTracker()
    assert.equal(record(tracker, { text: 'a' }), undefined)
    assert.equal(record(tracker, { text: 'b' }), undefined)
    const candidate = record(tracker, { text: 'c' })
    assert.equal(candidate?.calls, 3)
    assert.equal(record(tracker, { text: 'd' }), undefined)
    assert.equal(tracker.suggestions('s1').length, 1)
  })

  it('never stores the argument values', () => {
    const tracker = createRepetitionTracker()
    const secret = 'TOP-SECRET-VALUE'
    record(tracker, { text: secret })
    record(tracker, { text: secret })
    const candidate = record(tracker, { text: secret })
    assert.ok(candidate)
    assert.equal(JSON.stringify(candidate).includes(secret), false)
    assert.deepEqual(candidate?.inputSchema, {
      type: 'object', properties: { text: { type: 'string' } }, required: ['text'],
    })
  })

  it('keeps different shapes apart', () => {
    const tracker = createRepetitionTracker()
    record(tracker, { text: 'a' })
    record(tracker, { text: 'a' })
    record(tracker, { count: 1 })
    record(tracker, { count: 1 })
    assert.equal(tracker.suggestions('s1').length, 0)
    const candidate = record(tracker, { text: 'a' })
    assert.equal(candidate?.calls, 3)
  })

  it('updates the composition run id when one arrives', () => {
    const tracker = createRepetitionTracker()
    record(tracker, { code: 'return 1', tools: [] }, 'run-1')
    record(tracker, { code: 'return 1', tools: [] }, 'run-2')
    const candidate = record(tracker, { code: 'return 1', tools: [] }, 'run-3')
    assert.equal(candidate?.runId, 'run-3')
  })

  it('clears after acceptance and bounds sessions', () => {
    const tracker = createRepetitionTracker({ maxSessions: 1 })
    record(tracker, { text: 'a' })
    record(tracker, { text: 'a' })
    const candidate = record(tracker, { text: 'a' })
    assert.ok(candidate)
    tracker.clear('s1')
    assert.equal(tracker.suggestions('s1').length, 0)
  })
})
