/**
 * Async content digest + cached verifyUnchangedAsync (task-28).
 *
 * The async digest must be BYTE-IDENTICAL to the sync digest: identity is a sha256 over the
 * sorted (relative name, byte size, per-file sha256) records, so parallelism may only change
 * how fast the bytes are read, never what is hashed.
 *
 * The cache is a performance layer, never an authority: a hit requires the cheap tree
 * fingerprint to match AND the record's digest to equal the digest that was verified for that
 * fingerprint. The fast fingerprint is (file count, total size, max mtime, max change time);
 * the change-time component exists so an edit that rewrites content and restores mtime is still
 * detected on filesystems where ctime advances on write. Even so, a same-size, same-mtime,
 * same-ctime rewrite is not detectable without re-reading bytes, so every fresh process and
 * every fingerprint change falls back to the full digest and the recorded-digest comparison.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  digestInstalledContent,
  digestInstalledContentAsync,
  ExtensionStore,
  installContentFingerprint,
  type InstalledRecord,
} from '../src/install/store.ts'

const dirs: string[] = []
after(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const scratch = (prefix = 'tmx-digest-'): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** A fixture tree with nesting, binary bytes, an empty file, and the excluded receipt. */
const buildTree = (): string => {
  const root = scratch()
  mkdirSync(join(root, 'lib', 'nested'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"name":"@acme/fixture","version":"1.0.0"}')
  writeFileSync(join(root, 'lib', 'index.js'), 'export const ok = true\n')
  writeFileSync(join(root, 'lib', 'nested', 'data.bin'), Buffer.from([0, 1, 2, 255, 254, 0, 10, 13]))
  writeFileSync(join(root, 'lib', 'nested', 'empty.txt'), Buffer.alloc(0))
  writeFileSync(join(root, 'ünïcode.txt'), 'unicode filename and content')
  writeFileSync(join(root, '.tool-mode-install.json'), '{"receipt":true}')
  return root
}

const recordFor = (installPath: string, contentDigest = digestInstalledContent(installPath)): InstalledRecord => ({
  extensionId: '@acme/fixture',
  version: '1.0.0',
  installPath,
  archiveDigest: 'a'.repeat(128),
  contentDigest,
  source: { kind: 'registry', requested: '@acme/fixture@1.0.0' },
  installedAt: new Date().toISOString(),
})

describe('digestInstalledContentAsync', () => {
  it('is byte-identical to the sync digest across concurrency settings', async () => {
    const root = buildTree()
    const expected = digestInstalledContent(root)
    for (const concurrency of [1, 2, 3, 8]) {
      assert.equal(await digestInstalledContentAsync(root, { concurrency }), expected, 'concurrency ' + String(concurrency))
    }
    assert.equal(await digestInstalledContentAsync(root), expected, 'default concurrency')
  })

  it('is byte-identical on an empty directory', async () => {
    const root = scratch()
    assert.equal(await digestInstalledContentAsync(root), digestInstalledContent(root))
  })

  it('hashes many files identically when workers are used', async () => {
    const root = scratch()
    mkdirSync(join(root, 'bulk'), { recursive: true })
    for (let index = 0; index < 40; index += 1) {
      writeFileSync(join(root, 'bulk', 'f' + String(index).padStart(3, '0') + '.bin'), Buffer.alloc(4096, index))
    }
    assert.equal(await digestInstalledContentAsync(root, { concurrency: 8 }), digestInstalledContent(root))
  })

  it('changes when a file is edited, added or removed', async () => {
    const root = buildTree()
    const before = await digestInstalledContentAsync(root)
    appendFileSync(join(root, 'lib', 'index.js'), '\nexport const extra = 1')
    assert.notEqual(await digestInstalledContentAsync(root), before)
    writeFileSync(join(root, 'added.txt'), 'added')
    assert.notEqual(await digestInstalledContentAsync(root), before)
    rmSync(join(root, 'added.txt'))
    rmSync(join(root, 'lib', 'nested', 'data.bin'))
    assert.notEqual(await digestInstalledContentAsync(root), before)
  })

  it('rejects a missing directory like the sync digest does', async () => {
    const root = scratch()
    const missing = join(root, 'does-not-exist')
    assert.throws(() => digestInstalledContent(missing))
    await assert.rejects(() => digestInstalledContentAsync(missing))
  })

  it('ignores the install receipt exactly like the sync digest', async () => {
    const root = buildTree()
    const before = await digestInstalledContentAsync(root)
    writeFileSync(join(root, '.tool-mode-install.json'), '{"receipt":false}')
    assert.equal(await digestInstalledContentAsync(root), before)
  })
})

describe('installContentFingerprint', () => {
  it('counts content files (receipt excluded), total size and the newest times', () => {
    const root = buildTree()
    const fingerprint = installContentFingerprint(root)
    const total = statSync(join(root, 'package.json')).size
      + statSync(join(root, 'lib', 'index.js')).size
      + statSync(join(root, 'lib', 'nested', 'data.bin')).size
      + statSync(join(root, 'lib', 'nested', 'empty.txt')).size
      + statSync(join(root, 'ünïcode.txt')).size
    assert.equal(fingerprint.fileCount, 5)
    assert.equal(fingerprint.totalSize, total)
    assert.ok(fingerprint.maxMtimeMs > 0)
    assert.ok(fingerprint.maxChangeTimeMs > 0)
  })
})

describe('ExtensionStore.verifyUnchangedAsync', () => {
  it('verifies once, then serves an unchanged answer from the cache', async () => {
    const root = buildTree()
    const record = recordFor(root)
    const store = new ExtensionStore(scratch())
    const first = await store.verifyUnchangedAsync(record)
    assert.equal(first.unchanged, true)
    assert.equal(first.cached, false)
    assert.equal(first.contentDigest, record.contentDigest)
    const second = await store.verifyUnchangedAsync(record)
    assert.equal(second.unchanged, true)
    assert.equal(second.cached, true)
  })

  it('invalidates the cache when a file changes and reports the mismatch', async () => {
    const root = buildTree()
    const record = recordFor(root)
    const store = new ExtensionStore(scratch())
    assert.equal((await store.verifyUnchangedAsync(record)).cached, false)
    assert.equal((await store.verifyUnchangedAsync(record)).cached, true)
    appendFileSync(join(root, 'lib', 'index.js'), '\nexport const backdoor = true')
    const changed = await store.verifyUnchangedAsync(record)
    assert.equal(changed.unchanged, false)
    assert.equal(changed.cached, false)
    assert.match(String(changed.diagnostic), /changed on disk/)
    // The failed check must not leave a poisoned cache entry behind.
    assert.equal((await store.verifyUnchangedAsync(record)).cached, false)
  })

  it('detects an mtime-restored edit even with a warm cache (ctime advances on write)', async () => {
    const root = scratch()
    const file = join(root, 'payload.bin')
    writeFileSync(file, Buffer.from('AAAAAAAAAA'))
    const record = recordFor(root)
    const store = new ExtensionStore(scratch())
    assert.equal((await store.verifyUnchangedAsync(record)).unchanged, true)
    const original = statSync(file)
    // Same byte length, same mtime: only the content (and ctime) changed.
    writeFileSync(file, Buffer.from('BBBBBBBBBB'))
    utimesSync(file, original.atime, original.mtime)
    const check = await store.verifyUnchangedAsync(record)
    assert.equal(check.unchanged, false, 'a same-size, mtime-restored rewrite must be caught')
  })

  it('never serves a different recorded digest from the cache', async () => {
    const root = buildTree()
    const store = new ExtensionStore(scratch())
    const record = recordFor(root)
    assert.equal((await store.verifyUnchangedAsync(record)).cached, false)
    assert.equal((await store.verifyUnchangedAsync(record)).cached, true)
    const forged = recordFor(root, 'f'.repeat(64))
    const check = await store.verifyUnchangedAsync(forged)
    assert.equal(check.unchanged, false)
    assert.equal(check.cached, false)
  })

  it('reports a missing installation directory', async () => {
    const root = buildTree()
    const record = recordFor(root)
    const store = new ExtensionStore(scratch())
    rmSync(root, { recursive: true, force: true })
    const check = await store.verifyUnchangedAsync(record)
    assert.equal(check.unchanged, false)
    assert.match(String(check.diagnostic), /missing/)
  })
})
