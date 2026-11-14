/**
 * The tokenizer boundary for redact.
 *
 * Redact's tokenizer.json is Unigram, not WordPiece, so it is loaded with the pinned
 * `tokenizers` Node binding rather than reimplemented. The binding reports offsets in
 * Unicode CODE POINTS; every offset is converted to UTF-16 here, once, before the
 * pipeline slices a JavaScript string.
 *
 * The source is injectable so unit tests can prove the conversion and the length checks
 * without a native addon.
 *
 * @module @try-works/extension-redact/tokenizer
 */

import { utf16Offsets, type TokenOffset } from '@try-works/tool-mode-runtime-processors'
import { Tokenizer } from 'tokenizers'

/** One tokenized input, in the units the rest of the pipeline uses. */
export interface RedactTokens {
  readonly ids: readonly number[]
  readonly mask: readonly number[]
  readonly offsets: readonly TokenOffset[]
}

/** What the pipeline needs from a tokenizer. */
export interface RedactTokenizer {
  encode(text: string): Promise<RedactTokens>
}

/** The subset of a `tokenizers` Encoding this package reads. */
export interface RedactEncoding {
  getIds(): number[]
  getAttentionMask(): number[]
  getOffsets(): number[][]
}

/** The subset of `tokenizers` Tokenizer this package reads. */
export interface RedactTokenizerSource {
  encode(text: string): Promise<RedactEncoding>
}

/** Convert one encoding to pipeline tokens, rejecting an internally inconsistent result. */
export function redactTokensFrom(encoding: RedactEncoding, text: string): RedactTokens {
  const ids = encoding.getIds()
  const mask = encoding.getAttentionMask()
  const pairs = encoding.getOffsets()
  if (ids.length !== mask.length) {
    throw new Error('the tokenizer returned ' + String(ids.length) + ' ids but ' + String(mask.length) + ' mask entries')
  }
  if (pairs.length !== ids.length) {
    throw new Error('the tokenizer returned ' + String(ids.length) + ' ids but ' + String(pairs.length) + ' offsets')
  }
  const offsets = pairs.map((pair, index) => {
    const start = pair[0]
    const end = pair[1]
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end)) {
      throw new Error('offset at token ' + String(index) + ' is not an integer pair')
    }
    return { start, end }
  })
  return { ids, mask, offsets: utf16Offsets(offsets, text) }
}

/** Wrap an encoding source as the pipeline's tokenizer. */
export function tokenizerFrom(source: RedactTokenizerSource): RedactTokenizer {
  return {
    encode: async (text) => redactTokensFrom(await source.encode(text), text),
  }
}

/** Load the pinned tokenizer.json with the `tokenizers` binding. */
export function createRedactTokenizer(file: string): RedactTokenizer {
  return tokenizerFrom(Tokenizer.fromFile(file))
}
