/**
 * BIOES span decoding and cross-window span merging.
 *
 * Decode works on ONE window. It returns spans in the same coordinate system as the offsets it
 * is handed, so the caller passes the window's slice of the original token offsets (including
 * the repeated special tokens) and receives global character offsets back.
 *
 * Two rules are deliberate:
 *
 * 1. **The span score is the minimum token probability in the span.** A redaction decision is
 *    only as safe as its weakest token; averaging would let one confident sub-token hide an
 *    uncertain one.
 * 2. **A malformed sequence is repaired locally, never dropped silently.** An I with no B starts
 *    a span, a B with no E closes as a single-token span, and only a label below minScore or an
 *    O token ends a span. The model is a triage signal, so under-reporting is worse than a
 *    repaired boundary.
 *
 * @module @try-works/tool-mode-runtime-processors/bioes
 */

import type { TokenOffset } from './offsets.ts'

/** One decoded entity span, in UTF-16 code units. */
export interface Span {
  readonly start: number
  readonly end: number
  readonly label: string
  readonly score: number
}

/**
 * Logits geometry: tokens multiplied by labels entries, row-major.
 * The PLAN's decodeBioes parameter is named shape; this is the named type behind it.
 */
export interface LogitsGeometry {
  readonly tokens: number
  readonly labels: number
}

/** The BIOES prefixes this decoder understands. */
const BIOES_PREFIXES = new Set(['B', 'I', 'E', 'S'])
const OUTSIDE = 'O'
const SCORE_DECIMALS = 6

/** Round a probability to a stable published precision. */
function roundScore(value: number): number {
  const factor = 10 ** SCORE_DECIMALS
  return Math.round(value * factor) / factor
}

/** The winning label for one token row and its probability. */
interface LabelProbability {
  readonly index: number
  readonly probability: number
}

/** Softmax for one token row, returning the argmax label and its probability. */
function argmaxProbability(logits: Float32Array, rowOffset: number, labels: number): LabelProbability {
  let maximum = Number.NEGATIVE_INFINITY
  for (let label = 0; label < labels; label += 1) {
    const value = logits[rowOffset + label]
    if (value !== undefined && Number.isFinite(value) && value > maximum) maximum = value
  }
  if (maximum === Number.NEGATIVE_INFINITY) return { index: 0, probability: 0 }
  let sum = 0
  let bestIndex = 0
  let bestValue = Number.NEGATIVE_INFINITY
  for (let label = 0; label < labels; label += 1) {
    const value = logits[rowOffset + label]
    const finite = value !== undefined && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY
    sum += Math.exp(finite - maximum)
    if (finite > bestValue) {
      bestValue = finite
      bestIndex = label
    }
  }
  return { index: bestIndex, probability: Math.exp(bestValue - maximum) / sum }
}

/** An open span being assembled. */
interface OpenSpan {
  readonly label: string
  readonly start: number
  end: number
  score: number
}

/**
 * Decode one window's logits into entity spans.
 *
 * @param logits - row-major probabilities or logits, tokens rows by labels columns.
 * @param shape - logits geometry.
 * @param labels - label table, including O and BIOES-prefixed entity names.
 * @param offsets - one offset per token; zero-width tokens (specials) are skipped.
 * @param minScore - probability floor for a token to be reported at all.
 * @returns spans in reading order, in the offsets' coordinate system.
 * @throws Error when the arrays disagree with the shape or minScore is outside 0..1.
 */
