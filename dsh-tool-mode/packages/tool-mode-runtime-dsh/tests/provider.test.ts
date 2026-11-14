/**
 * Adapter contract tests for `createRuntimeProvider` (Phase 1, PLAN.md § runtime-dsh).
 *
 * WHAT THESE TESTS PROVE: the adapter drives a runtime provider's LIFECYCLE correctly across the
 * Promise/`ModelProviderV1` boundary — that `load()` forces a LAZY `ManagedRuntime` into
 * existence, that a failed load is reported as `failed` with a reason instead of a silent cold
 * state, that `invoke()` runs the spec's request mapper and re-encodes the result through Schema,
 * that the caller's `AbortSignal` reaches `runPromise`, and that `unload`/`dispose` release the
 * layer's scope and are idempotent.
 *
 * WHAT THEY DO NOT PROVE: anything about model quality. Every provider here is a deterministic
 * fake; no model and no inference runtime ran.
 *
 * Requirement links: PLAN.md § runtime-dsh (adapter rules, spike-verified), EXT-17, EXT-18.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Effect, Option, Schema } from 'effect'

import { InvalidInput, RuntimeResult as RuntimeResultSchema, RuntimeUnavailable } from '@try-works/tool-mode-runtime-core'
import type { InvocationContextV1, JsonObject, PreparedAssetMapV1 } from '@try-works/tool-mode-extension-sdk'

import { createRuntimeProvider, type ProviderSpec } from '../src/index.ts'
import { fakeProvider, fakeResult } from './fake-provider.ts'

type RuntimeResult = typeof RuntimeResultSchema['Type']

/** Verified-asset handle without touching the filesystem. */
function assets(ids: readonly string[]): PreparedAssetMapV1 {
  return {
    assetIds: ids,
    get: (assetId) => (ids.includes(assetId) ? { path: `/prepared/${assetId}`, digest: `sha256:${assetId}` } : undefined),
  }
}

/** A host-shaped invocation context. */
function invocation(signal: AbortSignal = new AbortController().signal): InvocationContextV1 {
  return {
    invocationId: 'inv-1',
    signal,
    limits: { maxInputBytes: 1_024, maxAudioSeconds: 0, maxResultBytes: 4_096 },
    resolvePath: (candidate) => candidate,
  }
}

const MODEL = { id: 'redact', version: '1.0.0', digest: 'sha256:model' } as const

/** The tool input shape a real provider spec would declare. */
const ToolInput = Schema.Struct({ text: Schema.String })
const decodeToolInput = Schema.decodeUnknownOption(ToolInput)

/** A spec whose request mapper accepts `{ text }` and rejects anything else, as a spec would. */
function specFor(provider: ReturnType<typeof fakeProvider>, overrides: Partial<ProviderSpec> = {}): ProviderSpec {
  return {
    modelId: 'redact',
    providerId: 'fake-runtime',
    layer: () => provider.layer,
    request: (input: Readonly<JsonObject>) => {
      const parsed = decodeToolInput(input)
      return Option.isSome(parsed)
        ? Effect.succeed({
            model: MODEL,
            input: { text: parsed.value.text },
            limits: { maxInputBytes: 1_024, timeoutMs: 1_000 },
          })
        : Effect.fail(new InvalidInput({ field: 'text', message: 'a string "text" is required' }))
    },
    ...overrides,
  }
}

describe('createRuntimeProvider — readiness and load', () => {
  it('reports prepared-cold before load and does not build the layer', async () => {
    const provider = fakeProvider()
    const model = createRuntimeProvider(specFor(provider))

    const inspection = await model.inspect(new AbortController().signal)

    assert.equal(inspection.readiness, 'prepared-cold')
    assert.deepEqual(inspection.missing, [])
    assert.equal(provider.stats.builds, 0, 'inspect must not construct the runtime')
  })

  it('load() forces the lazy ManagedRuntime and then reports ready with the provider features', async () => {
    const provider = fakeProvider()
    const model = createRuntimeProvider(specFor(provider))

    await model.load({ assets: assets(['model.tflite']), signal: new AbortController().signal })

    assert.equal(provider.stats.builds, 1, 'load must construct the runtime exactly once')
    const inspection = await model.inspect(new AbortController().signal)
    assert.equal(inspection.readiness, 'ready')
    assert.deepEqual(inspection.features, ['redact'])
    assert.equal(provider.stats.inspects, 1, 'ready inspect must ask the service, not answer locally')
  })

  it('reports failed with a reason when the layer fails, and recovers on a later successful load', async () => {
    const broken = fakeProvider({
      load: () => Effect.fail(new RuntimeUnavailable({ provider: 'fake-runtime', reason: 'wasm missing' })),
    })
    const model = createRuntimeProvider(specFor(broken))

    await assert.rejects(
      model.load({ assets: assets(['model.tflite']), signal: new AbortController().signal }),
      /wasm missing/,
    )
    const failed = await model.inspect(new AbortController().signal)
    assert.equal(failed.readiness, 'failed')
    assert.match(failed.reason ?? '', /wasm missing/)

    const healthy = fakeProvider()
    const recovered = createRuntimeProvider(specFor(healthy))
    await recovered.load({ assets: assets(['model.tflite']), signal: new AbortController().signal })
    assert.equal((await recovered.inspect(new AbortController().signal)).readiness, 'ready')
  })

  it('does not build the runtime when the signal is already aborted', async () => {
    const provider = fakeProvider()
    const model = createRuntimeProvider(specFor(provider))
    const controller = new AbortController()
    controller.abort()

    await assert.rejects(model.load({ assets: assets(['model.tflite']), signal: controller.signal }))
    assert.equal(provider.stats.builds, 0)
  })
})

