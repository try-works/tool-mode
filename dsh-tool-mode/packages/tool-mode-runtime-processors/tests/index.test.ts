/**
 * Package-surface tests: the constants the redact pipeline pins.
 *
 * They are asserted here because a drift in any of them silently changes model input shape,
 * which no other test in this package can see.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  deterministicPii,
  decodeBioes,
  mergeSpans,
  REDACT_MAX_LENGTH,
  REDACT_MAX_PROCESSED_TOKENS,
  REDACT_MAX_WINDOWS,
  REDACT_MIN_SCORE,
  REDACT_STRIDE,
  utf16Offsets,
  windows,
} from '../src/index.ts'

describe('redact constants', () => {
  it('pins the window geometry and threshold from the runtime plan', () => {
    assert.equal(REDACT_MAX_LENGTH, 256)
    assert.equal(REDACT_STRIDE, 64)
    assert.equal(REDACT_MIN_SCORE, 0.6)
    assert.equal(REDACT_MAX_WINDOWS, 4)
    assert.equal(REDACT_MAX_PROCESSED_TOKENS, 1024)
  })

  it('re-exposes every processor the plan names', () => {
    for (const exported of [deterministicPii, decodeBioes, mergeSpans, windows, utf16Offsets]) {
      assert.equal(typeof exported, 'function')
    }
  })
})
