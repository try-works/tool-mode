/**
 * Processor ear/mel-v1: spoken-language identification over the ear LiteRT artifact.
 *
 * PRIMARY SOURCE (Desert-Ant-Labs/desert-ant-core @ baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7):
 * - Sources/Ear/Model.swift:19 languages from languages.json; :72-102 identify (linear resample,
 *   window offsets, per-window softmax and probability averaging, alias folding, top-5);
 *   :104-114 tensor name/shape [1, 80, 3000]; :119-123 linear resample.
 * - Sources/Ear/Ear.swift:29-34 isReliable; :54 reliableMargin = 0.25; :113 defaultWindows = 3;
 *   :156-165 non-empty audio and windows > 0.
 * - Sources/Ear/Languages.swift:4-8 aliases (tl->fil, nb->no, yue->zh); :20 confusables
 *   (no, sv, da); :22-24 canonicalLanguage.
 * - Sources/Ear/Frontend.swift + AudioDSP: the log-mel front end and window selection, ported
 *   in ear-frontend.ts.
 * - .assets/ear/ear_meta.json: 16 kHz, 30 s windows, recommended 3, n_fft 400, hop 160,
 *   mels 80, frames 3000, clamp 1e-10, floor 8 decades, affine (x + 4) / 4, input 'mel',
 *   output 'output_0', 103 logits in languages.json order.
 *
 * INPUT closed: { audio_path: string 1..4096, windows?: integer 1..16 }.
 * WAV only (RIFF/WAVE), PCM 16-bit or IEEE float32, mono or stereo, any declared rate (linear
 * resample to 16 kHz). Short audio is zero-padded to one window; long audio is searched for the
 * most speech-like windows (window/3 candidate stride) and only the selected ones are scored.
 *
 * OUTPUT exactly: { language, confidence, isReliable,
 *                   candidates: [{language, probability}] (top 5, folded, descending),
 *                   windows } (integer count actually listened to).
 *
 * HONEST LIMITS: 103 model labels = 102 canonical languages after yue -> zh folding (this label
 * set has no tl or nb, so only yue -> zh fires; the full alias map is kept for future label
 * sets). Scores are decision probabilities averaged over a few 30 s windows, not calibrated
 * confidence, and this is not a speech-recognition or nationality claim.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { Effect, Schema } from 'effect'

import type { InvocationContextV1, JsonObject, JsonValue } from '@try-works/tool-mode-extension-sdk'
import { InferenceFailed, InvalidInput, RuntimeUnavailable } from '@try-works/tool-mode-runtime-core'

import {
  EAR_BINS,
  EAR_DEFAULT_WINDOWS,
  EAR_FRAMES,
  EAR_HOP,
  EAR_MELS,
  EAR_N_FFT,
  EAR_SAMPLE_RATE,
  EAR_WINDOW_SAMPLES,
  logMelFeatures,
  parseMelFilters,
  windowOffsets,
  type MelFilterbank,
} from './ear-frontend.ts'
import { describeCause } from './errors.ts'
import { closedKeyFailure, inputCeilingFailure, type RecipeProcessor } from './processor.ts'
import { LitertSession } from './runtime.ts'
import { decodeWav, resampleLinear } from './wav.ts'

/** The processor id this module owns. */
export const EAR_PROCESSOR = 'ear/mel-v1'

/** Codes the detector emits that differ from the codes callers expect (Languages.swift:4-8). */
export const EAR_LANGUAGE_ALIASES = { tl: 'fil', nb: 'no', yue: 'zh' } as const

/** Languages the detector confuses confidently rather than uncertainly (Languages.swift:20). */
export const EAR_CONFUSABLE_LANGUAGES = ['no', 'sv', 'da'] as const

/** How far ahead the top candidate must be before routing on it (Ear.swift:54). */
export const EAR_RELIABLE_MARGIN = 0.25

/** The label count at the pinned revision (103 logits, languages.json order). */
export const EAR_LANGUAGE_COUNT = 103

/** The largest windows value the tool accepts. */
export const EAR_MAX_WINDOWS = 16

const MAX_PATH_CHARACTERS = 4096
const INPUT_NAME = 'mel'
const OUTPUT_NAME = 'output_0'
const INPUT_KEYS = new Set(['audio_path', 'windows'])

