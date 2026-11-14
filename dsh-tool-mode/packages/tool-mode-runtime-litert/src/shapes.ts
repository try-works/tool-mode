/**
 * Processor shapes/points-v1 (Phase 2, extension-shapes-recipe).
 *
 * Input: { points: [[x, y], ...] (at least two finite pairs), closed?: boolean }.
 * closed === true appends the first point; the stroke is resampled to 128 points by arc
 * length, the bounding box is centred on the origin and the longer side is scaled to 1.
 * The model input is points [1,128,2] float32; outputs are probs [13] + head [128].
 * Output: { shape, confidence, candidates, rejected } in the MEASURED class order.
 */

/*
 * The anti-slop no-shape rule targets structural "shape" placeholders in type names. Here
 * "shape" is the DOMAIN: the shapes/points-v1 processor recognizes 2D geometric shapes, and
 * the recipe's output schema field is literally "shape". Renaming the domain noun to satisfy
 * the rule would make the contract less honest, so the rule is disabled for this file only.
 */
/* oxlint-disable anti-slop/no-shape-in-symbol-names */

import { Effect, Schema } from 'effect'

import type { JsonObject, JsonValue } from '@try-works/tool-mode-extension-sdk'
import { InferenceFailed, InvalidInput } from '@try-works/tool-mode-runtime-core'

import { describeCause } from './errors.ts'
import { closedKeyFailure, inputCeilingFailure, type RecipeProcessor } from './processor.ts'
import { LitertSession } from './runtime.ts'

/** The processor id this module owns. */
export const SHAPES_POINTS_PROCESSOR = 'shapes/points-v1'

/** The fixed stroke length the model consumes. */
export const SHAPES_POINT_COUNT = 128

/** The number of classes the classifier head emits. */
export const SHAPES_CLASS_COUNT = 13

/**
 * The model's class-index order, measured on the pinned shapes.tflite artifact (2026-11-14):
 * a horizontal line puts 0.9505 on index 1, an axis-aligned rectangle 0.9534 on index 3, a
 * triangle 0.9528 on index 5 and a circle 0.9514 on index 4. That matches the pinned
 * shapes_meta.json order, NOT the order a JSON-Schema enum happens to list.
 */
export const SHAPES_CLASSES = [
  'none',
  'line',
  'arrow',
  'rectangle',
  'ellipse',
  'triangle',
  'diamond',
  'pentagon',
  'hexagon',
  'star',
  'heart',
  'cloud',
  'scribble',
] as const

/** One class name from the measured model order. */
export type ShapesClass = (typeof SHAPES_CLASSES)[number]

const INPUT_KEYS = new Set(['points', 'closed'])

const ShapesInputSchema = Schema.Struct({
  points: Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite])),
  closed: Schema.optional(Schema.Boolean),
})

type ShapesInput = typeof ShapesInputSchema['Type']

/** Refuse one input before any inference: size ceiling, closed keys and the stroke shape. */
function parseInput(input: Readonly<JsonObject>, maxInputBytes: number): Effect.Effect<ShapesInput, InvalidInput> {
  const ceiling = inputCeilingFailure(input, { maxInputBytes, timeoutMs: 0 })
  if (ceiling !== undefined) return Effect.fail(ceiling)
  const keys = closedKeyFailure(input, INPUT_KEYS, 'points and closed')
  if (keys !== undefined) return Effect.fail(keys)
  const decoded = Schema.decodeUnknownOption(ShapesInputSchema)(input)
  if (decoded._tag === 'None') {
    return Effect.fail(
      new InvalidInput({
        field: 'points',
        message: 'points must be an array of [x, y] finite number pairs and closed must be a boolean when present',
      }),
    )
  }
  if (decoded.value.points.length < 2) {
    return Effect.fail(new InvalidInput({ field: 'points', message: 'a stroke needs at least two points' }))
  }
  return Effect.succeed(decoded.value)
}

/**
 * The processor's preprocessing: close when asked, resample by arc length to 128 points,
 * centre the bounding box on the origin and scale the longer side to 1.
 *
 * A stroke with no length or a zero-extent bounding box is refused rather than fed as 128
 * copies of one point: that is not a drawing the classifier can judge.
 */
