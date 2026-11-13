/** AT-52 — a legacy embedding index keeps its space through an upgrade. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EmbeddingIndex,
  IncompatibleEmbeddingSpace,
  openMemoryEmbeddingIndex,
} from '../src/embedding-index.ts'

const LEGACY = {
  spaceId: 'minilm-l6-384-v1',
  dimensions: 384,
  modelId: 'sentence-transformers/all-MiniLM-L6-v2',
  modelGeneration: '1110a243fdf4706b3f48f1d95db1a4f5529b4d41',
} as const
const CURRENT = {
  spaceId: 'embeddinggemma-2-768-v1',
  dimensions: 768,
  modelId: 'onnx-community/embeddinggemma-2-ONNX',
  modelGeneration: 'daa72c51243991dfcaf9f9137d2c573d8f7790c0',
} as const

const dirs: string[] = []
after(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'embedding-index-'))
  dirs.push(dir)
  return join(dir, 'index.json')
}

describe('AT-52 — persistent embedding space identity', () => {
  it('keeps the legacy 384-d space and vectors through a schema upgrade', () => {
    const file = scratch()
    const legacy = EmbeddingIndex.open(file, LEGACY)
    legacy.upsert({ id: 'doc-1', vector: Array.from({ length: 384 }, (_, i) => i / 384) })
    legacy.save()

    // Upgrade the index format without changing the embedding space.
    const reopened = EmbeddingIndex.open(file)
    reopened.upgrade(3, LEGACY)
    const after = EmbeddingIndex.open(file, LEGACY)
    assert.equal(after.space.spaceId, LEGACY.spaceId)
    assert.equal(after.space.dimensions, 384)
    assert.equal(after.get('doc-1')?.vector.length, 384)
  })

  it('refuses to reuse a 384-d index for 768-d vectors', () => {
    const file = scratch()
    EmbeddingIndex.open(file, LEGACY).save()
    assert.throws(() => EmbeddingIndex.open(file, CURRENT), IncompatibleEmbeddingSpace)
  })

  it('refuses a record whose vector length disagrees with the recorded space', () => {
    const index = EmbeddingIndex.open(scratch(), LEGACY)
    assert.throws(
      () => index.upsert({ id: 'bad', vector: Array.from({ length: 768 }, () => 0.1) }),
      /has 768 dimensions, but space minilm-l6-384-v1 is 384-dimensional/,
    )
  })

  it('refuses to upgrade a legacy index to the new model space', () => {
    const file = scratch()
    const legacy = EmbeddingIndex.open(file, LEGACY)
    legacy.save()
    assert.throws(
      () => EmbeddingIndex.open(file, LEGACY).upgrade(3, CURRENT),
      /refusing to upgrade a minilm-l6-384-v1\/384 index to embeddinggemma-2-768-v1\/768/,
    )
  })

  it('a memory-only index is explicit and never writes a file', () => {
    const file = scratch()
    const memory = openMemoryEmbeddingIndex(LEGACY)
    memory.upsert({ id: 'doc-1', vector: Array.from({ length: 384 }, () => 0.5) })
    memory.save()
    assert.equal(memory.size, 1)
    assert.equal(existsSync(file), false)
  })
})