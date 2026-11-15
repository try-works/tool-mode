/**
 * Data-flow edges: which earlier result reached which argument (OBS-01 extension).
 *
 * The tracker distinguishes identity (`same-reference`) from exact canonical equality
 * (`same-value`), and refuses to guess when two earlier calls produced the same value.
 * These tests pin those distinctions; they do not claim runtime taint tracking.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createDataFlowTracker, NO_DATA_FLOW, type DataFlowEdge } from '../src/data-flow.ts'

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
