/**
 * The asset lock is the only place the uhm artifacts' identity is recorded.
 *
 * A recipe names an asset SET and a file name; the lock says what bytes that means. Both files
 * were verified at the pinned Hugging Face revision on 2026-11-14: uhm.onnx from the repository's
 * LFS metadata plus a content-length check, and labels.json by hashing the 237 bytes fetched at
 * that revision.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { discoverExtension, validateManifest, type ExtensionManifest } from '@try-works/tool-mode-extension-sdk'

const DIR = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** The pinned HF revision (repository commit sha). */
const EXPECTED_REVISION = 'a81452eeaa82ba83bdd3682906fe01120b12351a'
/** uhm.onnx: LFS sha256 and byte count at the pinned revision. */
const ONNX_BYTES = 94042570
const ONNX_SHA256 = 'fbd19765def76893841e0c70e498bf632d6c68175ceae5a2da8fe3bf7d9d0314'
/** labels.json: sha256 computed from the 237 bytes fetched at the pinned revision. */
const LABELS_BYTES = 237
const LABELS_SHA256 = '9b3a8579b0185771f137873e5cbcbdd67572c34fdbeeac778580170c9248f9a3'

/** One artifact record in the lock's assets array. */
interface ModelAsset {
  readonly id: string
  readonly fileName: string
  readonly url: string
  readonly bytes: number
  readonly sha256: string
}

/** One group entry that the host's preparation plan consumes. */
interface ModelGroup {
  readonly id: string
  readonly enables: readonly string[]
  readonly assets: readonly {
    readonly id: string
    readonly file: string
    readonly bytes: number
    readonly source: string
    readonly digest: string
    readonly executable: boolean
  }[]
}

/** One asset set, as the runtime lock format defines it. */
interface ModelAssetSet {
  readonly model: {
    readonly provider: string
    readonly identity: string
    readonly revision: string
    readonly modalities: readonly string[]
  }
  readonly engine: { readonly kind: string }
  readonly tokenizer: { readonly kind: string; readonly identity: string }
  readonly platforms: readonly { readonly os: string; readonly arch: string; readonly accelerator?: string }[]
  readonly license: { readonly name: string; readonly redistribution: string; readonly attributionRequired: boolean }
  readonly assets: readonly ModelAsset[]
  readonly groups: readonly ModelGroup[]
  readonly pinning: { readonly state: string; readonly revision: string }
  readonly qualification: Record<string, string>
}

/** The whole lock document. */
interface ModelLock {
  readonly lockVersion: number
  readonly assetSets: Record<string, ModelAssetSet>
}

/** The package's validated manifest. */
function declaredManifest(): ExtensionManifest {
  const pkg: unknown = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'))
  // SAFETY: this package's own package.json supplies the name and version validateManifest
  // compares against the manifest; a malformed file fails that comparison.
  const identity = pkg as { name: string; version: string }
  const raw: unknown = JSON.parse(readFileSync(join(DIR, 'tool-mode.extension.json'), 'utf8'))
  return validateManifest(raw, { packageName: identity.name, packageVersion: identity.version, packageDir: DIR })
}

/** The lock document. */
function modelLock(): ModelLock {
  const manifest = declaredManifest()
  const assetLock = manifest.models[0]?.assetLock
  assert.ok(assetLock !== undefined)
  const parsed: unknown = JSON.parse(readFileSync(join(DIR, assetLock), 'utf8'))
  // SAFETY: this package's own lock file; discoverExtension has already validated its
  // qualification record, and every field read below is asserted rather than trusted.
  return parsed as ModelLock
}

/** The one asset set the manifest declares. */
function lockedAssetSet(lock: ModelLock): ModelAssetSet {
  const declared = declaredManifest()
  const assetSetId = declared.models[0]?.assetSet
  assert.ok(assetSetId !== undefined)
  const assetSet = lock.assetSets[assetSetId]
  assert.ok(assetSet !== undefined)
  return assetSet
}

