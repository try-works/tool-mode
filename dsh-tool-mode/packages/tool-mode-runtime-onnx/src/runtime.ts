/**
 * `OnnxSession`: the Effect service a model provider depends on (PHASE3).
 *
 * Contract: the layer builds ONE onnxruntime-node session and acquires it in the layer
 * scope; `run` is serialized with `Semaphore.make(1)` so a provider runs one inference at
 * a time. A failed load fails the layer with `RuntimeUnavailable`; a failed run fails with
 * `InferenceFailed` (`run`). The layer has no way to fail a RELEASE, because a teardown
 * that throws would mask the reason the scope is closing.
 *
 * EXECUTION-PROVIDER NEGOTIATION. A recipe declares the lanes it may use, in preference
 * order. This module asks the installed engine what it actually bundles
 * (`listSupportedBackends()`; verified on Windows x64 with onnxruntime-node 1.30.0 to
 * report cpu, dml and webgpu, all bundled) and takes the FIRST declared lane that is
 * available. It does not silently fall back to a lane the recipe did not declare: a
 * deployment that asked for a GPU lane and got CPU without being told would be a
 * performance claim nobody can audit.
 *
 * TESTS: the unit suite injects a fake `OnnxSessionLoader`, so it proves the lifecycle,
 * the negotiation rules and the error mapping — not inference.
 *
 * @module runtime
 */

/*
 * This module IS the boundary between the native engine and the runtime: the engine hands
 * back values typed as `OnnxValue`/`unknown`, and turning those into `OnnxTensor` is a
 * run-time proof about representations, not a typed caller. The generic anti-slop rules
 * assume an already-typed value, so they are disabled for this boundary only; every value
 * is validated by kind before it is exposed.
 */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof */

import { Context, Effect, Layer, Semaphore } from 'effect'

import type * as OrtModule from 'onnxruntime-node'

import { InferenceFailed, RuntimeUnavailable, describeCause } from './errors.ts'

const PROVIDER = 'onnx'

/** A feed tensor: float32 or int32 data and its dims. */
export interface OnnxFeed {
  readonly data: Float32Array | Int32Array
  readonly dims: readonly number[]
}

/** The output data kinds a session exposes. */
export type OnnxOutputData = Float32Array | Int32Array | BigInt64Array

/** One output tensor. */
export interface OnnxTensor {
  readonly data: OnnxOutputData
  readonly dims: readonly number[]
}

/** The compute lanes a recipe may request. */
export type OnnxExecutionProvider = 'cpu' | 'dml' | 'webgpu'

/** One backend the engine reports. */
export interface OnnxBackend {
  readonly name: string
  readonly bundled: boolean
}

/** One loaded engine session. This is the unit-test seam's product. */
export interface OnnxLoadedSession {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  readonly executionProvider: string
  readonly run: (feeds: Readonly<Record<string, OnnxFeed>>) => Promise<Readonly<Record<string, OnnxTensor>>>
  readonly release: () => Promise<void>
}

/** What one load needs. */
export interface OnnxLoadOptions {
  readonly modelBytes: Uint8Array
  /** The lanes the recipe declares, in preference order. */
  readonly accelerators: readonly OnnxExecutionProvider[]
  readonly intraOpNumThreads?: number
}

/** The engine seam: onnxruntime-node in production, a fake in the unit tests. */
export interface OnnxSessionLoader {
  readonly load: (options: OnnxLoadOptions) => Promise<OnnxLoadedSession>
}

/** The session members a provider layer uses. */
export interface OnnxSessionApi {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  /** The execution provider the session was created with. */
  readonly executionProvider: string
  readonly run: (
    feeds: Readonly<Record<string, OnnxFeed>>,
  ) => Effect.Effect<Readonly<Record<string, OnnxTensor>>, InferenceFailed>
}

/** One engine session, safe to share across concurrent callers. */
export class OnnxSession extends Context.Service<OnnxSession, OnnxSessionApi>()(
  'tool-mode-runtime/OnnxSession',
) {}

/** The negotiation result. */
export type ProviderSelection =
  | { readonly ok: true; readonly provider: OnnxExecutionProvider; readonly supported: readonly string[] }
  | { readonly ok: false; readonly reason: string }

/**
 * Choose the execution provider for a session.
 *
 * @param requested - the recipe's lanes, most preferred first
 * @param supported - what the installed engine reports
 * @returns the chosen lane, or the reason no requested lane is available
 */
export function selectExecutionProvider(
  requested: readonly OnnxExecutionProvider[],
  supported: readonly OnnxBackend[],
): ProviderSelection {
  const available = supported.filter((backend) => backend.bundled).map((backend) => backend.name)
  if (requested.length === 0) {
    return { ok: false, reason: 'no execution provider was requested; the recipe must name at least one' }
  }
  for (const lane of requested) {
    if (available.includes(lane)) return { ok: true, provider: lane, supported: available }
  }
  return {
    ok: false,
    reason:
      `none of the requested execution providers (${requested.join(', ')}) is available; `
      + `the engine bundles: ${available.length === 0 ? 'none' : available.join(', ')}`,
  }
}

/** Options for {@link onnxLayer}; `loader` is the unit-test seam. */
export interface OnnxLayerOptions {
  readonly modelBytes: Uint8Array
  /** The recipe's lanes, most preferred first. Defaults to `['cpu']`. */
  readonly accelerators?: readonly OnnxExecutionProvider[]
  readonly intraOpNumThreads?: number
  readonly loader?: OnnxSessionLoader
}

