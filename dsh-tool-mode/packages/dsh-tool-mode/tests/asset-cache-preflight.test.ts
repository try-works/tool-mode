/**
 * TASK-131 (RC2): the disk-space preflight for prepared assets.
 *
 * The live failure: pressing Prepare for the ~3.2 GB embeddinggemma set on a
 * disk with ~0.38 GB free surfaced as a bare mid-stream transport failure.
 * The preflight compares the MISSING bytes (a digest cache hit transfers
 * nothing) against the free space at the cache root and refuses with a
 * named, actionable `extension-asset-space-insufficient` reason quoting the
 * numbers — before any transfer.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { digestInstalledContent, ExtensionStore } from '@try-works/tool-mode-extension-sdk'

import {
  createPreparedAssetRegistry,
  identityFor,
  lockGroups,
  parseAssetLock,
  plannedAssets,
} from '../src/prepared-assets.ts'
import type { AcquisitionSource, PlannedAsset } from '../src/index.ts'
import * as plugin from '../src/index.ts'
import { tempDir } from './helpers.ts'

const FIXTURE_BYTES = {
  'big-model': Buffer.from('big-model-weights-0001'),
  'small-tokenizer': Buffer.from('{"fixture":"tokenizer"}'),
} as const

function fixtureLock(): string {
  const digestOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  return JSON.stringify({
    protocolVersion: '1.1.0',
    assetSets: {
      'fixture-set': {
        pinning: { state: 'measured', revision: 'fixture-revision-1', recordedAt: '2026-10-19' },
        license: { name: 'Fixture License', url: 'https://example.invalid/license' },
        groups: [
          {
            id: 'text-backbone',
            enables: ['text'],
            assets: [
              { id: 'big-model', file: 'onnx/model.onnx', bytes: FIXTURE_BYTES['big-model'].byteLength, source: 'https://example.invalid/model.onnx', digest: digestOf(FIXTURE_BYTES['big-model']) },
              { id: 'small-tokenizer', file: 'tokenizer.json', bytes: FIXTURE_BYTES['small-tokenizer'].byteLength, source: 'https://example.invalid/tokenizer.json', digest: digestOf(FIXTURE_BYTES['small-tokenizer']) },
            ],
          },
        ],
      },
    },
  })
}

/** A local source serving the fixture bytes; counts reads. */
function localSource(reads: { value: number }): AcquisitionSource {
  return {
    supportsRanges: true,
    async fetchRange(asset: PlannedAsset, from: number, to: number): Promise<Uint8Array> {
      reads.value += 1
      const name = asset.assetId.split('/').pop() ?? asset.assetId
      const bytes = FIXTURE_BYTES[name as keyof typeof FIXTURE_BYTES]
      if (bytes === undefined) throw new Error(`no fixture for ${asset.assetId}`)
      return new Uint8Array(bytes.subarray(from, to + 1))
    },
  }
}

function planFor(lock: ReturnType<typeof parseAssetLock>) {
  const assets = plannedAssets(lock, 'fixture-set')
  return {
    identity: identityFor('@try-works/fixture-preflight', 'fixture-model', lock),
    assets,
    totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    storageBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    requiresExecutableApproval: false,
    license: lock.license,
  }
}

test('insufficient space refuses with the named error and the exact byte math, before any transfer', async () => {
  const reads = { value: 0 }
  const root = tempDir()
  const registry = createPreparedAssetRegistry({
    cacheRoot: root,
    freeSpaceBytes: () => 4, // far below the fixture's needs
  })
  const lock = parseAssetLock(fixtureLock())
  const missingBytes = FIXTURE_BYTES['big-model'].byteLength + FIXTURE_BYTES['small-tokenizer'].byteLength
  const outcome = await registry.prepare('@try-works/fixture-preflight', planFor(lock), lockGroups(lock, 'fixture-set'), {
    source: localSource(reads),
    allowExecutable: false,
    signal: new AbortController().signal,
  })
  assert.equal(outcome.ok, false)
  assert.match(outcome.reason, /\[extension-asset-space-insufficient\]/, 'the named code leads the reason')
  assert.match(outcome.reason, new RegExp(`needs ${missingBytes} bytes`), 'the reason quotes the required bytes')
  assert.match(outcome.reason, /but only 4 bytes are free/, 'the reason quotes the available bytes')
  assert.match(outcome.reason, new RegExp(root.replaceAll('\\', '\\\\')), 'the reason quotes the cache path')
  assert.equal(reads.value, 0, 'nothing was transferred: the refusal happens before any fetch')
})

