/**
 * The processor seam between the shared provider lifecycle and one model's pipeline.
 *
 * A provider is the same machine for every model: resolve the artifact, build the session,
 * validate the graph, relay abort/timeout, and dispose. What differs is the DESCRIPTOR and
 * the pipeline. That difference is a `ProcessorDefinition`: a typed sidecar (uhm's labels,
 * nothing for clear), a graph binding, a sample rate, and one invoke effect.
 *
 * Keeping the shared half here is what makes the second processor a pipeline rather than a
 * second copy of the lifecycle.
 *
 * @module processor
 */

/*
 * The descriptor arrives from the host as JSON (`Readonly<JsonObject>`) and its shape is
 * proven at run time before any audio is touched. The generic anti-slop rules assume an
 * already-typed caller, so the run-time narrowing is the implementation and is disabled
 * for this boundary only.
 */
/* oxlint-disable anti-slop/no-runtime-typeof */

import { readFile } from 'node:fs/promises'

import { Effect } from 'effect'

import type { InvocationContextV1, JsonObject } from '@try-works/tool-mode-extension-sdk'
import type { ModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'

import { InvalidInput, type InferenceFailed, describeCause } from './errors.ts'
import type { OnnxSessionApi } from './runtime.ts'
import { decodeWav, resampleLinear } from './wav.ts'

/** The only input key every processor accepts: a caller-granted path to a WAV file. */
const AUDIO_PATH_KEYS = new Set(['audio_path'])

/** The decoded audio handed to a processor. */
export interface ProcessorAudio {
  /** Mono samples at the processor's sample rate. */
  readonly samples: Float32Array
  /** Duration of the ORIGINAL file in seconds, before resampling. */
  readonly sourceDurationSeconds: number
}

/** Everything one processor invocation needs. */
export interface ProcessorInvokeRequest<Sidecar, Binding> {
  /** The loaded engine session. */
  readonly engine: OnnxSessionApi
  /** The sidecar documents loaded beside the artifact. */
  readonly sidecar: Sidecar
  /** The graph binding proved at load time. */
  readonly binding: Binding
  readonly recipe: ModelRuntimeRecipe
  readonly input: Readonly<JsonObject>
  readonly context: InvocationContextV1
  readonly audio: ProcessorAudio
}

/** What a processor contributes to the shared provider. */
export interface ProcessorDefinition<Sidecar, Binding> {
  /** The recipe's `processor.id` this definition implements. */
  readonly id: string
  /** The rate the shared pipeline resamples the input to. */
  readonly sampleRate: number
  /** Load the processor's sidecar documents from the prepared asset directory. */
  loadSidecar: (directory: string) => Promise<Sidecar>
  /** Prove the loaded graph exposes the tensors the processor needs. */
  bindGraph: (names: { readonly inputs: readonly string[]; readonly outputs: readonly string[] }) =>
    | { readonly ok: true; readonly value: Binding }
    | { readonly ok: false; readonly reason: string }
  /** Run one invocation. */
  invoke: (request: ProcessorInvokeRequest<Sidecar, Binding>) => Effect.Effect<JsonObject, InvalidInput | InferenceFailed>
}

/** Read the recipe's audio descriptor: a closed key set and a non-empty path. */
export function parseAudioPath(input: Readonly<JsonObject>, recipe: ModelRuntimeRecipe): Effect.Effect<string, InvalidInput> {
  return Effect.suspend(() => {
    const bytes = Buffer.byteLength(JSON.stringify(input) ?? '', 'utf8')
    if (bytes > recipe.limits.maxInputBytes) {
      return Effect.fail(
        new InvalidInput({
          field: 'input',
          message: 'the input is ' + String(bytes) + ' bytes, over the ' + String(recipe.limits.maxInputBytes) + '-byte input limit',
        }),
      )
    }
    for (const key of Object.keys(input)) {
      if (!AUDIO_PATH_KEYS.has(key)) {
        return Effect.fail(
          new InvalidInput({ field: key, message: 'the input accepts only audio_path; received ' + JSON.stringify(key) }),
        )
      }
    }
    const audioPath = input['audio_path']
    if (typeof audioPath !== 'string' || audioPath.length === 0) {
      return Effect.fail(new InvalidInput({ field: 'audio_path', message: 'audio_path must be a non-empty string' }))
    }
    return Effect.succeed(audioPath)
  })
}

/** Resolve the caller-supplied path against the invocation grants. */
export function resolveAudioPath(context: InvocationContextV1, candidate: string): Effect.Effect<string, InvalidInput> {
  return Effect.try({
    try: () => context.resolvePath(candidate),
    catch: (cause) =>
      new InvalidInput({ field: 'audio_path', message: 'the audio path is not authorized: ' + describeCause(cause) }),
  })
}

/** Read the audio bytes from the resolved path. */
export function readAudioBytes(audioPath: string): Effect.Effect<Uint8Array, InvalidInput> {
  return Effect.tryPromise({
    try: async () => new Uint8Array(await readFile(audioPath)),
    catch: (cause) =>
      new InvalidInput({ field: 'audio_path', message: 'the audio file cannot be read: ' + describeCause(cause) }),
  })
}

/**
 * Decode a WAV, down-mix and resample it to the processor's rate.
 *
 * The source duration is carried separately because coverage reports the ORIGINAL file
 * length, not the resampled sample count (which differs by a rounding sample).
 */
export function prepareSamples(bytes: Uint8Array, sampleRate: number): Effect.Effect<ProcessorAudio, InvalidInput> {
  return Effect.suspend(() => {
    const decoded = decodeWav(bytes)
    if (!decoded.ok) {
      return Effect.fail(
        new InvalidInput({ field: 'audio_path', message: 'the audio cannot be decoded: ' + decoded.reason }),
      )
    }
    const samples = resampleLinear(decoded.audio.samples, decoded.audio.sampleRate, sampleRate)
    return Effect.succeed({
      samples,
      sourceDurationSeconds: decoded.audio.samples.length / decoded.audio.sampleRate,
    })
  })
}
