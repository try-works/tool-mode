/**
 * TDD tests for scripts/verify-tool-insights-instance.mjs.
 *
 * The script is the live evidence collector for Tool Insights (plan §6.3): it fetches the
 * app shell and the SERVED client bundle, asserts the three tab labels and the pagination
 * labels, drives the disposable host's MCP surface (initialize attempt, discovery,
 * tools/list, one safe call), redacts secrets from everything it prints/writes, and saves
 * JSON evidence.
 *
 * These tests run the real script against a local mock host, so the request shapes
 * (MCP 2026-07-28 headers + `_meta`, cookie-minted web shell) and the redaction path are
 * exercised end to end without needing the disposable instance.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULTS,
  EXPECTED_PAGINATION_LABELS,
  EXPECTED_TAB_LABELS,
  VerificationError,
  assertClientLabels,
  findClientBundleUrl,
  parseArgs,
  redact,
  redactDeep,
  runVerification,
  selectSafeCall,
  selectSemanticSimilarityCall,
} from '../../../scripts/verify-tool-insights-instance.mjs'

const TOKEN = 'test-mcp-bearer-token-0123456789abcdef'
const LAUNCH = 'test-web-launch-token-fedcba9876543210'

/** One recorded HTTP request, for header assertions. */
interface RecordedRequest {
  readonly method: string
  readonly url: string
  readonly headers: IncomingHttpHeaders
  readonly body: string
}

/** The JSON-RPC envelope the mock host parses from the test client's own request body. */
interface JsonRpcEnvelope {
  readonly id: unknown
  readonly method: string
  readonly params?: { readonly name?: string }
}

