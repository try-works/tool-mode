/**
 * The redact runtime provider: the Effect provider the dsh adapter drives, plus the layer
 * that binds it to the host-verified assets.
 *
 * The layer reads the pinned model bytes, compiles ONE LiteRT session (the engine keeps
 * process-global state), loads the tokenizer and label table from the same asset set, and
 * derives the label policy from redact_meta.json. It contains no host code, so the extension
 * stays a normal package behind the runtime seam.
 *
 * @module @try-works/extension-redact/provider
 */

import { readFileSync } from 'node:fs'

import { Effect, Layer } from 'effect'

import {
  InvalidInput,
  RuntimeProvider,
  RuntimeUnavailable,
  type RuntimeProviderShape,
  type RuntimeRequest,
} from '@try-works/tool-mode-runtime-core'
import type { JsonObject, PreparedAssetMapV1 } from '@try-works/tool-mode-extension-sdk'
import {
  LitertSession,
  litertLayer,
  resolveLitertWasmDir,
  type LitertSessionApi,
} from '@try-works/tool-mode-runtime-litert'

import { labelsFromJson, padIdFromTokenizerJson } from './pure.ts'
import { DEFAULT_REDACT_POLICY, policyFromMeta, runRedactPipeline, type RedactPolicy } from './pipeline.ts'
import { createRedactTokenizer, type RedactTokenizer } from './tokenizer.ts'

/** The model identity reported to the runtime contract. */
export const REDACT_MODEL = {
  id: 'redact',
  version: '0.4.2',
  digest: 'sha256:2b6237e3a08ee12966929af477fb3723018bacdb74a22f78992b8c0f6b5d545d',
} as const

/** The request limits the host enforces for this deployment. */
export const REDACT_LIMITS = { maxInputBytes: 1_048_576, timeoutMs: 120_000 } as const

/** The asset ids the provider resolves from the host-verified map. */
export const REDACT_ASSETS = {
  model: 'redact-tflite',
  tokenizer: 'redact-tokenizer',
  labels: 'redact-labels',
  meta: 'redact-meta',
} as const

/** What the runtime provider needs once the assets are loaded. */
export interface RedactRuntimeDeps {
  readonly session: LitertSessionApi
  readonly tokenizer: RedactTokenizer
  readonly labels: readonly string[]
  readonly padId: number
  readonly policy: RedactPolicy
}

/** The model provider shape, ready to be wrapped by createRuntimeProvider. */
export function createRedactRuntime(deps: RedactRuntimeDeps): RuntimeProviderShape {
  return {
    id: 'litert',
    formats: ['tflite'],
    inspect: Effect.succeed({
      readiness: 'ready',
      features: ['pii-redaction', 'deterministic-pii'],
      missing: [],
    }),
    load: () => Effect.void,
    invoke: (request: RuntimeRequest) =>
      runRedactPipeline(
        {
          tokenizer: deps.tokenizer,
          session: deps.session,
          labels: deps.labels,
          padId: deps.padId,
          policy: deps.policy,
        },
        request.input.text ?? '',
      ),
    unload: Effect.void,
  }
}

/** Map the tool's JSON input onto a validated runtime request. */
export function redactRequest(input: Readonly<JsonObject>): Effect.Effect<RuntimeRequest, InvalidInput> {
  const text = input.text
  if (typeof text !== 'string' || text.length === 0) {
    return Effect.fail(new InvalidInput({ field: 'text', message: '"text" must be a non-empty string' }))
  }
  if (Buffer.byteLength(text, 'utf8') > REDACT_LIMITS.maxInputBytes) {
    return Effect.fail(
      new InvalidInput({
        field: 'text',
        message: 'text is ' + String(Buffer.byteLength(text, 'utf8')) + ' bytes, over the '
          + String(REDACT_LIMITS.maxInputBytes) + '-byte input limit',
      }),
    )
  }
  return Effect.succeed({ model: REDACT_MODEL, input: { text }, limits: REDACT_LIMITS })
}

