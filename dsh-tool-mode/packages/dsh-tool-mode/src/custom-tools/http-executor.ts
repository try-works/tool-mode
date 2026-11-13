/**
 * HTTP executor for user-authored custom tools.
 *
 * Security properties, all enforced here rather than in the form:
 * - HTTPS only, exact origin allowlist;
 * - DNS is resolved for every call and every resolved address must be public;
 * - redirects are refused;
 * - response bytes and wall-clock time are bounded;
 * - credential references resolve per call and values never enter errors.
 *
 * @module @try-works/dsh-tool-mode/custom-tools/http-executor
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { CustomToolExecContext } from './compile.ts'
import { CustomToolSchemaError } from './schema.ts'
import type { CustomToolRecord, HttpExecution, HttpHeaderValue } from './types.ts'

/** A named refusal from the HTTP executor. */
export class CustomToolHttpError extends Error {
  override readonly name = 'CustomToolHttpError'
  readonly code:
    | 'custom-tool-http-url-invalid'
    | 'custom-tool-http-origin-denied'
    | 'custom-tool-http-private-address'
    | 'custom-tool-http-credential-unavailable'
    | 'custom-tool-http-fetch-failed'
    | 'custom-tool-http-response-too-large'
    | 'custom-tool-http-timeout'

  constructor(code: CustomToolHttpError['code'], message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

/** Dependency seams; production uses real DNS/fetch and `ctx.credentials`. */
export interface HttpExecutorDeps {
  readonly fetchImpl?: typeof fetch
  readonly lookup?: (hostname: string) => Promise<readonly { readonly address: string; readonly family: number }[]>
  /** Resolve a credential reference; undefined means unconfigured. */
  readonly resolveCredential?: (name: string) => Promise<string | undefined>
  /** Response byte cap; default 1 MiB. */
  readonly maxResponseBytes?: number
}

const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024
const TEMPLATE = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g

/** Whether an IPv4/IPv6 literal is loopback, private, link-local or metadata. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) {
    const parts = address.split('.').map(Number)
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true
    const [a = 0, b = 0] = parts
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224
  }
  if (version === 6) {
    const lower = address.toLowerCase()
    if (lower === '::' || lower === '::1') return true
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice('::ffff:'.length))
    return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9')
      || lower.startsWith('fea') || lower.startsWith('feb') || lower.startsWith('ff')
  }
  return true
}

/** One resolved template argument, with a named failure for a missing key. */
function argument(args: Readonly<Record<string, unknown>>, name: string): unknown {
  const value = args[name]
  if (value === undefined) {
    throw new CustomToolHttpError('custom-tool-http-url-invalid', `argument ${JSON.stringify(name)} is required by the template`)
  }
  return value
}

/** Percent-encode scalar template values for a URL/query component. */
function interpolateUrl(template: string, args: Readonly<Record<string, unknown>>): string {
  return template.replace(TEMPLATE, (_whole, name: string) => encodeURIComponent(String(argument(args, name))))
}

/** Substitute JSON-safe values into a JSON body template. */
function interpolateBody(template: string, args: Readonly<Record<string, unknown>>): string {
  return template.replace(TEMPLATE, (_whole, name: string) => JSON.stringify(argument(args, name)))
}

/** Extract a dot path from a JSON value; empty path returns the value itself. */
export function extractPath(value: unknown, path: string): unknown {
  if (path.length === 0) return value
  let current: unknown = value
  for (const segment of path.split('.')) {
    if (!Array.isArray(current) && (typeof current !== 'object' || current === null)) return undefined
    current = Array.isArray(current) ? current[Number(segment)] : (current as Record<string, unknown>)[segment]
  }
  return current
}

function originOf(url: URL): string {
  return url.origin
}

async function assertPublicHost(hostname: string, deps: HttpExecutorDeps): Promise<void> {
  if (isIP(hostname) !== 0) {
    if (isPrivateAddress(hostname)) {
      throw new CustomToolHttpError('custom-tool-http-private-address', `the target ${hostname} is a private or loopback address`)
    }
    return
  }
  const lookup = deps.lookup ?? (async (host: string) => dnsLookup(host, { all: true, verbatim: true }))
  let addresses: readonly { readonly address: string; readonly family: number }[]
  try {
    addresses = await lookup(hostname)
  } catch (error) {
    throw new CustomToolHttpError('custom-tool-http-fetch-failed', `the host ${hostname} could not be resolved`, { cause: error })
  }
  if (addresses.length === 0) {
    throw new CustomToolHttpError('custom-tool-http-fetch-failed', `the host ${hostname} resolved to no address`)
  }
  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      throw new CustomToolHttpError('custom-tool-http-private-address', `the host ${hostname} resolves to the private address ${entry.address}`)
    }
  }
}

