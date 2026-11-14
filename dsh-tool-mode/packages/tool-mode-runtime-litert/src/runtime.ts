/**
 * `LitertSession`: the Effect service a model provider depends on.
 *
 * Contract (docs/runtime/PLAN.md): the layer builds one compiled model and acquires it in
 * the layer scope; `run` is serialized with `Semaphore.make(1)` because the LiteRT C ABI
 * keeps module-global state; a failed load fails the layer with `RuntimeUnavailable`,
 * while a failed run or output conversion fails with `InferenceFailed` (`run`/`post`).
 *
 * TESTS: the unit suite injects a fake `LitertBoot`, so it proves the lifecycle, the feed
 * mapping, the serialization and the error mapping — not real inference.
 */

import { Context, Effect, Layer, Semaphore } from 'effect'

import { InferenceFailed, RuntimeUnavailable, describeCause } from './errors.ts'
import {
  createNodeLitertBoot,
  type LitertBoot,
  type LitertFeed,
  type LitertOutput,
} from './model.ts'

const PROVIDER = 'litert'

/** The outputs of one inference, keyed by the model's output name. */
export interface LitertOutputs {
  readonly [name: string]: Float32Array
}

/** The session members the provider layer uses. */
export interface LitertSessionApi {
  readonly inputNames: readonly string[]
  readonly run: (feeds: Readonly<Record<string, LitertFeed>>) => Effect.Effect<LitertOutputs, InferenceFailed>
}

/** One compiled LiteRT model, safe to share across concurrent callers. */
export class LitertSession extends Context.Service<LitertSession, LitertSessionApi>()(
  'tool-mode-runtime/LitertSession',
) {}

/** Options for `litertLayer`; `boot` is the unit-test seam. */
export interface LitertLayerOptions {
  readonly wasmDir: string
  readonly modelBytes: Uint8Array
  readonly threads?: number
  readonly boot?: LitertBoot
}

const toFloat32 = (name: string, value: LitertOutput): Float32Array => {
  if (value instanceof Float32Array) return value
  if (value instanceof Int32Array) return Float32Array.from(value)
  // A fake or a future engine can return something else; that is a post-processing failure.
  throw new Error(`the compiled model returned output ${name} as an unsupported value`)
}

const toOutputs = (raw: Readonly<Record<string, LitertOutput>>): LitertOutputs =>
  Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, toFloat32(name, value)] as const))

/**
 * Builds the session for one compiled model. The model is acquired when the layer builds,
 * released when the layer's scope closes, and every `run` holds the single permit.
 */
export const litertLayer = (options: LitertLayerOptions): Layer.Layer<LitertSession, RuntimeUnavailable> =>
  Layer.effect(
    LitertSession,
    Effect.gen(function* () {
      const boot =
        options.boot ??
        createNodeLitertBoot(
          options.threads === undefined
            ? { wasmDir: options.wasmDir }
            : { wasmDir: options.wasmDir, threads: options.threads },
        )
      const loadOptions =
        options.threads === undefined
          ? { modelBytes: options.modelBytes }
          : { modelBytes: options.modelBytes, threads: options.threads }

      const model = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => boot.load(loadOptions),
          catch: (cause) =>
            cause instanceof RuntimeUnavailable
              ? cause
              : new RuntimeUnavailable({ provider: PROVIDER, reason: describeCause(cause) }),
        }),
        (loaded) =>
          Effect.sync(() => {
            try {
              loaded.close()
            } catch {
              // Teardown must not fail; the Wasm module may already be unusable.
            }
          }),
      )

      const permits = yield* Semaphore.make(1)

      const run = (feeds: Readonly<Record<string, LitertFeed>>) =>
        permits.withPermit(
          Effect.gen(function* () {
            const raw = yield* Effect.tryPromise({
              try: () => model.run(feeds),
              catch: (cause) =>
                new InferenceFailed({ provider: PROVIDER, phase: 'run', message: describeCause(cause) }),
            })
            return yield* Effect.try({
              try: () => toOutputs(raw),
              catch: (cause) =>
                new InferenceFailed({ provider: PROVIDER, phase: 'post', message: describeCause(cause) }),
            })
          }),
        )

      return { inputNames: model.inputNames, run }
    }),
  )
