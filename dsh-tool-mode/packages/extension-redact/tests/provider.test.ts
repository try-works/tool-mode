/**
 * Provider unit tests: the request mapper, the provider shape, and asset wiring failure.
 * No model and no Wasm: the invoke test uses the fake session.
 *
 * @module tests/provider
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Effect } from 'effect'

import type { RuntimeRequest } from '@try-works/tool-mode-runtime-core'

import { DEFAULT_REDACT_POLICY } from '../src/pipeline.ts'
import { REDACT_MODEL, createRedactRuntime, redactLayer, redactRequest } from '../src/provider.ts'
import { failureFields, failureOf, logits, sessionFor, tokenizerFor } from './support.ts'

const LABELS = ['O', 'B-GIVEN_NAME', 'E-GIVEN_NAME'] as const
const ZERO = { start: 0, end: 0 }

/** A validated request for the invoke test. */
const REQUEST: RuntimeRequest = {
  model: REDACT_MODEL,
  input: { text: 'Jane Doe' },
  limits: { maxInputBytes: 1024, timeoutMs: 1_000 },
}

describe('redactRequest', () => {
  it('maps text onto a pinned request', async () => {
    const request = await Effect.runPromise(redactRequest({ text: 'hello' }))
    assert.equal(request.model.id, 'redact')
    assert.equal(request.input.text, 'hello')
    assert.equal(request.limits.maxInputBytes, 1_048_576)
  })

  it('refuses a missing, empty or non-string text', async () => {
    for (const input of [{}, { text: '' }, { text: 7 }]) {
      const error = failureFields(await failureOf(redactRequest(input)))
      assert.equal(error._tag, 'InvalidInput')
    }
  })

  it('refuses text over the byte limit', async () => {
    const error = failureFields(await failureOf(redactRequest({ text: 'a'.repeat(1_048_577) })))
    assert.equal(error._tag, 'InvalidInput')
    assert.match(error.message ?? '', /byte input limit/)
  })
})

describe('createRedactRuntime', () => {
  it('reports ready with its features', async () => {
    const runtime = createRedactRuntime({
      session: sessionFor(['input_ids', 'attention_mask'], () => ({ logits: new Float32Array(256 * LABELS.length) })),
      tokenizer: tokenizerFor({ ids: [0, 2], mask: [1, 1], offsets: [ZERO, ZERO] }),
      labels: LABELS,
      padId: 1,
      policy: DEFAULT_REDACT_POLICY,
    })
    const inspection = await Effect.runPromise(runtime.inspect)
    assert.equal(inspection.readiness, 'ready')
    assert.deepEqual(inspection.features, ['pii-redaction', 'deterministic-pii'])
    assert.equal(runtime.id, 'litert')
    assert.deepEqual(runtime.formats, ['tflite'])
  })

  it('invokes the pipeline through the provider shape', async () => {
    const runtime = createRedactRuntime({
      session: sessionFor(['input_ids', 'attention_mask'], () => ({
        logits: logits(LABELS, 256, [
          { row: 1, label: 'B-GIVEN_NAME' },
          { row: 2, label: 'E-GIVEN_NAME' },
        ]),
      })),
      tokenizer: tokenizerFor({
        ids: [0, 101, 102, 2],
        mask: [1, 1, 1, 1],
        offsets: [ZERO, { start: 0, end: 4 }, { start: 5, end: 8 }, ZERO],
      }),
      labels: LABELS,
      padId: 1,
      policy: DEFAULT_REDACT_POLICY,
    })
    const result = await Effect.runPromise(runtime.invoke(REQUEST))
    assert.equal(result.spans[0]?.label, 'GIVEN_NAME')
    assert.equal(result.spans[0]?.text, 'Jane Doe')
  })

  it('reports a missing verified asset instead of building a partial layer', () => {
    assert.throws(
      () => redactLayer({ assetIds: [], get: () => undefined }),
      (error: unknown) =>
        typeof error === 'object' && error !== null && (error as { _tag?: unknown })._tag === 'RuntimeUnavailable',
    )
  })
})