/** A short, always-defined description of a thrown value. */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message.length > 0 ? cause.message : cause.name
  if (typeof cause === 'string') return cause
  return String(cause)
}

/** Resolve a required verified asset, or report the deployment as unavailable. */
function requiredPath(assets: Readonly<PreparedAssetMapV1>, id: string): string {
  const entry = assets.get(id)
  if (entry === undefined) {
    throw new RuntimeUnavailable({ provider: 'litert', reason: 'the redact deployment is missing the verified asset "' + id + '"' })
  }
  return entry.path
}

/** Read one JSON asset, converting a read/parse failure to a typed unavailable error. */
function readJson(path: string, id: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (cause) {
    throw new RuntimeUnavailable({
      provider: 'litert',
      reason: 'the redact asset "' + id + '" cannot be read as JSON: ' + describeCause(cause),
    })
  }
}

/**
 * Build the provider from the host-verified assets.
 *
 * The model bytes are read synchronously because litertLayer takes them at construction; a
 * read failure is a RuntimeUnavailable, reported by the adapter as a failed load with the
 * reason attached rather than as an empty result later.
 */
export function redactLayer(assets: Readonly<PreparedAssetMapV1>): Layer.Layer<RuntimeProvider, RuntimeUnavailable, never> {
  let modelBytes: Uint8Array
  try {
    modelBytes = new Uint8Array(readFileSync(requiredPath(assets, REDACT_ASSETS.model)))
  } catch (cause) {
    if (cause instanceof RuntimeUnavailable) throw cause
    throw new RuntimeUnavailable({
      provider: 'litert',
      reason: 'the redact model artifact cannot be read: ' + describeCause(cause),
    })
  }

  const sessionLayer = litertLayer({ wasmDir: resolveLitertWasmDir(), modelBytes })

  const providerLayer = Layer.effect(
    RuntimeProvider,
    Effect.gen(function* () {
      const session = yield* LitertSession
      const tokenizer = yield* Effect.try({
        try: () => createRedactTokenizer(requiredPath(assets, REDACT_ASSETS.tokenizer)),
        catch: (cause) =>
          new RuntimeUnavailable({ provider: 'litert', reason: 'the redact tokenizer cannot be loaded: ' + describeCause(cause) }),
      })
      const labels = yield* Effect.try({
        try: () => labelsFromJson(readJson(requiredPath(assets, REDACT_ASSETS.labels), REDACT_ASSETS.labels)),
        catch: (cause) =>
          new RuntimeUnavailable({ provider: 'litert', reason: 'the redact label table cannot be read: ' + describeCause(cause) }),
      })
      const padId = yield* Effect.try({
        try: () => padIdFromTokenizerJson(readJson(requiredPath(assets, REDACT_ASSETS.tokenizer), REDACT_ASSETS.tokenizer)),
        catch: (cause) =>
          new RuntimeUnavailable({ provider: 'litert', reason: 'the redact pad token cannot be read: ' + describeCause(cause) }),
      })
      const policy = yield* Effect.try({
        try: () => policyFromMeta(readJson(requiredPath(assets, REDACT_ASSETS.meta), REDACT_ASSETS.meta)),
        catch: (cause) =>
          new RuntimeUnavailable({ provider: 'litert', reason: 'the redact policy file cannot be read: ' + describeCause(cause) }),
      })
      return createRedactRuntime({ session, tokenizer, labels, padId, policy })
    }),
  )

  const provided = providerLayer.pipe(Layer.provide(sessionLayer))
  // SAFETY: litert's RuntimeUnavailable has the same _tag and fields as core's (both are
  // Schema.TaggedError values); the adapter renders the structured reason, so the identity
  // of the class does not change any host-visible behaviour.
  return provided as Layer.Layer<RuntimeProvider, RuntimeUnavailable, never>
}

/** The pinned policy the layer uses when redact_meta.json declares nothing new. */
export const REDACT_DEFAULT_POLICY: RedactPolicy = DEFAULT_REDACT_POLICY
