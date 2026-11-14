/**
 * Processors for the local runtime: the pure, deterministic half of a redact pipeline.
 *
 * Everything here is a function of its arguments. No file is read, no model is loaded, no host
 * module is imported, and no Effect is involved: these are the pieces that must be testable
 * without an engine, and the pieces whose failure modes (an offset shifted by one character,
 * a card number labelled a phone) are invisible in a transcript but wrong in production.
 *
 * Pipeline position: the host tokenizes with the tokenizers package, normalises the reported
 * code-point offsets through utf16Offsets, then windows -> (model) -> decodeBioes -> mergeSpans.
 * deterministicPii runs alongside the model as the validated safety net.
 *
 * @module @try-works/tool-mode-runtime-processors
 */

export { utf16Offsets, type TokenOffset } from './offsets.ts'

export { windows, type TokenWindow, type WindowOptions } from './windows.ts'

export { decodeBioes, mergeSpans, type LogitsGeometry, type Span } from './bioes.ts'

export {
  deterministicPii,
  DETERMINISTIC_LABELS,
  ibanValid,
  luhnValid,
  type DeterministicSpan,
} from './deterministic.ts'

/** Redact window length in tokens, including the special pair. */
export const REDACT_MAX_LENGTH = 256

/** Redact window stride: 64 content tokens, so consecutive windows overlap by 190 tokens. */
export const REDACT_STRIDE = 64

/** Probability floor a token must clear before it can contribute to a span. */
export const REDACT_MIN_SCORE = 0.6

/** Maximum windows the local pipeline processes per request (start of the cap, per the plan). */
export const REDACT_MAX_WINDOWS = 4

/** Maximum tokens the local pipeline processes per request (4 windows of 256). */
export const REDACT_MAX_PROCESSED_TOKENS = 1024
