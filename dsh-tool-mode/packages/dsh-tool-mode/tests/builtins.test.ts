/** EXT-03 — the host release's trusted built-ins lock is authoritative. */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { BUILTINS_LOCK, isProtectedBuiltin, loadBuiltinsLock, PROTECTED_BUILTIN_IDS } from '../src/builtins.ts'

test('the shipped builtins lock lists the first-party packages as protected', () => {
  assert.equal(BUILTINS_LOCK.version, 1)
  assert.deepEqual([...PROTECTED_BUILTIN_IDS].sort(), [
    '@try-works/extension-declarative-recipes',
    '@try-works/extension-embeddinggemma',
    '@try-works/extension-laya',
    '@try-works/extension-needle',
  ])
  assert.equal(Object.isFrozen(PROTECTED_BUILTIN_IDS), true)
  assert.equal(isProtectedBuiltin('@try-works/extension-embeddinggemma'), true)
  assert.equal(isProtectedBuiltin('@acme/untrusted'), false)
})

test('a malformed lock fails closed instead of granting protection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'builtins-lock-'))
  const path = join(dir, 'builtins.lock.json')
  writeFileSync(path, JSON.stringify({ version: 1, builtins: [{ extensionId: '', protected: true }] }))
  assert.throws(() => loadBuiltinsLock(new URL(`file://${path.replace(/\\/g, '/')}`)), /non-empty string/)
  writeFileSync(path, JSON.stringify({ version: 2, builtins: [] }))
  assert.throws(() => loadBuiltinsLock(new URL(`file://${path.replace(/\\/g, '/')}`)), /version 1/)
})
