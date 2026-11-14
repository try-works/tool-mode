/**
 * Deterministic PII tests.
 *
 * This layer is the safety net under the model: it only reports patterns it can validate
 * (Luhn for cards and IMEI, mod-97 for IBAN) and it refuses to call a bare digit run a phone.
 * Every span is a UTF-16 slice of the caller's text, so the assertions compare the slice too.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { deterministicPii } from '../src/deterministic.ts'

function labelsOf(text: string): readonly string[] {
  return deterministicPii(text).map(span => span.label)
}

describe('deterministicPii', () => {
  it('finds an email and reports code-unit offsets', () => {
    const text = 'Contact anna@example.hu now'
    const spans = deterministicPii(text)
    assert.deepEqual(spans, [
      { start: 8, end: 23, label: 'EMAIL', text: 'anna@example.hu', score: 1 },
    ])
    assert.equal(text.slice(8, 23), 'anna@example.hu')
  })

  it('finds an email after an astral character', () => {
    const text = '😀 anna@example.com'
    const spans = deterministicPii(text)
    assert.equal(spans.length, 1)
    assert.deepEqual(spans[0], { start: 3, end: 19, label: 'EMAIL', text: 'anna@example.com', score: 1 })
    assert.equal(text.slice(3, 19), 'anna@example.com')
  })

  it('does not swallow the sentence period after an email', () => {
    const spans = deterministicPii('write to anna@example.com.')
    assert.deepEqual(spans, [{ start: 9, end: 25, label: 'EMAIL', text: 'anna@example.com', score: 1 }])
  })

  it('finds a phone with separators', () => {
    const spans = deterministicPii('call +31 6 1234 5678')
    assert.deepEqual(spans, [{ start: 5, end: 20, label: 'PHONE', text: '+31 6 1234 5678', score: 0.9 }])
  })

  it('finds a phone in parentheses', () => {
    const spans = deterministicPii('(020) 1234 5678')
    assert.deepEqual(spans, [{ start: 0, end: 15, label: 'PHONE', text: '(020) 1234 5678', score: 0.9 }])
  })

  it('finds a Luhn-valid card and prefers it over a phone', () => {
    const text = 'pay with 4111 1111 1111 1111 today'
    const spans = deterministicPii(text)
    assert.deepEqual(spans, [{ start: 9, end: 28, label: 'CREDIT_CARD', text: '4111 1111 1111 1111', score: 1 }])
  })

  it('does not report a card whose Luhn check fails', () => {
    assert.deepEqual(deterministicPii('4111 1111 1111 1112'), [])
  })

  it('finds an IBAN in printed form', () => {
    const text = 'IBAN GB29 NWBK 6016 1331 9268 19'
    const spans = deterministicPii(text)
    assert.deepEqual(spans, [{ start: 5, end: 32, label: 'IBAN', text: 'GB29 NWBK 6016 1331 9268 19', score: 1 }])
  })

  it('does not report an IBAN whose mod-97 check fails', () => {
    assert.deepEqual(labelsOf('GB29NWBK60161331926820'), [])
  })

  it('finds a Luhn-valid IMEI exactly once', () => {
    const spans = deterministicPii('356938035643809')
    assert.deepEqual(spans, [{ start: 0, end: 15, label: 'IMEI', text: '356938035643809', score: 1 }])
  })

  it('does not report a 15-digit run that fails the IMEI checksum', () => {
    assert.deepEqual(deterministicPii('356938035643808'), [])
  })

  it('refuses a digit run adjacent to letters', () => {
    assert.deepEqual(deterministicPii('x4111111111111111'), [])
  })

  it('reports an email and a phone in text order', () => {
    const text = 'mail anna@example.com or +31 6 1234 5678'
    const spans = deterministicPii(text)
    assert.deepEqual(spans.map(span => span.label), ['EMAIL', 'PHONE'])
    assert.ok((spans[0]?.start ?? -1) < (spans[1]?.start ?? -1))
  })

  it('is deterministic and returns fresh arrays', () => {
    const text = 'anna@example.com +31 6 1234 5678'
    const first = deterministicPii(text)
    const second = deterministicPii(text)
    assert.deepEqual(first, second)
    assert.notEqual(first, second)
  })

  it('returns nothing for empty or PII-free text', () => {
    assert.deepEqual(deterministicPii(''), [])
    assert.deepEqual(deterministicPii('a quiet sentence about nothing'), [])
  })

  it('never overlaps spans and always matches the slice', () => {
    const text = 'a 4111 1111 1111 1111 b anna@example.com c GB29 NWBK 6016 1331 9268 19'
    const spans = deterministicPii(text)
    let previousEnd = -1
    for (const span of spans) {
      assert.ok(span.start >= previousEnd, 'spans must not overlap')
      assert.ok(span.end > span.start)
      assert.equal(span.text, text.slice(span.start, span.end))
      previousEnd = span.end
    }
  })

  it('only emits labels from the redact taxonomy', () => {
    const text = 'anna@example.com +31 6 1234 5678 4111 1111 1111 1111 GB29 NWBK 6016 1331 9268 19 356938035643809'
    const allowed = new Set(['EMAIL', 'PHONE', 'CREDIT_CARD', 'IBAN', 'IMEI'])
    for (const span of deterministicPii(text)) {
      assert.ok(allowed.has(span.label), 'unexpected label ' + span.label)
    }
  })
})
