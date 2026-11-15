/**
 * Data-flow edges: which earlier result reached which argument (OBS-01 extension).
 *
 * The tracker distinguishes identity (`same-reference`) from exact canonical equality
 * (`same-value`), refuses to guess when two earlier calls produced the same value, and
 * reports coverage so an incomplete graph is visibly incomplete. It is equality
 * evidence, not taint tracking: a transformed value has no edge.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createDataFlowTracker, dataFlowCoverage, NO_DATA_FLOW, type DataFlowEdge } from '../src/data-flow.ts'

function edgesOf(args: unknown, to = 'call_2', record: (tracker: ReturnType<typeof createDataFlowTracker>) => void): readonly DataFlowEdge[] {
  const tracker = createDataFlowTracker()
  record(tracker)
  return tracker.edges(args, to)
}

describe('data-flow — identity evidence', () => {
  it('records the SAME object passed as a whole argument', () => {
    const result = { language: 'fr' }
    const edges = edgesOf({ query: result }, 'call_2', tracker => tracker.record('call_1', result))
    assert.deepEqual(edges, [
      { from: 'call_1', to: 'call_2', input: 'query', evidence: 'same-reference' },
    ])
  })

  it('records a nested object that was returned by an earlier call', () => {
    const inner = { text: 'bonjour' }
    const edges = edgesOf({ input: { first: inner } }, 'call_2', tracker => tracker.record('call_1', inner))
    assert.deepEqual(edges, [
      { from: 'call_1', to: 'call_2', input: 'input.first', evidence: 'same-reference' },
    ])
  })
})

describe('data-flow — value evidence', () => {
  it('records a primitive copied out of an earlier result by exact value', () => {
    const edges = edgesOf({ text: 'bonjour' }, 'call_2', tracker => tracker.record('call_1', 'bonjour'))
    assert.deepEqual(edges, [
      { from: 'call_1', to: 'call_2', input: 'text', evidence: 'same-value' },
    ])
  })

  it('records an array element path, not only top-level arguments', () => {
    const edges = edgesOf(
      { documents: [{ id: 'a', text: 'hello' }, { id: 'b', text: 'other' }] },
      'call_3',
      tracker => tracker.record('call_2', 'hello'),
    )
    assert.deepEqual(edges, [
      { from: 'call_2', to: 'call_3', input: 'documents[0].text', evidence: 'same-value' },
    ])
  })

  it('records a FIELD copied out of an object result', () => {
    const edges = edgesOf({ text: 'bonjour' }, 'call_2', tracker => tracker.record('call_1', { text: 'bonjour', language: 'fr' }))
    assert.deepEqual(edges, [
      { from: 'call_1', to: 'call_2', input: 'text', evidence: 'same-value' },
    ])
  })

  it('prefers the specific field over a same-shaped whole argument object', () => {
    const edges = edgesOf({ token: 'a' }, 'call_2', tracker => tracker.record('call_1', { token: 'a' }))
    assert.deepEqual(edges, [
      { from: 'call_1', to: 'call_2', input: 'token', evidence: 'same-value' },
    ], 'the argument object happening to equal the result is not more specific than its field')
  })

  it('reports ONE whole-object edge instead of one per field', () => {
    const result = { language: 'fr', reliability: 'confident', candidates: [{ language: 'fr' }] }
    const edges = edgesOf({ record: { ...result, candidates: [...result.candidates] } }, 'call_2', tracker => tracker.record('call_1', result))
    assert.deepEqual(edges, [
      { from: 'call_1', to: 'call_2', input: 'record', evidence: 'same-value' },
    ])
  })

  it('does NOT guess when two earlier calls produced the same value', () => {
    const edges = edgesOf({ text: 'same' }, 'call_3', tracker => {
      tracker.record('call_1', 'same')
      tracker.record('call_2', 'same')
    })
    assert.deepEqual(edges, [], 'an ambiguous match is not evidence of which call fed the argument')
  })

  it('does not record a transformed value that matches nothing', () => {
    const edges = edgesOf({ text: 'bonjour!' }, 'call_2', tracker => tracker.record('call_1', 'bonjour'))
    assert.deepEqual(edges, [])
  })
})

describe('data-flow — coverage is explicit, never implied complete', () => {
  it('reports matched consumers and the unresolved call ids', () => {
    const matched = dataFlowCoverage([
      { callId: 'call_1' },
      { callId: 'call_2', input: [{ from: 'call_1', to: 'call_2', input: 'token', evidence: 'same-value' }] },
    ])
    assert.deepEqual(matched, {
      method: 'value-equality',
      complete: false,
      consumers: 1,
      matched: 1,
      unresolved: [],
    })
  })

  it('lists a consumer with no edge instead of letting a quiet graph look simple', () => {
    const missing = dataFlowCoverage([
      { callId: 'call_1' },
      { callId: 'call_2' },
    ])
    assert.equal(missing.matched, 0)
    assert.deepEqual(missing.unresolved, ['call_2'])
  })
})

describe('data-flow — bounds and defaults', () => {
  it('produces no edges when nothing was recorded, and the inert tracker is empty', () => {
    assert.deepEqual(createDataFlowTracker().edges({ text: 'x' }, 'call_2'), [])
    assert.deepEqual(NO_DATA_FLOW.edges({ text: 'x' }, 'call_2'), [])
  })

  it('survives a circular argument without throwing', () => {
    const circular: Record<string, unknown> = { text: 'x' }
    circular['self'] = circular
    const edges = edgesOf(circular, 'call_2', tracker => tracker.record('call_1', 'y'))
    assert.deepEqual(edges, [], 'a cycle is walked a bounded number of levels, not forever')
  })
})
