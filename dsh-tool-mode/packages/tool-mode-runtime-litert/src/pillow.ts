/**
 * Bit-exact port of The Pillow Group's BILINEAR resampler as used by the moderator
 * preprocessing (libImaging/Resample.c), plus the crop geometry around it.
 *
 * PRIMARY SOURCE (Desert-Ant-Labs/desert-ant-core @ main, fetched 2026-11-14):
 * - Sources/Moderator/Preprocess.swift:9   side = 384
 * - Sources/Moderator/Preprocess.swift:10  zooms = [0.85, 0.70, 0.55]
 * - Sources/Moderator/Preprocess.swift:32-38 windows: fast = center square of the short
 *   side; balanced = the whole image letterboxed onto a black square, plus center squares
 *   at 85/70/55% of the short side; accurate adds each tile's mirror.
 * - Sources/Moderator/Preprocess.swift:40-50 mirror (horizontal RGB flip)
 * - Sources/Moderator/Preprocess.swift:54  precisionBits = 32 - 8 - 2 = 22
 * - Sources/Moderator/Preprocess.swift:65-94 fixed-point taps, including the exact
 *   operation order and the Int32 rounding of each weight.
 * - Sources/Moderator/Preprocess.swift:96-100 clip8: arithmetic shift then clamp 0..255.
 * - Sources/Moderator/Preprocess.swift:104-162 two-pass resample; pixels outside the
 *   source window read as black, which is how the letterbox is produced.
 *
 * THE CONTRACT IS BIT-EXACTNESS, so this file preserves the Swift operation order,
 * integer truncation and fixed-point precision rather than "improving" any of it.
 */

/** The square side every crop is resampled to (Preprocess.swift:9). */
export const TILE_SIDE = 384

/** Pillow's fixed-point precision for BILINEAR (Preprocess.swift:54). */
export const PILLOW_PRECISION_BITS = 32 - 8 - 2

/** Balanced-mode zoom factors of the short side (Preprocess.swift:10). */
export const MODERATOR_ZOOMS = [0.85, 0.7, 0.55] as const

/** The moderator quality dial (Moderator.swift:36-46). */
export type ModeratorQuality = 'fast' | 'balanced' | 'accurate'

/** Decoded 8-bit image; the moderator only reads the first three channels (alpha ignored). */
export interface ImagePixels {
  readonly width: number
  readonly height: number
  readonly channels: 3 | 4
  readonly pixels: Uint8Array
}

/** One square source window, possibly extending outside the image (the letterbox). */
export interface CropWindow {
  readonly x0: number
  readonly y0: number
  readonly size: number
}

/** Pillow's fixed-point filter taps for one output size. */
export interface BilinearTaps {
  readonly start: readonly number[]
  readonly count: readonly number[]
  readonly weights: readonly number[]
  readonly ksize: number
}

const PRECISION_SCALE = 1 << PILLOW_PRECISION_BITS
const PRECISION_HALF = 1 << (PILLOW_PRECISION_BITS - 1)

/**
 * Precompute the fixed-point tap table (Preprocess.swift:65-94).
 *
 * The arithmetic is deliberately the same as the Swift (and Pillow's C): double-precision
 * weights accumulated in the same order, divided by the total, scaled by 1 << 22 and rounded
 * with +0.5 (or -0.5 for the impossible negative case) before Int32 truncation.
 */
export const bilinearTaps = (inSize: number, outSize: number): BilinearTaps => {
  const scale = inSize / outSize
  const filterScale = Math.max(scale, 1)
  const support = filterScale
  const ss = 1 / filterScale
  const ksize = Math.ceil(support) * 2 + 1
  const start: number[] = []
  const count: number[] = []
  const weights: number[] = new Array(outSize * ksize).fill(0)
  const k: number[] = new Array(ksize).fill(0)
  for (let xx = 0; xx < outSize; xx += 1) {
    const center = (xx + 0.5) * scale
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0)
    const xmax = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin
    let total = 0
    for (let x = 0; x < xmax; x += 1) {
      const distance = Math.abs((x + xmin - center + 0.5) * ss)
      const value = distance < 1 ? 1 - distance : 0
      k[x] = value
      total += value
    }
    for (let x = 0; x < xmax; x += 1) {
      const value = k[x] ?? 0
      const normalized = total !== 0 ? value / total : value
      const fixed = normalized * PRECISION_SCALE
      weights[xx * ksize + x] = Math.trunc(normalized < 0 ? fixed - 0.5 : fixed + 0.5)
    }
    start.push(xmin)
    count.push(xmax)
  }
  return { start, count, weights, ksize }
}

/** Arithmetic shift then clamp, exactly Preprocess.swift:96-100. */
const clip8 = (value: number): number => {
  const shifted = value >> PILLOW_PRECISION_BITS
  return shifted <= 0 ? 0 : shifted >= 255 ? 255 : shifted
}

/**
 * Resample one square source window to TILE_SIDE x TILE_SIDE RGB.
 *
 * Two separable passes, horizontal into a scratch band of only the rows the vertical pass
 * reads, then vertical, exactly as Preprocess.swift:104-162. Source pixels outside the image
 * are skipped (black); out-of-window rows leave the scratch band zeroed.
 */
