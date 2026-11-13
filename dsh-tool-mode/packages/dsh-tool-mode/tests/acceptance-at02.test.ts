/**
 * AT-02 — a cold boot performs no model preparation and no network access.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, mountPlugin, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

describe('AT-02 — cold boot is read-only', () => {
  it('downloads no weights and leaves the asset cache empty', async () => {
    const store = tempDir()
    const cache = tempDir()
    const originalFetch = globalThis.fetch
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches += 1
      throw new Error('cold boot must not perform network access')
    }) as typeof fetch
    try {
      await mountPlugin({
        extensionStore: store,
        assetCacheRoot: cache,
        stateFile: join(store, 'state.json'),
      })
      // Give any deferred startup work a chance to run; it must not.
      await new Promise(resolve => setTimeout(resolve, 250))
      assert.equal(fetches, 0, 'no startup path may fetch')
      assert.deepEqual(readdirSync(cache), [], 'no prepared asset may be materialized at boot')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
