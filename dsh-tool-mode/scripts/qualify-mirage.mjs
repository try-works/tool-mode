#!/usr/bin/env node
/**
 * Reproduce the Mirage qualification from pinned local artifacts.
 *
 * Usage:
 *   MIRAGE_ASSETS_DIR=D:/path/to/mirage node scripts/qualify-mirage.mjs image.png
 *
 * The directory must contain cactus.js, cactus.wasm and mirage.cact whose sizes and
 * SHA-256 match packages/extension-mirage/models.lock.json. This script loads the
 * built extension, runs all four tools on the image, and writes
 * docs/tool-mode/qualification/mirage.json.
 */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const dir = process.env.MIRAGE_ASSETS_DIR
const image = process.argv[2]
if (!dir || !image) {
  console.error('usage: MIRAGE_ASSETS_DIR=<dir with cactus.js/cactus.wasm/mirage.cact> node scripts/qualify-mirage.mjs <image.png>')
  process.exit(2)
}
const sha = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const expected = {
  'cactus.js': '707341e44776ab0eb8dfc8f6a579ed5ac41e2ffc6419a18012f61619a6dfc70c',
  'cactus.wasm': '6fb6cb41145cd51fd8af97644cd684fbdd434d4d3ce261881df58cbaef5b67f7',
  'mirage.cact': '4249a0f7515272ff76b9414bec17d7e7daf84b15b66c7fb4f17fce1e66f9f237',
}
for (const [name, digest] of Object.entries(expected)) {
  const actual = await sha(join(dir, name))
  if (actual !== digest) throw new Error(`${name} sha256 ${actual} does not match the pinned ${digest}`)
}
const { default: extension } = await import('../packages/extension-mirage/lib/index.js')
const context = {
  extensionId: '@try-works/extension-mirage',
  extensionVersion: '0.1.0',
  activationGeneration: 1,
  storage: { read: async () => undefined, write: async () => {}, directory: join(dir, 'storage') },
  logger: { log: (...args) => console.error(...args) },
  signal: new AbortController().signal,
  configuration: {
    loaderPath: join(dir, 'cactus.js'),
    wasmPath: join(dir, 'cactus.wasm'),
    weightsPath: join(dir, 'mirage.cact'),
    threads: 4,
  },
}
const instance = await extension.create(context)
const provider = await instance.createProvider({ modelId: 'mirage' })
await provider.load({ assets: { get: () => undefined, assetIds: [] }, signal: context.signal })
const invocation = {
  invocationId: 'qualify-mirage',
  signal: context.signal,
  limits: { maxInputBytes: 16 * 1024 * 1024, maxAudioSeconds: 0, maxResultBytes: 16 * 1024 * 1024 },
  resolvePath: path => path,
}
const call = (implementationId, input) => provider.invoke({ implementationId, input, context: invocation })
const evidence = {
  recordedAt: new Date().toISOString(),
  model: 'Cactus-Compute/mirage',
  engine: '4.1.0 WASM',
  imageSha256: await sha(image),
  imagePixels: null,
  describe: await call('mirage-wasm-describe', { image, sections: ['scene', 'objects', 'text', 'relations', 'reasoning'], maxObjects: 5, maxTextLines: 5 }),
  detect: await call('mirage-wasm-detect', { image, maskFormat: 'polygons', maxObjects: 3 }),
  ocr: await call('mirage-wasm-ocr', { image, maxTextLines: 5 }),
  extract: await call('mirage-wasm-extract', {
    image,
    fields: [
      { name: 'sign', kind: 'enum', options: ['stop', 'yield', 'speed limit'] },
      { name: 'colour', kind: 'enum', options: ['red', 'blue', 'green'] },
      { name: 'location', kind: 'box', of: 'sign' },
      { name: 'count', kind: 'integer', minimum: 0, maximum: 5 },
      { name: 'label', kind: 'string', maxLength: 40 },
    ],
  }),
}
await writeFile('docs/tool-mode/qualification/mirage.json', JSON.stringify(evidence, null, 2) + '\n')
await provider.dispose()
console.log('wrote docs/tool-mode/qualification/mirage.json')
