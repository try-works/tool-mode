/**
 * Readiness tests.
 *
 * Readiness is what an operator or the control plane reads before anything is
 * loaded, so the states are a closed set and `missing` must say WHAT is
 * missing rather than only that something is.
 *
 * @module tests/readiness
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Effect, Schema } from 'effect'

import { Inspection, Readiness } from '../src/readiness.ts'
import { failureOf } from './support.ts'

/** Run a decode effect that needs no services. */
function runDecode<A>(effect: Effect.Effect<A, Schema.SchemaError, never>): Promise<A> {
  return Effect.runPromise(effect)
}

describe('readiness', () => {
  it('accepts exactly the four documented states', async () => {
    for (const state of ['prepared-cold', 'ready', 'failed', 'needs-preparation'] as const) {
      assert.equal(await runDecode(Schema.decodeUnknownEffect(Readiness)(state)), state)
    }
  })

  it('refuses a state outside the closed set', async () => {
    assert.ok(await failureOf(runDecode(Schema.decodeUnknownEffect(Readiness)('warmed'))))
    assert.ok(await failureOf(runDecode(Schema.decodeUnknownEffect(Readiness)('READY'))))
  })

  it('accepts a ready inspection with features and no missing requirements', async () => {
    const inspection = { readiness: 'ready', features: ['redact', 'windows'], missing: [] }
    assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(Inspection)(inspection)), inspection)
  })

  it('accepts a needs-preparation inspection that names every blocker', async () => {
    const inspection = {
      readiness: 'needs-preparation',
      features: ['redact'],
      missing: [
        { name: 'redact.tflite', reason: 'asset not staged' },
        { name: 'vocab.txt', reason: 'digest mismatch' },
      ],
    }
    assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(Inspection)(inspection)), inspection)
  })

  it('accepts a failed inspection with a reason', async () => {
    const inspection = {
      readiness: 'failed',
      features: [],
      missing: [],
      reason: 'litert engine could not initialise',
    }
    assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(Inspection)(inspection)), inspection)
  })

  it('accepts prepared-cold: assets are present but nothing has been loaded yet', async () => {
    const inspection = { readiness: 'prepared-cold', features: [], missing: [] }
    assert.deepEqual(await runDecode(Schema.decodeUnknownEffect(Inspection)(inspection)), inspection)
  })

  it('requires features and missing to be present, so an unknown state is never inferred', async () => {
    assert.ok(await failureOf(runDecode(Schema.decodeUnknownEffect(Inspection)({ readiness: 'ready', missing: [] }))))
    assert.ok(await failureOf(runDecode(Schema.decodeUnknownEffect(Inspection)({ readiness: 'ready', features: [] }))))
  })

  it('requires every missing entry to name an item and a reason', async () => {
    assert.ok(
      await failureOf(
        runDecode(Schema.decodeUnknownEffect(Inspection)({ readiness: 'needs-preparation', features: [], missing: [{ name: 'vocab.txt' }] })),
      ),
    )
  })

  it('exposes the decoded type, so a producer cannot drift from the schema', () => {
    const inspection: Inspection = { readiness: 'ready', features: ['redact'], missing: [] }
    assert.equal(inspection.readiness, 'ready')
  })
})