const EarMetaSchema = Schema.Struct({
  audio: Schema.Struct({ sample_rate: Schema.Finite, recommended_windows: Schema.Finite }),
  frontend: Schema.Struct({
    n_fft: Schema.Finite,
    hop_length: Schema.Finite,
    n_mels: Schema.Finite,
    frames: Schema.Finite,
    clamp_min: Schema.Finite,
    floor_below_peak_db: Schema.Finite,
    affine: Schema.Struct({ add: Schema.Finite, divide: Schema.Finite }),
  }),
  artifacts: Schema.Struct({ litert: Schema.Struct({ input: Schema.String, output: Schema.String }) }),
  output: Schema.Struct({ logits: Schema.Finite }),
})

type EarMeta = typeof EarMetaSchema['Type']

const LanguagesSchema = Schema.Array(Schema.NonEmptyString)

/** The canonical code a raw label reports as (Languages.swift:22-24). */
const canonicalLanguage = (code: string): string => {
  if (code === 'tl') return 'fil'
  if (code === 'nb') return 'no'
  if (code === 'yue') return 'zh'
  return code
}

/** Refuse one input before any file or engine work. */
interface EarOptions {
  readonly audioPath: string
  readonly windows: number
}

function parseInput(input: Readonly<JsonObject>, maxInputBytes: number): Effect.Effect<EarOptions, InvalidInput> {
  const ceiling = inputCeilingFailure(input, { maxInputBytes, timeoutMs: 0 })
  if (ceiling !== undefined) return Effect.fail(ceiling)
  const keys = closedKeyFailure(input, INPUT_KEYS, 'audio_path and windows')
  if (keys !== undefined) return Effect.fail(keys)

  const audioPath = input['audio_path']
  if (audioPath === undefined) return Effect.fail(new InvalidInput({ field: 'audio_path', message: 'audio_path is required' }))
  if (!Schema.is(Schema.String)(audioPath) || audioPath.length === 0) {
    return Effect.fail(new InvalidInput({ field: 'audio_path', message: 'audio_path must be a non-empty string' }))
  }
  if (audioPath.length > MAX_PATH_CHARACTERS) {
    return Effect.fail(new InvalidInput({ field: 'audio_path', message: 'audio_path must be at most ' + String(MAX_PATH_CHARACTERS) + ' characters' }))
  }

  const windowsValue = input['windows']
  if (windowsValue !== undefined) {
    if (!Schema.is(Schema.Int)(windowsValue) || windowsValue < 1 || windowsValue > EAR_MAX_WINDOWS) {
      return Effect.fail(
        new InvalidInput({
          field: 'windows',
          message: 'windows must be an integer between 1 and ' + String(EAR_MAX_WINDOWS) + ', or omitted for the default of ' + String(EAR_DEFAULT_WINDOWS),
        }),
      )
    }
  }
  return Effect.succeed({ audioPath, windows: windowsValue ?? EAR_DEFAULT_WINDOWS })
}

/** Read one JSON asset beside the model, as a lossless JSON value for schema decoding. */
function readAssetJson(assetDirectory: string, name: string): Effect.Effect<JsonValue, RuntimeUnavailable> {
  return Effect.tryPromise({
    try: async (): Promise<JsonValue> => JSON.parse(await readFile(path.join(assetDirectory, name), 'utf8')),
    catch: (cause) =>
      new RuntimeUnavailable({ provider: 'litert', reason: 'the ear asset "' + name + '" cannot be read as JSON: ' + describeCause(cause) }),
  })
}

