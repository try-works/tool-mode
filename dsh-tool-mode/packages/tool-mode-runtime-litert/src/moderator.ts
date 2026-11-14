/**
 * Processor moderator/crops-v1: on-device NSFW classification over 384px Pillow-bilinear crops.
 *
 * PRIMARY SOURCE (Desert-Ant-Labs/desert-ant-core @ main, fetched 2026-11-14). Every constant
 * and decision rule below is taken from it; the file:line references are the contract:
 * - Sources/Moderator/Preprocess.swift:9-10   side 384, zooms [0.85, 0.70, 0.55]
 * - Sources/Moderator/Preprocess.swift:26-27  accurate = tiles followed by their mirrors
 * - Sources/Moderator/Preprocess.swift:32-38  fast/balanced windows (letterbox + zoom squares)
 * - Sources/Moderator/Preprocess.swift:54-162 Pillow BILINEAR, bit-exact (see pillow.ts)
 * - Sources/Moderator/Model.swift:24          head order nipples, genitals, buttocks, nude, sexAct
 * - Sources/Moderator/Model.swift:29-30       input "image" [1,384,384,3] float32 raw RGB,
 *                                             output "scores" (normalisation is inside the model)
 * - Sources/Moderator/Model.swift:45-47       per-head max over crops
 * - Sources/Moderator/Moderator.swift:36-55   Quality (fast/balanced/accurate) and Policy
 *                                             (standard/allowTopless)
 * - Sources/Moderator/Moderator.swift:66-71   upstream defaults: threshold 0.5, policy standard,
 *                                             quality accurate; OUR tool contract defaults quality
 *                                             to balanced per docs/runtime/PHASE4.md:29.
 * - Sources/Moderator/Moderator.swift:96-101  score = max over the heads the policy counts
 * - Sources/Moderator/Moderator.swift:113-117 isNSFW = score >= threshold
 * - Sources/Moderator/Moderator.swift:3-31    ImagePixels: 8-bit RGB/RGBA, alpha ignored
 *
 * INPUT (closed): { image_path, quality?, threshold?, policy? }. v1 decodes PNG only, through
 * the host's resolvePath authority; JPEG is refused by name (PHASE4:27-29).
 * OUTPUT (exactly): { isNSFW, score, threshold, policy, quality, regions, crops } where
 * regions = { nipples, genitals, buttocks, nude, sexAct } (per-head max) and crops is the
 * integer number of crops scored: 1 fast, 4 balanced, 8 accurate.
 *
 * HONEST LIMITS: the model is an adult-content classifier. This processor makes no claim
 * about minors or non-adult content, and the scores are decision scores, not calibrated
 * probabilities. Vendor per-class fit gates from shapes/moderator metadata are not applied.
 */

import { readFile } from 'node:fs/promises'

import { Effect, Schema } from 'effect'

import type { InvocationContextV1, JsonObject } from '@try-works/tool-mode-extension-sdk'
import { InferenceFailed, InvalidInput } from '@try-works/tool-mode-runtime-core'

import { describeCause } from './errors.ts'
import {
  TILE_SIDE,
  cropTiles,
  type ImagePixels,
  type ModeratorQuality,
} from './pillow.ts'
import { decodePngToRgb } from './png.ts'
import { closedKeyFailure, inputCeilingFailure, type RecipeProcessor } from './processor.ts'
import { LitertSession } from './runtime.ts'

/** The processor id this module owns. */
export const MODERATOR_PROCESSOR = 'moderator/crops-v1'

/** The square side the model consumes (Preprocess.swift:9). */
export const MODERATOR_SIDE = TILE_SIDE

/** The graph's score head order (Model.swift:24). */
export const MODERATOR_HEADS = ['nipples', 'genitals', 'buttocks', 'nude', 'sexAct'] as const

/** One region head. */
export type ModeratorHead = (typeof MODERATOR_HEADS)[number]

