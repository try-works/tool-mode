/**
 * Provider-shape tests.
 *
 * A provider is a service whose lifecycle the host drives: inspect before load,
 * load once with the host-verified assets, invoke per request, unload on the way
 * out. These tests use a DETERMINISTIC fake provider, so they prove the shape
 * and the lifecycle wiring — never model behaviour.
 *
 * Release is wired through `Effect.acquireRelease`, which is the pattern every
 * real provider layer must use (Effect 4 has no `Layer.scoped`). The release
 * counter is therefore evidence that providing a provider layer closes its
 * scope instead of leaking the engine.
 *
 * @module tests/provider
 */

/*
 * `RuntimeProviderShape` is the interface name fixed by docs/runtime/PLAN.md,
 * and the fake below implements exactly that contract, so the naming rule is
 * disabled here for the same reason it is disabled in the declaration itself.
 */
/* oxlint-disable anti-slop/no-shape-in-symbol-names */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Effect, Layer } from 'effect'

import {
  InferenceFailed,
  InvalidInput,
  RuntimeProvider,
  RuntimeUnavailable,
  RuntimeResult,
  type Inspection,
  type PreparedAssets,
  type RuntimeProviderShape,
  type RuntimeRequest,
} from '../src/index.ts'
import { failureOf } from './support.ts'

/** The request fixture every invoke test uses. */
const request: RuntimeRequest = {
  model: { id: 'redact', version: '1.0.0', digest: 'sha256:model-digest' },
  input: { text: 'Call 555-0100.' },
  limits: { maxInputBytes: 65_536, timeoutMs: 5_000 },
}

/** The result fixture the fake provider returns. */
const result: RuntimeResult = {
  spans: [{ start: 5, end: 13, label: 'PHONE', text: '555-0100', score: 0.91 }],
  coverage: { complete: true, processedUnits: 1, totalUnits: 1 },
}

/** Host-verified assets, standing in for a prepared asset set. */
const assets: PreparedAssets = {
  assetIds: ['redact.tflite', 'vocab.txt'],
  get: (assetId) =>
    assetId === 'redact.tflite'
      ? { path: 'C:/assets/redact/redact.tflite', digest: 'sha256:model-digest' }
      : undefined,
}

/** A fake provider plus the layer that supplies it. */
interface FakeProvider {
  readonly layer: Layer.Layer<RuntimeProvider, RuntimeUnavailable, never>
  readonly observed: Observed
}

/** Everything the fake provider observed. */
interface Observed {
  builds: number
  releases: number
  inspects: number
  loads: PreparedAssets[]
  requests: RuntimeRequest[]
  unloads: number
}

/** Knobs that make one step fail on demand. */
interface Overrides {
  inspect?: () => Effect.Effect<Inspection>
  load?: (assets: PreparedAssets) => Effect.Effect<void, RuntimeUnavailable>
  invoke?: (request: RuntimeRequest) => Effect.Effect<RuntimeResult, InvalidInput | InferenceFailed>
}

/**
 * A fake provider whose build, release and calls are observable.
 *
 * @param overrides - per-step behaviours; omitted steps succeed
 * @returns the layer and the observation record
 */
function fakeProvider(overrides: Overrides = {}): FakeProvider {
  const observed: Observed = { builds: 0, releases: 0, inspects: 0, loads: [], requests: [], unloads: 0 }

  const providerValue: RuntimeProviderShape = {
    id: 'redact-litert',
    formats: ['tflite'],
    inspect: Effect.suspend(() => {
      observed.inspects += 1
      return (
        overrides.inspect?.() ??
        Effect.succeed<Inspection>({ readiness: 'ready', features: ['redact'], missing: [] })
      )
    }),
    load: (prepared) =>
      Effect.suspend(() => {
        observed.loads.push(prepared)
        return overrides.load?.(prepared) ?? Effect.void
      }),
    invoke: (incoming) =>
      Effect.suspend(() => {
        observed.requests.push(incoming)
        return overrides.invoke?.(incoming) ?? Effect.succeed(result)
      }),
    unload: Effect.suspend(() => {
      observed.unloads += 1
      return Effect.void
    }),
  }

  const layer = Layer.effect(
    RuntimeProvider,
    Effect.acquireRelease(
      Effect.sync(() => {
        observed.builds += 1
        return RuntimeProvider.of(providerValue)
      }),
      () =>
        Effect.sync(() => {
          observed.releases += 1
        }),
    ),
  )

  return { layer, observed }
}

