#!/usr/bin/env node
/**
 * Live evidence collector for the Tool Insights disposable instance (plan §6.3).
 *
 * What it proves, from OUTSIDE the product:
 *  - the web shell is reachable and the SERVED client bundle carries the three tab labels
 *    (`Tool Insights`, `Tool Inventory`, `MCP`) and the pagination labels;
 *  - the MCP surface at `--mcp-url` speaks the pinned revision (2026-07-28 replaced the
 *    `initialize` handshake with `server/discover`; the script records BOTH — the expected
 *    refusal of the pre-2026 `initialize` and the discovery result);
 *  - `tools/list` contains the exposed tools and NEVER `model_tools`;
 *  - one safe tool call succeeds and carries a receipt id when the tool declares one.
 *
 * Every printed line and every byte of the JSON evidence is passed through the redactor,
 * so the MCP bearer token and the web launch token never reach a log or an artifact.
 *
 * Usage:
 *   node scripts/verify-tool-insights-instance.mjs \
 *     --web-url "http://127.0.0.1:3180/?token=<launch-token>" \
 *     --mcp-url http://127.0.0.1:3865/mcp \
 *     --token "$env:DSH_TOOL_MODE_MCP_TOKEN" \
 *     --out docs/tool-insights/evidence/verify-<stamp>/instance-verification.json
 *
 * Flags: --web-url, --mcp-url, --token (or DSH_TOOL_MODE_MCP_TOKEN), --out, --web-token,
 *        --call, --args-json. Unknown flags are refused.
 *
 * The pure helpers (parseArgs, redact, findClientBundleUrl, assertClientLabels,
 * selectSafeCall) and `runVerification` are exported for tests; the CLI only runs when this
 * file is executed directly.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The plan's disposable-instance defaults. */
export const DEFAULTS = Object.freeze({
  webUrl: 'http://127.0.0.1:3180',
  mcpUrl: 'http://127.0.0.1:3865/mcp',
  out: 'docs/tool-insights/evidence/verify-instance.json',
})

/** The tab labels the served client must carry (plan §1). */
export const EXPECTED_TAB_LABELS = Object.freeze(['Tool Insights', 'Tool Inventory', 'MCP'])

/**
 * The pagination controls the served client must carry.
 *
 * The plan (§6.3) requires "the pagination labels" and the proposal (§5) specifies
 * "prev/next controls" plus a page count. The client slice must use these exact labels;
 * they are pinned here so a silent label drift fails the evidence run.
 */
export const EXPECTED_PAGINATION_LABELS = Object.freeze(['Previous', 'Next', 'Page'])

/** The pinned MCP revision. */
export const PROTOCOL_VERSION = '2026-07-28'

/** A caller mistake (bad flags / missing token), never a verification failure. */
export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
  }
}

/** A check failed; the message lists the evidence that was expected. */
export class VerificationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'VerificationError'
  }
}

/**
 * Parse the CLI flags.
 * @param {readonly string[]} argv - arguments after the script name.
 * @param {Record<string, string | undefined>} env - environment for the token fallback.
 * @returns {{webUrl: string, mcpUrl: string, token: string, out: string, webToken: string | undefined, callTool: string | undefined, callArgsJson: string | undefined}}
 * @throws {UsageError} on an unknown flag or a missing token.
 */