/** The number of heads the graph emits (Model.swift:9). */
export const MODERATOR_SCORE_COUNT = MODERATOR_HEADS.length

/** Which region heads count toward the decision (Moderator.swift:49-55). */
export type ModeratorPolicy = 'standard' | 'allowTopless'

/** The supported quality dials (Moderator.swift:36-46). */
export const MODERATOR_QUALITIES = ['fast', 'balanced', 'accurate'] as const

/** The supported policies. */
export const MODERATOR_POLICIES = ['standard', 'allowTopless'] as const

/** Default decision threshold (Moderator.swift:66). */
export const MODERATOR_DEFAULT_THRESHOLD = 0.5

/** Our tool contract's default quality (PHASE4:29; upstream Options defaults to accurate). */
export const MODERATOR_DEFAULT_QUALITY: ModeratorQuality = 'balanced'

/** Default policy (Moderator.swift:66). */
export const MODERATOR_DEFAULT_POLICY: ModeratorPolicy = 'standard'

/** The longest image path this tool accepts. */
const MAX_PATH_CHARACTERS = 4096

const INPUT_KEYS = new Set(['image_path', 'quality', 'threshold', 'policy'])

const QualitySchema = Schema.Literals(['fast', 'balanced', 'accurate'])
const PolicySchema = Schema.Literals(['standard', 'allowTopless'])

const fail = (field: string, message: string): InvalidInput => new InvalidInput({ field, message })

interface ModeratorOptions {
  readonly imagePath: string
  readonly quality: ModeratorQuality
  readonly threshold: number
  readonly policy: ModeratorPolicy
}

/** Validate the closed input and fill the PHASE4 defaults. */
function parseInput(input: Readonly<JsonObject>, maxInputBytes: number): Effect.Effect<ModeratorOptions, InvalidInput> {
  const ceiling = inputCeilingFailure(input, { maxInputBytes, timeoutMs: 0 })
  if (ceiling !== undefined) return Effect.fail(ceiling)
  const keys = closedKeyFailure(input, INPUT_KEYS, 'image_path, quality, threshold and policy')
  if (keys !== undefined) return Effect.fail(keys)

  const imagePath = input['image_path']
  if (imagePath === undefined) return Effect.fail(fail('image_path', 'image_path is required'))
  if (!Schema.is(Schema.String)(imagePath) || imagePath.length === 0) {
    return Effect.fail(fail('image_path', 'image_path must be a non-empty string'))
  }
  if (imagePath.length > MAX_PATH_CHARACTERS) {
    return Effect.fail(fail('image_path', 'image_path must be at most ' + String(MAX_PATH_CHARACTERS) + ' characters'))
  }

  const qualityValue = input['quality']
  if (qualityValue !== undefined && !Schema.is(QualitySchema)(qualityValue)) {
    return Effect.fail(fail('quality', 'quality must be one of fast, balanced, accurate'))
  }
  const policyValue = input['policy']
  if (policyValue !== undefined && !Schema.is(PolicySchema)(policyValue)) {
    return Effect.fail(fail('policy', 'policy must be standard or allowTopless'))
  }

  const thresholdValue = input['threshold']
  if (thresholdValue !== undefined && !Schema.is(Schema.Finite)(thresholdValue)) {
    return Effect.fail(fail('threshold', 'threshold must be a finite number'))
  }
  if (thresholdValue !== undefined && (thresholdValue < 0 || thresholdValue > 1)) {
    return Effect.fail(fail('threshold', 'threshold must be between 0 and 1'))
  }

  return Effect.succeed({
    imagePath,
    quality: qualityValue ?? MODERATOR_DEFAULT_QUALITY,
    threshold: thresholdValue ?? MODERATOR_DEFAULT_THRESHOLD,
    policy: policyValue ?? MODERATOR_DEFAULT_POLICY,
  })
}

