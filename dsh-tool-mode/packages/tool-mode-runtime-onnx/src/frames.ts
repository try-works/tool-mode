/**
 * Frames, spans and coverage (PHASE3 processor uhm/waveform-v1, steps 3-5).
 *
 * The model emits one probability row per 20 ms frame. Turning 1499 rows per window into
 * spans that a caller can cut a recording with is where the honest-timeline decisions live:
 *
 * - **Every absolute frame is decided ONCE.** Windows overlap by a second, so the last
 *   1450 frames of one window are the first frames of the next. A frame is a FILLER if
 *   either window calls it one at or above the threshold — the overlap exists so a word
 *   seen at a window edge by one window is not vetoed by the other — and between two
 *   filler calls the higher probability wins; an exact tie keeps the earlier window.
 *   Averaging instead would invent a confidence neither window produced.
 * - **A filler frame is `class != 0 && probability >= 0.5`.** Class 0 is `not_filler`,
 *   and a filler word that the model is not sure about is not worth cutting out.
 * - **One frame gap is tolerated.** A single non-filler frame between two filler frames of
 *   the same class is a boundary artefact, not two separate fillers.
 * - **Spans are clipped to the audio length.** The final window is zero padded to 30 s, so
 *   frames past the real audio carry no evidence and are dropped; a frame that straddles
 *   the end is clipped.
 *
 * @module frames
 */

/*
 * `parseUhmLabels` IS the validation boundary for the package's hand-editable labels.json:
 * taking `unknown`, proving each field at run time and naming what is wrong is its job. The
 * generic anti-slop rules assume a caller that already has a typed document, so they are
 * disabled for this boundary only.
 */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof */

import { UHM_FRAME_SAMPLES, UHM_SAMPLE_RATE, type AudioWindow } from './wav.ts'

/** The labels file the pinned asset set carries next to the model. */
export const UHM_LABELS_FILE = 'labels.json'

/** The number of classes the pinned model head emits. */
export const UHM_CLASS_COUNT = 6

/** A frame is a filler only at or above this probability. */
export const UHM_FILLER_THRESHOLD = 0.5

/** The filler classes the output contract can name (class 0 is not a filler). */
export const UHM_FILLER_TYPES = ['uh', 'um', 'hmm', 'and', 'other'] as const

/** One filler class name. */
export type UhmFillerType = (typeof UHM_FILLER_TYPES)[number]

/** What {@link parseUhmLabels} returns. */
export type UhmLabelsParseResult =
  | { readonly ok: true; readonly labels: readonly string[] }
  | { readonly ok: false; readonly reason: string }

/** One window's model output, as the session returned it. */
export interface UhmWindowRun {
  readonly window: AudioWindow
  /** Frame-major probabilities, length `frames * classes`. */
  readonly data: Float32Array
  /** The model output dims, either `[1, frames, classes]` or `[frames, classes]`. */
  readonly dims: readonly number[]
}

/** One merged filler span, in milliseconds. */
export interface UhmSpan {
  readonly startMs: number
  readonly endMs: number
  readonly type: UhmFillerType
  readonly confidence: number
}

/** How much of the audio was analysed. */
export interface UhmCoverage {
  readonly complete: boolean
  readonly processedSeconds: number
  readonly totalSeconds: number
  readonly reason?: string
}

/** What the uhm processor returns. */
export interface UhmResult {
  readonly fillers: readonly UhmSpan[]
  readonly coverage: UhmCoverage
}

/** The input {@link uhmResultFromWindows} needs. */
export interface UhmResultInput {
  readonly runs: readonly UhmWindowRun[]
  /** The decoded 16 kHz mono sample count, i.e. the real audio length. */
  readonly totalSamples: number
  readonly labels: readonly string[]
}

/** Whether a value is a plain JSON object. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Read the label array out of either accepted document shape. */
function readLabelArray(raw: unknown): UhmLabelsParseResult {
  if (Array.isArray(raw)) {
    const labels: string[] = []
    for (const [index, value] of raw.entries()) {
      if (typeof value !== 'string' || value.length === 0) {
        return { ok: false, reason: `label ${String(index)} must be a non-empty string` }
      }
      labels.push(value)
    }
    return { ok: true, labels }
  }
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'the labels document must be a JSON object with an id2label table, or an array of labels' }
  }
  const table = raw['id2label']
  if (!isPlainObject(table)) {
    return { ok: false, reason: 'the labels document has no id2label table' }
  }
  const labels: string[] = []
  for (let index = 0; index < UHM_CLASS_COUNT; index += 1) {
    const value = table[String(index)]
    if (typeof value !== 'string' || value.length === 0) {
      return {
        ok: false,
        reason: `the id2label table must name exactly six classes; class ${String(index)} is missing or not a string`,
      }
    }
    labels.push(value)
  }
  const extra = Object.keys(table).filter((key) => !/^\d+$/.test(key) || Number(key) >= UHM_CLASS_COUNT)
  if (extra.length > 0) {
    return {
      ok: false,
      reason: `the id2label table names classes beyond the six the model emits: ${extra.join(', ')}`,
    }
  }
  return { ok: true, labels }
}

