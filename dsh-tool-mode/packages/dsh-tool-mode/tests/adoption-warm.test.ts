import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { callTool, cleanup, mountPlugin, mountPluginWithTongue } from './helpers.ts'

after(async () => { await cleanup() })

describe('warm action', () => {
  it('is a mutation and is refused by the read-only clone', async () => {
    const ctx = await mountPluginWithTongue({ managementGrant: false })
    const result = await callTool(ctx, 'model_tools', { action: 'warm', model: 'tongue' })
    assert.equal(result.isError, true)
  })

  it('names the missing extension store instead of silently doing nothing', async () => {
    const ctx = await mountPlugin()
    const result = await callTool(ctx, 'model_tools', { action: 'warm', model: 'tongue' })
    assert.equal(result.isError, true)
    assert.match(result.error?.message ?? '', /extension store|extensionStoreDir/)
  })
})
