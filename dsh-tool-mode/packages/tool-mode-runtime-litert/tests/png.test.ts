/**
 * PNG decoding tests for v1: 8-bit RGB/RGBA, non-interlaced, CRC-checked, via node:zlib.
 *
 * The fixtures build the bytes, so each refusal is a NAMED case rather than a guessed binary.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { decodePngToRgb } from '../src/png.ts'
import { encodePng, gradientRgb, jpegBytes, solidRgb } from './png-fixtures.ts'

const asMessage = (error: unknown): string => {
  assert.ok(error instanceof Error)
  return error.message
}

describe('decodePngToRgb', () => {
  it('round-trips an 8-bit RGB PNG', () => {
    const image = gradientRgb(5, 3)
    const decoded = decodePngToRgb(encodePng(image))
    assert.equal(decoded.width, 5)
    assert.equal(decoded.height, 3)
    assert.deepEqual(Array.from(decoded.rgb), Array.from(image.pixels))
  })

  it('drops the alpha channel of an RGBA PNG', () => {
    const pixels = new Uint8Array([
      10, 20, 30, 255,
      40, 50, 60, 0,
      70, 80, 90, 128,
      1, 2, 3, 255,
    ])
    const decoded = decodePngToRgb(encodePng({ width: 2, height: 2, channels: 4, pixels }))
    assert.deepEqual(Array.from(decoded.rgb), [10, 20, 30, 40, 50, 60, 70, 80, 90, 1, 2, 3])
  })

  it('reconstructs every PNG filter type', () => {
    const image = gradientRgb(7, 4)
    for (const filter of [0, 1, 2, 3, 4] as const) {
      const decoded = decodePngToRgb(encodePng(image, { filter }))
      assert.deepEqual(Array.from(decoded.rgb), Array.from(image.pixels), 'filter ' + String(filter))
    }
  })

  it('refuses JPEG by name', () => {
    assert.throws(() => decodePngToRgb(jpegBytes()), (error: unknown) => /JPEG/.test(asMessage(error)))
  })

  it('refuses non-PNG bytes', () => {
    assert.throws(
      () => decodePngToRgb(new TextEncoder().encode('GIF89a not a png')),
      (error: unknown) => /not a PNG|PNG/.test(asMessage(error)),
    )
  })

  it('refuses 16-bit PNGs by name', () => {
    const image = solidRgb(2, 2, 10, 20, 30)
    assert.throws(
      () => decodePngToRgb(encodePng(image, { bitDepth: 16 })),
      (error: unknown) => /16-bit/.test(asMessage(error)),
    )
  })

  it('refuses palette and grayscale colour types by name', () => {
    const image = solidRgb(2, 2, 10, 20, 30)
    assert.throws(
      () => decodePngToRgb(encodePng(image, { colorType: 3 })),
      (error: unknown) => /palette/.test(asMessage(error)),
    )
    assert.throws(
      () => decodePngToRgb(encodePng(image, { colorType: 0 })),
      (error: unknown) => /grayscale/.test(asMessage(error)),
    )
  })

  it('refuses interlaced PNGs by name', () => {
    const image = solidRgb(2, 2, 10, 20, 30)
    assert.throws(
      () => decodePngToRgb(encodePng(image, { interlace: 1 })),
      (error: unknown) => /interlaced/.test(asMessage(error)),
    )
  })

  it('refuses a corrupt chunk CRC', () => {
    const image = solidRgb(2, 2, 10, 20, 30)
    assert.throws(
      () => decodePngToRgb(encodePng(image, { corruptCrc: true })),
      (error: unknown) => /CRC/.test(asMessage(error)),
    )
  })

  it('refuses a PNG with no IDAT', () => {
    const image = solidRgb(2, 2, 10, 20, 30)
    assert.throws(
      () => decodePngToRgb(encodePng(image, { omitIdat: true })),
      (error: unknown) => /IDAT/.test(asMessage(error)),
    )
  })

  it('refuses a truncated PNG', () => {
    const bytes = encodePng(solidRgb(4, 4, 1, 2, 3))
    assert.throws(
      () => decodePngToRgb(bytes.slice(0, 20)),
      (error: unknown) => /truncated/.test(asMessage(error)),
    )
  })
})
