/**
 * Code-point to UTF-16 offset tests.
 *
 * The tokenizers package indexes code points; String.slice indexes UTF-16 code units. Every
 * astral character (an emoji, a rare CJK ideograph) is one code point but two code units, so the
 * two indices diverge by one per astral character seen before the span. The tests below pin the
 * divergence, the identity case for BMP characters, and the refusal of a malformed span.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { utf16Offsets } from '../src/offsets.ts'

describe('utf16Offsets', () => {
  it('is the identity for ASCII text', () => {
    assert.deepEqual(utf16Offsets([{ start: 0, end: 5 }, { start: 6, end: 11 }], 'hello world'), [
      { start: 0, end: 5 },
      { start: 6, end: 11 },
    ])
  })

  it('shifts a span after an astral emoji by two code units', () => {
    const text = '😀 anna@example.com'
    const codePointOffsets = [{ start: 2, end: 18 }]
    const converted = utf16Offsets(codePointOffsets, text)
    assert.deepEqual(converted, [{ start: 3, end: 19 }])
    assert.equal(text.slice(converted[0]?.start ?? 0, converted[0]?.end ?? 0), 'anna@example.com')
  })

  it('covers the whole text when the code-point offset covers it', () => {
    const text = '😀😀'
    const converted = utf16Offsets([{ start: 0, end: 2 }], text)
    assert.deepEqual(converted, [{ start: 0, end: 4 }])
    assert.equal(converted[0]?.end, text.length)
  })

  it('maps a code-point offset that sits on the emoji itself', () => {
    const text = 'a😀b'
    assert.deepEqual(utf16Offsets([{ start: 1, end: 2 }], text), [{ start: 1, end: 3 }])
  })

  it('is the identity for a two-byte BMP character', () => {
    const text = 'café'
    assert.equal(text.length, 4)
    assert.deepEqual(utf16Offsets([{ start: 3, end: 4 }], text), [{ start: 3, end: 4 }])
    assert.equal(text.slice(3, 4), 'é')
  })

  it('combines BMP and astral characters in one string', () => {
    const text = 'a😀bé'
    assert.equal(text.length, 5)
    assert.deepEqual(utf16Offsets([{ start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 4 }], text), [
      { start: 1, end: 3 },
      { start: 3, end: 4 },
      { start: 4, end: 5 },
    ])
  })

  it('keeps an empty span empty', () => {
    assert.deepEqual(utf16Offsets([{ start: 2, end: 2 }], '😀ab'), [{ start: 3, end: 3 }])
  })

  it('handles empty text and an empty offset list', () => {
    assert.deepEqual(utf16Offsets([], 'abc'), [])
    assert.deepEqual(utf16Offsets([], ''), [])
    assert.deepEqual(utf16Offsets([{ start: 0, end: 0 }], ''), [{ start: 0, end: 0 }])
  })

  it('returns fresh objects and leaves the input untouched', () => {
    const input = [{ start: 0, end: 1 }]
    const snapshot = input.map(offset => ({ ...offset }))
    const converted = utf16Offsets(input, '😀')
    assert.deepEqual(input, snapshot)
    assert.notEqual(converted[0], input[0])
    assert.notEqual(converted, input)
  })

  it('refuses a non-integer offset', () => {
    assert.throws(() => utf16Offsets([{ start: 0, end: 1.5 }], 'ab'), /integer/)
  })

  it('refuses a negative start', () => {
    assert.throws(() => utf16Offsets([{ start: -1, end: 1 }], 'ab'), /before the text/)
  })

  it('refuses a span that ends before it starts', () => {
    assert.throws(() => utf16Offsets([{ start: 2, end: 1 }], 'abc'), /ends before it starts/)
  })

  it('refuses a span past the end of the text', () => {
    assert.throws(() => utf16Offsets([{ start: 0, end: 3 }], 'ab'), /past the text/)
  })
})
