/**
 * The Pillow BILINEAR port, tested against the primary source's own arithmetic.
 *
 * PROVENANCE (Desert-Ant-Labs/desert-ant-core @ main, fetched 2026-11-14):
 * - Sources/Moderator/Preprocess.swift:9  side = 384
 * - Sources/Moderator/Preprocess.swift:10 zooms = [0.85, 0.70, 0.55]
 * - Sources/Moderator/Preprocess.swift:32-38 windows (fast/balanced geometry)
 * - Sources/Moderator/Preprocess.swift:54 precisionBits = 32 - 8 - 2 (= 22)
 * - Sources/Moderator/Preprocess.swift:65-94 fixed-point taps
 * - Sources/Moderator/Preprocess.swift:96-100 clip8 (arithmetic shift, clamp)
 * - Sources/Moderator/Preprocess.swift:104-162 resample
 * - Sources/Moderator/Preprocess.swift:40-50 mirror
 *
 * These are exact-value tests: the identity taps, the 2->4 tap table and the corner pixels of
 * a resampled checkerboard are all derived from the Swift source's operation order.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MODERATOR_ZOOMS,
  PILLOW_PRECISION_BITS,
  TILE_SIDE,
  bilinearTaps,
  cropTiles,
  cropWindows,
  mirrorTile,
  resampleWindow,
} from '../src/pillow.ts'

const pixel = (tile: Uint8Array, x: number, y: number, channel: number): number =>
  tile[(y * TILE_SIDE + x) * 3 + channel] ?? -1

describe('Pillow bilinear taps', () => {
  it('pins the primary-source precision and side', () => {
    assert.equal(TILE_SIDE, 384) // Preprocess.swift:9
    assert.equal(PILLOW_PRECISION_BITS, 22) // Preprocess.swift:54
    assert.deepEqual([...MODERATOR_ZOOMS], [0.85, 0.7, 0.55]) // Preprocess.swift:10
  })

  it('is the identity when the source and destination sizes match', () => {
    const taps = bilinearTaps(TILE_SIDE, TILE_SIDE)
    assert.equal(taps.ksize, 3)
    for (const xx of [0, 1, 191, 382]) {
      assert.equal(taps.start[xx], xx)
      assert.equal(taps.count[xx], 2)
      assert.equal(taps.weights[xx * taps.ksize], 1 << PILLOW_PRECISION_BITS)
      assert.equal(taps.weights[xx * taps.ksize + 1], 0)
    }
    assert.equal(taps.start[383], 383)
    assert.equal(taps.count[383], 1)
    assert.equal(taps.weights[383 * taps.ksize], 1 << PILLOW_PRECISION_BITS)
  })

  it('produces the exact fixed-point tap table for a 2 -> 4 upscale', () => {
    const taps = bilinearTaps(2, 4)
    assert.equal(taps.ksize, 3)
    assert.deepEqual(taps.start, [0, 0, 0, 1])
    assert.deepEqual(taps.count, [1, 2, 2, 1])
    assert.deepEqual(taps.weights, [
      4194304, 0, 0,
      3145728, 1048576, 0,
      1048576, 3145728, 0,
      4194304, 0, 0,
    ])
  })

  it('falls back to a non-negative first tap at the left edge', () => {
    const taps = bilinearTaps(8, TILE_SIDE)
    assert.equal(taps.start[0], 0)
    assert.equal(taps.count[0], 1)
  })
})

describe('resampleWindow', () => {
  const rgb = (width: number, height: number, channels: 3 | 4): { width: number; height: number; channels: 3 | 4; pixels: Uint8Array } => ({
    width,
    height,
    channels,
    pixels: new Uint8Array(width * height * channels),
  })

  it('keeps a solid colour exactly solid (weights sum to 1 << precisionBits)', () => {
    const image = rgb(8, 8, 3)
    for (let index = 0; index < 8 * 8; index += 1) {
      image.pixels[index * 3] = 10
      image.pixels[index * 3 + 1] = 20
      image.pixels[index * 3 + 2] = 30
    }
    const tile = resampleWindow(image, 0, 0, 8)
    for (let y = 0; y < TILE_SIDE; y += 1) {
      for (let x = 0; x < TILE_SIDE; x += 1) {
        assert.equal(pixel(tile, x, y, 0), 10)
        assert.equal(pixel(tile, x, y, 1), 20)
        assert.equal(pixel(tile, x, y, 2), 30)
      }
    }
  })

  it('resamples a 2x2 checkerboard with the expected corner values', () => {
    const image = rgb(2, 2, 3)
    image.pixels.set([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0])
    const tile = resampleWindow(image, 0, 0, 2)
    assert.deepEqual([pixel(tile, 0, 0, 0), pixel(tile, 0, 0, 1), pixel(tile, 0, 0, 2)], [0, 0, 0])
    assert.deepEqual([pixel(tile, TILE_SIDE - 1, 0, 0), pixel(tile, 0, TILE_SIDE - 1, 0), pixel(tile, TILE_SIDE - 1, TILE_SIDE - 1, 0)], [255, 255, 0])
    const center = pixel(tile, TILE_SIDE / 2, TILE_SIDE / 2, 0)
    assert.ok(center >= 126 && center <= 129, 'the center of a bilinear checkerboard is mid-grey; got ' + String(center))
  })

  it('reads pixels outside the window as black (the letterbox)', () => {
    const image = rgb(3, 1, 3)
    image.pixels.set([200, 100, 50, 200, 100, 50, 200, 100, 50])
    // balanced letterbox of a 3x1 image: window (0, -1, 3)
    const tile = resampleWindow(image, 0, -1, 3)
    assert.deepEqual([pixel(tile, 0, 0, 0), pixel(tile, 0, 0, 1), pixel(tile, 0, 0, 2)], [0, 0, 0])
    const middleRow = pixel(tile, TILE_SIDE / 2, TILE_SIDE / 2, 0)
    // Fixed-point rounding can land one unit below a constant source value; that is Pillow's
    // behaviour, so assert the value is preserved rather than assume an exact 200.
    assert.ok(middleRow === 199 || middleRow === 200, 'the middle band keeps the source colour; got ' + String(middleRow))
  })
})

describe('geometry', () => {
  it('computes the fast and balanced windows exactly (Preprocess.swift:32-38)', () => {
    assert.deepEqual(cropWindows(100, 50, 'fast'), [{ x0: 25, y0: 0, size: 50 }])
    assert.deepEqual(cropWindows(100, 50, 'balanced'), [
      { x0: 0, y0: -25, size: 100 },
      { x0: 29, y0: 4, size: 42 },
      { x0: 32, y0: 7, size: 35 },
      { x0: 36, y0: 11, size: 27 },
    ])
    assert.deepEqual(cropWindows(50, 100, 'fast'), [{ x0: 0, y0: 25, size: 50 }])
  })

  it('mirrors RGB rows horizontally (Preprocess.swift:40-50)', () => {
    const tile = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    assert.deepEqual(Array.from(mirrorTile(tile, 2)), [4, 5, 6, 1, 2, 3, 10, 11, 12, 7, 8, 9])
  })

  it('adds each tile mirror after the tile for accurate, and not for balanced', () => {
    const image = { width: 2, height: 2, channels: 3 as const, pixels: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0]) }
    assert.equal(cropTiles(image, 'fast').length, 1)
    assert.equal(cropTiles(image, 'balanced').length, 4)
    const accurate = cropTiles(image, 'accurate')
    assert.equal(accurate.length, 8)
    for (let index = 0; index < 8; index += 2) {
      const tile = accurate[index]
      const mirror = accurate[index + 1]
      assert.ok(tile !== undefined && mirror !== undefined)
      assert.deepEqual(mirror, mirrorTile(tile, TILE_SIDE))
    }
  })
})
