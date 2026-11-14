/**
 * Phase 4 end-to-end: the code-free moderator package registers classify_nsfw through the
 * host lane and the REAL moderator.tflite model scores a generated PNG.
 *
 * Run: npx tsx scripts/verify-phase4.ts
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

import { createModelRuntimeTool } from '../packages/dsh-tool-mode/src/model-runtime-lane.ts'
import { parseModelRuntimeRecipe } from '../packages/dsh-tool-mode/src/model-runtime-recipe.ts'

const root = path.resolve(import.meta.dirname, '..')
const installPath = path.join(root, 'packages', 'extension-moderator-recipe')
const modelPath = path.join(root, '.assets', 'moderator', 'moderator.tflite')
const digest = '925d11966ea9086acbfeaf4d00c1dd30c738c531695f2004b68880d3f121cd89'

const manifest = JSON.parse(readFileSync(path.join(installPath, 'tool-mode.extension.json'), 'utf8')) as {
  id: string
  implementations: Array<{ id: string }>
}
const implementation = manifest.implementations[0]
if (implementation === undefined) throw new Error('no implementation')
const rawRecipe: unknown = JSON.parse(readFileSync(path.join(installPath, 'recipes', implementation.id + '.json'), 'utf8'))
const parsed = parseModelRuntimeRecipe(rawRecipe)
if (!parsed.ok) throw new Error('recipe refused: ' + parsed.code + ': ' + parsed.detail)

const assets = {
  assetIds: ['moderator-litert', 'moderator-tflite'],
  get: (id: string) =>
    id === 'moderator-litert' ? { path: path.dirname(modelPath), digest } : id === 'moderator-tflite' ? { path: modelPath, digest } : undefined,
}

const toolResult = createModelRuntimeTool({
  extensionId: manifest.id,
  implementationId: implementation.id,
  installPath,
  recipe: parsed.recipe,
  assets: () => assets,
  invocationContext: (exec) => ({
    invocationId: 'phase4-verify',
    signal: exec?.signal ?? new AbortController().signal,
    limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 0, maxResultBytes: 8_388_608 },
    resolvePath: (candidate: string) => candidate,
  }),
})
if (!toolResult.ok) throw new Error('lane refused: ' + toolResult.code + ': ' + toolResult.detail)
const tool = toolResult.tool
console.log('registered tool:', tool.name)

/** A solid grey 512x384 PNG (8-bit RGB, no interlace), built with node:zlib. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function makePng(): string {
  const width = 512
  const height = 384
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const row = Buffer.alloc(1 + width * 3)
  const grey = Number(process.env['PROBE_COLOR'] ?? '128')
  for (let x = 0; x < width; x += 1) { row[1 + x * 3] = grey; row[2 + x * 3] = grey; row[3 + x * 3] = grey }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'moderator-phase4-')), 'grey.png')
  writeFileSync(file, png)
  return file
}

const result = (await tool.execute({ image_path: makePng() })) as {
  isNSFW?: boolean
  score?: number
  regions?: Record<string, number>
  crops?: number
}
await tool.dispose()

if (typeof result.score !== 'number' || !Number.isFinite(result.score)) throw new Error('score is not finite')
if (typeof result.isNSFW !== 'boolean') throw new Error('isNSFW is not a boolean')
const regions = result.regions ?? {}
for (const head of ['nipples', 'genitals', 'buttocks', 'nude', 'sexAct']) {
  if (typeof regions[head] !== 'number' || !Number.isFinite(regions[head])) throw new Error('region ' + head + ' is not finite')
}
console.log('result:', JSON.stringify(result).slice(0, 400))
console.log('PHASE 4 E2E PASS — code-free moderator package registered classify_nsfw and ran the real model')