/**
 * Parse the pinned `labels.json` into the class order the head emits.
 *
 * The ORDER is the contract, not any name lookup: frame class 1 must be `uh` because the
 * head was trained that way. The names are validated too, because the output contract can
 * only name the five filler classes — a drifted labels file must fail loudly rather than
 * emit a `type` the schema does not allow.
 *
 * @param raw - the parsed JSON document
 * @returns the labels in class order, or the reason they cannot be used
 */
export function parseUhmLabels(raw: unknown): UhmLabelsParseResult {
  const read = readLabelArray(raw)
  if (!read.ok) return read
  const labels = [...read.labels]
  if (labels.length !== UHM_CLASS_COUNT) {
    return {
      ok: false,
      reason: `the labels table must name exactly six classes; it names ${String(labels.length)}`,
    }
  }
  if (labels[0] !== 'not_filler') {
    return { ok: false, reason: `the first class must be not_filler; it is ${JSON.stringify(labels[0])}` }
  }
  const seen = new Set<string>()
  for (const [index, label] of labels.entries()) {
    if (seen.has(label)) {
      return { ok: false, reason: `the labels table repeats the class ${JSON.stringify(label)}` }
    }
    seen.add(label)
    if (index === 0) continue
    if (!isFillerType(label)) {
      return {
        ok: false,
        reason: `class ${String(index)} is ${JSON.stringify(label)}, which the filler output contract cannot name; allowed: ${UHM_FILLER_TYPES.join(', ')}`,
      }
    }
  }
  return { ok: true, labels }
}

/** Whether a label is one of the five filler classes. */
function isFillerType(label: string): label is UhmFillerType {
  return UHM_FILLER_TYPES.some((candidate) => candidate === label)
}

/** Return the label as a filler type, or throw if it is not one. */
function fillerType(label: string): UhmFillerType {
  for (const candidate of UHM_FILLER_TYPES) {
    if (candidate === label) return candidate
  }
  throw new Error(`the label ${JSON.stringify(label)} is not a filler type`)
}

/** One absolute frame's winning prediction. */
interface FrameCandidate {
  readonly frameIndex: number
  readonly classIndex: number
  readonly probability: number
  readonly startMs: number
  readonly endMs: number
}

/** A validated frame/class geometry. */
interface OutputGeometry {
  readonly frames: number
  readonly classes: number
}

/** Read and validate an output tensor's geometry. */
function readGeometry(dims: readonly number[], dataLength: number): OutputGeometry {
  let frames: number | undefined
  let classes: number | undefined
  if (dims.length === 3 && dims[0] === 1) {
    frames = dims[1]
    classes = dims[2]
  } else if (dims.length === 2) {
    frames = dims[0]
    classes = dims[1]
  } else {
    throw new Error(
      `the model output shape ${JSON.stringify(dims)} is neither (1, frames, classes) nor (frames, classes)`,
    )
  }
  if (
    frames === undefined
    || classes === undefined
    || !Number.isInteger(frames)
    || !Number.isInteger(classes)
    || frames <= 0
    || classes <= 0
  ) {
    throw new Error(`the model output shape ${JSON.stringify(dims)} is not a positive integer geometry`)
  }
  if (frames * classes !== dataLength) {
    throw new Error(
      `the model output data length is ${String(dataLength)} but the shape ${JSON.stringify(dims)} needs ${String(frames * classes)}`,
    )
  }
  return { frames, classes }
}

/**
 * Rank two predictions of the same absolute frame.
 *
 * A qualifying filler call outranks any non-filler call, so a window that saw a filler is
 * not vetoed by the other window's `not_filler`. Within the same kind, the higher
 * probability wins; equal ranks keep the earlier window.
 */
function rankCandidate(classIndex: number, probability: number): number {
  const isFiller = classIndex !== 0 && probability >= UHM_FILLER_THRESHOLD
  return isFiller ? 1 + probability : probability
}

