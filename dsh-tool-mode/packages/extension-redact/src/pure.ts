/**
 * Pure helpers for the redact pipeline: asset-policy parsing, window padding,
 * offset alignment, coverage and span assembly.
 *
 * Nothing here reads a file, calls an engine or touches Effect, so every one of these
 * decisions is testable without LiteRT, a tokenizer or the host.
 *
 * @module @try-works/extension-redact/pure
 */

import type { Coverage, Span } from '@try-works/tool-mode-runtime-core'
import type { TokenOffset } from '@try-works/tool-mode-runtime-processors'

/** A zero-width offset used for the special pair and padding positions. */
export const ZERO_OFFSET: TokenOffset = { start: 0, end: 0 }

/** One padded model input: ids and attention mask, both at the model's fixed length. */
export interface PaddedWindow {
  readonly ids: Int32Array
  readonly mask: Int32Array
}

/** The shape every span-like value shares (model, deterministic, merged). */
export interface SpanLike {
  readonly start: number
  readonly end: number
  readonly label: string
  readonly score: number
}

/** Parse labels.json's id2label object into the ordered label table the head emits. */
export function labelsFromJson(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) throw new Error('labels.json must be a JSON object')
  const id2label = (value as { id2label?: unknown }).id2label
  if (typeof id2label !== 'object' || id2label === null || Array.isArray(id2label)) {
    throw new Error('labels.json must contain an id2label object')
  }
  const entries = Object.entries(id2label)
  if (entries.length === 0) throw new Error('labels.json id2label must not be empty')
  const labels: string[] = new Array<string>(entries.length).fill('')
  const seen = new Set<number>()
  for (const [key, label] of entries) {
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
      throw new Error(
        'labels.json id2label key ' + key + ' is not an index in 0..' + String(entries.length - 1)
        + '; indices must be contiguous from 0',
      )
    }
    if (typeof label !== 'string' || label.length === 0) {
      throw new Error('labels.json id2label[' + key + '] must be a non-empty string')
    }
    if (seen.has(index)) throw new Error('labels.json id2label repeats index ' + key)
    seen.add(index)
    labels[index] = label
  }
  if (seen.size !== entries.length) throw new Error('labels.json id2label indices are not contiguous from 0')
  return labels
}

/** Read the <pad> token id from tokenizer.json; the pipeline pads short windows with it. */
export function padIdFromTokenizerJson(value: unknown): number {
  if (typeof value !== 'object' || value === null) throw new Error('tokenizer.json must be a JSON object')
  const addedTokens = (value as { added_tokens?: unknown }).added_tokens
  if (!Array.isArray(addedTokens)) throw new Error('tokenizer.json must contain an added_tokens array')
  for (const entry of addedTokens) {
    if (typeof entry !== 'object' || entry === null) continue
    const token = entry as { content?: unknown; id?: unknown }
    if (token.content === '<pad>' && typeof token.id === 'number' && Number.isInteger(token.id) && token.id >= 0) {
      return token.id
    }
  }
  throw new Error('tokenizer.json has no <pad> added token; the pad id is required to pad short windows')
}

/** Pad one window's ids and mask to the model's fixed input length. */
export function padWindow(
  ids: readonly number[],
  mask: readonly number[],
  padId: number,
  totalLength: number,
): PaddedWindow {
  if (ids.length !== mask.length) throw new Error('token ids and attention mask disagree in length')
  if (ids.length > totalLength) throw new Error('window length ' + String(ids.length) + ' exceeds ' + String(totalLength))
  const paddedIds = new Int32Array(totalLength)
  paddedIds.fill(padId)
  const paddedMask = new Int32Array(totalLength)
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]
    const attention = mask[index]
    if (id === undefined || attention === undefined) throw new Error('token ' + String(index) + ' is missing its id or mask')
    paddedIds[index] = id
    paddedMask[index] = attention
  }
  return { ids: paddedIds, mask: paddedMask }
}

/**
 * Align one window's token offsets with its padded model input.
 *
 * Position 0 is the leading special token, positions 1..contentLength are the window's
 * content tokens (copied from the ORIGINAL offsets at startToken), and the trailing
 * special plus every padding position are zero-width so the BIOES decoder skips them.
 */
export function windowTokenOffsets(
  all: readonly TokenOffset[],
  startToken: number,
  contentLength: number,
  totalLength: number,
): TokenOffset[] {
  if (!Number.isInteger(startToken) || startToken < 0) throw new Error('startToken must be a non-negative integer')
  if (!Number.isInteger(contentLength) || contentLength < 0) throw new Error('contentLength must be a non-negative integer')
  if (startToken + contentLength > all.length) {
    throw new Error('the window content runs past the tokenizer offsets')
  }
  if (contentLength + 2 > totalLength) throw new Error('the window does not fit the model input length')
  const offsets = Array.from({ length: totalLength }, () => ZERO_OFFSET)
  for (let index = 0; index < contentLength; index += 1) {
    const offset = all[startToken + index]
    if (offset === undefined) throw new Error('the tokenizer has no offset for token ' + String(startToken + index))
    offsets[index + 1] = offset
  }
  return offsets
}

/** Report how much of the input the capped window run actually covered. */
export function coverageOf(
  totalTokens: number,
  windowsTotal: number,
  windowsProcessed: number,
  maxWindows: number,
  maxLength: number,
  stride: number,
): Coverage {
  if (windowsProcessed >= windowsTotal) {
    return { complete: true, processedUnits: totalTokens, totalUnits: totalTokens }
  }
  const contentPerWindow = maxLength - 2
  const covered = (windowsProcessed - 1) * stride + contentPerWindow
  const processedUnits = Math.min(totalTokens, covered + 2)
  return {
    complete: false,
    processedUnits,
    totalUnits: totalTokens,
    reason:
      'processed ' + String(windowsProcessed) + ' of ' + String(windowsTotal) + ' windows ('
      + String(processedUnits) + ' of ' + String(totalTokens) + ' tokens); the local cap is '
      + String(maxWindows) + ' windows',
  }
}

/** Drop model spans whose label the deployment policy disables (ORG, and deterministic-only IMEI). */
export function filterModelSpans<T extends SpanLike>(spans: readonly T[], disabled: ReadonlySet<string>): T[] {
  return spans.filter((span) => !disabled.has(span.label))
}

/** Turn merged spans into the contract's Span type by slicing the original text. */
export function spansFromMerged(merged: readonly SpanLike[], text: string): Span[] {
  return merged.map((span) => ({
    start: span.start,
    end: span.end,
    label: span.label,
    text: text.slice(span.start, span.end),
    score: span.score,
  }))
}
