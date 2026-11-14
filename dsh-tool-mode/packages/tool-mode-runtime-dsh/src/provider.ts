/**
 * `createRuntimeProvider` — the one bridge between the Effect-based runtime and the
 * Promise-based extension SDK (PLAN.md § runtime-dsh).
 *
 * THE CONTRACT IN ONE SENTENCE: the SDK hands us verified assets and an `AbortSignal` and
 * expects plain Promises and plain JSON; the runtime hands us `Layer`s and `Effect`s. This
 * module owns that mismatch and nothing else — it contains no model, no runtime and no host
 * code, so every model package reuses it unchanged.
 *
 * THREE RULES THAT ARE LOAD-BEARING (each has a test):
 *
 * 1. `ManagedRuntime.make` is LAZY. A layer that builds but fails would otherwise look like a
 *    successful load and fail at the first call. `load()` therefore forces construction with
 *    `runPromise(Effect.void)` and turns a failure into `readiness: "failed"` plus a thrown
 *    error, so a broken deployment is reported at load time, never as a confusing empty result.
 * 2. `invoke()` re-encodes the provider's result through `Schema.encodeEffect`, so the value
 *    that crosses into host territory is the wire form and a malformed result is rejected here
 *    rather than trusted downstream.
 * 3. `unload`/`dispose` are idempotent and actually close the layer scope (releasing ONNX or
 *    WASM memory) instead of dropping a reference and hoping the GC notices.
 *
 * The caller's `AbortSignal` is forwarded into every `runPromise`, including the load force, so
 * cancelling a request cancels the Effect fiber rather than only rejecting the Promise.
 *
 * @module @try-works/tool-mode-runtime-dsh
 */

import { Effect, Layer, ManagedRuntime, Option, Schema } from 'effect'

import {
  type InvalidInput,
  RuntimeProvider,
  RuntimeRequest as RuntimeRequestSchema,
  RuntimeResult as RuntimeResultSchema,
  type RuntimeUnavailable,
} from '@try-works/tool-mode-runtime-core'
import type { InvocationContextV1, JsonObject, ModelProviderV1, PreparedAssetMapV1, ProviderInspectionV1 } from '@try-works/tool-mode-extension-sdk'

/** The request the runtime consumes, derived from the contract's schema so it cannot drift. */
type RuntimeRequest = typeof RuntimeRequestSchema['Type']

/**
 * The Effect-side contract a model package supplies.
 *
 * `layer` is a FUNCTION of the verified assets, not a layer: the same provider must be able to
 * serve two deployments of the same model with different prepared asset sets, and the assets only
 * exist once the host has verified them. Its error type carries the ways a runtime can be
 * unavailable (a missing wasm, a refused second `loadLiteRt`), and it must have no remaining
 * requirements — everything it needs is inside the assets.
 */
export interface ProviderSpec {
  /** The deployment this adapter serves; reported in failures. */
  readonly modelId: string
  /** The runtime's own identity, e.g. `litert`; reported in failures and inspections. */
  readonly providerId: string
  /** Build the provider from the host-verified assets. Must have NO remaining requirements. */
  readonly layer: (assets: Readonly<PreparedAssetMapV1>) => Layer.Layer<RuntimeProvider, RuntimeUnavailable, never>
  /** Map the tool's JSON input onto a validated request; fail with `InvalidInput` to refuse it. */
  readonly request: (input: Readonly<JsonObject>) => Effect.Effect<RuntimeRequest, InvalidInput>
}

/** One live runtime, or the reason there is none. */
type State =
  | { readonly _tag: 'cold' }
  | { readonly _tag: 'ready'; readonly runtime: ManagedRuntime.ManagedRuntime<RuntimeProvider, RuntimeUnavailable> }
  | { readonly _tag: 'failed'; readonly reason: string }
  | { readonly _tag: 'disposed' }

/**
 * The failure facts worth reporting, parsed rather than sniffed.
 *
 * A `Schema.TaggedError` IS an `Error` but its `.message` is EMPTY: the facts live in typed
 * fields. Rendering only `.message` would lose the very reason a `readiness: "failed"` report
 * exists to carry, so a failed value is decoded into these fields first.
 */
const FailureFields = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
})
const decodeFailureFields = Schema.decodeUnknownOption(FailureFields)
const decodeText = Schema.decodeUnknownOption(Schema.String)

/** Human-readable rendering of an arbitrary thrown or failed value. */
function messageOf(cause: unknown): string {
  const fields = decodeFailureFields(cause)
  if (Option.isSome(fields)) {
    const { _tag, message, reason } = fields.value
    if (reason !== undefined && reason !== '') return _tag === undefined ? reason : `${_tag}: ${reason}`
    if (message !== undefined && message !== '') return message
  }
  const text = decodeText(cause)
  return Option.isSome(text) ? text.value : String(cause)
}

/** The wire form of a result, as produced by `Schema.encodeEffect`. */
type EncodedRuntimeResult = typeof RuntimeResultSchema['Encoded']