/** Clamp a confidence into the contract's range. */
function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * Turn window outputs into merged filler spans and honest coverage.
 *
 * `totalSamples` is the REAL audio length, so zero padded frames are dropped and spans are
 * clipped; it is never the padded window length.
 *
 * @param input - the window runs, the real sample count and the class order
 * @returns the filler spans and coverage
 * @throws Error when the model output is malformed (the provider maps this to InferenceFailed)
 */
export function uhmResultFromWindows(input: UhmResultInput): UhmResult {
  const { runs, totalSamples, labels } = input
  if (!Number.isInteger(totalSamples) || totalSamples < 0) {
    throw new Error('the total sample count must be a non-negative integer')
  }
  if (labels.length !== UHM_CLASS_COUNT) {
    throw new Error(
      `the label table names ${String(labels.length)} classes but the model emits ${String(UHM_CLASS_COUNT)}`,
    )
  }

  const byFrame = new Map<number, FrameCandidate>()
  for (const run of runs) {
    const { frames, classes } = readGeometry(run.dims, run.data.length)
    if (classes !== labels.length) {
      throw new Error(
        `the model emitted ${String(classes)} classes but the label table names ${String(labels.length)}`,
      )
    }
    for (let frame = 0; frame < frames; frame += 1) {
      const frameStartSample = run.window.startSample + frame * UHM_FRAME_SAMPLES
      // A frame that starts past the audio is entirely padding: there is nothing to report.
      if (frameStartSample >= totalSamples) continue
      const base = frame * classes
      let bestClass = 0
      let bestProbability = Number.NEGATIVE_INFINITY
      for (let column = 0; column < classes; column += 1) {
        const probability = run.data[base + column]
        if (probability === undefined || !Number.isFinite(probability)) {
          throw new Error(`the model output contains a non-finite probability at frame ${String(frame)}`)
        }
        if (probability > bestProbability) {
          bestProbability = probability
          bestClass = column
        }
      }
      const frameIndex = Math.round(frameStartSample / UHM_FRAME_SAMPLES)
      const startMs = Math.floor(frameStartSample / (UHM_SAMPLE_RATE / 1000))
      const endSample = Math.min(frameStartSample + UHM_FRAME_SAMPLES, totalSamples)
      const endMs = Math.floor(endSample / (UHM_SAMPLE_RATE / 1000))
      if (endMs <= startMs) continue
      const existing = byFrame.get(frameIndex)
      if (
        existing === undefined
        || rankCandidate(bestClass, bestProbability) > rankCandidate(existing.classIndex, existing.probability)
      ) {
        byFrame.set(frameIndex, { frameIndex, classIndex: bestClass, probability: bestProbability, startMs, endMs })
      }
    }
  }

  const candidates = [...byFrame.values()]
    .filter((candidate) => candidate.classIndex !== 0 && candidate.probability >= UHM_FILLER_THRESHOLD)
    .sort((left, right) => left.frameIndex - right.frameIndex)

  const fillers: UhmSpan[] = []
  let current:
    | { classIndex: number; lastFrameIndex: number; startMs: number; endMs: number; total: number; count: number }
    | undefined
  let currentType: UhmFillerType = 'uh'

  const flush = (): void => {
    if (current === undefined) return
    fillers.push({
      startMs: current.startMs,
      endMs: current.endMs,
      type: currentType,
      confidence: clampUnit(current.total / current.count),
    })
    current = undefined
  }

  for (const candidate of candidates) {
    const continues = current !== undefined
      && current.classIndex === candidate.classIndex
      && candidate.frameIndex - current.lastFrameIndex <= 2
    if (continues && current !== undefined) {
      current.lastFrameIndex = candidate.frameIndex
      current.endMs = candidate.endMs
      current.total += candidate.probability
      current.count += 1
      continue
    }
    flush()
    const label = labels[candidate.classIndex]
    if (label === undefined) {
      throw new Error(`the model emitted class ${String(candidate.classIndex)} but the label table has no such class`)
    }
    currentType = fillerType(label)
    current = {
      classIndex: candidate.classIndex,
      lastFrameIndex: candidate.frameIndex,
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      total: candidate.probability,
      count: 1,
    }
  }
  flush()

  const totalSeconds = totalSamples / UHM_SAMPLE_RATE
  return { fillers, coverage: { complete: true, processedSeconds: totalSeconds, totalSeconds } }
}
