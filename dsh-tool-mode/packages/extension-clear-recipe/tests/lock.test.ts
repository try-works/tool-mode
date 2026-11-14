/**
 * The asset lock is the only place the clear artifact's identity is recorded.
 *
 * The digest was computed first-hand from the 24,801,006 bytes fetched at the pinned revision on
 * 2026-11-14 (matched against the repository's LFS metadata), and the processor constants come
 * from the primary-source commit named in pinning.contractSource, not from a guess.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { discoverExtension, validateManifest, type ExtensionManifest } from '@try-works/tool-mode-extension-sdk'

const DIR = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** The pinned HF revision (repository commit sha). */
const EXPECTED_REVISION = 'b98f790c8a16d572f47bfdebd39964a0cbc987dc'
/** clear-studio.onnx: sha256 computed from the fetched bytes; byte count matches the LFS size. */
const ONNX_BYTES = 24801006
const ONNX_SHA256 = '4176990296374e972f0c347ddcc7988d216829cafc58e4d54a98dccd715107d9'

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
  readonly pinning: {
    readonly state: string
    readonly revision: string
    readonly contractSource?: {
      readonly repository: string
      readonly commit: string
      readonly fetched: string
      readonly files: readonly string[]
    }
  }
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

describe('models.lock.json — the clear artifact identity', () => {
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

  it('pins desert-ant-labs/clear at the measured revision', () => {
    const assetSet = lockedAssetSet(modelLock())
    assert.equal(assetSet.model.provider, 'desert-ant-labs')
    assert.equal(assetSet.model.identity, 'desert-ant-labs/clear')
    assert.equal(assetSet.model.revision, EXPECTED_REVISION)
    assert.equal(assetSet.pinning.revision, EXPECTED_REVISION)
    assert.equal(assetSet.pinning.state, 'measured')
    assert.deepEqual(assetSet.model.modalities, ['audio'])
  })

  it('records the primary-source contract provenance', () => {
    /**
     * The DSP contract is not inferable from the ONNX file. The lock names the exact source
     * commit and files it was read from, so a later change to the constants can be checked
     * against the same primary source rather than against a paraphrase.
     */
    const assetSet = lockedAssetSet(modelLock())
    const source = assetSet.pinning.contractSource
    assert.ok(source !== undefined, 'the lock must name the source commit the DSP contract was read from')
    assert.equal(source.repository, 'https://github.com/Desert-Ant-Labs/desert-ant-core')
    assert.equal(source.commit, 'baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7')
    assert.equal(source.fetched, '2026-11-14')
    assert.ok(source.files.some(file => file.includes('Sources/Clear/DSP.swift')))
    assert.ok(source.files.some(file => file.includes('Sources/Clear/Features.swift')))
    assert.ok(source.files.some(file => file.includes('Sources/AudioDSP/Limiter.swift')))
  })

  it('records the exact clear-studio.onnx bytes and sha256', () => {
    const assetSet = lockedAssetSet(modelLock())
    assert.equal(assetSet.assets.length, 1)
    const asset = assetSet.assets[0]
    assert.ok(asset !== undefined)
    assert.equal(asset.id, 'clear-onnx-model')
    assert.equal(asset.fileName, 'clear-studio.onnx')
    assert.equal(asset.bytes, ONNX_BYTES)
    assert.equal(asset.sha256, ONNX_SHA256)
    assert.match(asset.url, new RegExp('/resolve/' + EXPECTED_REVISION + '/clear-studio\\.onnx$'))
  })

  it('keeps the group id and the asset ids in distinct namespaces', () => {
    /**
     * The host projects a GROUP id to a prepared directory and each ASSET id to a file, so one
     * key cannot mean both (the shapes/uhm convention: group shapes-litert, asset shapes-tflite).
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
    assert.equal(group.id, 'clear-onnx')
    assert.deepEqual(group.enables, ['audio'])
    assert.equal(group.assets.length, assetSet.assets.length)
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

  it('uses the ONNX engine the recipe will name, not a vendor SDK', () => {
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

  it('qualifies the deployment without inventing the processor contract', () => {
    const assetSet = lockedAssetSet(modelLock())
    const qualification = assetSet.qualification
    for (const field of ['modelRevision', 'artifactSha', 'tokenizer', 'processor', 'engineVersion', 'nodeAbi', 'architecture', 'executionProvider']) {
      const value = qualification[field]
      assert.ok(value !== undefined, 'qualification.' + field + ' must be present')
      assert.ok(value.length > 0, 'qualification.' + field + ' must not be blank')
    }
    assert.equal(qualification['modelRevision'], EXPECTED_REVISION)
    assert.equal(qualification['artifactSha'], 'sha256:' + ONNX_SHA256)
    const processor = qualification['processor'] ?? ''
    assert.match(processor, /clear\/stft-v1/)
    assert.match(processor, /n_fft 960, hop 480, 481 bins/)
    assert.match(processor, /Vorbis window/)
    assert.match(processor, /output truncated to input length/)
    assert.match(processor, /target -19 LUFS/)
    assert.match(processor, /1\.5 dBTP/)
    assert.match(processor, /WAV\/RIFF PCM 16-bit or IEEE float32 only/)
  })

  it('declares the same platform in the lock as in the manifest', () => {
    const declared = declaredManifest()
    const assetSet = lockedAssetSet(modelLock())
    assert.deepEqual(assetSet.platforms, declared.models[0]?.platforms)
  })
})
