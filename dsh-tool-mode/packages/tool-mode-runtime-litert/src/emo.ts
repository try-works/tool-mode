/**
 * Processor emo/text-v1: on-device emoji suggestions over the emo LiteRT artifact.
 *
 * PRIMARY SOURCE (Desert-Ant-Labs/desert-ant-core @ baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7):
 * - Sources/Emo/Model.swift:19-30   label order, descending probability, limit
 * - Sources/Emo/Model.swift:33-79   n-gram windows, sem ids/mask padding and the six tensor
 *                                   names/shapes feeding output "probabilities"
 * - Sources/Emo/Model.swift:43-52   fmax feature window and the max(nf, 1) count
 * - Sources/Emo/Model.swift:54-64   sem window; empty token list keeps one unmasked pad
 * - Sources/Emo/EmoMeta.swift:7-35  meta fields and JSON key names
 * - Sources/Emo/Emo.swift:109-120   trimmed input, limit semantics
 * - Sources/Emo/Tokenizer.swift     EMTK tokenizer + FNV n-gram featurizer (emo-tokenizer.ts)
 * - .assets/emo/emo_meta.json       labels 812, n_hashes 3, n_buckets 44000, n_importance 16000,
 *                                   sem_pad_index 48000, fmax 512, smax 64
 *
 * INPUT closed: { text: string, limit?: integer 1..20 }. text is bounded at 1024 Unicode code
 * points (JSON Schema maxLength counts code points too); empty or whitespace-only text is
 * refused as InvalidInput. OUTPUT exactly: { suggestions: [{emoji, confidence}], labels: 812 }.
 * Emoji strings are read from emo_meta.json labels[index] and are never hardcoded; a meta whose
 * label count or constants disagree with the pinned artifact is RuntimeUnavailable, as is a
 * model probability vector whose length differs from the label count (never silently truncated).
 *
 * HONEST LIMITS: confidence is the model's raw softmax probability for that label, not a
 * calibrated probability, and suggestions are hints rather than promises. The vendor describes
 * coverage across 23 languages (Emo.swift:38-43); this tool does not return or verify a
 * language and makes no per-language accuracy claim. v1 applies no skin-tone variant.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { Effect, Schema } from 'effect'

import type { JsonObject, JsonValue } from '@try-works/tool-mode-extension-sdk'
import { InferenceFailed, InvalidInput, RuntimeUnavailable } from '@try-works/tool-mode-runtime-core'

import { describeCause } from './errors.ts'
import { encodeNgrams, parseEmtTokenizer, type EmtTokenizer } from './emo-tokenizer.ts'
import { closedKeyFailure, inputCeilingFailure, type RecipeProcessor } from './processor.ts'
import { LitertSession } from './runtime.ts'

/** The processor id this module owns. */
export const EMO_PROCESSOR = 'emo/text-v1'

/** The label count at the pinned revision. */
export const EMO_LABEL_COUNT = 812
/** FNV hashes per n-gram feature. */
export const EMO_N_HASHES = 3
/** N-gram hash-bucket table size. */
export const EMO_N_BUCKETS = 44_000
/** Importance-table size. */
export const EMO_N_IMPORTANCE = 16_000
/** The padding row appended to the semantic table. */
export const EMO_SEM_PAD_INDEX = 48_000
/** The fixed n-gram feature window. */
export const EMO_FMAX = 512
/** The fixed semantic-token window. */
export const EMO_SMAX = 64
/** Default suggestion count for the tool (the SDK default is 3; PHASE4 pins 5). */
export const EMO_DEFAULT_LIMIT = 5
/** The largest suggestion count the tool accepts. */
export const EMO_MAX_LIMIT = 20
/** The text bound, in Unicode code points. */
export const EMO_MAX_TEXT_CHARACTERS = 1024

const OUTPUT_NAME = 'probabilities'
const INPUT_KEYS = new Set(['text', 'limit'])

const EmoMetaSchema = Schema.Struct({
  labels: Schema.Array(Schema.NonEmptyString),
  n_hashes: Schema.Finite,
  n_buckets: Schema.Finite,
  n_importance: Schema.Finite,
  sem_pad_index: Schema.Finite,
  fmax: Schema.Finite,
  smax: Schema.Finite,
})

type EmoMeta = typeof EmoMetaSchema['Type']