/** Run a program that uses the provider, with the fake layer provided. */
function runWith<A, E>(
  layer: Layer.Layer<RuntimeProvider, RuntimeUnavailable, never>,
  program: Effect.Effect<A, E, RuntimeProvider>,
): Promise<A> {
  return Effect.runPromise(Effect.provide(program, layer))
}

describe('provider', () => {
  it('keeps the documented service key', () => {
    assert.equal(RuntimeProvider.key, 'tool-mode-runtime/Provider')
  })

  it('builds the layer once and releases it when the provided program ends', async () => {
    const { layer, observed } = fakeProvider()
    const providerValue = await runWith(
      layer,
      Effect.gen(function* () {
        return yield* RuntimeProvider
      }),
    )
    assert.equal(providerValue.id, 'redact-litert')
    assert.deepEqual(providerValue.formats, ['tflite'])
    assert.equal(observed.builds, 1)
    assert.equal(observed.releases, 1)
  })

  it('re-evaluates inspect on every run instead of caching it', async () => {
    const { layer, observed } = fakeProvider()
    const program = Effect.gen(function* () {
      const provider = yield* RuntimeProvider
      const first = yield* provider.inspect
      const second = yield* provider.inspect
      return [first, second] as const
    })
    const [first, second] = await runWith(layer, program)
    assert.deepEqual(first, { readiness: 'ready', features: ['redact'], missing: [] })
    assert.deepEqual(second, first)
    assert.equal(observed.inspects, 2)
  })

  it('hands load the host-verified asset set and nothing else', async () => {
    const { layer, observed } = fakeProvider()
    await runWith(
      layer,
      Effect.gen(function* () {
        const provider = yield* RuntimeProvider
        yield* provider.load(assets)
      }),
    )
    assert.equal(observed.loads.length, 1)
    assert.equal(observed.loads[0], assets)
    assert.deepEqual(assets.assetIds, ['redact.tflite', 'vocab.txt'])
    assert.deepEqual(assets.get('redact.tflite'), {
      path: 'C:/assets/redact/redact.tflite',
      digest: 'sha256:model-digest',
    })
    assert.equal(assets.get('missing.bin'), undefined)
  })

  it('surfaces a load failure as RuntimeUnavailable', async () => {
    const { layer } = fakeProvider({
      load: () => Effect.fail(new RuntimeUnavailable({ provider: 'litert', reason: 'engine missing' })),
    })
    const error = await failureOf(
      runWith(
        layer,
        Effect.gen(function* () {
          const provider = yield* RuntimeProvider
          yield* provider.load(assets)
        }),
      ),
    )
    assert.ok(error instanceof RuntimeUnavailable)
    assert.equal(error.provider, 'litert')
    assert.equal(error.reason, 'engine missing')
  })

  it('records the request it was asked to run and returns the runtime result', async () => {
    const { layer, observed } = fakeProvider()
    const returned = await runWith(
      layer,
      Effect.gen(function* () {
        const provider = yield* RuntimeProvider
        return yield* provider.invoke(request)
      }),
    )
    assert.deepEqual(returned, result)
    assert.equal(observed.requests.length, 1)
    assert.deepEqual(observed.requests[0], request)
  })

  it('surfaces an inference failure with its phase', async () => {
    const { layer } = fakeProvider({
      invoke: () =>
        Effect.fail(new InferenceFailed({ provider: 'litert', phase: 'post', message: 'BIOES decode failed' })),
    })
    const error = await failureOf(
      runWith(
        layer,
        Effect.gen(function* () {
          const provider = yield* RuntimeProvider
          return yield* provider.invoke(request)
        }),
      ),
    )
    assert.ok(error instanceof InferenceFailed)
    assert.equal(error.phase, 'post')
    assert.equal(error.message, 'BIOES decode failed')
  })

  it('surfaces an invalid request without pretending it was an inference failure', async () => {
    const { layer } = fakeProvider({
      invoke: () => Effect.fail(new InvalidInput({ field: 'input.text', message: 'empty text' })),
    })
    const error = await failureOf(
      runWith(
        layer,
        Effect.gen(function* () {
          const provider = yield* RuntimeProvider
          return yield* provider.invoke(request)
        }),
      ),
    )
    assert.ok(error instanceof InvalidInput)
    assert.equal(error.field, 'input.text')
  })

  it('runs unload when asked, each time it is yielded', async () => {
    const { layer, observed } = fakeProvider()
    await runWith(
      layer,
      Effect.gen(function* () {
        const provider = yield* RuntimeProvider
        yield* provider.unload
        yield* provider.unload
      }),
    )
    assert.equal(observed.unloads, 2)
    assert.equal(observed.releases, 1)
  })
})
