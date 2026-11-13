/**
 * Plugin-level custom-tool restore test: the store is loaded during apply and
 * the enabled record is present in the real registry.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { CustomToolStore } from '../src/custom-tools/store.ts'
import { cleanup, isolatedStateFile, mountPlugin } from './helpers.ts'

after(async () => { await cleanup() })

describe('plugin custom-tool restore', () => {
  it('registers an enabled stored tool and skips a disabled one', async () => {
    const stateFile = isolatedStateFile()
    const store = new CustomToolStore({ rootDir: join(dirname(stateFile), 'custom-tools') })
    store.save({
      id: 'custom.echo',
      name: 'custom_echo',
      title: 'Echo',
      description: 'Echo text.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      execution: { kind: 'prompt', prompt: { template: '{{text}}' } },
      policy: { timeoutMs: 5_000, readOnly: true, networkOrigins: [], agentExpose: true, mcpExpose: false },
      examples: [],
    })
    store.save({
      id: 'custom.off',
      name: 'custom_off',
      title: 'Off',
      description: 'Disabled tool.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execution: { kind: 'prompt', prompt: { template: 'off' } },
      policy: { timeoutMs: 5_000, readOnly: true, networkOrigins: [], agentExpose: true, mcpExpose: false },
      examples: [],
    })
    store.setEnabled('custom.off', false)
    const ctx = await mountPlugin({ stateFile })
    assert.notEqual(ctx.tools.get('custom_echo'), undefined)
    assert.equal(ctx.tools.get('custom_off'), undefined)
  })
})
