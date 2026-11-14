/**
 * The tokenizer wrapper: code-point offsets in, UTF-16 offsets out, and inconsistent
 * encodings refused before the pipeline can mis-slice a string.
 *
 * @module tests/tokenizer
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { redactTokensFrom, tokenizerFrom, type RedactEncoding } from '../src/tokenizer.ts'

/** An encoding with the three accessors the wrapper reads. */
function encoding(ids: number[], mask: number[], offsets: Array<[number, number]>): RedactEncoding {
  return {
    getIds: () => ids,
    getAttentionMask: () => mask,
    getOffsets: () => offsets,
  }
}

describe('redact tokenizer', () => {
  it('converts Unicode code-point offsets to UTF-16 offsets', () => {
    const text = '😀 ab'
    const tokens = redactTokensFrom(
      encoding([0, 7, 8, 2], [1, 1, 1, 1], [[0, 0], [1, 2], [2, 4], [0, 0]]),
      text,
    )
    assert.deepEqual(tokens.offsets, [
      { start: 0, end: 0 },
      { start: 2, end: 3 },
      { start: 3, end: 5 },
      { start: 0, end: 0 },
    ])
    assert.equal(text.slice(tokens.offsets[1]?.start, tokens.offsets[1]?.end), ' ')
    assert.equal(text.slice(tokens.offsets[2]?.start, tokens.offsets[2]?.end), 'ab')
  })

  it('refuses an encoding whose ids, mask and offsets disagree', async () => {
    const tokenizer = tokenizerFrom({
      encode: async () => encoding([1, 2], [1], [[0, 1], [1, 2]]),
    })
    await assert.rejects(tokenizer.encode('x'), /2 ids but 1 mask entries/)
    const second = tokenizerFrom({
      encode: async () => encoding([1, 2], [1, 1], [[0, 1]]),
    })
    await assert.rejects(second.encode('x'), /2 ids but 1 offsets/)
  })

  it('refuses an offset that runs past the text', async () => {
    const tokenizer = tokenizerFrom({
      encode: async () => encoding([1], [1], [[0, 9]]),
    })
    await assert.rejects(tokenizer.encode('ab'), /past the text/)
  })
})
