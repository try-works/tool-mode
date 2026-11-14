/**
 * Pure processor decisions: label parsing, pad id, padding, offset alignment, coverage.
 *
 * @module tests/pure
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  coverageOf,
  filterModelSpans,
  labelsFromJson,
  padIdFromTokenizerJson,
  padWindow,
  spansFromMerged,
  windowTokenOffsets,
} from '../src/pure.ts'

describe('labelsFromJson', () => {
  it('returns the label table in index order', () => {
    assert.deepEqual(labelsFromJson({ id2label: { 0: 'O', 1: 'B-SSN', 2: 'S-SSN' } }), ['O', 'B-SSN', 'S-SSN'])
  })

  it('refuses a gap, a non-integer key and a blank label', () => {
    assert.throws(() => labelsFromJson({ id2label: { 0: 'O', 2: 'S-SSN', 3: 'B-X' } }), /contiguous from 0/)
    assert.throws(() => labelsFromJson({ id2label: { 0: 'O', 2: 'S-SSN' } }), /not an index/)
    assert.throws(() => labelsFromJson({ id2label: { 0: 'O', x: 'S-SSN' } }), /not an index/)
    assert.throws(() => labelsFromJson({ id2label: { 0: 'O', 1: '' } }), /non-empty string/)
    assert.throws(() => labelsFromJson({}), /id2label/)
  })
})

describe('padIdFromTokenizerJson', () => {
  it('reads the <pad> added-token id', () => {
    const json = { added_tokens: [{ id: 0, content: '<s>' }, { id: 1, content: '<pad>' }] }
    assert.equal(padIdFromTokenizerJson(json), 1)
  })

  it('refuses a tokenizer without a pad token', () => {
    assert.throws(() => padIdFromTokenizerJson({ added_tokens: [{ id: 0, content: '<s>' }] }), /<pad>/)
    assert.throws(() => padIdFromTokenizerJson({}), /added_tokens/)
  })
})

describe('padWindow', () => {
  it('pads ids with the pad id and the mask with zero', () => {
    const padded = padWindow([0, 42, 2], [1, 1, 1], 1, 6)
    assert.deepEqual(Array.from(padded.ids), [0, 42, 2, 1, 1, 1])
    assert.deepEqual(Array.from(padded.mask), [1, 1, 1, 0, 0, 0])
  })

  it('refuses a mask that disagrees with the ids', () => {
    assert.throws(() => padWindow([1, 2], [1], 1, 4), /disagree/)
  })
})

describe('windowTokenOffsets', () => {
  it('aligns content at position 1 and leaves specials and padding zero-width', () => {
    const all = [{ start: 0, end: 4 }, { start: 5, end: 8 }]
    const offsets = windowTokenOffsets(all, 0, 2, 5)
    assert.deepEqual(offsets[0], { start: 0, end: 0 })
    assert.deepEqual(offsets[1], { start: 0, end: 4 })
    assert.deepEqual(offsets[2], { start: 5, end: 8 })
    assert.deepEqual(offsets[3], { start: 0, end: 0 })
    assert.deepEqual(offsets[4], { start: 0, end: 0 })
  })

  it('refuses a window that runs past the tokenizer offsets', () => {
    assert.throws(() => windowTokenOffsets([{ start: 0, end: 1 }], 0, 2, 4), /past the tokenizer offsets/)
  })
})

describe('coverageOf', () => {
  it('reports complete coverage when every window ran', () => {
    assert.deepEqual(coverageOf(602, 2, 2, 4, 256, 64), { complete: true, processedUnits: 602, totalUnits: 602 })
  })

  it('reports the processed prefix and the cap when truncated', () => {
    const coverage = coverageOf(602, 7, 4, 4, 256, 64)
    assert.equal(coverage.complete, false)
    assert.equal(coverage.processedUnits, 448)
    assert.equal(coverage.totalUnits, 602)
    assert.match(coverage.reason ?? '', /4 of 7 windows/)
  })
})

describe('span assembly', () => {
  it('slices the original text at UTF-16 offsets', () => {
    const text = '😀x'
    const spans = spansFromMerged([{ start: 2, end: 3, label: 'X', score: 1 }], text)
    assert.equal(spans[0]?.text, 'x')
  })

  it('filters disabled model labels only', () => {
    const kept = filterModelSpans(
      [{ start: 0, end: 1, label: 'ORG', score: 1 }, { start: 2, end: 3, label: 'EMAIL', score: 1 }],
      new Set(['ORG']),
    )
    assert.deepEqual(kept.map((span) => span.label), ['EMAIL'])
  })
})