describe('models.lock.json — the uhm artifact identities', () => {
  it('validates through discovery, which checks the qualification record', () => {
    assert.doesNotThrow(() => discoverExtension(DIR))
  })

  it('declares the asset set the manifest names, and only that one', () => {
    const declared = declaredManifest()
    const lock = modelLock()
    const assetSet = declared.models[0]?.assetSet
    assert.ok(assetSet !== undefined)
    assert.deepEqual(Object.keys(lock.assetSets), [assetSet])
  })

  it('pins desert-ant-labs/uhm at the measured revision', () => {
    const assetSet = lockedAssetSet(modelLock())
    assert.equal(assetSet.model.provider, 'desert-ant-labs')
    assert.equal(assetSet.model.identity, 'desert-ant-labs/uhm')
    assert.equal(assetSet.model.revision, EXPECTED_REVISION)
    assert.equal(assetSet.pinning.revision, EXPECTED_REVISION)
    assert.equal(assetSet.pinning.state, 'measured')
    assert.deepEqual(assetSet.model.modalities, ['audio'])
  })

  it('records the exact ONNX bytes and sha256', () => {
    const assetSet = lockedAssetSet(modelLock())
    const asset = assetSet.assets.find(entry => entry.fileName === 'uhm.onnx')
    assert.ok(asset !== undefined, 'the lock must pin uhm.onnx')
    assert.equal(asset.id, 'uhm-onnx-model')
    assert.equal(asset.bytes, ONNX_BYTES)
    assert.equal(asset.sha256, ONNX_SHA256)
    assert.match(asset.url, new RegExp('/resolve/' + EXPECTED_REVISION + '/uhm\\.onnx$'))
  })

  it('records the exact labels.json bytes, sha256 and class order', () => {
    const assetSet = lockedAssetSet(modelLock())
    const asset = assetSet.assets.find(entry => entry.fileName === 'labels.json')
    assert.ok(asset !== undefined, 'the lock must pin labels.json: it is the class-index contract')
    assert.equal(asset.id, 'uhm-labels')
    assert.equal(asset.bytes, LABELS_BYTES)
    assert.equal(asset.sha256, LABELS_SHA256)
    assert.match(asset.url, new RegExp('/resolve/' + EXPECTED_REVISION + '/labels\\.json$'))
    assert.match(
      JSON.stringify(assetSet.qualification),
      /not_filler/,
      'the qualification must name the class order, because the processor maps frame indices to types',
    )
  })

  it('keeps the group id and the asset ids in distinct namespaces', () => {
    /**
     * The host projects a GROUP id to a prepared directory and each ASSET id to a file inside it,
     * so one key cannot mean both. This is the convention the shapes lock already uses
     * (group shapes-litert, asset shapes-tflite); an asset id equal to the group id would collide
     * in that projection.
     */
    const assetSet = lockedAssetSet(modelLock())
    const group = assetSet.groups[0]
    assert.ok(group !== undefined)
    const assetIds = assetSet.assets.map(asset => asset.id)
    assert.equal(new Set(assetIds).size, assetIds.length, 'asset ids must be unique')
    for (const assetId of assetIds) {
      assert.notEqual(assetId, group.id, 'asset id ' + assetId + ' collides with the group id')
    }
    assert.deepEqual(group.assets.map(entry => entry.id), assetIds)
  })

  it('keeps every group digest, size and source identical to its asset record', () => {
    const assetSet = lockedAssetSet(modelLock())
    const group = assetSet.groups[0]
    assert.ok(group !== undefined)
    assert.equal(group.id, 'uhm-onnx')
    assert.deepEqual(group.enables, ['audio'])
    assert.equal(group.assets.length, 2)
    for (const groupAsset of group.assets) {
      const asset = assetSet.assets.find(entry => entry.id === groupAsset.id)
      assert.ok(asset !== undefined, 'group asset ' + groupAsset.id + ' has no asset record')
      assert.equal(groupAsset.file, asset.fileName)
      assert.equal(groupAsset.bytes, asset.bytes)
      assert.equal(groupAsset.digest, asset.sha256)
      assert.equal(groupAsset.source, asset.url)
      assert.equal(groupAsset.executable, false)
    }
  })

  it('uses the ONNX engine the recipe names, not a vendor SDK', () => {
    const assetSet = lockedAssetSet(modelLock())
    assert.equal(assetSet.engine.kind, 'onnxruntime')
    assert.equal(assetSet.tokenizer.kind, 'none')
  })

  it('carries the source-available weight licence with attribution', () => {
    const assetSet = lockedAssetSet(modelLock())
    assert.match(assetSet.license.name, /Desert Ant Labs Source-Available License/)
    assert.equal(assetSet.license.redistribution, 'not-permitted')
    assert.equal(assetSet.license.attributionRequired, true)
  })

  it('qualifies the deployment with every field the SDK requires', () => {
    const assetSet = lockedAssetSet(modelLock())
    const qualification = assetSet.qualification
    for (const field of ['modelRevision', 'artifactSha', 'tokenizer', 'processor', 'engineVersion', 'nodeAbi', 'architecture', 'executionProvider']) {
      const value = qualification[field]
      assert.ok(value !== undefined, 'qualification.' + field + ' must be present')
      assert.ok(value.length > 0, 'qualification.' + field + ' must not be blank')
    }
    assert.equal(qualification['modelRevision'], EXPECTED_REVISION)
    assert.equal(qualification['artifactSha'], 'sha256:' + ONNX_SHA256)
  })

  it('declares the same platform in the lock as in the manifest', () => {
    const declared = declaredManifest()
    const assetSet = lockedAssetSet(modelLock())
    assert.deepEqual(assetSet.platforms, declared.models[0]?.platforms)
  })
})
