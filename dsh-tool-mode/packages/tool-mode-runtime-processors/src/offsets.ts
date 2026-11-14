/**
 * Text-offset normalisation for the redact processor.
 *
 * The tokenizers package reports offsets in Unicode CODE POINTS. The caller's text, the model's
 * decoded spans and every consumer of this package work in UTF-16 code units, because that is
 * what String.prototype.slice indexes. The two agree for ASCII and for every BMP character and
 * disagree by one for each astral character, which is exactly the kind of off-by-one that cuts a
 * span in the middle of an emoji.
 *
 * This module is the only place that conversion happens.
 *
 * @module @try-works/tool-mode-runtime-processors/offsets
 */

/** One span in the caller's text, in UTF-16 code units. */
export interface TokenOffset {
  readonly start: number
  readonly end: number
}

/** Resolve one code-point index to its UTF-16 index. */
function boundaryAt(index: number, boundaries: readonly number[]): number {
  const value = boundaries[index]
  if (value === undefined) {
    throw new Error('utf16Offsets: code-point offset ' + String(index) + ' is outside the text')
  }
  return value
}

/**
 * Convert code-point offsets into UTF-16 code-unit offsets.
 *
 * @param offsets - spans reported by a tokenizer that indexes code points.
 * @param text - the text those offsets index.
 * @returns the same spans in UTF-16 code-unit indices, as fresh objects.
 * @throws Error when an offset is not an integer, is negative, ends before it starts, or runs
 * past the end of the text.
 */
export function utf16Offsets(offsets: readonly TokenOffset[], text: string): TokenOffset[] {
  const boundaries: number[] = [0]
  let utf16Index = 0
  for (const character of text) {
    utf16Index += character.length
    boundaries.push(utf16Index)
  }
  const codePointCount = boundaries.length - 1

  return offsets.map((offset, index) => {
    if (!Number.isInteger(offset.start) || !Number.isInteger(offset.end)) {
      throw new Error('utf16Offsets: offset at index ' + String(index) + ' must have integer start and end')
    }
    if (offset.start < 0) {
      throw new Error('utf16Offsets: offset at index ' + String(index) + ' starts before the text')
    }
    if (offset.end < offset.start) {
      throw new Error('utf16Offsets: offset at index ' + String(index) + ' ends before it starts')
    }
    if (offset.end > codePointCount) {
      throw new Error(
        'utf16Offsets: offset at index '
          + String(index)
          + ' ends past the text ('
          + String(offset.end)
          + ' code points > '
          + String(codePointCount)
          + ')',
      )
    }
    return { start: boundaryAt(offset.start, boundaries), end: boundaryAt(offset.end, boundaries) }
  })
}
