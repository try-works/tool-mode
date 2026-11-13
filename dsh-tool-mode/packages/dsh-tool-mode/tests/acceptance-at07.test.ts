/**
 * AT-07 — one contract result keeps the same semantics across Native and MCP.
 *
 * The MCP projection may add envelope/meta fields, but the semantic inference
 * values must be identical: language, candidates and reliability.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { McpHost } from '../src/mcp/host-binding.ts'
import { DEFAULT_LIMITS } from '../src/authority.ts'
import { callTool, cleanup, mountPlugin } from './helpers.ts'

after(async () => { await cleanup() })

describe('AT-07 — Native and MCP semantic parity', () => {
  it('lang_detect returns the same language/candidates through both surfaces', async () => {
    const ctx = await mountPlugin({})
    const native = await callTool(ctx, 'lang_detect', { text: 'kann ich das haben' })
    assert.equal(native.isError, false, JSON.stringify(native))
    const host = ctx.get('model-tools.mcp-host') as McpHost

    const external = await host.callTool('lang_detect', { text: 'kann ich das haben' }, new AbortController().signal, {
      clientId: 'at07',
      grantId: 'external:at07',
      allowedTools: ['lang_detect'],
      allowedHarnessProfiles: [],
      modelCapabilities: [],
      recordingPolicy: 'receipts',
      limits: DEFAULT_LIMITS,
    })
    assert.equal((external as { isError?: boolean }).isError, undefined, JSON.stringify(external))
    assert.ok((external as { structured?: unknown }).structured !== null)

    const nativeValue = (native as { value?: Record<string, unknown> }).value ?? {}
    const externalValue = (external as { structured?: Record<string, unknown> | null }).structured ?? {}
    // Envelope/meta may differ; the semantic answer may not.
    assert.equal(externalValue['language'], nativeValue['language'])
    assert.equal(externalValue['reliability'], nativeValue['reliability'])
    assert.deepEqual(externalValue['candidates'], nativeValue['candidates'])
  })
})
