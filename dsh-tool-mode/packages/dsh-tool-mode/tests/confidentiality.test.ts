/**
 * MCP-11 — confidentiality blocks the canonical value BEFORE MCP or PTC returns it.
 *
 * A content-only redaction is not enough: the original canonical value must never be
 * reachable through the external surface. The operator policy names tools that are
 * confidential; the MCP publication/execution path and Code Mode bindings must both
 * refuse them.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { authorizeProgramTools } from '../src/ptc-authority.ts'
import { callTool, cleanup, mountPluginWithTongue } from './helpers.ts'

after(async () => { await cleanup() })

const signal = new AbortController().signal

describe('MCP-11 — confidential canonical values are blocked', () => {
  it('refuses a confidential tool at the PTC binding boundary', () => {
    const decision = authorizeProgramTools(
      { requested: ['lang_detect'] },
      {
        granted: ['lang_detect'],
        visible: ['lang_detect'],
        confidential: ['lang_detect'],
      } as never,
      () => async () => ({ language: 'de' }),
    )
    assert.equal(decision.ok, false)
    if (decision.ok) throw new Error('expected a refusal')
    assert.equal(decision.rejections[0]?.reason, 'confidential')
  })

  it('withholds and refuses a confidential tool over the MCP host surface', async () => {
    const ctx = await mountPluginWithTongue({ confidentialTools: ['lang_detect'] })
    const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
    assert.equal(enabled.isError, false, JSON.stringify(enabled))

    const host = ctx.get('model-tools.mcp-host') as {
      listTools(): readonly { name: string }[]
      callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ isError?: boolean; text?: string }>
    }
    assert.equal(host.listTools().some(tool => tool.name === 'lang_detect'), false)
    const result = await host.callTool('lang_detect', { text: 'kann ich das haben' }, signal)
    assert.equal(result.isError, true)
    assert.match(result.text ?? '', /confidential/i)
  })
})
