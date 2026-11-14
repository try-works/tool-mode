/**
 * Tiny PNG encoder fixtures for the decoder tests.
 *
 * The processor SHIPS a decoder, not an encoder: these fixtures exist so the tests can build
 * valid 8-bit RGB/RGBA non-interlaced PNGs (with each filter type) and precise invalid ones
 * (bad CRC, palette, 16-bit, interlaced, no IDAT), instead of committing binary fixtures.
 */

import { deflateSync } from 'node:zlib'

export interface RasterImage {
  readonly width: number
  readonly height: number
  readonly channels: 3 | 4
  readonly pixels: Uint8Array
}

export interface PngOptions {
  /** Filter type applied to every scanline (0..4). */
  readonly filter?: 0 | 1 | 2 | 3 | 4
  readonly bitDepth?: number
  readonly colorType?: number
  readonly interlace?: number
  /** Flip the last byte of the IDAT chunk CRC. */
  readonly corruptCrc?: boolean
  readonly omitIdat?: boolean
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Uint8Array, corruptCrc = false): Uint8Array => {
  const typeBytes = new TextEncoder().encode(type)
  const body = new Uint8Array(typeBytes.length + data.length)
  body.set(typeBytes, 0)
  body.set(data, typeBytes.length)
  const crc = crc32(body)
  const out = new Uint8Array(4 + body.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(body, 4)
  view.setUint32(4 + body.length, corruptCrc ? (crc ^ 0x000000ff) >>> 0 : crc)
  return out
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export const encodePng = (image: RasterImage, options: PngOptions = {}): Uint8Array => {
  const filter = options.filter ?? 0
  const bpp = image.channels
  const stride = image.width * bpp
  const filtered: number[] = []
  let previous = new Uint8Array(stride)
  for (let y = 0; y < image.height; y += 1) {
    filtered.push(filter)
    const row = image.pixels.subarray(y * stride, (y + 1) * stride)
    for (let index = 0; index < stride; index += 1) {
      const raw = row[index] ?? 0
      const a = index >= bpp ? (row[index - bpp] ?? 0) : 0
      const b = previous[index] ?? 0
      const c = index >= bpp ? (previous[index - bpp] ?? 0) : 0
      const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0
      filtered.push((raw - predictor) & 0xff)
    }
    previous = Uint8Array.from(row)
  }

  const ihdr = new Uint8Array(13)
  const header = new DataView(ihdr.buffer)
  header.setUint32(0, image.width)
  header.setUint32(4, image.height)
  ihdr[8] = options.bitDepth ?? 8
  ihdr[9] = options.colorType ?? (image.channels === 4 ? 6 : 2)
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = options.interlace ?? 0

  const parts: Uint8Array[] = [PNG_SIGNATURE, chunk('IHDR', ihdr)]
  if (options.omitIdat !== true) {
    parts.push(chunk('IDAT', deflateSync(Uint8Array.from(filtered)), options.corruptCrc === true))
  }
  parts.push(chunk('IEND', new Uint8Array(0)))
  return concat(parts)
}

/** A JPEG-looking byte string: enough for the decoder to refuse it by name. */
export const jpegBytes = (): Uint8Array =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])

/** A small deterministic RGB gradient. */
export const gradientRgb = (width: number, height: number): RasterImage => {
  const pixels = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      pixels[offset] = (x * 37 + y * 11) & 0xff
      pixels[offset + 1] = (x * 5 + y * 53) & 0xff
      pixels[offset + 2] = (x * 97 + y * 3) & 0xff
    }
  }
  return { width, height, channels: 3, pixels }
}

/** A solid RGB image. */
export const solidRgb = (width: number, height: number, r: number, g: number, b: number): RasterImage => {
  const pixels = new Uint8Array(width * height * 3)
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 3] = r
    pixels[index * 3 + 1] = g
    pixels[index * 3 + 2] = b
  }
  return { width, height, channels: 3, pixels }
}
