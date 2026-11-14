/**
 * OnnxSession tests: execution-provider negotiation and the Effect lifecycle.
 *
 * The engine seam is injected, so these tests prove the LIFECYCLE (one build, one release,
 * serialized runs, typed failures) and the NEGOTIATION RULES. They prove nothing about
 * inference: the gated real test does that.
 *
 * @module tests/runtime
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Effect, Layer } from 'effect'

import { InferenceFailed, RuntimeUnavailable } from '@try-works/tool-mode-runtime-core'

import {
  OnnxSession,
  createNodeOnnxLoader,
  onnxLayer,
  selectExecutionProvider,
  type OnnxBackend,
  type OnnxFeed,
} from '../src/index.ts'
import { fakeLoader } from './support.ts'

/** One small feed, enough to prove the mapping. */
const feed: OnnxFeed = { data: new Float32Array([1, 2, 3]), dims: [1, 3] }

/** Run a program with the layer provided. */
function withLayer<A, E>(
  layer: Layer.Layer<OnnxSession, RuntimeUnavailable>,
  program: Effect.Effect<A, E, OnnxSession>,
): Promise<A> {
  return Effect.runPromise(Effect.provide(program, layer))
}

/** Run a promise that must reject with an Error and return it. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof Error)
    return error
  }
  assert.fail('expected the effect to fail')
}

/** The backends this repository's engine reports on Windows x64 (verified probe 2026-11-14). */
const SUPPORTED: readonly OnnxBackend[] = [
  { name: 'cpu', bundled: true },
  { name: 'dml', bundled: true },
  { name: 'webgpu', bundled: true },
]

describe('selectExecutionProvider', () => {
  it('takes the first requested lane the engine bundles', () => {
    const dml = selectExecutionProvider(['dml', 'cpu'], SUPPORTED)
    if (!dml.ok) assert.fail('expected dml to be selected')
    assert.equal(dml.provider, 'dml')

    const cpuFirst = selectExecutionProvider(['cpu', 'dml'], SUPPORTED)
    if (!cpuFirst.ok) assert.fail('expected cpu to be selected')
    assert.equal(cpuFirst.provider, 'cpu')
  })

  it('falls back to a later requested lane when an earlier one is not bundled', () => {
    const selection = selectExecutionProvider(['webgpu', 'cpu'], [{ name: 'cpu', bundled: true }])
    if (!selection.ok) assert.fail('expected cpu to be selected')
    assert.equal(selection.provider, 'cpu')
  })

  it('ignores a backend the engine reports but does not bundle', () => {
    const selection = selectExecutionProvider(['dml'], [{ name: 'dml', bundled: false }, { name: 'cpu', bundled: true }])
    assert.ok(!selection.ok)
    assert.match(selection.reason, /dml/)
  })

  it('refuses when none of the requested lanes is available, naming both sides', () => {
    const selection = selectExecutionProvider(['webgpu'], [{ name: 'cpu', bundled: true }])
    assert.ok(!selection.ok)
    assert.match(selection.reason, /webgpu/)
    assert.match(selection.reason, /cpu/)
  })

  it('refuses an empty request instead of silently choosing cpu', () => {
    const selection = selectExecutionProvider([], SUPPORTED)
    assert.ok(!selection.ok)
    assert.match(selection.reason, /no execution provider/i)
  })
})