/** Read the pinned meta and refuse a document whose geometry or IO disagrees with the source. */
function loadMeta(assetDirectory: string): Effect.Effect<EarMeta, RuntimeUnavailable> {
  return Effect.flatMap(readAssetJson(assetDirectory, 'ear_meta.json'), (raw) => {
    const decoded = Schema.decodeUnknownOption(EarMetaSchema)(raw)
    if (decoded._tag === 'None') {
      return Effect.fail(new RuntimeUnavailable({ provider: 'litert', reason: 'the ear ear_meta.json is not the pinned document' }))
    }
    const meta = decoded.value
    const problems: string[] = []
    if (meta.audio.sample_rate !== EAR_SAMPLE_RATE) problems.push('audio.sample_rate must be ' + String(EAR_SAMPLE_RATE))
    if (meta.audio.recommended_windows !== EAR_DEFAULT_WINDOWS) problems.push('audio.recommended_windows must be ' + String(EAR_DEFAULT_WINDOWS))
    if (meta.frontend.n_fft !== EAR_N_FFT) problems.push('n_fft must be ' + String(EAR_N_FFT))
    if (meta.frontend.hop_length !== EAR_HOP) problems.push('hop_length must be ' + String(EAR_HOP))
    if (meta.frontend.n_mels !== EAR_MELS) problems.push('n_mels must be ' + String(EAR_MELS))
    if (meta.frontend.frames !== EAR_FRAMES) problems.push('frames must be ' + String(EAR_FRAMES))
    if (meta.frontend.clamp_min !== 1e-10) problems.push('clamp_min must be 1e-10')
    if (meta.frontend.floor_below_peak_db !== 8) problems.push('floor_below_peak_db must be 8')
    if (meta.frontend.affine.add !== 4) problems.push('affine.add must be 4')
    if (meta.frontend.affine.divide !== 4) problems.push('affine.divide must be 4')
    if (meta.artifacts.litert.input !== INPUT_NAME) problems.push('artifacts.litert.input must be "' + INPUT_NAME + '"')
    if (meta.artifacts.litert.output !== OUTPUT_NAME) problems.push('artifacts.litert.output must be "' + OUTPUT_NAME + '"')
    if (meta.output.logits !== EAR_LANGUAGE_COUNT) problems.push('output.logits must be ' + String(EAR_LANGUAGE_COUNT))
    return problems.length > 0
      ? Effect.fail(new RuntimeUnavailable({ provider: 'litert', reason: 'ear_meta.json does not match the pinned front end: ' + problems.join('; ') }))
      : Effect.succeed(meta)
  })
}

/** Read the model's label order (languages.json). */
function loadLanguages(assetDirectory: string): Effect.Effect<readonly string[], RuntimeUnavailable> {
  return Effect.flatMap(readAssetJson(assetDirectory, 'languages.json'), (raw) => {
    const decoded = Schema.decodeUnknownOption(LanguagesSchema)(raw)
    if (decoded._tag === 'None') {
      return Effect.fail(new RuntimeUnavailable({ provider: 'litert', reason: 'the ear languages.json is not an array of language codes' }))
    }
    if (decoded.value.length !== EAR_LANGUAGE_COUNT) {
      return Effect.fail(
        new RuntimeUnavailable({
          provider: 'litert',
          reason: 'languages.json declares ' + String(decoded.value.length) + ' languages; the pinned model emits ' + String(EAR_LANGUAGE_COUNT),
        }),
      )
    }
    return Effect.succeed(decoded.value)
  })
}

/** Read and validate the mel filterbank beside the model. */
function loadFilters(assetDirectory: string): Effect.Effect<MelFilterbank, RuntimeUnavailable> {
  return Effect.tryPromise({
    try: async () => {
      const bytes = new Uint8Array(await readFile(path.join(assetDirectory, 'mel_filters.f32')))
      const filters = parseMelFilters(bytes)
      if (filters.mels !== EAR_MELS || filters.bins !== EAR_BINS) {
        throw new Error(String(filters.mels) + 'x' + String(filters.bins) + ' is not the pinned ' + String(EAR_MELS) + 'x' + String(EAR_BINS) + ' filterbank')
      }
      return filters
    },
    catch: (cause) =>
      new RuntimeUnavailable({ provider: 'litert', reason: 'the ear mel filterbank cannot be used: ' + describeCause(cause) }),
  })
}

/** Resolve the caller's path through the host authority, decode the WAV and resample to 16 kHz. */
function loadAudio(audioPath: string, context: InvocationContextV1): Effect.Effect<Float32Array, InvalidInput> {
  return Effect.tryPromise({
    try: async () => {
      const resolved = context.resolvePath(audioPath)
      const decoded = decodeWav(new Uint8Array(await readFile(resolved)))
      if (decoded.samples.length === 0) throw new Error('the recording contains no audio samples')
      return resampleLinear(decoded.samples, decoded.sampleRate, EAR_SAMPLE_RATE)
    },
    catch: (cause) => new InvalidInput({ field: 'audio_path', message: 'audio_path cannot be used: ' + describeCause(cause) }),
  })
}