describe('createRuntimeProvider — invoke', () => {
  it('refuses to invoke before load instead of loading implicitly', async () => {
    const provider = fakeProvider()
    const model = createRuntimeProvider(specFor(provider))

    await assert.rejects(model.invoke({ implementationId: 'redact', input: { text: 'Jane' }, context: invocation() }))
    assert.equal(provider.stats.builds, 0, "invoke must not load the model behind the host's back")
  })

  it('runs the spec request mapper, the provider invoke, and returns the Schema-encoded result', async () => {
    const provider = fakeProvider()
    const model = createRuntimeProvider(specFor(provider))
    await model.load({ assets: assets(['model.tflite']), signal: new AbortController().signal })

    const payload = await model.invoke({ implementationId: 'redact', input: { text: 'Jane Doe' }, context: invocation() })

    assert.deepEqual(payload, fakeResult)
    assert.equal(provider.stats.requests.length, 1)
    assert.deepEqual(provider.stats.requests[0], {
      model: MODEL,
      input: { text: 'Jane Doe' },
      limits: { maxInputBytes: 1_024, timeoutMs: 1_000 },
    })
  })

  it('surfaces a request-mapping failure as a rejection naming the field', async () => {
    const provider = fakeProvider()
    const model = createRuntimeProvider(specFor(provider))
    await model.load({ assets: assets(['model.tflite']), signal: new AbortController().signal })

    await assert.rejects(
      model.invoke({ implementationId: 'redact', input: {}, context: invocation() }),
      /text/,
    )
    assert.equal(provider.stats.requests.length, 0, 'an invalid input must never reach the provider')
  })

  it('rejects an already-aborted invocation before it reaches the provider', async () => {
    const provider = fakeProvider()
    const model = createRuntimeProvider(specFor(provider))
    await model.load({ assets: assets(['model.tflite']), signal: new AbortController().signal })
    const controller = new AbortController()
    controller.abort()

    await assert.rejects(
      model.invoke({ implementationId: 'redact', input: { text: 'Jane' }, context: invocation(controller.signal) }),
    )
    assert.equal(provider.stats.requests.length, 0, 'a cancelled call must not reach the provider')
  })

  it('forwards the invocation AbortSignal so aborting mid-flight interrupts the fiber', async () => {
    // A slow provider is REQUIRED here: Effect only interrupts a running fiber, so an effect that
    // finishes before the abort lands would pass without proving the signal is forwarded at all.
    const provider = fakeProvider({ invoke: () => Effect.sleep('30 seconds').pipe(Effect.map(() => fakeResult)) })
    const model = createRuntimeProvider(specFor(provider))
    await model.load({ assets: assets(['model.tflite']), signal: new AbortController().signal })
    const controller = new AbortController()

    const call = model.invoke({ implementationId: 'redact', input: { text: 'Jane' }, context: invocation(controller.signal) })
    setTimeout(() => controller.abort(), 25)

    await assert.rejects(call, 'aborting mid-flight must reject the call')
  })

  it('rejects a provider result that the Schema cannot encode', async () => {
    // SAFETY: JSON.parse returns any; the point of this test is a structurally invalid payload.
    const invalid = JSON.parse('{"spans":[]}') as RuntimeResult
    const provider = fakeProvider({ invoke: () => Effect.succeed(invalid) })
    const model = createRuntimeProvider(specFor(provider))
    await model.load({ assets: assets(['model.tflite']), signal: new AbortController().signal })

    await assert.rejects(
      model.invoke({ implementationId: 'redact', input: { text: 'Jane' }, context: invocation() }),
      'an incomplete RuntimeResult must not be returned as success',
    )
  })
})

describe('createRuntimeProvider — unload and dispose', () => {
  it('unload releases the scope, returns to prepared-cold, and is idempotent', async () => {
    const provider = fakeProvider()
    const model = createRuntimeProvider(specFor(provider))
    await model.load({ assets: assets(['model.tflite']), signal: new AbortController().signal })

    await model.unload(new AbortController().signal)
    assert.equal(provider.stats.releases, 1, 'unload must close the layer scope')
    assert.equal((await model.inspect(new AbortController().signal)).readiness, 'prepared-cold')

    await model.unload(new AbortController().signal)
    assert.equal(provider.stats.releases, 1, 'a second unload must not release twice')

    await model.load({ assets: assets(['model.tflite']), signal: new AbortController().signal })
    assert.equal(provider.stats.builds, 2, 'the provider stays usable after unload')
  })

  it('dispose is idempotent and makes the provider unusable', async () => {
    const provider = fakeProvider()
    const model = createRuntimeProvider(specFor(provider))
    await model.load({ assets: assets(['model.tflite']), signal: new AbortController().signal })

    await model.dispose()
    assert.equal(provider.stats.releases, 1)
    await model.dispose()
    assert.equal(provider.stats.releases, 1, 'a second dispose must not release twice')

    assert.equal((await model.inspect(new AbortController().signal)).readiness, 'unavailable')
    await assert.rejects(model.invoke({ implementationId: 'redact', input: { text: 'Jane' }, context: invocation() }))
    await assert.rejects(model.load({ assets: assets(['model.tflite']), signal: new AbortController().signal }))
  })
})
