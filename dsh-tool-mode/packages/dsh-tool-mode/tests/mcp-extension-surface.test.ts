/**
 * EXTENSION TOOLS ARE ON THE MCP SURFACE (MCP-08, regression).
 *
 * The live defect: an extension owns its tool name, so catalogue registration is
 * DEFERRED — and the MCP surface, built only from the catalogue map, advertised
 * `tool_mode_run` while hiding every installed model tool. A client listed an empty
 * catalogue; a Code Mode program could not bind `lang_detect`.
 *
 * This mounts the real plugin over a real installed extension, prepares and enables it,
 * then reads the wire: `tools/list` must contain the extension's own tool, with the
 * declared input schema (not a host guess).
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { stagedInstallFromDirectory } from '@try-works/tool-mode-extension-sdk'

import type { AcquisitionSource } from '../src/asset-acquisition.ts'
import { cleanup, mountPlugin, tempDir } from './helpers.ts'

const FIXTURE_DIR = join(process.cwd(), 'packages', 'dsh-tool-mode', 'tests', 'fixtures', 'preparable-extension')
const EXTENSION_ID = '@try-works/fixture-preparable'
const TOKEN = 'extension-surface-token-3c1d'
const ASSET_BYTES = Buffer.from('fixture-preparable-asset-v1\n')

after(async () => { await cleanup() })

function localSource(bytes: Uint8Array): AcquisitionSource {
  return {
    supportsRanges: false,
    async fetchRange(_asset, from, to) {
      return bytes.slice(from, to + 1)
    },
  }
}

async function rpc(port: number, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: method,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'surface-test', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  })
  return JSON.parse(await response.text()) as Record<string, unknown>
}

describe('extension-published tools are visible over MCP', () => {
  it('lists the extension tool with its declared input schema', async () => {
    const previous = process.env.DSH_TOOL_MODE_MCP_TOKEN
    process.env.DSH_TOOL_MODE_MCP_TOKEN = TOKEN
    try {
      const storeDir = tempDir()
      await stagedInstallFromDirectory({ sourceDir: FIXTURE_DIR, storeDir, allowSourceDirectories: true })
      const ctx = await mountPlugin({
        extensionStore: storeDir,
        stateFile: join(tempDir(), 'state.json'),
        credentialsFile: join(tempDir(), 'credentials.json'),
        assetSourceFactory: () => localSource(ASSET_BYTES),
        mcpV3: { enabled: true, host: '127.0.0.1', port: 0, path: '/mcp' },
      })
      const service = ctx.get('modelTools') as {
        prepare(id: string): Promise<{ prepared: boolean }>
        enable(id: string): Promise<{ active: boolean }>
      }
      const prepared = await service.prepare(EXTENSION_ID)
      assert.equal(prepared.prepared, true)
      const enabled = await service.enable(EXTENSION_ID)
      assert.equal(enabled.active, true)
      // The tool must actually be REGISTERED, not merely described.
      assert.equal(
        ctx.tools.schemas().some(schema => schema.name === 'fixture_preparable_tool'),
        true,
        'the extension tool must register before MCP can list it',
      )

      const endpoint = ctx.get('model-tools.mcp-endpoint') as { port: number } | undefined
      assert.ok(endpoint !== undefined)
      const listed = await rpc(endpoint.port, 'tools/list') as {
        result: { tools: { name: string; inputSchema: unknown }[] }
      }
      const tool = listed.result.tools.find(candidate => candidate.name === 'fixture_preparable_tool')
      assert.ok(tool !== undefined, `tools/list must include the extension tool; got ${listed.result.tools.map(t => t.name).join(',')}`)
      // The DECLARED schema, projected for the wire, not an empty object.
      const schema = tool.inputSchema as { properties?: Record<string, unknown> }
      assert.ok(schema.properties?.['token'] !== undefined, JSON.stringify(schema))

      await ctx.fiber.dispose()
    } finally {
      if (previous === undefined) delete process.env.DSH_TOOL_MODE_MCP_TOKEN
      else process.env.DSH_TOOL_MODE_MCP_TOKEN = previous
    }
  })
})