/**
 * Convert one engine output to the runtime's tensor shape.
 *
 * The properties are read with `in`, not `Object.hasOwn`: onnxruntime-node returns a
 * `Tensor` whose `data` and `dims` are PROTOTYPE getters, so an own-property check would
 * reject every real output while accepting only a fake one. Values are then validated by
 * kind, so nothing here trusts the engine's declared shape.
 */
function toOnnxTensor(name: string, value: unknown): OnnxTensor {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`the graph returned the output ${JSON.stringify(name)} as a non-tensor value`)
  }
  if (!('data' in value) || !('dims' in value)) {
    throw new Error(`the graph returned the output ${JSON.stringify(name)} as a non-tensor value`)
  }
  const data: unknown = value.data
  const dims: unknown = value.dims
  if (!(data instanceof Float32Array || data instanceof Int32Array || data instanceof BigInt64Array)) {
    throw new Error(`the graph returned the output ${JSON.stringify(name)} with an unsupported data kind`)
  }
  if (!Array.isArray(dims) || !dims.every((dim: unknown) => typeof dim === 'number' && Number.isInteger(dim) && dim >= 0)) {
    throw new Error(`the graph returned the output ${JSON.stringify(name)} with invalid dimensions`)
  }
  return { data, dims: [...dims] }
}

/**
 * The real engine seam: onnxruntime-node, imported lazily.
 *
 * The dynamic import is deliberate. A unit test that injects a fake loader never touches
 * the native binding, so the test suite runs on a machine where the binding cannot load,
 * and the failure a real deployment would hit is reported by load() instead of by
 * importing this module.
 *
 * @returns a loader backed by onnxruntime-node
 */
export function createNodeOnnxLoader(): OnnxSessionLoader {
  return {
    async load(options: OnnxLoadOptions): Promise<OnnxLoadedSession> {
      const ort = await import('onnxruntime-node')
      const supported: OnnxBackend[] = ort.listSupportedBackends().map((backend) => ({
        name: backend.name,
        bundled: backend.bundled,
      }))
      const selection = selectExecutionProvider(options.accelerators, supported)
      if (!selection.ok) throw new RuntimeUnavailable({ provider: PROVIDER, reason: selection.reason })

      const sessionOptions: OrtModule.InferenceSession.SessionOptions = {
        executionProviders: [selection.provider],
      }
      if (options.intraOpNumThreads !== undefined) sessionOptions.intraOpNumThreads = options.intraOpNumThreads
      const session = await ort.InferenceSession.create(options.modelBytes, sessionOptions)

      return {
        inputNames: session.inputNames,
        outputNames: session.outputNames,
        executionProvider: selection.provider,
        run: async (feeds) => {
          const tensors: Record<string, OrtModule.Tensor> = {}
          for (const [name, feed] of Object.entries(feeds)) {
            tensors[name] = feed.data instanceof Float32Array
              ? new ort.Tensor('float32', feed.data, [...feed.dims])
              : new ort.Tensor('int32', feed.data, [...feed.dims])
          }
          const outputs = await session.run(tensors)
          const converted: Record<string, OnnxTensor> = {}
          for (const [name, value] of Object.entries(outputs)) {
            converted[name] = toOnnxTensor(name, value)
          }
          return converted
        },
        release: () => session.release(),
      }
    },
  }
}

/**
 * Build the session for one compiled model.
 *
 * The session is acquired when the layer builds, released when the layer's scope closes,
 * and every `run` holds the single permit.
 *
 * @param options - the model bytes, the desired lanes and the test seam
 * @returns the layer, which fails with `RuntimeUnavailable` when the engine cannot load
 */
export const onnxLayer = (options: OnnxLayerOptions): Layer.Layer<OnnxSession, RuntimeUnavailable> =>
  Layer.effect(
    OnnxSession,
    Effect.gen(function* () {
      const loader = options.loader ?? createNodeOnnxLoader()
      const accelerators = options.accelerators ?? ['cpu']
      const baseOptions = { modelBytes: options.modelBytes, accelerators }
      const loadOptions: OnnxLoadOptions = options.intraOpNumThreads === undefined
        ? baseOptions
        : { ...baseOptions, intraOpNumThreads: options.intraOpNumThreads }

      const loaded = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => loader.load(loadOptions),
          catch: (cause) =>
            cause instanceof RuntimeUnavailable
              ? cause
              : new RuntimeUnavailable({ provider: PROVIDER, reason: describeCause(cause) }),
        }),
        (session) =>
          Effect.promise(async () => {
            try {
              await session.release()
            } catch {
              // Teardown must not fail; the native session may already be unusable.
            }
          }),
      )

      const permits = yield* Semaphore.make(1)

      const run = (feeds: Readonly<Record<string, OnnxFeed>>) =>
        permits.withPermit(
          Effect.tryPromise({
            try: () => loaded.run(feeds),
            catch: (cause) =>
              new InferenceFailed({ provider: PROVIDER, phase: 'run', message: describeCause(cause) }),
          }),
        )

      return OnnxSession.of({
        inputNames: loaded.inputNames,
        outputNames: loaded.outputNames,
        executionProvider: loaded.executionProvider,
        run,
      })
    }),
  )
