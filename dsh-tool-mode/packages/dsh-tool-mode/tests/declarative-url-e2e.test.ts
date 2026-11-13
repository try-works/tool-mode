/**
 * RCP-07 — a DECLARATIVE package through the npm/HTTPS archive route, ACTIVATED.
 *
 * Reads the real declarative package, packs it as an npm-style `.tgz`, serves it over
 * HTTP, installs it through the host extension service (the same route an operator
 * uses), enables it, and invokes its recipe tool with a scripted harness provider.
 * This is the end-to-end link the earlier suite left at "install + resolve".
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'

import type { LlmProvider } from '@try-works/tool-mode-recipes'

import { DEFAULT_LIMITS } from '../src/authority.ts'
import { callTool, cleanup, mountPlugin, resultText, tempDir } from './helpers.ts'

const PACKAGE_DIR = join(process.cwd(), 'packages', 'extension-declarative-recipes')
const EXTENSION_ID = '@try-works/extension-declarative-recipes'

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512)
  header.write(name.slice(0, 100), 0, 'utf8')
  header.write('0000644\0', 100)
  header.write('0000000\0', 108)
  header.write('0000000\0', 116)
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  header.write('00000000000\0', 136)
  header.write('        ', 148)
  header.write('0', 156)
  header.write('ustar\0', 257)
  header.write('00', 263)
  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148)
  return header
}

function pack(): Uint8Array {
  const blocks: Buffer[] = []
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      if (name === 'src' || name === 'tests' || name === 'node_modules') continue
      const full = join(current, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      const data = readFileSync(full)
      blocks.push(tarHeader(`package/${relative(PACKAGE_DIR, full).replace(/\\/g, '/')}`, data.byteLength), data)
      const padding = (512 - (data.byteLength % 512)) % 512
      if (padding > 0) blocks.push(Buffer.alloc(padding))
    }
  }
  walk(PACKAGE_DIR)
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

async function serve(bytes: Uint8Array): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(bytes.byteLength) })
    response.end(Buffer.from(bytes))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  return {
    get url() { return `http://127.0.0.1:${address.port}/pkg.tgz` },
    async close() {
      await new Promise<void>((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error))))
    },
  }
}

function scriptedProvider(): LlmProvider {
  return {
    id: 'rcp07-scripted',
    generation: 1,
    destination: 'local',
    capabilities: () => ({ images: true, maxOutputTokens: 1024 }),
    async complete() {
      return {
        kind: 'text',
        text: JSON.stringify({
          title: 'End to end declarative package',
          description: 'Installed from a pinned npm tarball over HTTPS and activated.',
        }),
      }
    },
  } as LlmProvider
}

test('a declarative package installs from a pinned HTTPS tarball, activates and runs', async () => {
  const bytes = pack()
  const server = await serve(bytes)
  try {
    const ctx = await mountPlugin({
      extensionStore: tempDir(),
      harnessProvider: scriptedProvider(),
      harnessExecutorV3: { externalDefaultProfile: 'vision' },
    })
    const service = ctx.get('modelTools') as {
      install(id: string, source: string): Promise<{ id: string; version: string; source: string }>
      enable(id: string): Promise<{ active: boolean }>
    }
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    const installed = await service.install(EXTENSION_ID, `${server.url}#${encodeURIComponent(integrity)}`)
    assert.equal(installed.source, 'url')
    const enabled = await service.enable(EXTENSION_ID)
    assert.equal(enabled.active, true)
    assert.ok(ctx.tools.schemas().some(schema => schema.name === 'text_title'), 'the recipe tool must be registered after activation')

    const result = await callTool(ctx, 'text_title', { text: 'How to deploy the service safely.', kind: 'section' })
    assert.match(resultText(result), /End to end declarative package/)

    // HLM-03: the same declarative tool over the EXTERNAL MCP surface has no DSH
    // conversational model unless the operator authorized a profile.
    const host = ctx.get('model-tools.mcp-host') as {
      callTool(
        name: string,
        args: Record<string, unknown>,
        signal: AbortSignal,
        caller: {
          clientId: string
          grantId: string
          allowedTools: readonly string[]
          allowedHarnessProfiles: readonly string[]
          modelCapabilities: readonly string[]
          recordingPolicy: 'none' | 'receipts'
          limits: typeof DEFAULT_LIMITS
        },
      ): Promise<{ isError?: boolean; text?: string }>
    }
    const external = await host.callTool('text_title', { text: 'External call' }, new AbortController().signal, {
      clientId: 'client-a',
      grantId: 'external:client-a',
      allowedTools: ['text_title'],
      allowedHarnessProfiles: [],
      modelCapabilities: [],
      recordingPolicy: 'receipts',
      limits: DEFAULT_LIMITS,
    })
    assert.equal(external.isError, true)
    assert.match(external.text ?? '', /EXECUTOR_NOT_CONFIGURED/)

    // AT-67: the operator's server-owned externalDefaultProfile makes the
    // caller-model recipe usable, but ONLY for a client whose grant names it.
    const profiled = await host.callTool('text_title', { text: 'Profiled external call' }, new AbortController().signal, {
      clientId: 'client-b',
      grantId: 'external:client-b',
      allowedTools: ['text_title'],
      allowedHarnessProfiles: ['vision'],
      modelCapabilities: [],
      recordingPolicy: 'receipts',
      limits: DEFAULT_LIMITS,
    })
    assert.equal(profiled.isError, undefined, JSON.stringify(profiled))
  } finally {
    await server.close()
    await cleanup()
  }
})
