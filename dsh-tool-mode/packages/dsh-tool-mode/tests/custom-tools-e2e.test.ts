/**
 * Clean-profile end-to-end evidence for custom tools (plan §15).
 *
 * A fresh state/profile root: persist a composite custom tool, mount the real
 * plugin and registry, invoke it through the registry pipeline, inspect
 * inventory attribution, disable it through the Remote surface, and confirm it
 * is gone. No network and no model provider are required.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CustomToolStore } from '../src/custom-tools/store.ts'
import type { ModelToolsRemote } from '../src/extensions-api.ts'
import { callTool, cleanup, isolatedStateFile, mountPlugin } from './helpers.ts'

after(async () => { await cleanup() })

function pipelineRecord() {
  return {
    id: 'custom.pipeline',
    name: 'custom_pipeline',
    title: 'Pipeline',
    description: 'Echo text through the registry.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    execution: {
      kind: 'composite' as const,
      composite: { steps: [{ tool: 'stub_echo', args: { text: '{{text}}' } }] },
    },
    policy: {
      timeoutMs: 5_000,
      readOnly: true,
      networkOrigins: [],
      agentExpose: true,
      mcpExpose: false,
    },
    examples: [],
  }
}

describe('custom tools clean-profile E2E', () => {
  it('restores, executes, attributes, disables and removes one custom tool', async () => {
    const stateFile = isolatedStateFile()
    const store = new CustomToolStore({ rootDir: join(dirname(stateFile), 'custom-tools') })
    store.save(pipelineRecord())

    const ctx = await mountPlugin({ stateFile })
    ctx.tools.register(defineTool({
      name: 'stub_echo',
      description: 'Echo text for the composite test.',
      parameters: { text: { type: 'string', required: true } },
      output: {
        schema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async args => ({ text: String(args['text'] ?? '') }),
    }))

    assert.notEqual(ctx.tools.get('custom_pipeline'), undefined)
    const result = await callTool(ctx, 'custom_pipeline', { text: 'clean-profile' })
    assert.equal(result.isError, false)
    assert.deepEqual(result.value, { text: 'clean-profile' })

    const remote = ctx.get('modelTools') as unknown as ModelToolsRemote
    const inventory = await remote.toolInventory!()
    const row = inventory.tools.find(tool => tool.name === 'custom_pipeline')
    assert.ok(row !== undefined)
    assert.equal(row.kind, 'custom')
    assert.equal(row.owner, 'custom.pipeline')

    const mcp = await remote.mcpStatus!()
    assert.equal(mcp.exposed.includes('custom_pipeline'), false)
    assert.equal(mcp.withheld.includes('custom_pipeline'), true)

    await remote.customToolsSetEnabled!('custom.pipeline', false)
    assert.equal(ctx.tools.get('custom_pipeline'), undefined)
    const listed = await remote.customToolsDescribe!()
    assert.equal(listed.tools.find(tool => tool.id === 'custom.pipeline')?.enabled, false)

    assert.equal(await remote.customToolsDelete!('custom.pipeline'), true)
    assert.deepEqual((await remote.customToolsDescribe!()).tools, [])
  })
})