export function parseArgs(argv, env = process.env) {
  const parsed = {
    webUrl: DEFAULTS.webUrl,
    mcpUrl: DEFAULTS.mcpUrl,
    token: env.DSH_TOOL_MODE_MCP_TOKEN ?? '',
    out: DEFAULTS.out,
    webToken: undefined,
    callTool: undefined,
    callArgsJson: undefined,
  }
  const VALUE_FLAGS = new Map([
    ['--web-url', 'webUrl'],
    ['--mcp-url', 'mcpUrl'],
    ['--token', 'token'],
    ['--out', 'out'],
    ['--web-token', 'webToken'],
    ['--call', 'callTool'],
    ['--args-json', 'callArgsJson'],
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const equals = argument.indexOf('=')
    const flag = equals === -1 ? argument : argument.slice(0, equals)
    const key = VALUE_FLAGS.get(flag)
    if (key === undefined) throw new UsageError(`unknown argument "${argument}"`)
    const value = equals === -1 ? argv[index + 1] : argument.slice(equals + 1)
    if (value === undefined || (equals === -1 && value.startsWith('--'))) {
      throw new UsageError(`missing value for "${flag}"`)
    }
    if (equals === -1) index += 1
    parsed[key] = value
  }
  if (parsed.token.length === 0) {
    throw new UsageError('missing --token (or set DSH_TOOL_MODE_MCP_TOKEN) for the MCP bearer')
  }
  return parsed
}

/**
 * Replace every secret occurrence in one string with a visible marker.
 * @param {string} text - text to redact.
 * @param {readonly string[]} secrets - values that must not survive.
 * @returns {string} the redacted text.
 */
export function redact(text, secrets) {
  let redacted = text
  for (const secret of secrets) {
    if (secret.length === 0) continue
    redacted = redacted.split(secret).join('[redacted]')
  }
  return redacted
}

/**
 * Redact one JSON-safe value recursively without mutating it.
 * @param {unknown} value - the value.
 * @param {readonly string[]} secrets - values that must not survive.
 * @returns {unknown} a redacted copy.
 */
export function redactDeep(value, secrets) {
  // A JSON-safe value is a string, an array/object, or a primitive. A string is the only
  // primitive equal to its own String() form, so this branches without a typeof probe.
  if (value !== null && value === String(value)) return redact(value, secrets)
  if (Array.isArray(value) || value instanceof Object) {
    if (Array.isArray(value)) return value.map(entry => redactDeep(entry, secrets))
    const copy = {}
    for (const [key, entry] of Object.entries(value)) copy[key] = redactDeep(entry, secrets)
    return copy
  }
  return value
}

/**
 * Whether a JSON value is a non-empty string, without a runtime type probe.
 * @param {unknown} value - the value parsed from JSON.
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return value !== undefined && value !== null && value === String(value) && value.length > 0
}

/**
 * Read the shell's `__DSH_BOOT__` manifest, when it has one.
 *
 * The current web shell preloads client modules through a boot manifest
 * (`globalThis["__DSH_BOOT__"] = {...}`) whose `entries[].url` values are RELATIVE
 * (`plugins/??@try-works/dsh-tool-mode/client.js&rev=…`). Older shells put the same
 * URL in a `<script src>` attribute instead; both shapes are supported.
 * @param {string} html - the served shell (HTML entities already decoded).
 * @returns {{entries?: readonly {id?: string, url?: string}[]} | null}
 */
function readBootManifest(html) {
  const match = /globalThis\["__DSH_BOOT__"\]\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/.exec(html)
  if (match === null) return null
  try {
    const parsed = JSON.parse(match[1])
    return parsed !== null && parsed instanceof Object ? parsed : null
  } catch {
    return null
  }
}

/**
 * Find the client bundle URL in the served app shell.
 *
 * Resolution order: the `__DSH_BOOT__` entry for this plugin (preferred), then a
 * script/link attribute (absolute or relative) naming the bundle.
 * @param {string} html - the served shell.
 * @param {string} baseUrl - the shell's own URL (for relative resolution).
 * @returns {string | null} the absolute bundle URL, or null when the shell names none.
 */
export function findClientBundleUrl(html, baseUrl) {
  const decoded = String(html).replaceAll('&amp;', '&')
  const boot = readBootManifest(decoded)
  if (boot !== null) {
    const entries = Array.isArray(boot.entries) ? boot.entries : []
    const named = entries.find(entry => entry !== null && entry instanceof Object
      && isNonEmptyString(entry.id) && String(entry.id).includes('dsh-tool-mode'))
      ?? entries.find(entry => entry !== null && entry instanceof Object
        && isNonEmptyString(entry.url) && String(entry.url).includes('dsh-tool-mode/client.js'))
    if (named !== undefined && isNonEmptyString(named.url)) {
      try {
        return new URL(String(named.url), baseUrl).href
      } catch {
        return null
      }
    }
  }
  const candidates = []
  for (const match of decoded.matchAll(/(?:src|href)="([^"]+)"/g)) candidates.push(match[1])
  for (const match of decoded.matchAll(/["']([^"'\s]*(?:plugins\/|client\.js)[^"'\s]*)["']/g)) candidates.push(match[1])
  const pluginCandidates = candidates.filter(candidate => candidate.includes('client.js') || candidate.includes('plugins/'))
  const preferred = pluginCandidates.find(candidate => candidate.includes('@try-works/dsh-tool-mode/client.js'))
    ?? pluginCandidates[0]
  if (preferred === undefined) return null
  try {
    return new URL(preferred, baseUrl).href
  } catch {
    return null
  }
}

/**
 * Inspect the labels in a served client bundle.
 * @param {string} bundleText - the served JavaScript.
 * @param {{tabs?: readonly string[], pagination?: readonly string[]}} [labels] - overrides.
 * @returns {{tabs: {label: string, present: boolean}[], pagination: {label: string, present: boolean}[], missing: string[]}}
 */
function inspectClientLabels(bundleText, labels = {}) {
  const text = String(bundleText)
  const tabs = (labels.tabs ?? EXPECTED_TAB_LABELS).map(label => ({ label, present: text.includes(label) }))
  const pagination = (labels.pagination ?? EXPECTED_PAGINATION_LABELS).map(label => ({ label, present: text.includes(label) }))
  const missing = [...tabs, ...pagination].filter(row => !row.present).map(row => row.label)
  return { tabs, pagination, missing }
}

/**
 * Assert the served client bundle carries the tab and pagination labels.
 * @param {string} bundleText - the served JavaScript.
 * @param {{tabs?: readonly string[], pagination?: readonly string[]}} [labels] - overrides.
 * @returns {{tabs: {label: string, present: boolean}[], pagination: {label: string, present: boolean}[], missing: string[]}}
 * @throws {VerificationError} naming every missing label (not only the first).
 */
export function assertClientLabels(bundleText, labels = {}) {
  const inspected = inspectClientLabels(bundleText, labels)
  if (inspected.missing.length > 0) {
    throw new VerificationError(`served client bundle is missing labels: ${inspected.missing.join(', ')}`)
  }
  return inspected
}

/**
 * Choose one safe tool call.
 * @param {readonly string[]} toolNames - the exposed tool names.
 * @param {{callTool?: string, callArgsJson?: string, tempFilePath?: string}} options - explicit override.
 * @returns {{tool: string, arguments: Record<string, unknown>, reason: string} | null}
 * @throws {Error} when an explicit --args-json is not valid JSON.
 */
export function selectSafeCall(toolNames, options = {}) {
  const explicit = options.callTool
  if (explicit !== undefined) {
    let parsedArguments = {}
    if (options.callArgsJson !== undefined) {
      try {
        const parsed = JSON.parse(options.callArgsJson)
        if (parsed === null || Array.isArray(parsed) || parsed instanceof Object === false) {
          throw new Error('must be a JSON object')
        }
        parsedArguments = parsed
      } catch (error) {
        throw new Error(`--args-json is not a JSON object: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      parsedArguments = defaultArgumentsFor(explicit, options.tempFilePath)
    }
    return { tool: explicit, arguments: parsedArguments, reason: 'explicit --call' }
  }
  if (toolNames.includes('read')) {
    return { tool: 'read', arguments: { file_path: options.tempFilePath }, reason: 'default read on a temp file' }
  }
  if (toolNames.includes('lang_detect')) {
    return {
      tool: 'lang_detect',
      arguments: { text: 'Hallo, dies ist ein Test fuer die Sprach erkennung.' },
      reason: 'fallback lang_detect (read is not exposed)',
    }
  }
  return null
}

/**
 * The schema-conformant `semantic_similarity` call.
 *
 * Its live contract takes ITEM OBJECTS, not plain strings:
 * `{ id, parts: [{ kind: 'text', text }] }`.
 * @param {readonly string[]} toolNames - exposed tool names.
 * @returns {{tool: string, arguments: Record<string, unknown>} | null}
 */
export function selectSemanticSimilarityCall(toolNames) {
  if (!toolNames.includes('semantic_similarity')) return null
  return {
    tool: 'semantic_similarity',
    arguments: {
      left: { id: 'verifier-left', parts: [{ kind: 'text', text: 'The cat sat on the mat.' }] },
      right: { id: 'verifier-right', parts: [{ kind: 'text', text: 'A feline rested on the rug.' }] },
    },
  }
}

/** Default arguments for the tools the verifier knows how to call safely. */
function defaultArgumentsFor(tool, tempFilePath) {
  if (tool === 'read') return { file_path: tempFilePath }
  if (tool === 'lang_detect') return { text: 'Hallo, dies ist ein Test fuer die Sprach erkennung.' }
  return {}
}

/** The JSON-RPC `_meta` a 2026-07-28 request must carry. */
function requestMeta() {
  return {
    'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'verify-tool-insights-instance', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  }
}

/**
 * POST one JSON-RPC request to the MCP endpoint with the pinned headers.
 * @param {typeof fetch} fetchImpl - fetch implementation.
 * @param {string} url - the MCP endpoint.
 * @param {{method: string, params?: Record<string, unknown>, token: string}} request - the request.
 * @returns {Promise<{status: number, body: any}>} status and parsed body.
 */
export async function mcpRpc(fetchImpl, url, request) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL_VERSION,
    'mcp-method': request.method,
    authorization: `Bearer ${request.token}`,
  }
  if (request.method === 'tools/call') headers['mcp-name'] = String(request.params?.name ?? '')
  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${request.method}-${Date.now()}`,
      method: request.method,
      params: { ...(request.params ?? {}), _meta: requestMeta() },
    }),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    const line = text.split(/\r?\n/).filter(entry => entry.startsWith('data:')).pop()
    body = line === undefined ? { raw: text.slice(0, 500) } : JSON.parse(line.slice(5).trim())
  }
  return { status: response.status, body }
}

/** Read the Set-Cookie header as a list across Node/undici shapes. */
function readSetCookies(headers) {
  if (headers.getSetCookie !== undefined) return headers.getSetCookie()
  const single = headers.get('set-cookie')
  return single === null ? [] : [single]
}

/** Find the first `receiptId` anywhere in a JSON-RPC result. */
function findReceiptId(value) {
  if (value === null || value instanceof Object === false) return null
  const candidate = value.receiptId
  if (candidate !== undefined && candidate !== null && String(candidate).length > 0) return String(candidate)
  for (const entry of Object.values(value)) {
    const found = findReceiptId(entry)
    if (found !== null) return found
  }
  return null
}

/**
 * Run the whole verification and build the evidence document.
 * @param {{
 *   webUrl: string, mcpUrl: string, token: string, out?: string,
 *   webToken?: string, callTool?: string, callArgsJson?: string,
 *   fetchImpl?: typeof fetch, now?: () => Date,
 * }} options - run options; `fetchImpl` and `now` are injectable for tests.
 * @returns {Promise<object>} the evidence document (already redacted).
 */
export async function runVerification(options) {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => new Date())
  const startedAt = now()
  const checks = []
  const check = (id, ok, detail) => {
    checks.push({ id, ok, detail: String(detail) })
    return ok
  }
  const parsedWeb = new URL(options.webUrl)
  const launchToken = parsedWeb.searchParams.get('token') ?? options.webToken ?? ''
  const secrets = [options.token, options.webToken ?? '', launchToken].filter(secret => secret.length > 0)

  // ---- web shell (launch token -> cookie -> authenticated shell) ----
  let cookie = ''
  let shellHtml = ''
  let shellUrl = parsedWeb.href
  try {
    const mintTarget = launchToken.length > 0 ? parsedWeb.href : parsedWeb.href
    const mint = await fetchImpl(mintTarget, { redirect: 'manual' })
    const mintCookies = readSetCookies(mint.headers)
      .map(raw => raw.split(';')[0])
      .filter(pair => pair.startsWith('dsh-auth'))
    cookie = mintCookies.join('; ')
    check('web.launch', mint.status < 400 || mint.status === 401, `launch exchange HTTP ${mint.status}`)
    const shellBase = `${parsedWeb.origin}${parsedWeb.pathname === '' ? '/' : parsedWeb.pathname}`
    shellUrl = shellBase
    const shell = await fetchImpl(shellBase, {
      headers: cookie.length === 0 ? {} : { cookie },
      redirect: 'follow',
    })
    shellHtml = await shell.text()
    const shellOk = shell.status === 200
    check('web.shell', shellOk, shellOk
      ? `HTTP 200, ${shellHtml.length} bytes`
      : `HTTP ${shell.status}; pass the launch URL printed by \`dsh web\` (it contains ?token=) as --web-url`)
  } catch (error) {
    check('web.shell', false, `shell request failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  // ---- served client bundle ----
  let bundleUrl = null
  let bundleText = ''
  if (shellHtml.length > 0) {
    bundleUrl = findClientBundleUrl(shellHtml, shellUrl)
    check('web.bundle_url', bundleUrl !== null, bundleUrl === null
      ? 'the served shell names no /plugins/ client bundle'
      : `bundle: ${bundleUrl}`)
    if (bundleUrl !== null) {
      try {
        const bundle = await fetchImpl(bundleUrl, { headers: cookie.length === 0 ? {} : { cookie } })
        bundleText = await bundle.text()
        check('web.bundle', bundle.status === 200 && bundleText.length > 0, `HTTP ${bundle.status}, ${bundleText.length} bytes`)
      } catch (error) {
        check('web.bundle', false, `bundle request failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  const labelReport = inspectClientLabels(bundleText)
  check('client.tabs', labelReport.tabs.every(row => row.present),
    labelReport.tabs.filter(row => !row.present).map(row => row.label).join(', ') || 'all three tab labels present')
  check('client.pagination', labelReport.pagination.every(row => row.present),
    labelReport.pagination.filter(row => !row.present).map(row => row.label).join(', ') || 'all pagination labels present')

  // ---- MCP handshake, tools/list, one safe call ----
  const mcp = { initialize: null, discover: null, toolsCount: 0, tools: [], modelToolsPresent: false }
  const callEvidence = {
    attempted: false,
    tool: null,
    httpStatus: null,
    isError: null,
    resultType: null,
    receiptId: null,
    durationMs: null,
    reason: null,
    argumentsPreview: null,
  }
  const semanticEvidence = {
    attempted: false,
    tool: 'semantic_similarity',
    httpStatus: null,
    isError: null,
    score: null,
    scoreKind: null,
    durationMs: null,
    reason: null,
    argumentsPreview: null,
  }
  try {
    const initialize = await mcpRpc(fetchImpl, options.mcpUrl, { method: 'initialize', params: {}, token: options.token })
    const rejected = initialize.body?.error?.code === -32601
    mcp.initialize = {
      status: initialize.status,
      accepted: !rejected,
      errorCode: initialize.body?.error?.code ?? null,
      errorMessage: String(initialize.body?.error?.message ?? ''),
    }
    const discover = await mcpRpc(fetchImpl, options.mcpUrl, { method: 'server/discover', params: {}, token: options.token })
    const discoverResult = discover.body?.result
    const supported = Array.isArray(discoverResult?.supportedVersions) ? discoverResult.supportedVersions : []
    mcp.discover = {
      status: discover.status,
      ok: discover.status === 200 && supported.includes(PROTOCOL_VERSION),
      supportedVersions: supported,
      serverInfo: discoverResult?._meta?.['io.modelcontextprotocol/serverInfo'] ?? null,
    }
    check('mcp.handshake', mcp.discover.ok || mcp.initialize.accepted,
      `initialize ${rejected ? 'refused (2026-07-28 replaced the handshake)' : 'accepted'}; `
      + `server/discover HTTP ${discover.status}, supported ${supported.join(',') || 'none'}`)

    // tools/list, following pagination to capture every tool
    const tools = []
    let cursor
    let listStatus = 0
    for (let page = 0; page < 20; page += 1) {
      const response = await mcpRpc(fetchImpl, options.mcpUrl, {
        method: 'tools/list',
        params: cursor === undefined ? {} : { cursor },
        token: options.token,
      })
      listStatus = response.status
      const result = response.body?.result ?? {}
      if (Array.isArray(result.tools)) tools.push(...result.tools)
      cursor = result.nextCursor
      if (cursor === undefined) break
    }
    mcp.toolsCount = tools.length
    mcp.tools = tools.map(tool => String(tool?.name ?? ''))
    mcp.modelToolsPresent = mcp.tools.includes('model_tools')
    check('mcp.tools.list', listStatus === 200 && mcp.tools.length > 0, `HTTP ${listStatus}, ${mcp.tools.length} tool(s)`)
    check('mcp.model_tools.absent', !mcp.modelToolsPresent, mcp.modelToolsPresent
      ? 'model_tools is exposed on the MCP surface (it must stay host-local)'
      : 'model_tools is not exposed')

    // one safe call
    let tempFilePath
    try {
      const { mkdtempSync, writeFileSync: writeTemporary } = await import('node:fs')
      const { tmpdir } = await import('node:os')
      const { join } = await import('node:path')
      const temporaryDir = mkdtempSync(join(tmpdir(), 'verify-ti-call-'))
      tempFilePath = join(temporaryDir, 'safe-call.txt')
      writeTemporary(tempFilePath, 'tool-insights verification safe call\n', 'utf8')
    } catch {
      tempFilePath = undefined
    }
    const selected = selectSafeCall(mcp.tools, {
      callTool: options.callTool,
      callArgsJson: options.callArgsJson,
      tempFilePath,
    })
    if (selected === null) {
      check('mcp.call', false, 'no safe tool is exposed (neither read nor lang_detect); pass --call/--args-json')
      callEvidence.reason = 'no safe exposed tool'
    } else {
      callEvidence.attempted = true
      callEvidence.tool = selected.tool
      callEvidence.reason = selected.reason
      callEvidence.argumentsPreview = Object.keys(selected.arguments ?? {})
      const started = Date.now()
      try {
        const response = await mcpRpc(fetchImpl, options.mcpUrl, {
          method: 'tools/call',
          params: { name: selected.tool, arguments: selected.arguments },
          token: options.token,
        })
        const result = response.body?.result ?? {}
        const receiptId = findReceiptId(response.body)
        const toolDefinition = tools.find(tool => tool?.name === selected.tool)
        const declaresMeta = JSON.stringify(toolDefinition?.outputSchema ?? '').includes('"meta"')
        callEvidence.httpStatus = response.status
        callEvidence.isError = result.isError === true
        callEvidence.resultType = result.resultType ?? null
        callEvidence.receiptId = receiptId
        callEvidence.durationMs = Date.now() - started
        check('mcp.call', response.status === 200 && result.isError !== true,
          result.isError === true
            ? `isError: ${String(result.content?.[0]?.text ?? '').slice(0, 300)}`
            : `${selected.tool} returned ${result.resultType ?? 'a result'}`)
        check('mcp.call.receipt', !declaresMeta || receiptId !== null,
          receiptId === null ? 'the tool declares meta but the result carries no receiptId' : `receiptId ${receiptId}`)
      } catch (error) {
        check('mcp.call', false, `the safe call failed: ${error instanceof Error ? error.message : String(error)}`)
        check('mcp.call.receipt', false, 'no result, so no receipt')
      }
    }

    // The object-shaped semantic_similarity contract. This catches the exact
    // prompt mistake of passing plain strings to a tool that takes item objects.
    const semantic = selectSemanticSimilarityCall(mcp.tools)
    if (semantic !== null) {
      semanticEvidence.attempted = true
      semanticEvidence.argumentsPreview = Object.keys(semantic.arguments)
      const started = Date.now()
      try {
        const response = await mcpRpc(fetchImpl, options.mcpUrl, {
          method: 'tools/call',
          params: { name: semantic.tool, arguments: semantic.arguments },
          token: options.token,
        })
        const result = response.body?.result ?? {}
        const structured = result.structuredContent ?? {}
        const score = typeof structured.score === 'number' ? structured.score : null
        semanticEvidence.httpStatus = response.status
        semanticEvidence.isError = result.isError === true
        semanticEvidence.score = score
        semanticEvidence.scoreKind = typeof structured.scoreKind === 'string' ? structured.scoreKind : null
        semanticEvidence.durationMs = Date.now() - started
        check('mcp.semantic_similarity', response.status === 200 && result.isError !== true
          && score !== null && score > 0 && score <= 1,
        result.isError === true
          ? `isError: ${String(result.content?.[0]?.text ?? '').slice(0, 300)}`
          : `${semantic.tool} score ${String(score)}${semanticEvidence.scoreKind === null ? '' : ` (${semanticEvidence.scoreKind})`}`)
      } catch (error) {
        check('mcp.semantic_similarity', false,
          `the object-shaped semantic_similarity call failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } catch (error) {
    check('mcp.handshake', false, `MCP request failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const finishedAt = now()
  const passed = checks.filter(entry => entry.ok).length
  const failed = checks.length - passed
  const evidence = {
    tool: 'verify-tool-insights-instance',
    version: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    config: {
      webUrl: options.webUrl,
      mcpUrl: options.mcpUrl,
      out: options.out ?? null,
      callTool: options.callTool ?? null,
    },
    checks,
    summary: { ok: failed === 0, passed, failed },
    tabs: labelReport.tabs,
    pagination: labelReport.pagination,
    mcp,
    call: callEvidence,
    semanticCall: semanticEvidence,
    artifacts: { bundleUrl, bundleBytes: bundleText.length, shellBytes: shellHtml.length },
    redaction: { applied: true, secrets: secrets.length },
  }
  const redactedEvidence = redactDeep(evidence, secrets)
  if (options.out !== undefined && options.out.length > 0) {
    const absoluteOut = resolve(options.out)
    mkdirSync(dirname(absoluteOut), { recursive: true })
    writeFileSync(absoluteOut, JSON.stringify(redactedEvidence, null, 2) + '\n', 'utf8')
  }
  return redactedEvidence
}

/** Print the redacted human summary for the CLI. */
function printSummary(evidence, secrets) {
  const lines = []
  lines.push(`verify-tool-insights-instance — ${evidence.summary.ok ? 'PASS' : 'FAIL'} `
    + `(${evidence.summary.passed} passed, ${evidence.summary.failed} failed)`)
  for (const entry of evidence.checks) {
    lines.push(`  ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.id}: ${entry.detail}`)
  }
  lines.push(`  evidence: ${evidence.config.out ?? '(not written)'}`)
  process.stdout.write(redact(lines.join('\n') + '\n', secrets))
}

// CLI entry: run only when executed directly, never when imported by the tests.
const invokedPath = process.argv[1] === undefined ? '' : pathToFileURL(resolve(process.argv[1])).href
if (import.meta.url === invokedPath) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const evidence = await runVerification(args)
    printSummary(evidence, [args.token, args.webToken ?? ''])
    process.exitCode = evidence.summary.ok ? 0 : 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`verify-tool-insights-instance: ${message}\n`)
    process.exitCode = error instanceof UsageError ? 2 : 1
  }
}