async function resolveHeaders(
  headers: Readonly<Record<string, HttpHeaderValue>>,
  deps: HttpExecutorDeps,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      out[name] = value
      continue
    }
    const secret = await deps.resolveCredential?.(value.secret)
    if (secret === undefined) {
      throw new CustomToolHttpError(
        'custom-tool-http-credential-unavailable',
        `the credential ${JSON.stringify(value.secret)} is not configured`,
      )
    }
    out[name] = secret
  }
  return out
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw new CustomToolHttpError('custom-tool-http-response-too-large', `the response is over the ${maxBytes}-byte cap`)
  }
  if (response.body === null) return new Uint8Array(await response.arrayBuffer())
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value === undefined) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new CustomToolHttpError('custom-tool-http-response-too-large', `the response is over the ${maxBytes}-byte cap`)
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}

/**
 * Execute one HTTP custom tool.
 * @param record - validated record whose execution kind is `http`.
 * @param args - tool arguments.
 * @param context - cancellation signal.
 * @param deps - injectable fetch/DNS/credential seams.
 * @returns the parsed/extracted response value.
 */
export async function executeHttpCustomTool(
  record: CustomToolRecord,
  args: Readonly<Record<string, unknown>>,
  context: CustomToolExecContext,
  deps: HttpExecutorDeps = {},
): Promise<unknown> {
  if (record.execution.kind !== 'http') {
    throw new CustomToolHttpError('custom-tool-http-url-invalid', `${record.id} is not an HTTP tool`)
  }
  const http: HttpExecution = record.execution.http
  const target = interpolateUrl(http.url, args)
  let url: URL
  try {
    url = new URL(target)
  } catch (error) {
    throw new CustomToolHttpError('custom-tool-http-url-invalid', `the URL template did not produce an absolute URL`, { cause: error })
  }
  if (url.protocol !== 'https:') throw new CustomToolHttpError('custom-tool-http-url-invalid', 'HTTP tools must use https')
  if (url.username !== '' || url.password !== '') throw new CustomToolHttpError('custom-tool-http-url-invalid', 'the URL must not embed credentials')
  if (!record.policy.networkOrigins.includes(originOf(url))) {
    throw new CustomToolHttpError(
      'custom-tool-http-origin-denied',
      `${url.origin} is not in the tool's network allowlist`,
    )
  }
  await assertPublicHost(url.hostname, deps)

  const headers = await resolveHeaders(http.headers, deps)
  const method = http.method
  const body = http.bodyTemplate === undefined || method === 'GET' ? undefined : interpolateBody(http.bodyTemplate, args)
  if (body !== undefined && !Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) {
    headers['content-type'] = 'application/json'
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('custom-tool-http-timeout')), record.policy.timeoutMs)
  const signal = AbortSignal.any([context.signal, controller.signal])
  let response: Response
  try {
    response = await (deps.fetchImpl ?? fetch)(url, {
      method,
      headers,
      ...body === undefined ? {} : { body },
      redirect: 'error',
      signal,
    })
  } catch (error) {
    if (signal.aborted) {
      const timeout = controller.signal.aborted
      throw new CustomToolHttpError(
        timeout ? 'custom-tool-http-timeout' : 'custom-tool-http-fetch-failed',
        timeout ? `the request exceeded ${record.policy.timeoutMs} ms` : 'the request was cancelled',
        { cause: error },
      )
    }
    throw new CustomToolHttpError('custom-tool-http-fetch-failed', `the request to ${url.host} failed`, { cause: error })
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new CustomToolHttpError('custom-tool-http-fetch-failed', `the request to ${url.host} answered HTTP ${response.status}`)
  }
  const bytes = await readBounded(response, deps.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)
  const text = new TextDecoder().decode(bytes)
  const contentType = response.headers.get('content-type') ?? ''
  let value: unknown = text
  if (contentType.includes('json')) {
    try {
      value = JSON.parse(text)
    } catch {
      throw new CustomToolHttpError('custom-tool-http-fetch-failed', `the response from ${url.host} declared JSON but did not parse`)
    }
  }
  return extractPath(value, http.extract ?? '')
}

/** Render a safe error message without credential values. */
export function describeHttpError(error: unknown): string {
  if (error instanceof CustomToolSchemaError) return error.message
  if (error instanceof CustomToolHttpError) return error.message
  return error instanceof Error ? error.message : String(error)
}