/**
 * Resolve the caller's path through the host authority and decode it as PNG.
 *
 * Any failure -- a denied path, an unreadable file, JPEG bytes, an unsupported PNG variant --
 * is an InvalidInput naming image_path, because the caller can fix all of them.
 */
function loadImage(path: string, context: InvocationContextV1): Effect.Effect<ImagePixels, InvalidInput> {
  return Effect.tryPromise({
    try: async () => {
      const resolved = context.resolvePath(path)
      const decoded = decodePngToRgb(new Uint8Array(await readFile(resolved)))
      return { width: decoded.width, height: decoded.height, channels: 3 as const, pixels: decoded.rgb }
    },
    catch: (cause) => fail('image_path', 'image_path cannot be used: ' + describeCause(cause)),
  })
}

/** Crop the image; a preprocessing failure is an invalid image rather than an inference failure. */
function tilesFor(image: ImagePixels, quality: ModeratorQuality): Effect.Effect<readonly Uint8Array[], InvalidInput> {
  return Effect.try({
    try: () => cropTiles(image, quality),
    catch: (cause) => fail('image_path', 'the image cannot be cropped: ' + describeCause(cause)),
  })
}

/** Read and validate one score vector (Model.swift:31-33). */
function scoreVector(raw: Readonly<Record<string, Float32Array>>): Effect.Effect<Float32Array, InferenceFailed> {
  return Effect.try({
    try: () => {
      const scores = raw['scores']
      if (!(scores instanceof Float32Array) || scores.length !== MODERATOR_SCORE_COUNT) {
        throw new Error(
          'the model returned scores with ' + String(scores?.length ?? 'no') + ' values; expected ' + String(MODERATOR_SCORE_COUNT),
        )
      }
      for (const value of scores) {
        if (!Number.isFinite(value)) throw new Error('the model returned a non-finite score')
      }
      return scores
    },
    catch: (cause) => new InferenceFailed({ provider: 'litert', phase: 'post', message: describeCause(cause) }),
  })
}

/** Build exactly the tool schema's seven keys (Moderator.swift:96-117). */
function composeOutput(options: ModeratorOptions, peaks: readonly number[], crops: number): JsonObject {
  const regions = {
    nipples: peaks[0] ?? 0,
    genitals: peaks[1] ?? 0,
    buttocks: peaks[2] ?? 0,
    nude: peaks[3] ?? 0,
    sexAct: peaks[4] ?? 0,
  }
  const score =
    options.policy === 'standard'
      ? Math.max(regions.nipples, regions.genitals, regions.buttocks, regions.nude, regions.sexAct)
      : Math.max(regions.genitals, regions.buttocks, regions.nude, regions.sexAct)
  return {
    isNSFW: score >= options.threshold,
    score,
    threshold: options.threshold,
    policy: options.policy,
    quality: options.quality,
    regions,
    crops,
  }
}

/** The moderator processor. */
export const moderatorCropsProcessor: RecipeProcessor = {
  id: MODERATOR_PROCESSOR,
  features: [MODERATOR_PROCESSOR],
  invoke: ({ input, context, limits }) =>
    Effect.gen(function* () {
      const options = yield* parseInput(input, limits.maxInputBytes)
      const image = yield* loadImage(options.imagePath, context)
      const tiles = yield* tilesFor(image, options.quality)
      const session = yield* LitertSession
      const peaks: number[] = [0, 0, 0, 0, 0]
      for (const tile of tiles) {
        const data = Float32Array.from(tile)
        const raw = yield* session.run({
          image: { data, dims: [1, MODERATOR_SIDE, MODERATOR_SIDE, 3] },
        })
        const scores = yield* scoreVector(raw)
        for (let head = 0; head < MODERATOR_SCORE_COUNT; head += 1) {
          peaks[head] = Math.max(peaks[head] ?? 0, scores[head] ?? 0)
        }
      }
      return composeOutput(options, peaks, tiles.length)
    }),
}