/** A mock disposable host: launch-token shell, served client bundle, and MCP endpoint. */
function createMockHost(options: {
  readonly bundleText?: string
  readonly toolNames?: readonly string[]
  readonly callIsError?: boolean
  readonly callReceiptId?: string | null
} = {}) {
  const requests: RecordedRequest[] = []
  const toolNames = options.toolNames ?? ['lang_detect']
  const bundleText = options.bundleText ?? [
    'const EXTENSIONS = [{ id: "@try-works/extension-desert-ant-tongue" }];',
    'function ToolInsightsPage() {',
    '  return h("div", {},',
    '    h("button", {}, "Tool Insights"),',
    '    h("button", {}, "Tool Inventory"),',
    '    h("button", {}, "MCP"),',
    '    h("nav", {}, h("button", {}, "Previous"), h("span", {}, "Page 1 of 4"), h("button", {}, "Next")),',
    '  )',
    '}',
  ].join('\n')

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      requests.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body })

      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/') {
        if (url.searchParams.get('token') === LAUNCH) {
          response.writeHead(303, {
            'set-cookie': 'dsh-auth-mock=v1.mock.signature; Path=/; HttpOnly; SameSite=Strict',
            location: '/',
          })
          response.end()
          return
        }
        const cookie = String(request.headers.cookie ?? '')
        if (!cookie.includes('dsh-auth-mock=')) {
          response.writeHead(401, { 'content-type': 'text/plain' })
          response.end('dsh web authentication required')
          return
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end([
          '<!doctype html><html><body>',
          '<script src="/plugins/??@deepseek-ai/dsh-client-ui-chat/client.js,',
          '@try-works/dsh-tool-mode/client.js&amp;rev=mock-rev"></script>',
          '</body></html>',
        ].join(''))
        return
      }
      if (request.method === 'GET' && url.pathname.startsWith('/plugins/')) {
        response.writeHead(200, { 'content-type': 'text/javascript' })
        response.end(bundleText)
        return
      }
      if (request.method === 'POST' && url.pathname === '/mcp') {
        // SAFETY: the test client wrote this body itself; the switch below reads only the
        // two fields the envelope interface declares, then the mock replies to them.
        const envelope = JSON.parse(body) as JsonRpcEnvelope
        const requiredHeaders = ['mcp-protocol-version', 'mcp-method', 'authorization']
        const missing = requiredHeaders.filter(name => request.headers[name] === undefined)
        if (envelope.method === 'tools/call' && request.headers['mcp-name'] === undefined) missing.push('mcp-name')
        if (missing.length > 0) {
          response.writeHead(400, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ jsonrpc: '2.0', id: envelope.id, error: { code: -32020, message: `missing headers: ${missing.join(',')}` } }))
          return
        }
        function reply<T>(result: T) {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ jsonrpc: '2.0', id: envelope.id, result }))
        }
        const fail = (code: number, message: string) => {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ jsonrpc: '2.0', id: envelope.id, error: { code, message } }))
        }
        switch (envelope.method) {
          case 'initialize':
            fail(-32601, 'unknown method "initialize"')
            return
          case 'server/discover':
            reply({
              supportedVersions: ['2026-07-28'],
              capabilities: { tools: { listChanged: false } },
              resultType: 'complete',
              ttlMs: 0,
              cacheScope: 'private',
              _meta: { 'io.modelcontextprotocol/serverInfo': { name: '@try-works/dsh-tool-mode', version: '0.0.0-mock' } },
            })
            return
          case 'tools/list':
            reply({
              tools: toolNames.map(name => ({
                name,
                description: `mock ${name}`,
                inputSchema: { type: 'object', additionalProperties: true },
                outputSchema: { type: 'object', properties: { meta: { type: 'object' } } },
              })),
            })
            return
          case 'tools/call': {
            const name = envelope.params?.name ?? ''
            const semantic = name === 'semantic_similarity'
            const meta = options.callReceiptId === null
              ? {}
              : { 'io.modelcontextprotocol/serverInfo': { name: '@try-works/dsh-tool-mode', version: '0.0.0-mock' }, receiptId: options.callReceiptId ?? 'rcpt_mock_1' }
            const baseReply = {
              content: [{ type: 'text', text: JSON.stringify(semantic ? { score: 0.855 } : { language: 'de' }) }],
              structuredContent: semantic
                ? { score: 0.8550876986095926, scoreKind: 'cosine_similarity' }
                : { language: 'de' },
              resultType: 'complete',
              _meta: meta,
              _mockTool: name,
            }
            const callReply = options.callIsError === true ? { ...baseReply, isError: true as const } : baseReply
            reply(callReply)
            return
          }
          default:
            fail(-32601, `unknown method "${envelope.method}"`)
        }
        return
      }
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
    })
  })

  return {
    requests,
    async start() {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      // SAFETY: the server was bound to a TCP port, so Node returns AddressInfo (never a
      // pipe-name string); the null case is handled here.
      const bound = address as { readonly port: number } | null
      if (bound === null) throw new Error('mock host did not bind')
      return { origin: `http://127.0.0.1:${bound.port}` }
    },
    async close() {
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

describe('parseArgs', () => {
  it('uses the plan defaults when no flag is supplied, with the token from the env', () => {
    const parsed = parseArgs([], { DSH_TOOL_MODE_MCP_TOKEN: TOKEN })
    assert.equal(parsed.webUrl, DEFAULTS.webUrl)
    assert.equal(parsed.mcpUrl, DEFAULTS.mcpUrl)
    assert.equal(parsed.token, TOKEN)
    assert.equal(parsed.out, DEFAULTS.out)
  })

  it('accepts every documented flag and the env fallback is overridden by --token', () => {
    const parsed = parseArgs([
      '--web-url', 'http://127.0.0.1:3180/?token=launch',
      '--mcp-url', 'http://127.0.0.1:3865/mcp',
      '--token', TOKEN,
      '--out', 'docs/tool-insights/evidence/verify-x/instance.json',
    ], { DSH_TOOL_MODE_MCP_TOKEN: 'env-token' })
    assert.equal(parsed.webUrl, 'http://127.0.0.1:3180/?token=launch')
    assert.equal(parsed.mcpUrl, 'http://127.0.0.1:3865/mcp')
    assert.equal(parsed.token, TOKEN)
    assert.equal(parsed.out, 'docs/tool-insights/evidence/verify-x/instance.json')
  })

  it('refuses an unknown flag and a missing token with an actionable message', () => {
    assert.throws(() => parseArgs(['--bogus'], {}), /unknown argument "--bogus"/)
    assert.throws(() => parseArgs([], {}), /--token .*DSH_TOOL_MODE_MCP_TOKEN|DSH_TOOL_MODE_MCP_TOKEN/)
  })
})

describe('secret redaction', () => {
  it('redacts a bare token, a bearer header and a launch token in a URL', () => {
    const text = [
      `authorization: Bearer ${TOKEN}`,
      `token=${LAUNCH}`,
      `raw ${TOKEN}`,
    ].join('\n')
    const redacted = redact(text, [TOKEN, LAUNCH])
    assert.ok(!redacted.includes(TOKEN), 'the bearer token must not survive')
    assert.ok(!redacted.includes(LAUNCH), 'the launch token must not survive')
    assert.ok(redacted.includes('[redacted]'), 'a visible redaction marker is expected')
  })

  it('walks nested evidence objects and never mutates the input', () => {
    const input = { url: `http://x/?token=${LAUNCH}`, nested: [{ token: TOKEN }] }
    const output = redactDeep(input, [TOKEN, LAUNCH])
    assert.equal(JSON.stringify(output).includes(TOKEN), false)
    assert.equal(JSON.stringify(output).includes(LAUNCH), false)
    assert.equal(input.nested[0].token, TOKEN, 'the input object is not mutated')
  })
})

describe('served client bundle discovery and labels', () => {
  it('decodes the shell\'s HTML entities and picks the model-as-tool bundle', () => {
    const html = '<script src="/plugins/??@deepseek-ai/dsh-client-ui-chat/client.js,@try-works/dsh-tool-mode/client.js&amp;rev=abc"></script>'
    const url = findClientBundleUrl(html, 'http://127.0.0.1:3180/')
    assert.equal(
      url,
      'http://127.0.0.1:3180/plugins/??@deepseek-ai/dsh-client-ui-chat/client.js,@try-works/dsh-tool-mode/client.js&rev=abc',
    )
  })

  it('returns null when the shell names no client bundle', () => {
    assert.equal(findClientBundleUrl('<html></html>', 'http://127.0.0.1:3180/'), null)
  })

  it('reads the __DSH_BOOT__ manifest and resolves its relative plugin URL', () => {
    const boot = {
      rev: 'abc',
      entries: [
        { id: '@deepseek-ai/dsh-api-gateway', url: 'plugins/??@deepseek-ai/dsh-api-gateway/client.js&rev=1' },
        { id: '@try-works/dsh-tool-mode', url: 'plugins/??@try-works/dsh-tool-mode/client.js&rev=2' },
      ],
    }
    const html = `<script>globalThis["__DSH_BOOT__"] = ${JSON.stringify(boot)}</script>`
    assert.equal(
      findClientBundleUrl(html, 'http://127.0.0.1:3180/'),
      'http://127.0.0.1:3180/plugins/??@try-works/dsh-tool-mode/client.js&rev=2',
    )
  })

  it('also accepts a relative plugins/ attribute in an older shell', () => {
    const html = '<script src="plugins/??@try-works/dsh-tool-mode/client.js&amp;rev=3"></script>'
    assert.equal(
      findClientBundleUrl(html, 'http://127.0.0.1:3180/'),
      'http://127.0.0.1:3180/plugins/??@try-works/dsh-tool-mode/client.js&rev=3',
    )
  })

  it('accepts a bundle with the three tabs and the pagination labels', () => {
    const labels = assertClientLabels(
      'h("b",{},"Tool Insights"); h("b",{},"Tool Inventory"); h("b",{},"MCP"); h("b",{},"Previous"); h("b",{},"Next"); h("span",{},"Page 1 of 4")',
    )
    assert.equal(labels.tabs.every(row => row.present), true)
    assert.equal(labels.pagination.every(row => row.present), true)
    assert.deepEqual(EXPECTED_TAB_LABELS, ['Tool Insights', 'Tool Inventory', 'MCP'])
    assert.deepEqual(EXPECTED_PAGINATION_LABELS, ['Previous', 'Next', 'Page'])
  })

  it('reports every missing label instead of only the first', () => {
    let thrown: unknown
    try {
      assertClientLabels('only "MCP" here')
    } catch (error) {
      thrown = error
    }
    assert.ok(thrown instanceof VerificationError)
    assert.match(thrown.message, /Tool Insights/)
    assert.match(thrown.message, /Tool Inventory/)
    assert.match(thrown.message, /Previous/)
  })
})

describe('selectSafeCall', () => {
  it('honours an explicit tool and argument override', () => {
    const selected = selectSafeCall(['lang_detect'], { callTool: 'lang_detect', callArgsJson: '{"text":"hallo"}' })
    assert.deepEqual(selected, { tool: 'lang_detect', arguments: { text: 'hallo' }, reason: 'explicit --call' })
  })

  it('falls back from read to lang_detect and reports when neither is exposed', () => {
    assert.equal(selectSafeCall(['read', 'lang_detect'], {}).tool, 'read')
    assert.equal(selectSafeCall(['lang_detect'], {}).tool, 'lang_detect')
    assert.equal(selectSafeCall(['text_embed'], {}), null)
  })

  it('builds the object-shaped semantic_similarity call', () => {
    const selected = selectSemanticSimilarityCall(['lang_detect', 'semantic_similarity'])
    assert.ok(selected !== null)
    assert.equal(selected.tool, 'semantic_similarity')
    assert.equal(typeof selected.arguments.left, 'object')
    assert.equal(Array.isArray((selected.arguments.left as { parts: unknown[] }).parts), true)
    assert.equal(selectSemanticSimilarityCall(['lang_detect']), null)
  })

  it('refuses a malformed --args-json', () => {
    assert.throws(() => selectSafeCall(['lang_detect'], { callTool: 'lang_detect', callArgsJson: '{oops' }), /args-json/)
  })
})

describe('runVerification against a mock disposable host', () => {
  let tempDir = ''
  before(() => { tempDir = mkdtempSync(join(tmpdir(), 'verify-ti-')) })
  after(() => { if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true }) })

  it('collects full passing evidence, authenticates the shell, drives MCP and redacts secrets', async () => {
    const host = createMockHost()
    const { origin } = await host.start()
    try {
      const webUrl = `${origin}/?token=${LAUNCH}`
      const out = join(tempDir, 'instance-evidence.json')
      const evidence = await runVerification({
        webUrl,
        mcpUrl: `${origin}/mcp`,
        token: TOKEN,
        out,
        now: () => new Date('2026-10-23T05:00:00.000Z'),
      })

      assert.equal(evidence.summary.ok, true, JSON.stringify(evidence.checks.filter(c => !c.ok)))
      assert.equal(evidence.summary.failed, 0)
      assert.equal(evidence.mcp.toolsCount, 1)
      assert.equal(evidence.mcp.modelToolsPresent, false)
      assert.equal(evidence.call.tool, 'lang_detect')
      assert.equal(evidence.call.isError, false)
      assert.equal(evidence.call.receiptId, 'rcpt_mock_1')
      assert.equal(evidence.tabs.every(row => row.present), true)
      assert.equal(evidence.pagination.every(row => row.present), true)
      assert.equal(evidence.artifacts.bundleBytes > 0, true)

      // the launch token must have been exchanged for a cookie, not sent as a bearer
      const mint = host.requests.find(r => r.method === 'GET' && r.url.includes('token='))
      assert.ok(mint !== undefined, 'the shell must be fetched through the launch URL')
      const mcpCalls = host.requests.filter(r => r.method === 'POST' && r.url === '/mcp')
      // SAFETY: the recorded body is this test's own JSON-RPC request; only `method` is read.
      const call = mcpCalls.find(r => (JSON.parse(r.body) as { method: string }).method === 'tools/call')
      assert.ok(call !== undefined)
      assert.equal(call.headers.authorization, `Bearer ${TOKEN}`)
      assert.equal(call.headers['mcp-protocol-version'], '2026-07-28')
      assert.equal(call.headers['mcp-method'], 'tools/call')
      assert.equal(call.headers['mcp-name'], 'lang_detect')
      // SAFETY: same recorded request body; only `method` is read.
      const discover = mcpCalls.find(r => (JSON.parse(r.body) as { method: string }).method === 'server/discover')
      assert.ok(discover !== undefined, 'the 2026-07-28 handshake is server/discover')

      // the evidence file exists, is valid JSON, and never carries a secret
      const written = readFileSync(out, 'utf8')
      assert.equal(written.includes(TOKEN), false, 'the bearer token must not reach the evidence file')
      assert.equal(written.includes(LAUNCH), false, 'the launch token must not reach the evidence file')
      // SAFETY: runVerification wrote this file in this test; the two fields read next are
      // asserted immediately below.
      const parsed = JSON.parse(written) as { tool: string, summary: { ok: boolean } }
      assert.equal(parsed.tool, 'verify-tool-insights-instance')
      assert.equal(parsed.summary.ok, true)
    } finally {
      await host.close()
    }
  })

  it('exercises semantic_similarity with object items and records its score', async () => {
    const host = createMockHost({ toolNames: ['lang_detect', 'semantic_similarity'] })
    const { origin } = await host.start()
    try {
      const evidence = await runVerification({
        webUrl: `${origin}/?token=${LAUNCH}`,
        mcpUrl: `${origin}/mcp`,
        token: TOKEN,
        out: join(tempDir, 'semantic-evidence.json'),
        now: () => new Date('2026-10-23T05:00:00.000Z'),
      })
      assert.equal(evidence.summary.ok, true, JSON.stringify(evidence.checks.filter(c => !c.ok)))
      assert.equal(evidence.semanticCall.attempted, true)
      assert.equal(evidence.semanticCall.isError, false)
      assert.equal(Math.round(evidence.semanticCall.score * 1000) / 1000, 0.855)
      assert.ok(evidence.checks.some(check => check.id === 'mcp.semantic_similarity' && check.ok))
      // SAFETY: these are this test's own recorded JSON-RPC request bodies.
      const semanticRequest = host.requests
        .filter(r => r.method === 'POST' && r.url === '/mcp')
        .map(r => JSON.parse(r.body) as { method: string, params?: { name?: string, arguments?: { left?: { parts?: unknown[] } } } })
        .find(body => body.method === 'tools/call' && body.params?.name === 'semantic_similarity')
      assert.ok(semanticRequest !== undefined)
      assert.equal(Array.isArray(semanticRequest.params?.arguments?.left?.parts), true)
    } finally {
      await host.close()
    }
  })

  it('fails the model_tools check when the MCP surface exposes model_tools', async () => {
    const host = createMockHost({ toolNames: ['lang_detect', 'model_tools'] })
    const { origin } = await host.start()
    try {
      const evidence = await runVerification({
        webUrl: `${origin}/?token=${LAUNCH}`,
        mcpUrl: `${origin}/mcp`,
        token: TOKEN,
        out: join(tempDir, 'model-tools.json'),
        now: () => new Date('2026-10-23T05:00:00.000Z'),
      })
      assert.equal(evidence.summary.ok, false)
      assert.equal(evidence.mcp.modelToolsPresent, true)
      const failed = evidence.checks.filter(check => !check.ok).map(check => check.id)
      assert.ok(failed.includes('mcp.model_tools.absent'), `failed checks: ${failed.join(',')}`)
    } finally {
      await host.close()
    }
  })

  it('fails the tab check when a tab label is missing from the served bundle', async () => {
    const host = createMockHost({
      bundleText: '"Tool Insights"; "MCP"; "Previous"; "Next"; "Page 1 of 2"',
    })
    const { origin } = await host.start()
    try {
      const evidence = await runVerification({
        webUrl: `${origin}/?token=${LAUNCH}`,
        mcpUrl: `${origin}/mcp`,
        token: TOKEN,
        out: join(tempDir, 'missing-tab.json'),
        now: () => new Date('2026-10-23T05:00:00.000Z'),
      })
      assert.equal(evidence.summary.ok, false)
      const failed = evidence.checks.filter(check => !check.ok).map(check => check.id)
      assert.ok(failed.includes('client.tabs'), `failed checks: ${failed.join(',')}`)
      assert.equal(evidence.tabs.find(row => row.label === 'Tool Inventory')?.present, false)
    } finally {
      await host.close()
    }
  })

  it('fails the call check when the safe call returns isError', async () => {
    const host = createMockHost({ callIsError: true })
    const { origin } = await host.start()
    try {
      const evidence = await runVerification({
        webUrl: `${origin}/?token=${LAUNCH}`,
        mcpUrl: `${origin}/mcp`,
        token: TOKEN,
        out: join(tempDir, 'call-error.json'),
        now: () => new Date('2026-10-23T05:00:00.000Z'),
      })
      assert.equal(evidence.summary.ok, false)
      assert.equal(evidence.call.isError, true)
      const failed = evidence.checks.filter(check => !check.ok).map(check => check.id)
      assert.ok(failed.includes('mcp.call'), `failed checks: ${failed.join(',')}`)
    } finally {
      await host.close()
    }
  })
})
