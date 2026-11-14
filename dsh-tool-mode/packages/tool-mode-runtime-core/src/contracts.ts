/**
 * The runtime's request/result contracts.
 *
 * Every exported schema doubles as the runtime's validation boundary: a request
 * is decoded through {@link RuntimeRequest} before a provider sees it, and a
 * result is encoded through {@link RuntimeResult} before the host sees it. A
 * shape that is not in this module is not part of the boundary.
 *
 * Offsets are UTF-16 code units, the same units JavaScript strings use, so a
 * span can be sliced out with `text.slice(start, end)` and nothing else.
 *
 * @module contracts
 */

import { Schema } from 'effect'

/** The artifact formats a provider can execute. */
export const ModelFormat = Schema.Literals(['onnx', 'tflite', 'gguf'])
/** The artifact formats a provider can execute. */
export type ModelFormat = Schema.Schema.Type<typeof ModelFormat>

/** A pinned model artifact identity. */
export const ModelRef = Schema.Struct({
  id: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  digest: Schema.String,
})
/** A pinned model artifact identity. */
export type ModelRef = Schema.Schema.Type<typeof ModelRef>

/**
 * What the caller supplied.
 *
 * Which modalities are required is the model's business, not this contract's:
 * an empty input is structurally valid and a provider refuses it with
 * `InvalidInput` when its model needs, say, `text`.
 */
export const RuntimeInput = Schema.Struct({
  text: Schema.optional(Schema.String),
  audioPath: Schema.optional(Schema.String),
  imagePath: Schema.optional(Schema.String),
})
/** What the caller supplied. */
export type RuntimeInput = Schema.Schema.Type<typeof RuntimeInput>

/** The request limits the host enforces. */
export const Limits = Schema.Struct({ maxInputBytes: Schema.Int, timeoutMs: Schema.Int })
/** The request limits the host enforces. */
export type Limits = Schema.Schema.Type<typeof Limits>

/** A complete, decodable runtime request. */
export const RuntimeRequest = Schema.Struct({
  model: ModelRef,
  input: RuntimeInput,
  limits: Limits,
})
/** A complete, decodable runtime request. */
export type RuntimeRequest = Schema.Schema.Type<typeof RuntimeRequest>

/** One detected span: a half-open UTF-16 range plus its label and score. */
export const Span = Schema.Struct({
  start: Schema.Int,
  end: Schema.Int,
  label: Schema.NonEmptyString,
  text: Schema.String,
  score: Schema.Number,
})
/** One detected span: a half-open UTF-16 range plus its label and score. */
export type Span = Schema.Schema.Type<typeof Span>

/**
 * How much of the input the run actually covered.
 *
 * `complete: false` is an honest report, not a failure: the runtime caps the
 * number of windows it will process and says so, instead of silently claiming
 * the whole document.
 */
export const Coverage = Schema.Struct({
  complete: Schema.Boolean,
  processedUnits: Schema.Int,
  totalUnits: Schema.Int,
  reason: Schema.optional(Schema.String),
})
/** How much of the input the run actually covered. */
export type Coverage = Schema.Schema.Type<typeof Coverage>

/** What a provider returns. */
export const RuntimeResult = Schema.Struct({ spans: Schema.Array(Span), coverage: Coverage })
/** What a provider returns. */
export type RuntimeResult = Schema.Schema.Type<typeof RuntimeResult>
