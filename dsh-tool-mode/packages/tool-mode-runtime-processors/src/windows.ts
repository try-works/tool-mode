/**
 * Sliding windows over a tokenized sequence.
 *
 * The window is the unit the model sees. Each window repeats the sequence's special pair, so
 * every window is a standalone model input, and startToken records where the window's first
 * content token sits in the ORIGINAL ids array, which is what lets a caller map a decoded span
 * back to the right token offsets without re-tokenizing.
 *
 * The last window may be shorter than maxLength. Padding is the caller's job because only the
 * caller knows the pad id; recomputing the mask here would hide that decision.
 *
 * @module @try-works/tool-mode-runtime-processors/windows
 */

/** One model input window. */
export interface TokenWindow {
  readonly ids: number[]
  readonly mask: number[]
  /** Index in the original ids array of this window's first content token. */
  readonly startToken: number
}

/** Window geometry. */
export interface WindowOptions {
  /** Total window length including the two special tokens. */
  readonly maxLength: number
  /** Content tokens to advance between window starts; smaller than maxLength - 2 overlaps. */
  readonly stride: number
}

/** Reject a non-integer or out-of-range option with a message naming the field. */
function requireInteger(value: number, name: string, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(name + ' must be an integer >= ' + String(minimum))
  }
  return value
}

/**
 * Split tokenized ids into model windows.
 *
 * @param ids - sequence ids, first and last of which are the special pair.
 * @param mask - attention mask aligned with ids; carried into each window positionally.
 * @param options - window length and stride.
 * @returns windows in reading order, each with the original index of its first content token.
 * @throws Error when the sequence, mask or options are inconsistent.
 */
export function windows(
  ids: readonly number[],
  mask: readonly number[],
  options: WindowOptions,
): readonly TokenWindow[] {
  const maxLength = requireInteger(options.maxLength, 'maxLength', 3)
  const contentPerWindow = maxLength - 2
  const stride = requireInteger(options.stride, 'stride', 1)
  if (stride > contentPerWindow) {
    throw new Error('stride must not exceed maxLength - 2, or the windows would leave a gap')
  }
  if (ids.length < 2) {
    throw new Error('ids must contain at least the two special tokens')
  }
  if (mask.length !== ids.length) {
    throw new Error('mask must have the same length as ids')
  }

  const lastIndex = ids.length - 1
  const clsId = ids[0]
  const sepId = ids[lastIndex]
  const clsMask = mask[0]
  const sepMask = mask[lastIndex]
  if (clsId === undefined || sepId === undefined || clsMask === undefined || sepMask === undefined) {
    throw new Error('ids and mask must contain at least the two special tokens')
  }

  const contentLength = ids.length - 2
  if (contentLength === 0) {
    return [{ ids: [clsId, sepId], mask: [clsMask, sepMask], startToken: 1 }]
  }

  const result: TokenWindow[] = []
  for (let start = 0; start < contentLength; start += stride) {
    const end = Math.min(start + contentPerWindow, contentLength)
    const windowIds = [clsId, ...ids.slice(start + 1, end + 1), sepId]
    const windowMask = [clsMask, ...mask.slice(start + 1, end + 1), sepMask]
    result.push({ ids: windowIds, mask: windowMask, startToken: start + 1 })
    if (end === contentLength) break
  }
  return result
}
