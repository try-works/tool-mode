/**
 * Pipeline unit tests: model decoding, deterministic union, label policy, truncation and
 * the typed failures. The session and tokenizer are fakes; no model runs.
 *
 * @module tests/pipeline
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Effect } from 'effect'

import { DEFAULT_REDACT_POLICY, runRedactPipeline, type PipelineDeps } from '../src/pipeline.ts'
import { failureFields, failureOf, logits, sessionFor, tokenizerFor } from './support.ts'

const LABELS = [
  'O',
  'B-GIVEN_NAME', 'I-GIVEN_NAME', 'E-GIVEN_NAME', 'S-GIVEN_NAME',
  'B-ORG', 'I-ORG', 'E-ORG', 'S-ORG',
] as const

const ZERO = { start: 0, end: 0 }

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    tokenizer: tokenizerFor({ ids: [0, 2], mask: [1, 1], offsets: [ZERO, ZERO] }),
    session: sessionFor(['input_ids', 'attention_mask'], () => ({ logits: new Float32Array(256 * LABELS.length) })),
    labels: LABELS,
    padId: 1,
    policy: DEFAULT_REDACT_POLICY,
    ...overrides,
  }
}

describe('runRedactPipeline', () => {
  it('decodes a model span against the original UTF-16 offsets', async () => {
    const result = await runWith(
      deps({
        tokenizer: tokenizerFor({
          ids: [0, 101, 102, 2],
          mask: [1, 1, 1, 1],
          offsets: [ZERO, { start: 0, end: 4 }, { start: 5, end: 8 }, ZERO],
        }),
        session: sessionFor(['input_ids', 'attention_mask'], () => ({
          logits: logits(LABELS, 256, [
            { row: 1, label: 'B-GIVEN_NAME' },
            { row: 2, label: 'E-GIVEN_NAME' },
          ]),
        })),
      }),
      'Jane Doe',
    )
    assert.equal(result.spans.length, 1)
    assert.deepEqual(
      { start: result.spans[0]?.start, end: result.spans[0]?.end, label: result.spans[0]?.label, text: result.spans[0]?.text },
      { start: 0, end: 8, label: 'GIVEN_NAME', text: 'Jane Doe' },
    )
    assert.ok((result.spans[0]?.score ?? 0) > 0.9)
    assert.equal(result.coverage.complete, true)
  })

  it('unions deterministic PII with the model layer and resolves overlaps', async () => {
    const text = 'Email alice@example.com'
    const result = await runWith(
      deps({
        tokenizer: tokenizerFor({ ids: [0, 2], mask: [1, 1], offsets: [ZERO, ZERO] }),
      }),
      text,
    )
    const email = result.spans.find((span) => span.label === 'EMAIL')
    assert.ok(email)
    assert.equal(email.text, 'alice@example.com')
    assert.equal(text.slice(email.start, email.end), email.text)
  })

  it('drops model labels the deployment disables', async () => {
    const result = await runWith(
      deps({
        tokenizer: tokenizerFor({
          ids: [0, 201, 202, 2],
          mask: [1, 1, 1, 1],
          offsets: [ZERO, { start: 0, end: 4 }, { start: 5, end: 8 }, ZERO],
        }),
        session: sessionFor(['input_ids', 'attention_mask'], () => ({
          logits: logits(LABELS, 256, [
            { row: 1, label: 'B-ORG' },
            { row: 2, label: 'E-ORG' },
          ]),
        })),
      }),
      'Acme Ltd',
    )
    assert.deepEqual(result.spans, [])
  })

  it('caps the windows it processes and reports the truncation honestly', async () => {
    const content = 600
    const ids = [0, ...Array.from({ length: content }, (_, index) => 1000 + index), 2]
    const mask = ids.map(() => 1)
    const offsets = ids.map((_, index) => ({ start: index * 2, end: index * 2 + 2 }))
    const result = await runWith(
      deps({ tokenizer: tokenizerFor({ ids, mask, offsets }) }),
      'a'.repeat(ids.length * 2),
    )
    assert.equal(result.coverage.complete, false)
    assert.equal(result.coverage.totalUnits, 602)
    assert.equal(result.coverage.processedUnits, 448)
    assert.match(result.coverage.reason ?? '', /4 of 7 windows/)
  })

  it('refuses empty text as invalid input', async () => {
    const error = failureFields(await failureOf(runRedactPipeline(deps(), '')))
    assert.equal(error._tag, 'InvalidInput')
  })

  it('refuses an unexpected model input set', async () => {
    const error = failureFields(
      await failureOf(
        runRedactPipeline(
          deps({ session: sessionFor(['ids', 'mask'], () => ({ logits: new Float32Array(256 * LABELS.length) })) }),
          'Jane Doe',
        ),
      ),
    )
    assert.equal(error._tag, 'InferenceFailed')
    assert.equal(error.phase, 'run')
    assert.match(error.message ?? '', /input_ids/)
  })

  it('refuses logits whose geometry does not match the model contract', async () => {
    const error = failureFields(
      await failureOf(
        runRedactPipeline(
          deps({ session: sessionFor(['input_ids', 'attention_mask'], () => ({ logits: new Float32Array(9) })) }),
          'Jane Doe',
        ),
      ),
    )
    assert.equal(error._tag, 'InferenceFailed')
    assert.equal(error.phase, 'post')
    assert.match(error.message ?? '', /logits output has 9 values/)
  })
})

/** Run the pipeline and return its result. */
async function runWith(dependencies: PipelineDeps, text: string) {
  return Effect.runPromise(runRedactPipeline(dependencies, text))
}
