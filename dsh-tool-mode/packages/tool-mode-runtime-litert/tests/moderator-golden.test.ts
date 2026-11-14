/**
 * GOLDEN preprocessing test: our PNG decoder + Pillow BILINEAR crops, byte-for-byte against
 * an independent Pillow 13.0.0 run.
 *
 * HOW THE GOLDENS WERE MADE (2026-11-14, outside this repo):
 * 1. Our own fixture encoder wrote PNG bytes for gradientRgb(61, 37) (8-bit RGB,
 *    non-interlaced, filter 0) -- the same fixture this test uses.
 * 2. Pillow 13.0.0 opened that exact PNG (Image.open(...).convert("RGB")) and produced:
 *    - decodedRgbSha256, the sha256 of the raw RGB pixels;
 *    - for each quality, the crop windows from Sources/Moderator/Preprocess.swift:32-38 and
 *      a 384x384 RGB tile per window, built by pasting the window onto a black square and
 *      calling Image.resize((384, 384), Image.Resampling.BILINEAR). The accurate tiles are
 *      followed by Image.Transpose.FLIP_LEFT_RIGHT mirrors, as Preprocess.swift:26-27 does.
 * 3. Each tile's sha256 is pinned below. Any change to PNG decoding, tap arithmetic, the
 *    fixed-point precision, the window geometry, channel order or the mirror order changes
 *    one of these hashes.
 *
 * This is the test that distinguishes "the preprocessing is bit-exact" from "the preprocessing
 * is plausible": a real-image model score cannot do that, because an out-of-distribution flat
 * image legitimately produces arbitrary scores.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { cropTiles, cropWindows, type ModeratorQuality } from '../src/pillow.ts'
import { decodePngToRgb } from '../src/png.ts'
import { encodePng, gradientRgb } from './png-fixtures.ts'

const PILLOW_VERSION = '13.0.0'

/** sha256 of the raw RGB pixels Pillow 13.0.0 decoded from the fixture PNG. */
const DECODED_RGB_SHA256 = '04c23603b51ecbeae8d2e575637ed59eadb2267a3d002cb907e5b94dbafe57bc'

/** Per-quality windows and tile hashes produced by Pillow 13.0.0 BILINEAR. */
const GOLDEN = {
  fast: {
    windows: [{ x0: 12, y0: 0, size: 37 }],
    tiles: ['d1d4d03eec8df46c9866318c45d05999d043dfb837ff393d521e796f5bb90e1f'],
  },
  balanced: {
    windows: [
      { x0: 0, y0: -12, size: 61 },
      { x0: 15, y0: 3, size: 31 },
      { x0: 18, y0: 6, size: 25 },
      { x0: 20, y0: 8, size: 20 },
    ],
    tiles: [
      '5f68fc2dcf61997a77f2bffa747a6fa6b7db08db720e61f99448e755723c360e',
      '4d8f3d7495fc68aa5323b229146ceea04eaf9610baca217b9a14e1eba8ce97d6',
      'fb908036551783771c29fab988028ae12c415f5c918685681e419abe175482a1',
      '1861ecf6fba25837ed5b59ec7f07037758e2036c840c5c99d9a975e2ce32a6f5',
    ],
  },
  accurate: {
    windows: [
      { x0: 0, y0: -12, size: 61 },
      { x0: 15, y0: 3, size: 31 },
      { x0: 18, y0: 6, size: 25 },
      { x0: 20, y0: 8, size: 20 },
    ],
    tiles: [
      '5f68fc2dcf61997a77f2bffa747a6fa6b7db08db720e61f99448e755723c360e',
      'b36930c15d8cde13de354a492a97c69d18c3fdbc04c1bebda2d041551c2e8571',
      '4d8f3d7495fc68aa5323b229146ceea04eaf9610baca217b9a14e1eba8ce97d6',
      'f25b69ac546a606d3173dadc54ef8f0b45da970838e5d3b27ae5bfa7bf06e186',
      'fb908036551783771c29fab988028ae12c415f5c918685681e419abe175482a1',
      '3cf0db0cf6fd3e75c3ffa70c3929ec6a61cd9c380f3bd5bf3e252532d11e217f',
      '1861ecf6fba25837ed5b59ec7f07037758e2036c840c5c99d9a975e2ce32a6f5',
      'a31853a8d25702fe4ae5dc790f05aaae987b6d0d03dfc44b583ca1fa29339298',
    ],
  },
} as const

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

describe('golden preprocessing against Pillow ' + PILLOW_VERSION, () => {
  const image = gradientRgb(61, 37)
  const decoded = decodePngToRgb(encodePng(image))

  it('decodes the PNG to exactly the pixels Pillow decoded', () => {
    assert.equal(sha256(decoded.rgb), DECODED_RGB_SHA256)
  })

  for (const quality of ['fast', 'balanced', 'accurate'] as const satisfies readonly ModeratorQuality[]) {
    it('produces the exact Pillow crop windows and tiles for quality ' + quality, () => {
      const golden = GOLDEN[quality]
      assert.deepEqual(cropWindows(image.width, image.height, quality), golden.windows)
      const tiles = cropTiles(
        { width: decoded.width, height: decoded.height, channels: 3, pixels: decoded.rgb },
        quality,
      )
      assert.equal(tiles.length, golden.tiles.length)
      for (let index = 0; index < tiles.length; index += 1) {
        const tile = tiles[index]
        assert.ok(tile !== undefined)
        assert.equal(sha256(tile), golden.tiles[index], quality + ' tile ' + String(index))
      }
    })
  }
})
