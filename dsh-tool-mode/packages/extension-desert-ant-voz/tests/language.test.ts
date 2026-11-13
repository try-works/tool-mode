/** AT-21 — an explicit language request is a support check, not a fallback. */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertSupportedLanguage, normalizeLanguageRequest, VOZ_LANGUAGE_CODES } from '../src/index.ts'

describe('AT-21 — Voz language support', () => {
  it('documents the model card set exactly once, as ISO 639-1 codes', () => {
    assert.equal(VOZ_LANGUAGE_CODES.length, 25)
    assert.equal(new Set(VOZ_LANGUAGE_CODES).size, 25)
    for (const code of VOZ_LANGUAGE_CODES) assert.match(code, /^[a-z]{2}$/)
  })

  it('normalizes a BCP-47 request to its primary code', () => {
    assert.equal(normalizeLanguageRequest('EN-us'), 'en')
    assert.equal(normalizeLanguageRequest('pt-BR'), 'pt')
    assert.equal(normalizeLanguageRequest(undefined), undefined)
    assert.throws(() => normalizeLanguageRequest('x'), /at least two characters/)
  })

  it('accepts every documented code and refuses an undocumented one', () => {
    for (const code of VOZ_LANGUAGE_CODES) assert.equal(assertSupportedLanguage(code), code)
    assert.throws(
      () => assertSupportedLanguage('zz'),
      /unsupported requested language "zz": Voz documents .*English|unsupported requested language "zz": Voz documents/,
    )
  })
})