/**
 * The SDK boundary takes `JsonObject`; a schema-encoded value is already plain JSON, so this
 * only satisfies the index-signature type rather than changing the data.
 */
function toJsonObject(value: EncodedRuntimeResult): JsonObject {
  // SAFETY: the argument is a Schema-encoded value (primitives, arrays and plain objects only),
  // so a JSON round-trip is lossless and the assertion only adds the index signature.
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

/**
 * Turn an Effect-based `RuntimeProvider` spec into the SDK's `ModelProviderV1`.
 *
 * @param spec - the deployment's model id, provider id, layer factory and request mapper.
 * @returns a provider whose `load`/`invoke`/`unload`/`dispose` obey the SDK lifecycle.
 */
export function createRuntimeProvider(spec: ProviderSpec): ModelProviderV1 {
  let state: State = { _tag: 'cold' }

  const inspect = async (signal: AbortSignal): Promise<ProviderInspectionV1> => {
    // The SDK requires every entry point to observe cancellation, including a read.
    if (signal.aborted) throw new Error(`the "${spec.providerId}" inspection was aborted before it started`)
    switch (state._tag) {
      case 'disposed':
        return { readiness: 'unavailable', features: [], missing: [], reason: 'the provider has been disposed' }
      case 'failed':
        return { readiness: 'failed', features: [], missing: [], reason: state.reason }
      case 'cold':
        return {
          readiness: 'prepared-cold',
          features: [],
          missing: [],
          reason: `${spec.providerId} has not been loaded yet; load() must run before the first call`,
        }
      case 'ready': {
        const found = await state.runtime.runPromise(RuntimeProvider.use((provider) => provider.inspect), { signal })
        const inspection: ProviderInspectionV1 = {
          readiness: found.readiness,
          features: found.features,
          missing: found.missing,
        }
        return found.reason === undefined ? inspection : { ...inspection, reason: found.reason }
      }
    }
  }

  const load = async (request: { readonly assets: Readonly<PreparedAssetMapV1>; readonly signal: AbortSignal }): Promise<void> => {
    if (request.signal.aborted) throw new Error(`the "${spec.providerId}" load was aborted before it started`)
    if (state._tag === 'disposed') throw new Error('the provider has been disposed')
    if (state._tag === 'ready') return

    try {
      const candidate = ManagedRuntime.make(spec.layer(request.assets))
      try {
        // Two distinct steps, both required. Yielding the service forces the LAZY runtime into
        // existence (a broken layer would otherwise look loaded); calling the provider's own
        // `load` then lets it acquire what only it knows how to acquire from the assets.
        const program = Effect.gen(function*() {
          const provider = yield* RuntimeProvider
          yield* provider.load(request.assets)
        })
        await candidate.runPromise(program, { signal: request.signal })
      } catch (cause) {
        await candidate.dispose().catch(() => undefined)
        throw cause
      }
      state = { _tag: 'ready', runtime: candidate }
    } catch (cause) {
      const reason = messageOf(cause)
      state = { _tag: 'failed', reason }
      throw new Error(`the "${spec.providerId}" runtime failed to load: ${reason}`, { cause })
    }
  }

  const invoke = async (request: {
    readonly implementationId: string
    readonly input: Readonly<JsonObject>
    readonly context: InvocationContextV1
  }): Promise<JsonObject> => {
    // Explicit pre-flight check: Effect interrupts a running fiber on abort, but an effect that
    // finishes first would otherwise complete on an already-cancelled call.
    if (request.context.signal.aborted) throw new Error(`the "${spec.providerId}" invocation was aborted before it started`)
    switch (state._tag) {
      case 'disposed':
        throw new Error('the provider has been disposed')
      case 'failed':
        throw new Error(`the "${spec.providerId}" runtime is not loaded: ${state.reason}`)
      case 'cold':
        throw new Error(`the "${spec.providerId}" runtime is not loaded: load() must be called before invoke()`)
      case 'ready': {
        const runtime = state.runtime
        const program = Effect.gen(function*() {
          const mapped = yield* spec.request(request.input)
          const provider = yield* RuntimeProvider
          const result = yield* provider.invoke(mapped)
          return yield* Schema.encodeEffect(RuntimeResultSchema)(result)
        })
        return toJsonObject(await runtime.runPromise(program, { signal: request.context.signal }))
      }
    }
  }

  const unload = async (_signal: AbortSignal): Promise<void> => {
    if (state._tag !== 'ready') return
    const runtime = state.runtime
    state = { _tag: 'cold' }
    try {
      await runtime.runPromise(RuntimeProvider.use((provider) => provider.unload))
    } catch {
      // A provider that fails to unload is still torn down below; the scope is the real owner.
    }
    await runtime.dispose()
  }

  const dispose = async (): Promise<void> => {
    if (state._tag === 'disposed') return
    const runtime = state._tag === 'ready' ? state.runtime : undefined
    state = { _tag: 'disposed' }
    if (runtime !== undefined) await runtime.dispose()
  }

  return { inspect, load, invoke, unload, dispose }
}