export const resampleWindow = (image: ImagePixels, x0: number, y0: number, size: number): Uint8Array => {
  const horizontal = bilinearTaps(size, TILE_SIDE)
  const vertical = bilinearTaps(size, TILE_SIDE)
  const rowFirst = vertical.start[0] ?? 0
  const lastStart = vertical.start[TILE_SIDE - 1] ?? 0
  const lastCount = vertical.count[TILE_SIDE - 1] ?? 0
  const rows = lastStart + lastCount - rowFirst
  const channels = image.channels
  const width = image.width
  const height = image.height

  const scratch = new Uint8Array(rows * TILE_SIDE * 3)
  for (let r = 0; r < rows; r += 1) {
    const sy = y0 + rowFirst + r
    if (sy < 0 || sy >= height) continue
    const rowBase = sy * width * channels
    for (let xx = 0; xx < TILE_SIDE; xx += 1) {
      let s0 = PRECISION_HALF
      let s1 = PRECISION_HALF
      let s2 = PRECISION_HALF
      const kBase = xx * horizontal.ksize
      const first = horizontal.start[xx] ?? 0
      const taps = horizontal.count[xx] ?? 0
      for (let x = 0; x < taps; x += 1) {
        const sx = x0 + first + x
        if (sx < 0 || sx >= width) continue
        const p = rowBase + sx * channels
        const weight = horizontal.weights[kBase + x] ?? 0
        s0 += (image.pixels[p] ?? 0) * weight
        s1 += (image.pixels[p + 1] ?? 0) * weight
        s2 += (image.pixels[p + 2] ?? 0) * weight
      }
      const out = (r * TILE_SIDE + xx) * 3
      scratch[out] = clip8(s0)
      scratch[out + 1] = clip8(s1)
      scratch[out + 2] = clip8(s2)
    }
  }

  const result = new Uint8Array(TILE_SIDE * TILE_SIDE * 3)
  for (let yy = 0; yy < TILE_SIDE; yy += 1) {
    const kBase = yy * vertical.ksize
    const first = (vertical.start[yy] ?? 0) - rowFirst
    const taps = vertical.count[yy] ?? 0
    for (let xx = 0; xx < TILE_SIDE; xx += 1) {
      let s0 = PRECISION_HALF
      let s1 = PRECISION_HALF
      let s2 = PRECISION_HALF
      for (let y = 0; y < taps; y += 1) {
        const p = ((first + y) * TILE_SIDE + xx) * 3
        const weight = vertical.weights[kBase + y] ?? 0
        s0 += (scratch[p] ?? 0) * weight
        s1 += (scratch[p + 1] ?? 0) * weight
        s2 += (scratch[p + 2] ?? 0) * weight
      }
      const out = (yy * TILE_SIDE + xx) * 3
      result[out] = clip8(s0)
      result[out + 1] = clip8(s1)
      result[out + 2] = clip8(s2)
    }
  }
  return result
}

/** Horizontal mirror of one RGB tile (Preprocess.swift:40-50). */
export const mirrorTile = (tile: Uint8Array, side: number): Uint8Array => {
  const out = new Uint8Array(tile.length)
  for (let y = 0; y < side; y += 1) {
    const row = y * side * 3
    for (let x = 0; x < side; x += 1) {
      const src = row + (side - 1 - x) * 3
      const dst = row + x * 3
      out[dst] = tile[src] ?? 0
      out[dst + 1] = tile[src + 1] ?? 0
      out[dst + 2] = tile[src + 2] ?? 0
    }
  }
  return out
}

/** The square source windows for one quality (Preprocess.swift:32-38). */
export const cropWindows = (width: number, height: number, quality: ModeratorQuality): readonly CropWindow[] => {
  const short = Math.min(width, height)
  const square = (size: number): CropWindow => ({
    x0: Math.trunc((width - size) / 2),
    y0: Math.trunc((height - size) / 2),
    size,
  })
  if (quality === 'fast') return [square(short)]
  const long = Math.max(width, height)
  // Same integer inset as -((long - w) / 2), written on the non-negative side so a zero
  // inset is +0 rather than -0 (deep equality and JSON both prefer +0).
  return [
    { x0: Math.trunc((width - long) / 2), y0: Math.trunc((height - long) / 2), size: long },
    ...MODERATOR_ZOOMS.map((zoom) => square(Math.trunc(short * zoom))),
  ]
}

/**
 * The RGB tiles one image is scored on: resample every window, and for accurate follow each
 * tile with its mirror (Preprocess.swift:14-28).
 */
export const cropTiles = (image: ImagePixels, quality: ModeratorQuality): readonly Uint8Array[] => {
  const tiles = cropWindows(image.width, image.height, quality).map((window) =>
    resampleWindow(image, window.x0, window.y0, window.size),
  )
  if (quality !== 'accurate') return tiles
  return tiles.flatMap((tile) => [tile, mirrorTile(tile, TILE_SIDE)])
}