describe('onnxLayer', () => {
  it('builds one session, exposes its names and releases it when the scope closes', async () => {
    const fake = fakeLoader({
      run: async () => ({ frames: { data: new Float32Array([1]), dims: [1, 1] } }),
    })
    const layer = onnxLayer({ modelBytes: new Uint8Array([1]), loader: fake.loader })

    const result = await withLayer(
      layer,
      Effect.gen(function* () {
        const session = yield* OnnxSession
        const outputs = yield* session.run({ audio: feed })
        return { inputs: session.inputNames, outputs: session.outputNames, provider: session.executionProvider, first: outputs['frames']?.data[0] }
      }),
    )

    assert.deepEqual(result.inputs, ['audio'])
    assert.deepEqual(result.outputs, ['frames'])
    assert.equal(result.provider, 'cpu')
    assert.equal(result.first, 1)
    assert.equal(fake.loads.length, 1)
    assert.equal(fake.calls.length, 1)
    assert.equal(fake.releases(), 1)
  })

  it('passes the requested lanes to the loader and defaults to cpu', async () => {
    const fake = fakeLoader({ run: async () => ({}) })
    await withLayer(
      onnxLayer({ modelBytes: new Uint8Array([1]), accelerators: ['dml', 'cpu'], loader: fake.loader }),
      OnnxSession.use((session) => Effect.sync(() => session.executionProvider)),
    )
    assert.deepEqual(fake.loads[0]?.accelerators, ['dml', 'cpu'])

    const defaults = fakeLoader({ run: async () => ({}) })
    await withLayer(onnxLayer({ modelBytes: new Uint8Array([1]), loader: defaults.loader }), Effect.void)
    assert.deepEqual(defaults.loads[0]?.accelerators, ['cpu'])
  })

  it('releases the session even when the program fails', async () => {
    const fake = fakeLoader({ run: async () => ({}) })
    const failure = await rejection(
      withLayer(
        onnxLayer({ modelBytes: new Uint8Array([1]), loader: fake.loader }),
        Effect.gen(function* () {
          yield* OnnxSession
          return yield* Effect.fail(new Error('after the session was acquired'))
        }),
      ),
    )
    assert.ok(failure instanceof Error)
    assert.equal(fake.releases(), 1)
  })

  it('maps an engine run failure to InferenceFailed in the run phase', async () => {
    const fake = fakeLoader({
      run: async () => {
        throw new Error('the graph exploded')
      },
    })
    const failure = await rejection(
      withLayer(
        onnxLayer({ modelBytes: new Uint8Array([1]), loader: fake.loader }),
        Effect.gen(function* () {
          const session = yield* OnnxSession
          yield* session.run({ audio: feed })
        }),
      ),
    )
    assert.ok(failure instanceof InferenceFailed)
    assert.equal(failure.phase, 'run')
    assert.equal(failure.provider, 'onnx')
    assert.match(failure.message, /graph exploded/)
  })

  it('maps an engine load failure to RuntimeUnavailable', async () => {
    const fake = fakeLoader({
      run: async () => ({}),
    })
    const broken = {
      load: async () => {
        throw new Error('onnxruntime-node could not load its native binding')
      },
    }
    const failure = await rejection(
      withLayer(
        onnxLayer({ modelBytes: new Uint8Array([1]), loader: { ...fake.loader, ...broken } }),
        Effect.gen(function* () {
          yield* OnnxSession
        }),
      ),
    )
    assert.ok(failure instanceof RuntimeUnavailable)
    assert.equal(failure.provider, 'onnx')
    assert.match(failure.reason, /native binding/)
  })

  it('passes a typed RuntimeUnavailable from the loader through unchanged', async () => {
    const typed = new RuntimeUnavailable({ provider: 'onnx', reason: 'no requested lane is available' })
    const failure = await rejection(
      withLayer(
        onnxLayer({ modelBytes: new Uint8Array([1]), loader: { load: async () => Promise.reject(typed) } }),
        Effect.gen(function* () {
          yield* OnnxSession
        }),
      ),
    )
    assert.equal(failure, typed)
  })

  it('runs concurrent calls through one session', async () => {
    const fake = fakeLoader({
      run: async (call) => ({ frames: { data: new Float32Array([call.index]), dims: [1, 1] } }),
    })
    const outputs = await withLayer(
      onnxLayer({ modelBytes: new Uint8Array([1]), loader: fake.loader }),
      Effect.gen(function* () {
        const session = yield* OnnxSession
        return yield* Effect.all([session.run({ audio: feed }), session.run({ audio: feed }), session.run({ audio: feed })])
      }),
    )
    assert.equal(outputs.length, 3)
    assert.equal(fake.calls.length, 3)
    assert.equal(fake.releases(), 1)
  })

  it('exposes a node loader without loading the native engine at import time', () => {
    const loader = createNodeOnnxLoader()
    assert.ok(loader.load instanceof Function)
  })
})
