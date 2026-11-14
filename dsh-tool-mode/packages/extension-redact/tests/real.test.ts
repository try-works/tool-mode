/**
 * The real-inference gate.
 *
 * It is skipped unless TOOL_MODE_REAL_ASSETS=1 and the pinned assets are present under
 * .assets/redact (see scripts/fetch-redact-assets.mjs). When it runs it drives the SAME
 * createRuntimeProvider -> redactLayer path the host will drive: real tokenizer, real
 * LiteRT.js, real tflite, real spans.
 *
 * @module tests/real
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { InvocationContextV1, PreparedAssetMapV1 } from '@try-works/tool-mode-extension-sdk'
import { createRuntimeProvider } from '@try-works/tool-mode-runtime-dsh'

import { redactLayer, redactRequest } from '../src/provider.ts'

/** The prepared-asset directory this repo's fetch script writes. */
const ASSETS_DIR = fileURLToPath(new URL('../../../.assets/redact/', import.meta.url))

/** Asset id -> the pinned file name. */
const FILES: Readonly<Record<string, string>> = {
  'redact-tflite': 'redact.tflite',
  'redact-tokenizer': 'tokenizer.json',
  'redact-tokenizer-config': 'tokenizer_config.json',
  'redact-config': 'config.json',
  'redact-labels': 'labels.json',
  'redact-meta': 'redact_meta.json',
}

/** The expected digest per asset id, restated so the test proves the lock and the bytes agree. */
const DIGESTS: Readonly<Record<string, string>> = {
  'redact-tflite': '2b6237e3a08ee12966929af477fb3723018bacdb74a22f78992b8c0f6b5d545d',
  'redact-tokenizer': 'f2c1a2749a3ec41e56d9b65221918391f62d339869f8ac937fc3c581d99c74ec',
  'redact-labels': '228835734235f85ec4bf31391a296aa6e8a36684e1171e841ac94f7b3f9b430a',
  'redact-meta': 'adc5dadf50fca1f757162898930aad7d53a869cec0c246398a53a2a56438e019',
}

/** A host-shaped prepared asset map rooted at the prepared directory. */
function preparedAssets(): PreparedAssetMapV1 {
  return {
    assetIds: Object.keys(FILES),
    get: (assetId) => {
      const file = FILES[assetId]
      return file === undefined ? undefined : { path: join(ASSETS_DIR, file), digest: 'sha256:' + (DIGESTS[assetId] ?? '') }
    },
  }
}

const enabled = process.env.TOOL_MODE_REAL_ASSETS === '1'
const skip = !enabled
  ? 'TOOL_MODE_REAL_ASSETS is not 1'
  : !existsSync(join(ASSETS_DIR, 'redact.tflite'))
    ? '.assets/redact is absent; run node scripts/fetch-redact-assets.mjs'
    : false

/** A text with deterministic and model-detectable PII. */
const SAMPLE =
  'Alice Smith lives at 42 Baker Street, London. Email alice.smith@example.com, '
  + 'phone +1 415 555 0132, card 4111 1111 1111 1111.'

describe('redact real inference', () => {
  it('produces concrete spans from the pinned tflite artifact', { skip }, async () => {
    const provider = createRuntimeProvider({
      modelId: 'redact',
      providerId: 'litert',
      layer: redactLayer,
      request: redactRequest,
    })
    const controller = new AbortController()
    await provider.load({ assets: preparedAssets(), signal: controller.signal })

    const context: InvocationContextV1 = {
      invocationId: 'real-redact-1',
      signal: controller.signal,
      limits: { maxInputBytes: 1_000_000, maxAudioSeconds: 0, maxResultBytes: 1_000_000 },
      resolvePath: (candidate) => candidate,
    }
    const raw = await provider.invoke({ implementationId: 'redact-text', input: { text: SAMPLE }, context })
    const spans = raw.spans as Array<{ start: number; end: number; label: string; text: string; score: number }>
    const coverage = raw.coverage as { complete: boolean; processedUnits: number; totalUnits: number; reason?: string }
    console.log('redact real spans:', JSON.stringify(spans))

    assert.equal(coverage.complete, true)
    assert.ok(spans.length > 0, 'a document with an email, a phone and a card must produce spans')
    for (const span of spans) assert.equal(SAMPLE.slice(span.start, span.end), span.text)

    const email = spans.find((span) => span.label === 'EMAIL')
    assert.ok(email, 'the email must be reported')
    assert.equal(email.text, 'alice.smith@example.com')

    const card = spans.find((span) => span.label === 'CREDIT_CARD')
    assert.ok(card, 'the card number must be reported')
    assert.match(card.text, /4111 1111 1111 1111/)

    const phone = spans.find((span) => span.label === 'PHONE')
    assert.ok(phone, 'the phone number must be reported')
    assert.equal(phone.text, '+1 415 555 0132')

    const modelOnly = spans.some((span) =>
      ['GIVEN_NAME', 'SURNAME', 'STREET_NAME', 'BUILDING_NUMBER', 'CITY'].includes(span.label),
    )
    assert.ok(modelOnly, 'the model layer must contribute a name or address span, not only deterministic hits')

    await provider.unload(controller.signal)
    await provider.dispose()
  })
})