test('a digest cache hit short-circuits: zero free space is fine when every blob is already cached', async () => {
  const reads = { value: 0 }
  const root = tempDir()
  const lock = parseAssetLock(fixtureLock())
  // Pre-seed every blob by digest (the content-addressed cache layout).
  for (const group of lockGroups(lock, 'fixture-set')) {
    for (const asset of group.assets) {
      const name = asset.id.split('/').pop() ?? asset.id
      writeFileSync(join(root, asset.digest), FIXTURE_BYTES[name as keyof typeof FIXTURE_BYTES])
    }
  }
  const registry = createPreparedAssetRegistry({
    cacheRoot: root,
    freeSpaceBytes: () => 0, // nothing free — irrelevant when nothing is missing
  })
  const outcome = await registry.prepare('@try-works/fixture-preflight', planFor(lock), lockGroups(lock, 'fixture-set'), {
    source: localSource(reads),
    allowExecutable: false,
    signal: new AbortController().signal,
  })
  assert.equal(outcome.ok, true, JSON.stringify(outcome))
  assert.equal(reads.value, 0, 'cache hits never touch the source')
})

test('the config assetCacheRoot overrides the state-adjacent default end to end', async () => {
  const storeDir = tempDir()
  const customRoot = join(tempDir(), 'custom-cache')
  mkdirSync(customRoot, { recursive: true })
  // Install the minimal fixture extension so the service can plan + prepare.
  const installPath = join(storeDir, 'extensions', '@try-works', 'fixture-preflight', '1.0.0')
  mkdirSync(join(installPath, 'lib'), { recursive: true })
  writeFileSync(join(installPath, 'package.json'), JSON.stringify({
    name: '@try-works/fixture-preflight', version: '1.0.0', private: true, type: 'module',
    exports: { './tool-mode': './lib/index.mjs' }, toolMode: { manifest: './tool-mode.extension.json' },
  }))
  writeFileSync(join(installPath, 'models.lock.json'), fixtureLock())
  writeFileSync(join(installPath, 'tool-mode.extension.json'), JSON.stringify({
    protocolVersion: '1.1.0', id: '@try-works/fixture-preflight', version: '1.0.0',
    displayName: 'Preflight fixture', description: 'RC2 preflight fixture',
    activation: { policy: 'operator', deactivatable: true }, runtimeApi: 1,
    compatibility: { hostApi: '^1.1.0', requiredFeatures: [] },
    execution: { kind: 'module', entry: './lib/index.mjs' },
    permissions: { networkOrigins: [], inputFiles: false, storage: 'extension-private', secrets: [], nativeCode: false },
    models: [{ id: 'fixture-model', assetSet: 'fixture-set', assetLock: './models.lock.json', platforms: [{ os: 'win32', arch: 'x64', accelerator: 'cpu' }] }],
    tools: [], implementations: [], skills: [],
  }))
  writeFileSync(join(installPath, 'lib', 'index.mjs'), `export default {
  apiVersion: 1,
  async create() {
    return {
      async createProvider() {
        return {
          async inspect() { return { readiness: 'needs-preparation', features: [], missing: [] } },
          async load() {},
          async invoke(request) { return { echo: request.input?.text ?? 'x' } },
          async unload() {}, async dispose() {},
        }
      },
      async dispose() {},
    }
  },
}
`)
  const store = new ExtensionStore(storeDir)
  store.recordInstall({
    extensionId: '@try-works/fixture-preflight',
    version: '1.0.0',
    installPath,
    archiveDigest: 'sha512-00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    contentDigest: digestInstalledContent(installPath),
  } satisfies Parameters<ExtensionStore['recordInstall']>[0])
  store.writeProfileState('default', [{
    extensionId: '@try-works/fixture-preflight',
    installation: 'installed',
    desiredActivation: 'active',
    observedActivation: 'active',
    ownerPid: 2147483647,
    export: 'not-exported',
    tools: [],
    readiness: {},
  }])
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(plugin.default ?? plugin, {
    stateFile: join(storeDir, 'state.json'),
    credentialsFile: join(storeDir, 'credentials.json'),
    extensionStore: storeDir,
    assetCacheRoot: customRoot,
    assetFreeSpaceProbe: () => 0,
  })
  const service = ctx.get('modelTools') as unknown as {
    prepare: (id: string, signal?: AbortSignal) => Promise<{ prepared: boolean; reason?: string }>
  }
  const outcome = await service.prepare('@try-works/fixture-preflight')
  assert.equal(outcome.prepared, false)
  assert.match(outcome.reason ?? '', /\[extension-asset-space-insufficient\]/, 'the preflight refusal surfaces through the service')
  assert.match(outcome.reason ?? '', new RegExp(customRoot.replaceAll('\\', '\\\\')), 'the reason quotes the CONFIGURED cache root, not the state-adjacent default')
  await ctx.fiber.dispose()
})
