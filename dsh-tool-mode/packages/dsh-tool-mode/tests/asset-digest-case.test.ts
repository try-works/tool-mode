/**
 * Hex-digest case is not semantic (task-132).
 *
 * Laya's `models.lock.json` records SHA-256 digests in UPPER case, while
 * `crypto.digest('hex')` emits lower case. The acquisition compared the two raw
 * strings, so a correctly seeded blob was treated as a miss and the transfer fell
 * through to the lock's prose source, failing with `Failed to parse URL` even
 * though the verified bytes were on disk. These tests pin the comparison.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acquireAsset, sameDigest, type AcquisitionSource, type AcquisitionStore } from '../src/asset-acquisition.ts'
import type { PlannedAsset } from '../src/deployment-coordinator.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

/** A filesystem store rooted at one directory, implementing the acquisition surface. */
function fsStore(): AcquisitionStore {
  return {
    write(path, bytes) { writeFileSync(path, bytes) },
    read(path) {
      try { return readFileSync(path) } catch { return undefined }
    },
    sizeOf(path) {
      try { return statSync(path).size } catch { return 0 }
    },
    rename(from, to) { renameSync(from, to) },
    remove(path) { rmSync(path, { force: true }) },
    exists(path) { return existsSync(path) },
  }
}

/** A source that must never be reached: the bytes are already in the cache. */
function refusingSource(): AcquisitionSource {
  return {
    supportsRanges: true,
    async fetchRange() {
      throw new Error('the cache hit must not consult the source')
    },
  }
}

describe('a seeded blob verifies regardless of the digest hex case (task-132)', () => {
  it('treats an upper-case digest as the same content as the lower-case hash', () => {
    assert.equal(sameDigest('ABCDEF', 'abcdef'), true)
    assert.equal(sameDigest('abcdef', 'abcdef'), true)
    assert.equal(sameDigest('abcdef', 'abcdee'), false)
  })

  it('hits the cache when the lock records the digest in upper case', async () => {
    const root = tempDir()
    mkdirSync(root, { recursive: true })
    const bytes = new Uint8Array(Buffer.from('the pinned bytes'))
    const lower = createHash('sha256').update(bytes).digest('hex')
    // The lock's spelling: upper case. The blob on disk is named the same way.
    const asset: PlannedAsset = {
      assetId: 'case-asset',
      bytes: bytes.byteLength,
      source: 'the split export of the pinned checkpoint',
      digest: lower.toUpperCase(),
      executable: false,
    }
    writeFileSync(join(root, asset.digest), bytes)
    const result = await acquireAsset(asset, {
      store: fsStore(),
      source: refusingSource(),
      root,
      signal: new AbortController().signal,
    })
    assert.equal(result.acquired, true, 'the seeded upper-case blob must verify as a cache hit')
    if (result.acquired) {
      assert.equal(result.transferredBytes, 0)
      assert.ok(result.path.endsWith(asset.digest), 'the cache path keeps the lock digest')
    }
  })
})