/** Read one JSON asset beside the model as a lossless JSON value. */
function readAssetJson(assetDirectory: string, name: string): Effect.Effect<JsonValue, RuntimeUnavailable> {
  return Effect.tryPromise({
    try: async (): Promise<JsonValue> => JSON.parse(await readFile(path.join(assetDirectory, name), 'utf8')),
    catch: (cause) =>
      new RuntimeUnavailable({ provider: 'litert', reason: 'the emo asset "' + name + '" cannot be read as JSON: ' + describeCause(cause) }),
  })
}

/** Read and validate the pinned meta. */
function loadMeta(assetDirectory: string): Effect.Effect<EmoMeta, RuntimeUnavailable> {
  return Effect.flatMap(readAssetJson(assetDirectory, 'emo_meta.json'), (raw) => {
    const decoded = Schema.decodeUnknownOption(EmoMetaSchema)(raw)
    if (decoded._tag === 'None') {
      return Effect.fail(new RuntimeUnavailable({ provider: 'litert', reason: 'the emo emo_meta.json is not the pinned document' }))
    }
    const meta = decoded.value
    const problems: string[] = []
    if (meta.labels.length !== EMO_LABEL_COUNT) problems.push('labels must number ' + String(EMO_LABEL_COUNT) + ', not ' + String(meta.labels.length))
    if (meta.n_hashes !== EMO_N_HASHES) problems.push('n_hashes must be ' + String(EMO_N_HASHES))
    if (meta.n_buckets !== EMO_N_BUCKETS) problems.push('n_buckets must be ' + String(EMO_N_BUCKETS))
    if (meta.n_importance !== EMO_N_IMPORTANCE) problems.push('n_importance must be ' + String(EMO_N_IMPORTANCE))
    if (meta.sem_pad_index !== EMO_SEM_PAD_INDEX) problems.push('sem_pad_index must be ' + String(EMO_SEM_PAD_INDEX))
    if (meta.fmax !== EMO_FMAX) problems.push('fmax must be ' + String(EMO_FMAX))
    if (meta.smax !== EMO_SMAX) problems.push('smax must be ' + String(EMO_SMAX))
    return problems.length > 0
      ? Effect.fail(new RuntimeUnavailable({ provider: 'litert', reason: 'emo_meta.json does not match the pinned artifact: ' + problems.join('; ') }))
      : Effect.succeed(meta)
  })
}

/** Read and parse the EMTK tokenizer. */
function loadTokenizer(assetDirectory: string): Effect.Effect<EmtTokenizer, RuntimeUnavailable> {
  return Effect.tryPromise({
    try: async () => parseEmtTokenizer(new Uint8Array(await readFile(path.join(assetDirectory, 'emo_tokenizer.bin')))),
    catch: (cause) => new RuntimeUnavailable({ provider: 'litert', reason: 'the emo tokenizer cannot be used: ' + describeCause(cause) }),
  })
}

interface EmoOptions {
  readonly text: string
  readonly limit: number
}

/** Refuse one input before any tokenizer or engine work. */
function parseInput(input: Readonly<JsonObject>, maxInputBytes: number): Effect.Effect<EmoOptions, InvalidInput> {
  const ceiling = inputCeilingFailure(input, { maxInputBytes, timeoutMs: 0 })
  if (ceiling !== undefined) return Effect.fail(ceiling)
  const keys = closedKeyFailure(input, INPUT_KEYS, 'text and limit')
  if (keys !== undefined) return Effect.fail(keys)

  const textValue = input['text']
  if (textValue === undefined) return Effect.fail(new InvalidInput({ field: 'text', message: 'text is required' }))
  if (!Schema.is(Schema.String)(textValue)) return Effect.fail(new InvalidInput({ field: 'text', message: 'text must be a string' }))
  const codePoints = Array.from(textValue).length
  if (codePoints === 0) return Effect.fail(new InvalidInput({ field: 'text', message: 'text must not be empty' }))
  if (codePoints > EMO_MAX_TEXT_CHARACTERS) {
    return Effect.fail(
      new InvalidInput({
        field: 'text',
        message: 'text must be at most ' + String(EMO_MAX_TEXT_CHARACTERS) + ' Unicode code points',
      }),
    )
  }
  const trimmed = textValue.trim()
  if (trimmed.length === 0) return Effect.fail(new InvalidInput({ field: 'text', message: 'text must not be empty or whitespace only' }))

  const limitValue = input['limit']
  if (limitValue !== undefined) {
    if (!Schema.is(Schema.Int)(limitValue) || limitValue < 1 || limitValue > EMO_MAX_LIMIT) {
      return Effect.fail(
        new InvalidInput({
          field: 'limit',
          message: 'limit must be an integer between 1 and ' + String(EMO_MAX_LIMIT) + ', or omitted for the default of ' + String(EMO_DEFAULT_LIMIT),
        }),
      )
    }
  }
  return Effect.succeed({ text: trimmed, limit: limitValue ?? EMO_DEFAULT_LIMIT })
}

