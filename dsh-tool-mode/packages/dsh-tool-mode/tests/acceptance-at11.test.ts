/** AT-11 — invalid output must not leak through Native, MCP or a PTC binding. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { callTool, cleanup, mountPlugin } from './helpers.ts'
import { STANDARD_CONTRACTS } from '@try-works/tool-mode-contracts'
import { createMcpHost } from '../src/mcp/host-binding.ts'
import type { HostSurface } from '../src/mcp/host-binding.ts'
import type { Context } from '@deepseek-ai/cordis'

after(async () => { await cleanup() })

const CONTRACT = STANDARD_CONTRACTS.find(contract => contract.toolName === 'lang_detect')!

async function registerBadOutput(ctx: Context): Promise<void> {
  ctx.tools.register({
    name: 'at11_bad_output',
    description: 'Returns a value that violates its declared output schema.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        required: ['language'],
        properties: { language: { type: 'string' } },
        additionalProperties: false,
      },
      render: () => [{ type: 'text', text: 'bad' }],
    },
    async execute() {
      return { wrong: true }
    },
  } as never)
}

describe('AT-11 — invalid output validation', () => {
  it('Native rejects the invalid output', async () => {
    const ctx = await mountPlugin()
    await registerBadOutput(ctx)
    const result = await callTool(ctx, 'at11_bad_output', {})
    assert.equal(result.isError, true)
    assert.match(JSON.stringify(result), /language|output/i)
  })

  it('MCP exposes no structuredContent for an invalid output', async () => {
    const surface: HostSurface = {
      published: [{ toolName: 't', contract: CONTRACT }],
      async execute() {
        return {
          isError: false,
          value: { reliability: 'not-a-contract-value', tooCloseToCall: false, candidates: [] },
        }
      },
    }
    const host = createMcpHost({ surface, serverInfo: { name: 'x', version: '1' } })
    const outcome = await host.callTool('t', {}, new AbortController().signal)
    assert.equal(outcome.isError, true)
    assert.equal(outcome.structured, null)
    assert.match(outcome.text, /advertised MCP output schema/)
  })

  it('a PTC binding over the Native path cannot return the invalid value', async () => {
    const ctx = await mountPlugin()
    await registerBadOutput(ctx)
    // The binding is exactly the host dispatch a program receives: if the host
    // refuses the output, the binding throws and the program cannot observe it.
    const binding = async (): Promise<unknown> => {
      const result = await ctx.tools.execute({
        name: 'at11_bad_output',
        arguments: {},
        signal: new AbortController().signal,
      } as never)
      if ((result as { isError?: boolean }).isError === true) {
        throw new Error(`tool_mode_run binding saw a refused result: ${JSON.stringify(result)}`)
      }
      return (result as { value?: unknown }).value
    }
    await assert.rejects(binding(), /refused result|language|output/i)
  })
})
