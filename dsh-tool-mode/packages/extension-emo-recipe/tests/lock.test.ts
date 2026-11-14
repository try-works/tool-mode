/**
 * The asset lock is the only place the emo artifact set is recorded.
 *
 * PREPARATORY: the three artifact identities are final and tested (computed from the fetched bytes
 * at the pinned revision and matched against the repository metadata); the qualification's
 * processor text is a documented placeholder for litert-provider's `emo/text-v1` contract
 * (docs/runtime/PHASE4.md emo section) and is replaced when that contract lands.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { discoverExtension, validateManifest, type ExtensionManifest } from '@try-works/tool-mode-extension-sdk'

const DIR = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** The pinned HF revision (repository commit sha). */
const EXPECTED_REVISION = '7c2e137cb0300ecf8e31b7deab4c4e9734d06b74'
/** The three artifacts, measured from the fetched bytes at the pinned revision. */
const ASSETS = [
  { id: 'emo-tflite', fileName: 'emo.tflite', bytes: 10222736, sha256: '2c382e8da94bab64172c0694b0350abb96829bf89eb623008ed0085128621de2' },
  { id: 'emo-tokenizer', fileName: 'emo_tokenizer.bin', bytes: 733197, sha256: 'f54462a7a2344f15c9430ed4e399c49444f890dd6094c745a0c5391690bf019d' },
  { id: 'emo-meta', fileName: 'emo_meta.json', bytes: 6280, sha256: 'a3143258ac4099de65367cd4598073f1f5ce94f0eb505a30331762619967d3f6' },
] as const

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

describe('models.lock.json — the emo artifact set (preparatory)', () => {
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

  it('pins desert-ant-labs/emo at the measured revision', () => {
    const assetSet = lockedAssetSet(modelLock())
    assert.equal(assetSet.model.provider, 'desert-ant-labs')
    assert.equal(assetSet.model.identity, 'desert-ant-labs/emo')
    assert.equal(assetSet.model.revision, EXPECTED_REVISION)
    assert.equal(assetSet.pinning.revision, EXPECTED_REVISION)
    assert.equal(assetSet.pinning.state, 'measured')
    assert.deepEqual(assetSet.model.modalities, ['text'])
  })

  it('records all three artifacts with their exact bytes and sha256', () => {
    const assetSet = lockedAssetSet(modelLock())
    assert.equal(assetSet.assets.length, ASSETS.length)
    for (const expected of ASSETS) {
      const asset = assetSet.assets.find(entry => entry.id === expected.id)
      assert.ok(asset !== undefined, 'missing asset ' + expected.id)
      assert.equal(asset.fileName, expected.fileName)
      assert.equal(asset.bytes, expected.bytes)
      assert.equal(asset.sha256, expected.sha256)
      assert.match(asset.url, new RegExp('/resolve/' + EXPECTED_REVISION + '/' + expected.fileName.replace('.', '\\.') + '$'))
    }
  })

  it('keeps the group id and the asset ids in distinct namespaces', () => {
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
    assert.equal(group.id, 'emo-litert')
    assert.deepEqual(group.enables, ['text'])
    assert.equal(group.assets.length, ASSETS.length)
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

  it('uses the LiteRT engine the recipe will name, not a vendor SDK', () => {
    const assetSet = lockedAssetSet(modelLock())
    assert.equal(assetSet.engine.kind, 'litert')
    assert.equal(assetSet.tokenizer.kind, 'emtk')
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
    assert.equal(qualification['artifactSha'], 'sha256:' + ASSETS[0].sha256)
    assert.match(qualification['processor'] ?? '', /emo\/text-v1/)
    assert.match(qualification['processor'] ?? '', /812/)
    assert.match(qualification['tokenizer'] ?? '', /EMTK/)
  })

  it('records the Lead-decided input, ordering and meta contract', () => {
    const processor = lockedAssetSet(modelLock()).qualification['processor'] ?? ''
    assert.match(processor, /Unicode code points/)
    assert.match(processor, /whitespace-only text is refused/)
    assert.match(processor, /ascending label index/)
    assert.match(processor, /explicitly uncalibrated/)
    assert.ok(processor.includes('emo_meta.json labels[index]'), 'emoji strings come from the meta labels')
    assert.match(processor, /4194304 bytes \/ 120000 ms/)
    assert.ok(processor.includes("model card's '23 languages' claim is card-sourced"), 'the language claim is card-sourced')
    assert.match(processor, /RuntimeUnavailable/)
  })

  it('records the confirmed input, tensor and meta contract', () => {
    const processor = lockedAssetSet(modelLock()).qualification['processor'] ?? ''
    assert.match(processor, /Unicode code points/)
    assert.match(processor, /whitespace-only text is refused/)
    assert.match(processor, /ascending label index/)
    assert.match(processor, /explicitly uncalibrated/)
    assert.ok(processor.includes('emo_meta.json labels[index]'), 'emoji strings come from the meta labels')
    assert.ok(processor.includes('int32 [1,512,3]'), 'ngram bucket tensor shape is recorded')
    assert.ok(processor.includes('float32 [1,64]'), 'semantic mask tensor shape is recorded')
    assert.ok(processor.includes('float32 [812]'), 'the output tensor is recorded')
    assert.ok(processor.includes('v1 applies no skin-tone variant'), 'the skin-tone scope is recorded')
    assert.match(processor, /4194304 bytes \/ 120000 ms/)
    assert.match(processor, /23 languages' claim is card-sourced/)
    assert.match(processor, /RuntimeUnavailable/)
  })

  it('pins the primary-source provenance the contract was read from', () => {
    const contractSource = lockedAssetSet(modelLock()).pinning.contractSource
    assert.ok(contractSource !== undefined)
    assert.equal(contractSource.repository, 'https://github.com/Desert-Ant-Labs/desert-ant-core')
    assert.equal(contractSource.commit, 'baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7')
    assert.ok(contractSource.files.some(file => file.startsWith('Sources/Emo/Tokenizer.swift')))
    assert.ok(contractSource.files.some(file => file.startsWith('Sources/Emo/Emo.swift')))
  })

  it('declares the same platform in the lock as in the manifest', () => {
    const declared = declaredManifest()
    const assetSet = lockedAssetSet(modelLock())
    assert.deepEqual(assetSet.platforms, declared.models[0]?.platforms)
  })
})
