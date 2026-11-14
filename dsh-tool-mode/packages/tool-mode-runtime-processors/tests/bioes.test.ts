/**
 * BIOES decode + span merge tests.
 *
 * Decode works on one window's logits and returns spans in GLOBAL character offsets, because
 * the offsets it receives are the window's slice of the original token offsets. Merge then
 * reconciles the same entity seen twice by overlapping windows, and resolves the one case that
 * cannot be deferred: two different labels claiming the same characters.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { decodeBioes, mergeSpans } from '../src/bioes.ts'
import { logitsFromRows, oneHotLogits } from './support.ts'

const LABELS = ['O', 'B-GIVEN_NAME', 'I-GIVEN_NAME', 'E-GIVEN_NAME', 'S-EMAIL']
const OFFSETS = [
  { start: 0, end: 0 },
  { start: 0, end: 5 },
  { start: 6, end: 11 },
  { start: 11, end: 11 },
]

describe('decodeBioes', () => {
  it('assembles B then E into one span', () => {
    const spans = decodeBioes(oneHotLogits(4, LABELS.length, [0, 1, 3, 0]), { tokens: 4, labels: LABELS.length }, LABELS, OFFSETS, 0.6)
    assert.deepEqual(spans, [{ start: 0, end: 11, label: 'GIVEN_NAME', score: 1 }])
  })

  it('assembles B, I, E into one span', () => {
    const spans = decodeBioes(oneHotLogits(4, LABELS.length, [0, 1, 2, 0]), { tokens: 4, labels: LABELS.length }, LABELS, OFFSETS, 0.6)
    assert.deepEqual(spans, [{ start: 0, end: 11, label: 'GIVEN_NAME', score: 1 }])
  })

  it('emits an S label as a single-token span', () => {
    const spans = decodeBioes(
      oneHotLogits(4, LABELS.length, [0, 4, 0, 0]),
      { tokens: 4, labels: LABELS.length },
      LABELS,
      OFFSETS,
      0.6,
    )
    assert.deepEqual(spans, [{ start: 0, end: 5, label: 'EMAIL', score: 1 }])
  })

  it('tolerates an I label with no B', () => {
    const spans = decodeBioes(
      oneHotLogits(4, LABELS.length, [0, 2, 0, 0]),
      { tokens: 4, labels: LABELS.length },
      LABELS,
      OFFSETS,
      0.6,
    )
    assert.deepEqual(spans, [{ start: 0, end: 5, label: 'GIVEN_NAME', score: 1 }])
  })

  it('closes a B that is never continued as a single-token span', () => {
    const spans = decodeBioes(
      oneHotLogits(4, LABELS.length, [0, 1, 0, 0]),
      { tokens: 4, labels: LABELS.length },
      LABELS,
      OFFSETS,
      0.6,
    )
    assert.deepEqual(spans, [{ start: 0, end: 5, label: 'GIVEN_NAME', score: 1 }])
  })

  it('skips zero-width special tokens', () => {
    const spans = decodeBioes(
      oneHotLogits(4, LABELS.length, [1, 3, 0, 0]),
      { tokens: 4, labels: LABELS.length },
      LABELS,
      [{ start: 0, end: 0 }, { start: 0, end: 5 }, { start: 5, end: 5 }, { start: 5, end: 5 }],
      0.6,
    )
    assert.deepEqual(spans, [{ start: 0, end: 5, label: 'GIVEN_NAME', score: 1 }])
  })

  it('drops an entity below minScore', () => {
    const spans = decodeBioes(
      logitsFromRows([[0, 0]]),
      { tokens: 1, labels: 2 },
      ['B-EMAIL', 'E-EMAIL'],
      [{ start: 0, end: 4 }],
      0.6,
    )
    assert.deepEqual(spans, [])
  })

  it('reports the minimum token probability as the span score', () => {
    const rows = [
      [0, Math.log(7 / 3), -20],
      [-20, -20, 0],
    ]
    const spans = decodeBioes(
      logitsFromRows(rows),
      { tokens: 2, labels: 3 },
      ['O', 'B-EMAIL', 'E-EMAIL'],
      [{ start: 0, end: 4 }, { start: 4, end: 8 }],
      0.6,
    )
    const span = spans[0]
    assert.ok(span !== undefined, 'expected a span')
    assert.ok(Math.abs(span.score - 0.7) < 1e-3, 'score should be the weaker token probability')
    assert.equal(span.label, 'EMAIL')
  })

  it('treats an unknown BIOES prefix as O', () => {
    const spans = decodeBioes(
      oneHotLogits(2, 2, [0, 1]),
      { tokens: 2, labels: 2 },
      ['O', 'X-EMAIL'],
      [{ start: 0, end: 4 }, { start: 4, end: 8 }],
      0.6,
    )
    assert.deepEqual(spans, [])
  })

  it('returns nothing for an empty window', () => {
    assert.deepEqual(decodeBioes(new Float32Array(0), { tokens: 0, labels: 1 }, ['O'], [], 0.6), [])
  })

  it('rejects a logits length that does not match the shape', () => {
    assert.throws(
      () => decodeBioes(new Float32Array(3), { tokens: 2, labels: 2 }, ['O', 'B-X'], [{ start: 0, end: 1 }, { start: 1, end: 2 }], 0.6),
      /logits/,
    )
  })

  it('rejects offsets that do not match the token count', () => {
    assert.throws(
      () => decodeBioes(new Float32Array(4), { tokens: 2, labels: 2 }, ['O', 'B-X'], [{ start: 0, end: 1 }], 0.6),
      /offsets/,
    )
  })

  it('rejects a label list that does not match the shape', () => {
    assert.throws(
      () => decodeBioes(new Float32Array(4), { tokens: 2, labels: 2 }, ['O'], [{ start: 0, end: 1 }, { start: 1, end: 2 }], 0.6),
      /labels/,
    )
  })

  it('rejects a minScore outside 0..1', () => {
    assert.throws(
      () => decodeBioes(new Float32Array(2), { tokens: 1, labels: 2 }, ['O', 'B-X'], [{ start: 0, end: 1 }], 1.5),
      /minScore/,
    )
  })

  it('is deterministic', () => {
    const args: Parameters<typeof decodeBioes> = [
      oneHotLogits(4, LABELS.length, [0, 1, 3, 0]),
      { tokens: 4, labels: LABELS.length },
      LABELS,
      OFFSETS,
      0.6,
    ]
    assert.deepEqual(decodeBioes(...args), decodeBioes(...args))
  })
})

describe('mergeSpans', () => {
  it('collapses duplicates from overlapping windows, keeping the best score', () => {
    const merged = mergeSpans([
      { start: 0, end: 5, label: 'EMAIL', score: 0.9 },
      { start: 0, end: 5, label: 'EMAIL', score: 0.95 },
    ])
    assert.deepEqual(merged, [{ start: 0, end: 5, label: 'EMAIL', score: 0.95 }])
  })

  it('unions partially overlapping spans of the same label', () => {
    const merged = mergeSpans([
      { start: 0, end: 6, label: 'PHONE', score: 0.7 },
      { start: 4, end: 10, label: 'PHONE', score: 0.8 },
    ])
    assert.deepEqual(merged, [{ start: 0, end: 10, label: 'PHONE', score: 0.8 }])
  })

  it('joins touching spans of the same label', () => {
    const merged = mergeSpans([
      { start: 0, end: 4, label: 'GIVEN_NAME', score: 0.9 },
      { start: 4, end: 9, label: 'GIVEN_NAME', score: 0.9 },
    ])
    assert.deepEqual(merged, [{ start: 0, end: 9, label: 'GIVEN_NAME', score: 0.9 }])
  })

  it('resolves a cross-label overlap in favour of the higher score', () => {
    const merged = mergeSpans([
      { start: 0, end: 15, label: 'PHONE', score: 0.8 },
      { start: 5, end: 12, label: 'EMAIL', score: 0.95 },
    ])
    assert.deepEqual(merged, [{ start: 5, end: 12, label: 'EMAIL', score: 0.95 }])
  })

  it('breaks a score tie by length, then by earlier start', () => {
    const longer = mergeSpans([
      { start: 0, end: 10, label: 'A', score: 0.9 },
      { start: 2, end: 6, label: 'B', score: 0.9 },
    ])
    assert.deepEqual(longer, [{ start: 0, end: 10, label: 'A', score: 0.9 }])
    const earlier = mergeSpans([
      { start: 3, end: 7, label: 'B', score: 0.9 },
      { start: 0, end: 4, label: 'A', score: 0.9 },
    ])
    assert.deepEqual(earlier, [{ start: 0, end: 4, label: 'A', score: 0.9 }])
  })

  it('sorts unsorted input', () => {
    const merged = mergeSpans([
      { start: 10, end: 12, label: 'EMAIL', score: 1 },
      { start: 0, end: 2, label: 'EMAIL', score: 1 },
    ])
    assert.deepEqual(merged, [
      { start: 0, end: 2, label: 'EMAIL', score: 1 },
      { start: 10, end: 12, label: 'EMAIL', score: 1 },
    ])
  })

  it('keeps adjacent spans of different labels separate', () => {
    const merged = mergeSpans([
      { start: 0, end: 5, label: 'EMAIL', score: 1 },
      { start: 5, end: 10, label: 'PHONE', score: 1 },
    ])
    assert.deepEqual(merged, [
      { start: 0, end: 5, label: 'EMAIL', score: 1 },
      { start: 5, end: 10, label: 'PHONE', score: 1 },
    ])
  })

  it('drops zero-length spans and returns a fresh array', () => {
    const input = [
      { start: 4, end: 4, label: 'EMAIL', score: 1 },
      { start: 0, end: 3, label: 'EMAIL', score: 1 },
    ]
    const snapshot = input.map(span => ({ ...span }))
    const merged = mergeSpans(input)
    assert.deepEqual(merged, [{ start: 0, end: 3, label: 'EMAIL', score: 1 }])
    assert.deepEqual(input, snapshot)
    assert.notEqual(merged, input)
  })

  it('handles an empty input', () => {
    assert.deepEqual(mergeSpans([]), [])
  })
})
