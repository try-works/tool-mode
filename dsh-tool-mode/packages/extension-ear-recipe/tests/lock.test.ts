/**
 * The asset lock is the only place the ear artifact set is recorded.
 *
 * PREPARATORY: the four artifact identities are final and tested (computed from the fetched
 * bytes at the pinned revision and matched against the repository metadata); the qualification's
 * processor text is a documented placeholder for litert-provider's `ear/mel-v1` contract
 * (docs/runtime/PHASE4.md ear section) and is replaced when that contract lands.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { discoverExtension, validateManifest, type ExtensionManifest } from '@try-works/tool-mode-extension-sdk'

const DIR = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** The pinned HF revision (repository commit sha). */
const EXPECTED_REVISION = '1e2148c0cc46130174ecf564c406e44931fca386'
/** The four artifacts, measured from the fetched bytes at the pinned revision. */
const ASSETS = [
  { id: 'ear-tflite', fileName: 'ear.tflite', bytes: 10671552, sha256: 'a19b43892abe53afba50122a861b10fd76f312a5027a5c659b0738081135feeb' },
  { id: 'ear-meta', fileName: 'ear_meta.json', bytes: 2190, sha256: '538d66c747024d4ef2ae33aef273817c7baea21171430fef0c2713a66bb6af18' },
  { id: 'ear-languages', fileName: 'languages.json', bytes: 628, sha256: '0a08f30dec26ad25730a1fa9375a5d693f5a159032d0cd7818007b7dbc3eae18' },
  { id: 'ear-mel-filters', fileName: 'mel_filters.f32', bytes: 64328, sha256: 'a3099fcba1a7f30f229b230011146ea0140db8de4f467b44aaa5de70bcc0f325' },
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

describe('models.lock.json — the ear artifact set (preparatory)', () => {
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

  it('pins desert-ant-labs/ear at the measured revision', () => {
    const assetSet = lockedAssetSet(modelLock())
    assert.equal(assetSet.model.provider, 'desert-ant-labs')
    assert.equal(assetSet.model.identity, 'desert-ant-labs/ear')
    assert.equal(assetSet.model.revision, EXPECTED_REVISION)
    assert.equal(assetSet.pinning.revision, EXPECTED_REVISION)
    assert.equal(assetSet.pinning.state, 'measured')
    assert.deepEqual(assetSet.model.modalities, ['audio'])
  })

  it('records all four artifacts with their exact bytes and sha256', () => {
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
    assert.equal(group.id, 'ear-litert')
    assert.deepEqual(group.enables, ['audio'])
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
    assert.equal(qualification['artifactSha'], 'sha256:' + ASSETS[0].sha256)
    assert.match(qualification['processor'] ?? '', /ear\/mel-v1/)
  })

  it('records the adjudicated language arithmetic and window contract', () => {
    const processor = lockedAssetSet(modelLock()).qualification['processor'] ?? ''
    assert.match(processor, /103 logits/)
    assert.match(processor, /102 distinct canonical/)
    assert.match(processor, /yue->zh/)
    assert.match(processor, /no-ops/)
    assert.match(processor, /windows = the integer count/)
    assert.match(processor, /up to 5 \{language, probability\}/)
    assert.match(processor, /isReliable/)
    assert.match(processor, /0\.25/)
  })

  it('pins the primary-source provenance the contract was read from', () => {
    const contractSource = lockedAssetSet(modelLock()).pinning.contractSource
    assert.ok(contractSource !== undefined)
    assert.equal(contractSource.repository, 'https://github.com/Desert-Ant-Labs/desert-ant-core')
    assert.equal(contractSource.commit, 'baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7')
    assert.ok(contractSource.files.some(file => file.startsWith('Sources/Ear/Ear.swift')))
  })

  it('declares the same platform in the lock as in the manifest', () => {
    const declared = declaredManifest()
    const assetSet = lockedAssetSet(modelLock())
    assert.deepEqual(assetSet.platforms, declared.models[0]?.platforms)
  })
})
