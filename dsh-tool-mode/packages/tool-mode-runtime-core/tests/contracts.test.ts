/**
 * Contract tests for the runtime boundary schemas.
 *
 * The schemas are the validation boundary of the whole runtime, so every test
 * here is about what the boundary ACCEPTS and what it REFUSES. Nothing about a
 * model is asserted: no model runs.
 *
 * @module tests/contracts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Effect, Schema } from 'effect'

import {
  Coverage,
  Limits,
  ModelFormat,
  ModelRef,
  RuntimeInput,
  RuntimeRequest,
  RuntimeResult,
  Span,
  type RuntimeResult as RuntimeResultType,
} from '../src/contracts.ts'
import { failureOf } from './support.ts'

/** Run a decode effect that needs no services. */
function runDecode<A>(effect: Effect.Effect<A, Schema.SchemaError, never>): Promise<A> {
  return Effect.runPromise(effect)
}

describe('contracts', () => {
  describe('ModelFormat', () => {
    it('accepts only the three formats the runtime can execute', async () => {
      for (const format of ['onnx', 'tflite', 'gguf'] as const) {
        assert.equal(await runDecode(Schema.decodeUnknownEffect(ModelFormat)(format)), format)
      }
    })

    it('refuses a format no runtime executes', async () => {
      const error = await failureOf(runDecode(Schema.decodeUnknownEffect(ModelFormat)('safetensors')))
      assert.ok(error)
    })
  })

  describe('ModelRef', () => {
    it('accepts a pinned reference', async () => {
      const ref = { id: 'redact', version: '1.0.0', digest: 'sha256:abc' }
      assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(ModelRef)(ref)), ref)
    })

    it('refuses an empty model id or version', async () => {
      assert.ok(await failureOf(runDecode(Schema.decodeUnknownEffect(ModelRef)({ id: '', version: '1.0.0', digest: 'd' }))))
      assert.ok(await failureOf(runDecode(Schema.decodeUnknownEffect(ModelRef)({ id: 'redact', version: '', digest: 'd' }))))
    })

    it('accepts an empty digest string — a digest is optional evidence, not a length contract', async () => {
      assert.deepEqual(
        await runDecode(Schema.decodeUnknownEffect(ModelRef)({ id: 'redact', version: '1.0.0', digest: '' })),
        { id: 'redact', version: '1.0.0', digest: '' },
      )
    })
  })

  describe('RuntimeInput', () => {
    it('accepts an empty input: which modalities are required is the business of the model', async () => {
      assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(RuntimeInput)({})), {})
    })

    it('accepts each supported modality', async () => {
      assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(RuntimeInput)({ text: 'hello' })), { text: 'hello' })
      assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(RuntimeInput)({ audioPath: 'C:/a.wav' })), { audioPath: 'C:/a.wav' })
      assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(RuntimeInput)({ imagePath: 'C:/a.png' })), { imagePath: 'C:/a.png' })
    })

    it('refuses a non-string modality', async () => {
      assert.ok(await failureOf(runDecode(Schema.decodeUnknownEffect(RuntimeInput)({ text: 42 }))))
    })
  })

  describe('Limits', () => {
    it('accepts integer limits', async () => {
      assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(Limits)({ maxInputBytes: 1024, timeoutMs: 500 })), {
        maxInputBytes: 1024,
        timeoutMs: 500,
      })
    })

    it('refuses fractional limits, so a timeout cannot be sub-millisecond by accident', async () => {
      assert.ok(await failureOf(runDecode(Schema.decodeUnknownEffect(Limits)({ maxInputBytes: 1024, timeoutMs: 0.5 }))))
      assert.ok(await failureOf(runDecode(Schema.decodeUnknownEffect(Limits)({ maxInputBytes: 1.5, timeoutMs: 500 }))))
    })

    it('requires both limits', async () => {
      assert.ok(await failureOf(runDecode(Schema.decodeUnknownEffect(Limits)({ timeoutMs: 500 }))))
    })
  })

  describe('RuntimeRequest', () => {
    it('round-trips a complete request through decode and encode', async () => {
      const request = {
        model: { id: 'redact', version: '1.0.0', digest: 'sha256:abc' },
        input: { text: 'Call 555-0100.' },
        limits: { maxInputBytes: 65_536, timeoutMs: 5_000 },
      }
      const requestSchema = RuntimeRequest
      const decoded = await Effect.runPromise(Schema.decodeUnknownEffect(requestSchema)(request))
      assert.deepEqual(decoded, request)
      assert.deepEqual(await Effect.runPromise(Schema.encodeEffect(requestSchema)(decoded)), request)
    })

    it('refuses a request whose nested model reference is invalid', async () => {
      const error = await failureOf(
        runDecode(Schema.decodeUnknownEffect(RuntimeRequest)({
          model: { id: '', version: '1.0.0', digest: 'sha256:abc' },
          input: { text: 'x' },
          limits: { maxInputBytes: 1, timeoutMs: 1 },
        })),
      )
      assert.ok(error)
    })
  })

  describe('Span and Coverage', () => {
    it('accepts a span with a non-empty label and any finite score', async () => {
      const span = { start: 5, end: 13, label: 'PHONE', text: '555-0100', score: 0.91 }
      assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(Span)(span)), span)
    })

    it('refuses a span with an empty label', async () => {
      assert.ok(await failureOf(runDecode(Schema.decodeUnknownEffect(Span)({ start: 0, end: 1, label: '', text: 'x', score: 1 }))))
    })

    it('refuses non-integer offsets', async () => {
      assert.ok(await failureOf(runDecode(Schema.decodeUnknownEffect(Span)({ start: 0.5, end: 1, label: 'X', text: 'x', score: 1 }))))
    })

    it('reports truncation honestly: incomplete coverage must carry a reason', async () => {
      const truncated = { complete: false, processedUnits: 4, totalUnits: 9, reason: 'window cap' }
      assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(Coverage)(truncated)), truncated)
      const complete = { complete: true, processedUnits: 9, totalUnits: 9 }
      assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(Coverage)(complete)), complete)
    })
  })

  describe('RuntimeResult', () => {
    it('round-trips a result with spans and coverage', async () => {
      const result = {
        spans: [
          { start: 0, end: 4, label: 'PERSON', text: 'Jane', score: 0.9 },
          { start: 10, end: 18, label: 'PHONE', text: '555-0100', score: 0.75 },
        ],
        coverage: { complete: true, processedUnits: 1, totalUnits: 1 },
      }
      const decoded = await Effect.runPromise(Schema.decodeUnknownEffect(RuntimeResult)(result))
      assert.deepEqual(decoded, result)
      assert.deepEqual(await Effect.runPromise(Schema.encodeEffect(RuntimeResult)(decoded)), result)
    })

    it('allows an empty span array — a clean document is a valid result', async () => {
      const result = { spans: [], coverage: { complete: true, processedUnits: 0, totalUnits: 0 } }
      assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(RuntimeResult)(result)), result)
    })

    it('exposes a result type that is assignable to the schema type', () => {
      const result: RuntimeResultType = {
        spans: [],
        coverage: { complete: true, processedUnits: 0, totalUnits: 0 },
      }
      assert.equal(result.spans.length, 0)
    })
  })
})
