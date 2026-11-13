#!/usr/bin/env node
/** AT-43 — generate the actual golden embedding fixture from the pinned backbone. */
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activateExtension } from '@try-works/tool-mode-extension-sdk'
import extension from '../packages/extension-embeddinggemma/src/index.ts'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const REVISION = 'daa72c51243991dfcaf9f9137d2c573d8f7790c0'
const CACHE_DIR = process.env.EMBEDDINGGEMMA_CACHE_DIR
  ?? join(homedir(), '.cache', 'embeddinggemma-2', 'onnx-community', REVISION)
const TEXT = 'Embedding models turn text into vectors for search and comparison.'
if (!existsSync(join(CACHE_DIR, 'onnx', 'model.onnx'))) {
  throw new Error(`the pinned backbone is not at ${CACHE_DIR}; set EMBEDDINGGEMMA_CACHE_DIR`)
}
const context = {
  extensionId: '@try-works/extension-embeddinggemma',
  extensionVersion: '0.1.1',
  activationGeneration: 1,
  storage: { directory: '', async read() { return undefined }, async write() { /* no-op */ } },
  logger: { log() { /* silent */ } },
  signal: new AbortController().signal,
  configuration: {},
}
const invocation = {
  invocationId: 'golden-generator',
  signal: new AbortController().signal,
  limits: { maxInputBytes: 8 * 1024 * 1024, maxAudioSeconds: 300, maxResultBytes: 4 * 1024 * 1024 },
  resolvePath: candidate => candidate,
}
const assets = {
  get: assetId => assetId === 'text-backbone' ? { path: CACHE_DIR, digest: `sha256:${REVISION}` } : undefined,
  assetIds: ['text-backbone'],
}
const instance = await activateExtension(extension, context)
try {
  const provider = await instance.createProvider({ modelId: 'embeddinggemma-2', configuration: {} })
  await provider.load({ assets, signal: new AbortController().signal })
  const result = await provider.invoke({
    implementationId: 'embeddinggemma2-onnx',
    input: { items: [{ id: 'golden', parts: [{ kind: 'text', text: TEXT }] }], purpose: 'similarity', role: 'symmetric', dimensions: 768 },
    context: invocation,
  })
  const vector = result.vectors[0]
  const norm = Math.sqrt(vector.values.reduce((sum, value) => sum + value * value, 0))
  writeFileSync(join(ROOT, 'packages', 'extension-embeddinggemma', 'tests', 'fixtures', 'embedding-golden.json'), `${JSON.stringify({
    text: TEXT,
    purpose: 'similarity',
    role: 'symmetric',
    dimensions: 768,
    embeddingSpaceId: vector.embeddingSpaceId,
    normalized: vector.normalized,
    values: vector.values,
  }, null, 2)}\n`)
  console.log(`golden written: dimensions=${vector.values.length} norm=${norm}`)
} finally {
  await instance.dispose('shutdown')
}
