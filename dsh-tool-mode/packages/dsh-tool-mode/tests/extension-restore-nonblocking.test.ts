/**
 * The restore chain must not run a synchronous full-tree digest on the boot path.
 *
 * A restart with ~16 installed extensions held the loader open for minutes while
 * verifyUnchanged() hashed installed trees on the event loop. The host now uses the
 * SDK's async, cached verification before activation.
 *
 * @module tests/extension-restore-nonblocking
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof */

import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { join } from 'node:path'

import { restoreExtensions } from '../src/extension-lifecycle.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

describe('extension restore stays off the synchronous boot path', () => {
  it('uses verifyUnchangedAsync and never the synchronous full-tree digest', async () => {
    const id = '@try-works/fixture-restore'
    const record = {
      extensionId: id,
      version: '1.0.0',
      installPath: join(tempDir(), 'missing-install'),
      contentDigest: 'recorded-digest',
    }
    let asyncChecks = 0
    let syncChecks = 0
    const store = {
      listInstalled: () => ({ value: [record] }),
      readProfilePointers: () => ({ value: { activeVersions: {} }, corrupt: false }),
      readProfileState: () => ({
        value: [{ extensionId: id, desiredActivation: 'active' }],
        corrupt: false,
      }),
      verifyUnchangedAsync: async () => {
        asyncChecks += 1
        return { unchanged: true, cached: true }
      },
      verifyUnchanged: () => {
        syncChecks += 1
        throw new Error('the synchronous digest must not run on the boot path')
      },
    }
    const activationGenerations = new Map<string, number>()
    const lifecycle = {
      states: () => [],
      activate: async () => ({ generation: 7 }),
      recordReadiness: async () => undefined,
    }
    const warnings: string[] = []
    const ctx = {
      logger: { info: () => {}, warn: (message: string) => { warnings.push(message) } },
    }

    await restoreExtensions({
      ctx: ctx as never,
      store: store as never,
      config: { autoProvisionExtensions: false },
      extensionStoreDir: '',
      extensionLifecycle: () => lifecycle as never,
      prepareAssetsSurface: () => undefined,
      assetRestoreFailures: new Map(),
      activationGenerations,
      extensionsService: {} as never,
      bridge: {} as never,
      resolved: [],
    })

    const deadline = Date.now() + 2_000
    while (Date.now() < deadline && activationGenerations.get(id) === undefined) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }

    assert.equal(syncChecks, 0, warnings.join('\n'))
    assert.equal(asyncChecks, 1, warnings.join('\n'))
    assert.equal(activationGenerations.get(id), 7, warnings.join('\n'))
  })
})
