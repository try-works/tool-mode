/**
 * Restart restore for prepared assets (task-133).
 *
 * The store persists readiness (`prepared-cold`), but the prepared-asset MAP the
 * dispatch hands to an extension lives in one process and only `prepare()` filled
 * it. After a host restart the extension activated with an empty map and every
 * tool call failed with "the … asset group was not prepared" — while the page
 * offered no Prepare action, because the recorded requirement was satisfied.
 *
 * `restore` rebuilds the handles from the cache directories without reading or
 * transferring bytes; these tests pin that it publishes the same map `prepare`
 * would, and that it refuses when a pinned file is absent or the wrong size.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { planPreparation, type DeploymentIdentity } from '../src/deployment-coordinator.ts'
import { createPreparedAssetRegistry, type LockGroup } from '../src/prepared-assets.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const EXTENSION_ID = '@fixture/restore'
const MODEL_ID = 'fixture-model'

/** The identity + one-asset group shared by the cases below. */
function fixture(): { identity: DeploymentIdentity; group: LockGroup; digest: string; bytes: Uint8Array } {
  const bytes = new Uint8Array(Buffer.from('restored pinned bytes'))
  const digest = createHash('sha256').update(bytes).digest('hex')
  const identity: DeploymentIdentity = {
    extensionId: EXTENSION_ID,
    modelId: MODEL_ID,
    modelRevision: 'rev-1',
    engineVersion: 'engine-1',
    quantization: 'fp32',
    tokenizer: 'tok-1',
    preprocessingRecipe: 'recipe-1',
  }
  const group: LockGroup = {
    id: 'text-backbone',
    assets: [{
      id: 'fixture-asset',
      file: 'onnx/model.onnx',
      bytes: bytes.byteLength,
      source: 'https://example.invalid/model.onnx',
      digest,
      executable: false,
    }],
  }
  return { identity, group, digest, bytes }
}

/** Write the group's file where `prepare` would have materialized it. */
function materialize(cacheRoot: string, group: LockGroup, bytes: Uint8Array): string {
  const dir = join(cacheRoot, 'groups', EXTENSION_ID.replaceAll('/', '__'), MODEL_ID, group.id)
  mkdirSync(join(dir, 'onnx'), { recursive: true })
  writeFileSync(join(dir, 'onnx', 'model.onnx'), bytes)
  return dir
}

describe('a prepared extension survives a restart without a re-prepare (task-133)', () => {
  it('publishes the same handles from the cache directories, without a transfer', () => {
    const cacheRoot = tempDir()
    const { identity, group, bytes, digest } = fixture()
    const registry = createPreparedAssetRegistry({ cacheRoot })
    const dir = materialize(cacheRoot, group, bytes)
    assert.equal(registry.assetMapFor(EXTENSION_ID), undefined, 'a fresh process starts with no map')

    const plan = planPreparation(identity, [{
      assetId: 'fixture-asset',
      bytes: bytes.byteLength,
      source: 'https://example.invalid/model.onnx',
      digest,
      executable: false,
    }], { name: 'MIT', url: 'https://example.invalid/license' })

    const outcome = registry.restore(EXTENSION_ID, plan, [group])
    assert.equal(outcome.ok, true)
    const map = registry.assetMapFor(EXTENSION_ID)
    assert.ok(map !== undefined)
    assert.equal(map.get('text-backbone')?.path, dir, 'the group id resolves to its cache directory')
    assert.equal(map.get('fixture-asset')?.path, join(dir, 'onnx', 'model.onnx'))
  })

  it('refuses when a pinned file is absent or no longer the recorded size', () => {
    const cacheRoot = tempDir()
    const { identity, group, bytes, digest } = fixture()
    const registry = createPreparedAssetRegistry({ cacheRoot })
    const plan = planPreparation(identity, [{
      assetId: 'fixture-asset',
      bytes: bytes.byteLength,
      source: 'https://example.invalid/model.onnx',
      digest,
      executable: false,
    }], { name: 'MIT', url: 'https://example.invalid/license' })

    const absent = registry.restore(EXTENSION_ID, plan, [group])
    assert.equal(absent.ok, false)
    if (!absent.ok) assert.match(absent.reason, /is not in the prepared cache/)

    const dir = materialize(cacheRoot, group, bytes)
    writeFileSync(join(dir, 'onnx', 'model.onnx'), new Uint8Array(3))
    const resized = registry.restore(EXTENSION_ID, plan, [group])
    assert.equal(resized.ok, false)
    assert.equal(registry.assetMapFor(EXTENSION_ID), undefined, 'a refused restore must not publish a stale map')
  })
})