/** Validate one logits vector (Model.swift:104-114). */
function logitsOf(raw: Readonly<Record<string, Float32Array>>, expected: number): Effect.Effect<Float32Array, InferenceFailed> {
  return Effect.try({
    try: () => {
      const logits = raw[OUTPUT_NAME]
      if (!(logits instanceof Float32Array) || logits.length !== expected) {
        throw new Error('the model returned ' + String(logits?.length ?? 'no') + ' logits; expected ' + String(expected))
      }
      for (const value of logits) {
        if (!Number.isFinite(value)) throw new Error('the model returned a non-finite logit')
      }
      return logits
    },
    catch: (cause) => new InferenceFailed({ provider: 'litert', phase: 'post', message: describeCause(cause) }),
  })
}

/** Softmax in double precision (Model.swift:125-131). */
function softmax(logits: Float32Array): Float64Array {
  let peak = -Number.MAX_VALUE
  for (const value of logits) peak = Math.max(peak, value)
  const exps = new Float64Array(logits.length)
  let total = 0
  for (let index = 0; index < logits.length; index += 1) {
    const value = Math.exp((logits[index] ?? 0) - peak)
    exps[index] = value
    total += value
  }
  if (!(total > 0)) return exps
  for (let index = 0; index < exps.length; index += 1) exps[index] = (exps[index] ?? 0) / total
  return exps
}

/** Fold aliases, rank, and take the top five (Model.swift:90-101). */
function candidatesOf(
  totals: Float64Array,
  windows: number,
  languages: readonly string[],
): readonly { readonly language: string; readonly probability: number }[] {
  const scale = 1 / Math.max(windows, 1)
  const mass = new Map<string, number>()
  for (let index = 0; index < languages.length; index += 1) {
    const code = canonicalLanguage(languages[index] ?? '')
    mass.set(code, (mass.get(code) ?? 0) + (totals[index] ?? 0) * scale)
  }
  return [...mass.entries()]
    .map(([language, probability]) => ({ language, probability }))
    .sort((a, b) => b.probability - a.probability || (a.language < b.language ? -1 : a.language > b.language ? 1 : 0))
    .slice(0, 5)
}

/** The reliability rule (Ear.swift:29-34). */
function reliable(candidates: readonly { readonly language: string; readonly probability: number }[]): boolean {
  const top = candidates[0]
  if (top === undefined) return false
  if (EAR_CONFUSABLE_LANGUAGES.some((code) => code === top.language)) return false
  const runnerUp = candidates[1]?.probability ?? 0
  return top.probability - runnerUp >= EAR_RELIABLE_MARGIN
}

/** The ear processor. */
export const earMelProcessor: RecipeProcessor = {
  id: EAR_PROCESSOR,
  features: [EAR_PROCESSOR],
  invoke: ({ input, context, limits, assetDirectory }) =>
    Effect.gen(function* () {
      const options = yield* parseInput(input, limits.maxInputBytes)
      yield* loadMeta(assetDirectory)
      const languages = yield* loadLanguages(assetDirectory)
      const filters = yield* loadFilters(assetDirectory)
      const samples = yield* loadAudio(options.audioPath, context)
      const offsets = windowOffsets(samples, options.windows)
      const session = yield* LitertSession
      const totals = new Float64Array(languages.length)
      for (const offset of offsets) {
        const window = samples.subarray(offset, Math.min(offset + EAR_WINDOW_SAMPLES, samples.length))
        const features = logMelFeatures(window, filters)
        const raw = yield* session.run({
          [INPUT_NAME]: { data: features, dims: [1, EAR_MELS, EAR_FRAMES] },
        })
        const logits = yield* logitsOf(raw, languages.length)
        const probabilities = softmax(logits)
        for (let index = 0; index < totals.length; index += 1) {
          totals[index] = (totals[index] ?? 0) + (probabilities[index] ?? 0)
        }
      }
      const candidates = candidatesOf(totals, offsets.length, languages)
      const top = candidates[0]
      if (top === undefined) {
        return yield* Effect.fail(new InferenceFailed({ provider: 'litert', phase: 'post', message: 'the model produced no language candidates' }))
      }
      return {
        language: top.language,
        confidence: top.probability,
        isReliable: reliable(candidates),
        candidates: candidates.map((candidate) => ({ language: candidate.language, probability: candidate.probability })),
        windows: offsets.length,
      }
    }),
}
