/**
 * Sliding-window tests.
 *
 * The window is the unit the model actually sees, so the contract is:
 * every window repeats the sequence's special tokens, startToken is the index in the
 * ORIGINAL ids array of the window's first content token, and a stride smaller than the
 * content span overlaps rather than lays windows end to end.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { windows } from '../src/windows.ts'
import { requireValue } from './support.ts'

const CLS = 101
const SEP = 102

/** ids with n content tokens 1..n wrapped in the special pair. */
function sequence(n: number) {
  const content = Array.from({ length: n }, (_, index) => index + 1)
  return { ids: [CLS, ...content, SEP], mask: new Array<number>(n + 2).fill(1) }
}

describe('windows', () => {
  it('splits content into maxLength windows and restores the special pair', () => {
    const { ids, mask } = sequence(8)
    const result = windows(ids, mask, { maxLength: 6, stride: 4 })
    assert.equal(result.length, 2)
    assert.deepEqual(result[0]?.ids, [CLS, 1, 2, 3, 4, SEP])
    assert.deepEqual(result[1]?.ids, [CLS, 5, 6, 7, 8, SEP])
    assert.deepEqual(result[0]?.mask, [1, 1, 1, 1, 1, 1])
    assert.equal(result[0]?.startToken, 1)
    assert.equal(result[1]?.startToken, 5)
  })

  it('overlaps consecutive windows by content span minus stride', () => {
    const { ids, mask } = sequence(8)
    const result = windows(ids, mask, { maxLength: 7, stride: 3 })
    assert.deepEqual(result.map(window => window.startToken), [1, 4])
    assert.deepEqual(result.map(window => window.ids.length), [7, 7])
    assert.deepEqual(result[1]?.ids, [CLS, 4, 5, 6, 7, 8, SEP])
  })

  it('stops once a window reaches the end instead of repeating covered tail windows', () => {
    const { ids, mask } = sequence(8)
    const result = windows(ids, mask, { maxLength: 7, stride: 3 })
    assert.equal(result.length, 2, 'the window starting at content token 6 is already covered')
  })

  it('keeps a final short window instead of dropping the tail', () => {
    const { ids, mask } = sequence(9)
    const result = windows(ids, mask, { maxLength: 6, stride: 3 })
    assert.equal(result.length, 3)
    assert.deepEqual(result[2]?.ids, [CLS, 7, 8, 9, SEP])
    assert.equal(result[2]?.startToken, 7)
  })

  it('tiles without overlap when stride equals the content span', () => {
    const { ids, mask } = sequence(8)
    const result = windows(ids, mask, { maxLength: 6, stride: 4 })
    assert.deepEqual(result.map(window => window.startToken), [1, 5])
  })

  it('returns the special pair for empty content', () => {
    const result = windows([CLS, SEP], [1, 1], { maxLength: 256, stride: 64 })
    assert.deepEqual(result, [{ ids: [CLS, SEP], mask: [1, 1], startToken: 1 }])
  })

  it('carries the mask positionally instead of recomputing it', () => {
    const { ids } = sequence(8)
    const mask = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1]
    const result = windows(ids, mask, { maxLength: 6, stride: 4 })
    assert.deepEqual(result[0]?.mask, [1, 0, 1, 0, 1, 1])
    assert.deepEqual(result[1]?.mask, [1, 1, 0, 1, 0, 1])
  })

  it('returns independent copies of the ids', () => {
    const { ids, mask } = sequence(4)
    const result = windows(ids, mask, { maxLength: 6, stride: 4 })
    const first = requireValue(result[0], 'expected a window')
    first.ids[1] = 999
    assert.equal(ids[1], 1)
  })

  it('rejects a stride that would leave a gap', () => {
    const { ids, mask } = sequence(8)
    assert.throws(() => windows(ids, mask, { maxLength: 6, stride: 5 }), /stride/)
  })

  it('rejects a non-positive stride', () => {
    const { ids, mask } = sequence(8)
    assert.throws(() => windows(ids, mask, { maxLength: 6, stride: 0 }), /stride/)
  })

  it('rejects a maxLength too small to hold the special pair and content', () => {
    const { ids, mask } = sequence(8)
    assert.throws(() => windows(ids, mask, { maxLength: 2, stride: 1 }), /maxLength/)
  })

  it('rejects a sequence shorter than the special pair', () => {
    assert.throws(() => windows([CLS], [1], { maxLength: 6, stride: 4 }), /at least/)
  })

  it('rejects a mask whose length does not match ids', () => {
    const { ids } = sequence(8)
    assert.throws(() => windows(ids, [1], { maxLength: 6, stride: 4 }), /mask/)
  })

  it('rejects a non-integer window option', () => {
    const { ids, mask } = sequence(8)
    assert.throws(() => windows(ids, mask, { maxLength: 6.5, stride: 4 }), /maxLength/)
  })
})