export function decodeBioes(
  logits: Float32Array,
  shape: LogitsGeometry,
  labels: readonly string[],
  offsets: readonly TokenOffset[],
  minScore: number,
): readonly Span[] {
  if (!Number.isInteger(shape.tokens) || shape.tokens < 0) {
    throw new Error('shape.tokens must be a non-negative integer')
  }
  if (!Number.isInteger(shape.labels) || shape.labels < 1) {
    throw new Error('shape.labels must be a positive integer')
  }
  if (logits.length !== shape.tokens * shape.labels) {
    throw new Error('logits length must equal shape.tokens * shape.labels')
  }
  if (labels.length !== shape.labels) {
    throw new Error('labels length must equal shape.labels')
  }
  if (offsets.length !== shape.tokens) {
    throw new Error('offsets length must equal shape.tokens')
  }
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
    throw new Error('minScore must be between 0 and 1')
  }

  const spans: Span[] = []
  let open: OpenSpan | undefined

  const close = (): void => {
    if (open === undefined) return
    if (open.end > open.start) {
      spans.push({ start: open.start, end: open.end, label: open.label, score: roundScore(open.score) })
    }
    open = undefined
  }

  for (let token = 0; token < shape.tokens; token += 1) {
    const offset = offsets[token]
    if (offset === undefined) continue
    const { index, probability } = argmaxProbability(logits, token * shape.labels, shape.labels)
    const raw = labels[index]
    if (raw === undefined || raw === OUTSIDE) {
      close()
      continue
    }
    if (probability < minScore || offset.end <= offset.start) {
      close()
      continue
    }
    const prefix = raw.charAt(0)
    const component = raw.indexOf('-')
    const label = component > 0 ? raw.slice(component + 1) : ''
    if (label.length === 0 || !BIOES_PREFIXES.has(prefix)) {
      close()
      continue
    }

    if (prefix === 'S') {
      close()
      spans.push({ start: offset.start, end: offset.end, label, score: roundScore(probability) })
      continue
    }
    if (prefix === 'B') {
      close()
      open = { label, start: offset.start, end: offset.end, score: probability }
      continue
    }
    if (prefix === 'E') {
      if (open !== undefined && open.label === label) {
        open.end = Math.max(open.end, offset.end)
        open.score = Math.min(open.score, probability)
        close()
      } else {
        close()
        spans.push({ start: offset.start, end: offset.end, label, score: roundScore(probability) })
      }
      continue
    }
    // I continues only the same entity; anything else starts a repaired span here.
    if (open === undefined || open.label !== label) {
      close()
      open = { label, start: offset.start, end: offset.end, score: probability }
    } else {
      open.end = Math.max(open.end, offset.end)
      open.score = Math.min(open.score, probability)
    }
  }
  close()
  return spans
}

/** Whether the candidate should replace the incumbent on a cross-label overlap. */
function candidateWins(candidate: Span, incumbent: Span): boolean {
  if (candidate.score !== incumbent.score) return candidate.score > incumbent.score
  const candidateLength = candidate.end - candidate.start
  const incumbentLength = incumbent.end - incumbent.start
  if (candidateLength !== incumbentLength) return candidateLength > incumbentLength
  return candidate.start < incumbent.start
}

/**
 * Merge spans decoded from overlapping windows.
 *
 * Same-label spans that overlap or touch are unioned and keep the best score, because the
 * overlap exists to let a span survive the window boundary. Different labels that claim the same
 * characters cannot both be true; the higher score wins, then the longer span, then the earlier
 * start, so the outcome does not depend on window order.
 *
 * @param spans - spans from any number of windows, in any order.
 * @returns non-overlapping spans in reading order.
 */
export function mergeSpans(spans: readonly Span[]): readonly Span[] {
  const ordered = spans
    .filter(span => span.end > span.start)
    .slice()
    .sort((left, right) => {
      if (left.start !== right.start) return left.start - right.start
      if (left.end !== right.end) return right.end - left.end
      if (left.label === right.label) return 0
      return left.label < right.label ? -1 : 1
    })

  const merged: Span[] = []
  for (const candidate of ordered) {
    let pending: Span = { ...candidate }
    let discarded = false
    while (merged.length > 0) {
      const incumbent = merged[merged.length - 1]
      if (incumbent === undefined) break
      if (pending.start > incumbent.end) break
      if (pending.start === incumbent.end && incumbent.label !== pending.label) break
      if (incumbent.label === pending.label) {
        merged.pop()
        pending = {
          start: Math.min(incumbent.start, pending.start),
          end: Math.max(incumbent.end, pending.end),
          label: pending.label,
          score: Math.max(incumbent.score, pending.score),
        }
        continue
      }
      if (candidateWins(pending, incumbent)) {
        merged.pop()
        continue
      }
      discarded = true
      break
    }
    if (!discarded) merged.push(pending)
  }
  return merged
}
