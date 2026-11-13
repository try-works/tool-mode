/**
 * EXT-32 — external discovery is filtered to the caller's authorized information.
 *
 * `tool_mode_list`/`tool_mode_describe` are read-only discovery, but an external
 * caller must not see another client's inventory. The native caller keeps the full
 * catalog. The migration mapping is documented in docs/tool-mode/MODEL-TOOLS-MIGRATION.md.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { callTool, cleanup, mountPluginWithTongue } from './helpers.ts'

after(async () => { await cleanup() })

const signal = new AbortController().signal

function caller(allowedTools: readonly string[]) {
  return {
    grantId: 'external:client-a',
    allowedTools,
    recordingPolicy: 'none' as const,
    limits: { maxInputBytes: 1024, maxOutputBytes: 1024, maxToolCalls: 10, maxDurationMs: 10_000 },
  }
}

describe('EXT-32 — external discovery sees only authorized tools', () => {
  it('filters tool_mode_list and refuses an unauthorized describe', async () => {
    const ctx = await mountPluginWithTongue({ models: ['title'] })
    const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
    assert.equal(enabled.isError, false, JSON.stringify(enabled))
    const host = ctx.get('model-tools.mcp-host') as {
      callTool(name: string, args: Record<string, unknown>, signal: AbortSignal, caller?: unknown): Promise<{
        isError?: boolean
        text?: string
      }>
    }

    const native = await host.callTool('tool_mode_list', {}, signal)
    assert.equal(native.isError, undefined, JSON.stringify(native))
    assert.match(native.text ?? '', /lang_detect/)
    assert.match(native.text ?? '', /extension-desert-ant-tongue/)
    assert.match(native.text ?? '', /"route":"extension"/)

    const external = await host.callTool('tool_mode_list', {}, signal, caller(['tool_mode_list']))
    assert.equal(external.isError, undefined, JSON.stringify(external))
    assert.doesNotMatch(external.text ?? '', /lang_detect/, 'an external caller must not see another client’s tool')

    const refused = await host.callTool('tool_mode_describe', { tools: ['lang_detect'] }, signal, caller(['tool_mode_list', 'tool_mode_describe']))
    assert.equal(refused.isError, true)
    assert.match(refused.text ?? '', /forbidden|not authorized|unknown/i)
  })
})