function resampleStroke(input: ShapesInput): Float32Array {
  const source = input.points
  const first = source[0]
  if (source.length < 2 || first === undefined) throw new Error('a stroke needs at least two points')
  const stroke = input.closed === true ? [...source, first] : [...source]

  const cumulative: number[] = [0]
  let total = 0
  for (let index = 1; index < stroke.length; index += 1) {
    const previous = stroke[index - 1]
    const current = stroke[index]
    if (previous === undefined || current === undefined) throw new Error('the stroke lost a point while resampling')
    total += Math.hypot(current[0] - previous[0], current[1] - previous[1])
    cumulative.push(total)
  }
  if (total <= 0) throw new Error('the stroke is degenerate: its total length is zero')

  const xs: number[] = []
  const ys: number[] = []
  let segment = 0
  for (let sample = 0; sample < SHAPES_POINT_COUNT; sample += 1) {
    const target = (sample * total) / (SHAPES_POINT_COUNT - 1)
    while (segment < stroke.length - 2 && (cumulative[segment + 1] ?? 0) < target) segment += 1
    const start = stroke[segment]
    const end = stroke[segment + 1]
    if (start === undefined || end === undefined) throw new Error('the stroke lost a segment while resampling')
    const startLength = cumulative[segment] ?? 0
    const endLength = cumulative[segment + 1] ?? startLength
    const span = endLength - startLength
    const portion = span > 0 ? (target - startLength) / span : 0
    xs.push(start[0] + (end[0] - start[0]) * portion)
    ys.push(start[1] + (end[1] - start[1]) * portion)
  }

  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const extent = Math.max(maxX - minX, maxY - minY)
  if (extent <= 0) throw new Error('the stroke is degenerate: its bounding box has zero extent')

  const data = new Float32Array(SHAPES_POINT_COUNT * 2)
  for (let index = 0; index < SHAPES_POINT_COUNT; index += 1) {
    const x = xs[index]
    const y = ys[index]
    if (x === undefined || y === undefined) throw new Error('the stroke produced too few samples')
    data[index * 2] = (x - centerX) / extent
    data[index * 2 + 1] = (y - centerY) / extent
  }
  return data
}

/** The preprocessing as a typed effect: a degenerate stroke is an invalid input. */
function feedFor(input: ShapesInput): Effect.Effect<Float32Array, InvalidInput> {
  return Effect.try({
    try: () => resampleStroke(input),
    catch: (cause) => new InvalidInput({ field: 'points', message: describeCause(cause) }),
  })
}

/** Map the engine's 13-class probabilities onto the shapes recipe's output schema. */
function toolOutput(raw: Readonly<Record<string, Float32Array>>): Effect.Effect<JsonObject, InferenceFailed> {
  return Effect.try({
    try: () => {
      const probs = raw['probs']
      const fitted = raw['head']
      if (!(probs instanceof Float32Array) || probs.length !== SHAPES_CLASS_COUNT) {
        throw new Error('the model returned probs with ' + String(probs?.length ?? 'no') + ' values; expected ' + String(SHAPES_CLASS_COUNT))
      }
      if (!(fitted instanceof Float32Array) || fitted.length !== SHAPES_POINT_COUNT) {
        throw new Error('the model returned head with ' + String(fitted?.length ?? 'no') + ' values; expected ' + String(SHAPES_POINT_COUNT))
      }
      const ranked = SHAPES_CLASSES.map((shape, index) => ({ shape, index, confidence: probs[index] ?? 0 })).sort(
        (a, b) => b.confidence - a.confidence || a.index - b.index,
      )
      const top = ranked[0]
      if (top === undefined) throw new Error('the model returned no class probabilities')
      const candidates: JsonValue[] = ranked
        .slice(1)
        .map((entry) => ({ shape: entry.shape, confidence: entry.confidence }))
      return {
        shape: top.shape,
        confidence: top.confidence,
        candidates,
        rejected: top.shape === 'none' || top.shape === 'scribble',
      }
    },
    catch: (cause) => new InferenceFailed({ provider: 'litert', phase: 'post', message: describeCause(cause) }),
  })
}

/** The shapes processor. */
export const shapesPointsProcessor: RecipeProcessor = {
  id: SHAPES_POINTS_PROCESSOR,
  features: [SHAPES_POINTS_PROCESSOR],
  invoke: ({ input, limits }) =>
    Effect.gen(function* () {
      const parsed = yield* parseInput(input, limits.maxInputBytes)
      const data = yield* feedFor(parsed)
      const session = yield* LitertSession
      const raw = yield* session.run({
        points: { data, dims: [1, SHAPES_POINT_COUNT, 2] },
      })
      return yield* toolOutput(raw)
    }),
}
