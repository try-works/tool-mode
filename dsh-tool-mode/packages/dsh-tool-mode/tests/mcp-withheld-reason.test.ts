/**
 * Slice 3 — withheld reasons in call results (task-37).
 *
 * A tool the host deliberately withheld must explain itself when called by name.
 * The current binding answers `unknown tool` for both a withheld tool and a name
 * that never existed, which hides the publication decision from the caller.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createMcpHost, type PublishedTool } from '../src/mcp/host-binding.ts'
import { dispatch } from '../src/mcp/server.ts'
import { META_KEYS, PROTOCOL_VERSION, type WireRequest } from '../src/mcp/protocol.ts'
import type { ToolContract } from '@try-works/tool-mode-contracts'

const WITHHELD_REASON = 'the extension declares no output schema, so MCP cannot advertise a result shape'
const CONFIDENTIAL_REASON = 'the operator confidentiality policy blocks this tool'

function contract(toolName: string, description: string): ToolContract {
  return {
    contract: `test.${toolName}`,
    version: '1.0.0',
    toolName,
    description,
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    outputSchema: { type: 'object', additionalProperties: false, properties: {} },
    semantics: {},
    limits: {},
    unsupported: [],
  }
}

function surface(published: readonly PublishedTool[], withheld: ReadonlyMap<string, string>) {
  const calls: string[] = []
  return {
    calls,
    surface: {
      published,
      withheld,
      async execute({ name }) {
        calls.push(name)
        return { isError: false, value: {} }
      },
    },
  }
}

describe('MCP withheld tools explain themselves', () => {
  it('a withheld tool returns its recorded reason instead of "unknown tool"', async () => {
    const fake = surface(
      [{ toolName: 'withheld_tool', contract: contract('withheld_tool', 'withheld description'), notExportableReason: WITHHELD_REASON }],
      new Map([['withheld_tool', WITHHELD_REASON]]),
    )
    const host = createMcpHost({ serverInfo: { name: 'test', version: '1.0.0' }, surface: fake.surface })

    const result = await host.callTool('withheld_tool', {}, new AbortController().signal)
    assert.equal(result.isError, true)
    assert.match(result.text, /withheld/)
    assert.equal(result.text.includes(WITHHELD_REASON), true, `expected the recorded reason, got: ${result.text}`)
    assert.equal(result.text.includes('unknown tool'), false)
    assert.deepEqual(fake.calls, [], 'a withheld tool must never execute')
  })

  it('a genuinely unknown tool still answers "unknown tool"', async () => {
    const fake = surface([], new Map())
    const host = createMcpHost({ serverInfo: { name: 'test', version: '1.0.0' }, surface: fake.surface })

    const result = await host.callTool('never_existed', {}, new AbortController().signal)
    assert.equal(result.isError, true)
    assert.match(result.text, /unknown tool/)
  })

  it('a confidential tool stays blocked and leaks neither its definition nor the withheld reason', async () => {
    const hidden = contract('hidden_tool', 'a definition that must not leak')
    const fake = surface(
      [{ toolName: 'hidden_tool', contract: hidden, notExportableReason: CONFIDENTIAL_REASON }],
      new Map([['hidden_tool', CONFIDENTIAL_REASON]]),
    )
    const host = createMcpHost({
      serverInfo: { name: 'test', version: '1.0.0' },
      confidentialTools: ['hidden_tool'],
      surface: fake.surface,
    })

    assert.equal(host.listTools().some(tool => tool.name === 'hidden_tool'), false)
    const result = await host.callTool('hidden_tool', {}, new AbortController().signal)
    assert.equal(result.isError, true)
    assert.match(result.text, /confidentiality policy/)
    assert.equal(result.text.includes('a definition that must not leak'), false)
    assert.equal(result.text.includes(WITHHELD_REASON), false)
    assert.deepEqual(fake.calls, [], 'a confidential tool must never execute')
  })

  it('the MCP dispatcher returns the recorded reason instead of invalid params', async () => {
    const fake = surface([], new Map([['withheld_tool', WITHHELD_REASON]]))
    const host = createMcpHost({ serverInfo: { name: 'test', version: '1.0.0' }, surface: fake.surface })
    const request: WireRequest = {
      jsonrpc: '2.0',
      id: 'withheld-dispatch',
      method: 'tools/call',
      params: {
        name: 'withheld_tool',
        arguments: {},
        _meta: {
          [META_KEYS.protocolVersion]: PROTOCOL_VERSION,
          [META_KEYS.clientInfo]: { name: 'test', version: '1.0.0' },
          [META_KEYS.clientCapabilities]: {},
        },
      },
    }
    const { response, httpStatus } = await dispatch(request, host)
    assert.equal(httpStatus, 200)
    const result = response?.result as { content?: { text?: string }[] } | undefined
    assert.match(result?.content?.[0]?.text ?? '', /withheld/)
    assert.match(result?.content?.[0]?.text ?? '', new RegExp(WITHHELD_REASON.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })
})
