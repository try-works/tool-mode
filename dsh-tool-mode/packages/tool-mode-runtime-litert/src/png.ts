/**
 * Minimal, honest PNG decoding for the moderator tool (PHASE4: v1 decodes PNG only).
 *
 * SCOPE, BY DESIGN: 8-bit RGB (colour type 2) and 8-bit RGBA (colour type 6), non-interlaced,
 * with every chunk CRC checked. Everything else is REFUSED BY NAME rather than guessed:
 * JPEG, 16-bit, palette, grayscale, interlaced, corrupt CRC, missing IDAT, truncated data.
 * The alpha channel is dropped, which is what the moderator's ImagePixels does
 * (Sources/Moderator/Moderator.swift:3-31).
 *
 * NO IMAGE LIBRARY IS ADDED: node:zlib inflates the IDAT stream and the five PNG scanline
 * filters are implemented here.
 */

import { inflateSync } from 'node:zlib'

/** A decoded image: width * height * 3 RGB bytes, row-major from the top-left. */
export interface DecodedRgb {
  readonly width: number
  readonly height: number
  readonly rgb: Uint8Array
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_PIXELS = 50_000_000

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

const crc32 = (bytes: Uint8Array, start: number, end: number): number => {
  let crc = 0xffffffff
  for (let index = start; index < end; index += 1) {
    crc = (crcTable[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
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

/** Fail as a never-returning call, so control-flow analysis prunes the branches. */
function fail(message: string): never {
  throw new Error(message)
}

const signatureMatches = (bytes: Uint8Array): boolean => {
  if (bytes.length < PNG_SIGNATURE.length) return false
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return false
  }
  return true
}

interface Header {
  readonly width: number
  readonly height: number
  readonly channels: 3 | 4
}

const readHeader = (view: DataView, offset: number, length: number): Header => {
  if (length !== 13) fail('the PNG IHDR chunk must be 13 bytes')
  const width = view.getUint32(offset + 8)
  const height = view.getUint32(offset + 12)
  const bitDepth = view.getUint8(offset + 16)
  const colorType = view.getUint8(offset + 17)
  const compression = view.getUint8(offset + 18)
  const filterMethod = view.getUint8(offset + 19)
  const interlace = view.getUint8(offset + 20)
  if (width === 0 || height === 0) fail('the PNG has zero width or height')
  if (width * height > MAX_PIXELS) fail('the PNG is larger than the ' + String(MAX_PIXELS) + '-pixel decode limit')
  if (interlace !== 0) fail('interlaced PNGs are not supported')
  if (compression !== 0 || filterMethod !== 0) fail('unsupported PNG compression or filter method')
  if (bitDepth !== 8) {
    fail(bitDepth === 16 ? '16-bit PNGs are not supported; the decoder accepts 8-bit PNG only' : String(bitDepth) + '-bit PNGs are not supported')
  }
  if (colorType === 3) fail('palette PNGs are not supported; the decoder accepts 8-bit RGB or RGBA')
  if (colorType === 0 || colorType === 4) fail('grayscale PNGs are not supported; the decoder accepts 8-bit RGB or RGBA')
  if (colorType === 2) return { width, height, channels: 3 }
  if (colorType === 6) return { width, height, channels: 4 }
  return fail('PNG colour type ' + String(colorType) + ' is not supported')
}

/**
 * Decode a PNG to raw 8-bit RGB.
 *
 * @param bytes - the file bytes.
 * @returns the decoded raster.
 * @throws Error with a named refusal for every unsupported or corrupt input.
 */
export const decodePngToRgb = (bytes: Uint8Array): DecodedRgb => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    fail('JPEG input is not supported in v1; only 8-bit non-interlaced PNG is accepted')
  }
  if (!signatureMatches(bytes)) fail('the image is not a PNG (bad signature)')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoded = new TextDecoder('latin1')
  let header: Header | undefined
  let sawIend = false
  const idat: Uint8Array[] = []
  let offset = PNG_SIGNATURE.length
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail('truncated PNG: a chunk header is incomplete')
    const length = view.getUint32(offset)
    if (length > bytes.length - offset - 12) fail('truncated PNG: a chunk body is incomplete')
    const type = decoded.decode(bytes.subarray(offset + 4, offset + 8))
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const expectedCrc = view.getUint32(dataEnd)
    const actualCrc = crc32(bytes, offset + 4, dataEnd)
    if (expectedCrc !== actualCrc) fail('PNG chunk CRC mismatch in "' + type + '"')
    if (type === 'IHDR') {
      header = readHeader(view, offset, length)
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(dataStart, dataEnd))
    } else if (type === 'IEND') {
      sawIend = true
    }
    offset = dataEnd + 4
  }
  if (header === undefined) fail('truncated PNG: no IHDR chunk')
  if (!sawIend) fail('truncated PNG: no IEND chunk')
  if (idat.length === 0) fail('the PNG has no IDAT chunk')

  const stride = header.width * header.channels
  const expected = header.height * (stride + 1)
  const total = idat.reduce((sum, part) => sum + part.length, 0)
  const compressed = new Uint8Array(total)
  let cursor = 0
  for (const part of idat) {
    compressed.set(part, cursor)
    cursor += part.length
  }
  const raw = inflateSync(compressed, { maxOutputLength: expected })
  if (raw.length !== expected) fail('the PNG pixel data is ' + String(raw.length) + ' bytes; expected ' + String(expected))

  const pixels = new Uint8Array(header.height * stride)
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0
    if (filter > 4) fail('unsupported PNG filter type ' + String(filter))
    const rowStart = y * (stride + 1) + 1
    const outRow = y * stride
    for (let index = 0; index < stride; index += 1) {
      const value = raw[rowStart + index] ?? 0
      const left = index >= header.channels ? (pixels[outRow + index - header.channels] ?? 0) : 0
      const above = y > 0 ? (pixels[outRow - stride + index] ?? 0) : 0
      const aboveLeft = y > 0 && index >= header.channels ? (pixels[outRow - stride + index - header.channels] ?? 0) : 0
      const predictor =
        filter === 1 ? left : filter === 2 ? above : filter === 3 ? (left + above) >> 1 : filter === 4 ? paeth(left, above, aboveLeft) : 0
      pixels[outRow + index] = (value + predictor) & 0xff
    }
  }

  if (header.channels === 3) return { width: header.width, height: header.height, rgb: pixels }
  const rgb = new Uint8Array(header.width * header.height * 3)
  for (let index = 0; index < header.width * header.height; index += 1) {
    rgb[index * 3] = pixels[index * 4] ?? 0
    rgb[index * 3 + 1] = pixels[index * 4 + 1] ?? 0
    rgb[index * 3 + 2] = pixels[index * 4 + 2] ?? 0
  }
  return { width: header.width, height: header.height, rgb }
}