/** The fixed-window feeds (Model.swift:38-74). */
function packFeeds(meta: EmoMeta, tokenizer: EmtTokenizer, text: string) {
  const ngrams = encodeNgrams(text, {
    nBuckets: meta.n_buckets,
    nHashes: meta.n_hashes,
    nImportance: meta.n_importance,
    maxFeatures: meta.fmax,
  })
  const featureCount = ngrams.count
  const buckets = new Int32Array(meta.fmax * meta.n_hashes)
  const signs = new Float32Array(meta.fmax * meta.n_hashes)
  const importance = new Int32Array(meta.fmax)
  buckets.set(ngrams.buckets, 0)
  signs.set(ngrams.signs, 0)
  importance.set(ngrams.importance, 0)

  let ids = tokenizer.encode(text)
  if (ids.length > meta.smax) ids = ids.slice(0, meta.smax)
  const semIDs = new Int32Array(meta.smax)
  semIDs.fill(meta.sem_pad_index)
  const semMask = new Float32Array(meta.smax)
  if (ids.length === 0) {
    semMask[0] = 1
  } else {
    for (let index = 0; index < ids.length; index += 1) {
      semIDs[index] = ids[index] ?? meta.sem_pad_index
      semMask[index] = 1
    }
  }

  return {
    ngram_buckets: { data: buckets, dims: [1, meta.fmax, meta.n_hashes] },
    ngram_signs: { data: signs, dims: [1, meta.fmax, meta.n_hashes] },
    ngram_importance: { data: importance, dims: [1, meta.fmax] },
    ngram_count: { data: Float32Array.from([Math.max(featureCount, 1)]), dims: [1, 1] },
    sem_ids: { data: semIDs, dims: [1, meta.smax] },
    sem_mask: { data: semMask, dims: [1, meta.smax] },
  }
}

/** The emo processor. */
export const emoTextProcessor: RecipeProcessor = {
  id: EMO_PROCESSOR,
  features: [EMO_PROCESSOR],
  invoke: ({ input, limits, assetDirectory }) =>
    Effect.gen(function* () {
      const options = yield* parseInput(input, limits.maxInputBytes)
      const meta = yield* loadMeta(assetDirectory)
      const tokenizer = yield* loadTokenizer(assetDirectory)
      const session = yield* LitertSession
      const raw = yield* session.run(packFeeds(meta, tokenizer, options.text))
      const probabilities = raw[OUTPUT_NAME]
      if (!(probabilities instanceof Float32Array) || probabilities.length !== meta.labels.length) {
        return yield* Effect.fail(
          new RuntimeUnavailable({
            provider: 'litert',
            reason:
              'the emo model returned ' + String(probabilities?.length ?? 'no') + ' probabilities for ' + String(meta.labels.length) + ' labels',
          }),
        )
      }
      return yield* Effect.try({
        try: () => {
          for (const value of probabilities) {
            if (!Number.isFinite(value)) throw new Error('the emo model returned a non-finite probability')
          }
          const ranked = meta.labels.map((emoji, index) => ({ emoji, confidence: probabilities[index] ?? 0, index }))
          ranked.sort((a, b) => b.confidence - a.confidence || a.index - b.index)
          const suggestions = ranked.slice(0, options.limit).map((entry) => ({ emoji: entry.emoji, confidence: entry.confidence }))
          return { suggestions, labels: meta.labels.length }
        },
        catch: (cause) => new InferenceFailed({ provider: 'litert', phase: 'post', message: describeCause(cause) }),
      })
    }),
}
