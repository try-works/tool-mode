/**
 * `mcpV3.enabled` serves the host's own MCP surface (MCP-02, MCP-08, SEC-01).
 *
 * Before this test the plugin exposed `model-tools.mcp-host` but bound no port: an MCP
 * client could not reach the DSH host at all, only the separate headless composition.
 * These cases pin the endpoint the host actually opens and the wire it answers.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { cleanup, mountPlugin, tempDir } from './helpers.ts'

const TOKEN = 'test-host-token-7f3a9c'
const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'dsh-test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

after(async () => { await cleanup() })

/** One JSON-RPC exchange with protocol headers. */
async function rpc(
  port: number,
  method: string,
  params: Record<string, unknown> = {},
  options: { token?: string; name?: string; auth?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...options.name === undefined ? {} : { 'mcp-name': options.name },
      ...options.auth === false ? {} : { authorization: `Bearer ${options.token ?? TOKEN}` },
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: String(method), method, params: { ...params, _meta: META } }),
  })
  return { status: response.status, body: JSON.parse(await response.text()) as Record<string, unknown> }
}

describe('mcpV3.enabled serves the host surface', () => {
  it('binds an endpoint, answers server/discover, and closes with the host', async () => {
    const previous = process.env.DSH_TOOL_MODE_MCP_TOKEN
    process.env.DSH_TOOL_MODE_MCP_TOKEN = TOKEN
    try {
      const stateFile = join(tempDir(), 'state.json')
      const ctx = await mountPlugin({
        stateFile,
        credentialsFile: join(tempDir(), 'credentials.json'),
        mcpV3: { enabled: true, host: '127.0.0.1', port: 0, path: '/mcp' },
      })
      const endpoint = ctx.get('model-tools.mcp-endpoint') as { url: string; port: number } | undefined
      assert.ok(endpoint !== undefined, 'the host must expose the endpoint it bound')
      assert.ok(endpoint.port > 0)

      const discover = await rpc(endpoint.port, 'server/discover')
      assert.equal(discover.status, 200, JSON.stringify(discover.body))
      const result = discover.body['result'] as { supportedVersions: string[]; capabilities: unknown }
      assert.deepEqual(result.supportedVersions, ['2026-07-28'])

      const list = await rpc(endpoint.port, 'tools/list')
      assert.equal(list.status, 200, JSON.stringify(list.body))
      assert.ok(Array.isArray((list.body['result'] as { tools: unknown[] }).tools))

      const wrongToken = await rpc(endpoint.port, 'server/discover', {}, { token: 'wrong' })
      assert.equal(wrongToken.status, 401, JSON.stringify(wrongToken.body))

      // The wire must refuse a MISSING credential too, not only a wrong one: a client
      // that sends no Authorization header is unauthenticated, never anonymous.
      const noToken = await rpc(endpoint.port, 'server/discover', {}, { auth: false })
      assert.equal(noToken.status, 401, JSON.stringify(noToken.body))

      await ctx.fiber.dispose()
      await assert.rejects(
        fetch(`http://127.0.0.1:${endpoint.port}/mcp`, { method: 'POST' }),
        'disposing the host must close the listener',
      )
    } finally {
      if (previous === undefined) delete process.env.DSH_TOOL_MODE_MCP_TOKEN
      else process.env.DSH_TOOL_MODE_MCP_TOKEN = previous
    }
  })

  it('serves with a token FILE when the launch environment has none', async () => {
    // A desktop-launched host inherits an environment the operator cannot change, so
    // enabling mcpV3 in a profile had no effect without a special launch variable.
    // The token file is the durable route; the env still wins when present.
    const previous = process.env.DSH_TOOL_MODE_MCP_TOKEN
    delete process.env.DSH_TOOL_MODE_MCP_TOKEN
    try {
      const tokenFile = join(tempDir(), 'mcp-token.txt')
      writeFileSync(tokenFile, `${TOKEN}\n`)
      const ctx = await mountPlugin({
        stateFile: join(tempDir(), 'state.json'),
        credentialsFile: join(tempDir(), 'credentials.json'),
        mcpV3: { enabled: true, host: '127.0.0.1', port: 0, path: '/mcp', tokenFile },
      })
      const endpoint = ctx.get('model-tools.mcp-endpoint') as { port: number } | undefined
      assert.ok(endpoint !== undefined, 'the token file must start the listener')
      const discover = await rpc(endpoint.port, 'server/discover')
      assert.equal(discover.status, 200, JSON.stringify(discover.body))
      await ctx.fiber.dispose()
    } finally {
      if (previous === undefined) delete process.env.DSH_TOOL_MODE_MCP_TOKEN
      else process.env.DSH_TOOL_MODE_MCP_TOKEN = previous
    }
  })

  it('registers tool_mode_run under its own consent, not the management flag', async () => {
    // The live defect: registerControlTool false (to hide model_tools) ALSO removed
    // tool_mode_run from the registry while MCP advertised it → "unknown tool".
    const ctx = await mountPlugin({
      stateFile: join(tempDir(), 'state.json'),
      registerControlTool: false,
      hostedCode: true,
    })
    const names = ctx.tools.schemas().map(schema => schema.name)
    assert.ok(names.includes('tool_mode_run'), `tool_mode_run must register; got ${names.join(',')}`)
    assert.equal(names.includes('model_tools'), false, 'model_tools stays hidden')
    await ctx.fiber.dispose()
  })

  it('does not bind when the flag is off', async () => {
    const ctx = await mountPlugin({ stateFile: join(tempDir(), 'state.json') })
    assert.equal(ctx.get('model-tools.mcp-endpoint'), undefined)
  })

  it('refuses a non-loopback bind without taking the host down', async () => {
    // MCP-02: LAN/public binding is out of scope. Refusing is the STARTUP behavior;
    // the refusal must not remove the rest of the plugin's surface from the session.
    const previous = process.env.DSH_TOOL_MODE_MCP_TOKEN
    process.env.DSH_TOOL_MODE_MCP_TOKEN = TOKEN
    try {
      const ctx = await mountPlugin({
        stateFile: join(tempDir(), 'state.json'),
        credentialsFile: join(tempDir(), 'credentials.json'),
        mcpV3: { enabled: true, host: '0.0.0.0', port: 0, path: '/mcp' },
      })
      assert.equal(ctx.get('model-tools.mcp-endpoint'), undefined, 'a routable bind must be refused')
      assert.ok(ctx.get('modelTools') !== undefined, 'the plugin must keep running after the refusal')
      await ctx.fiber.dispose()
    } finally {
      if (previous === undefined) delete process.env.DSH_TOOL_MODE_MCP_TOKEN
      else process.env.DSH_TOOL_MODE_MCP_TOKEN = previous
    }
  })
})
