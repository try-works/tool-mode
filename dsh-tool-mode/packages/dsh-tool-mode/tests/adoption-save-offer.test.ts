import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import type { Context } from '@deepseek-ai/cordis'
import { callTool, cleanup, mountPluginWithTongue } from './helpers.ts'

after(async () => { await cleanup() })

let counter = 0
async function callAs(ctx: Context, name: string, args: unknown, sessionId: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('offer-' + (++counter)),
    name,
    arguments: args,
    agent: { id: sessionId } as never,
  } as never)
}

async function enableTongue(ctx: Context) {
  const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
  assert.equal(enabled.isError, false, JSON.stringify(enabled))
}

describe('repetition save offer', () => {
  it('is absent when the flag is off', async () => {
    const ctx = await mountPluginWithTongue({ adoption: { saveOffer: false } })
    await enableTongue(ctx)
    for (const text of ['a', 'b', 'c']) await callAs(ctx, 'lang_detect', { text }, 'session-a')
    const listed = await callAs(ctx, 'tool_mode_list', {}, 'session-a')
    assert.equal(listed.isError, false)
    const authoring = (listed as { value?: { authoring?: { suggestions?: unknown } } }).value?.authoring
    assert.equal(authoring?.suggestions, undefined)
  })

  it('offers one actionable save after three identical shapes, without values', async () => {
    const ctx = await mountPluginWithTongue()
    await enableTongue(ctx)
    for (const text of ['SECRET-A', 'SECRET-B', 'SECRET-C']) {
      await callAs(ctx, 'lang_detect', { text }, 'session-a')
    }
    const listed = await callAs(ctx, 'tool_mode_list', {}, 'session-a')
    assert.equal(listed.isError, false)
    const suggestions = (listed as {
      value?: { authoring?: { suggestions?: { toolName: string; calls: number; command: { tool: string; arguments: Record<string, unknown> }; inputSchema: unknown }[] } }
    }).value?.authoring?.suggestions ?? []
    assert.equal(suggestions.length, 1)
    assert.equal(suggestions[0]?.toolName, 'lang_detect')
    assert.equal(suggestions[0]?.calls, 3)
    assert.equal(suggestions[0]?.command.tool, 'tool_mode_workflows')
    assert.equal(suggestions[0]?.command.arguments['action'], 'save')
    assert.equal(JSON.stringify(suggestions).includes('SECRET-'), false)
  })

  it('does not offer for a management or discovery tool', async () => {
    const ctx = await mountPluginWithTongue()
    for (let index = 0; index < 3; index += 1) await callAs(ctx, 'tool_mode_list', {}, 'session-a')
    const listed = await callAs(ctx, 'tool_mode_list', {}, 'session-a')
    const suggestions = (listed as { value?: { authoring?: { suggestions?: unknown[] } } }).value?.authoring?.suggestions ?? []
    assert.equal(suggestions.length, 0)
  })
})
