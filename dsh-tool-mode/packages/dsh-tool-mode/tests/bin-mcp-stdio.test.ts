/** AT-06 — the shipped `mcp-stdio` launcher actually forwards stdin and replies. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

const BIN = join(process.cwd(), 'packages', 'dsh-tool-mode', 'bin', 'dsh-tool-mode.mjs')
const children: ChildProcessWithoutNullStreams[] = []
const servers: ReturnType<typeof createServer>[] = []

after(async () => {
  for (const child of children) child.kill()
  for (const server of servers) await new Promise<void>(resolve => server.close(() => resolve()))
})

describe('AT-06 — stdio launcher', () => {
  it('forwards a modern request, writes the reply, and keeps diagnostics off stdout', async () => {
    const seen: { headers: Record<string, string | string[] | undefined>; body: string }[] = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(chunk as Buffer))
      request.on('end', () => {
        seen.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          jsonrpc: '2.0', id: 1,
          result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } },
        }))
      })
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address !== null && typeof address === 'object')
    const child = spawn(process.execPath, [BIN, 'mcp-stdio'], {
      env: {
        ...process.env,
        DSH_TOOL_MODE_MCP_URL: `http://127.0.0.1:${address.port}/mcp`,
        DSH_TOOL_MODE_MCP_TOKEN: 'test-token',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    children.push(child)
    const lines = createInterface({ input: child.stdout })
    const reply = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the launcher wrote no protocol reply')), 30_000)
      lines.once('line', line => { clearTimeout(timer); resolve(line) })
    })
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'server/discover',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
    })}\n`)
    const parsed = JSON.parse(await reply) as { result?: { supportedVersions?: string[] } }
    assert.equal(parsed.result?.supportedVersions?.[0], '2026-07-28')
    assert.equal(seen.length, 1)
    assert.equal(seen[0]!.headers['mcp-method'], 'server/discover')
    assert.equal(seen[0]!.headers.authorization, 'Bearer test-token')
  })
})
