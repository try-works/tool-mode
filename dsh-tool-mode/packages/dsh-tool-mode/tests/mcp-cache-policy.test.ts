/**
 * P26-14 — catalog cache policy on discovery results (task-25).
 *
 * The pinned schema's CacheableResult requires `cacheScope` and `ttlMs` on BOTH
 * `server/discover` and `tools/list`. Tool Mode's catalogs are authorization-filtered,
 * so the only admitted scope is `private`; the TTL is deployment policy and defaults
 * to 0. Before this task the fields were hard-coded (`private`/0) and the
 * `mcpV3.catalogTtlMs` / `catalogCacheScope` config was dead.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { McpHost } from '../src/mcp/server.ts'
import { dispatch } from '../src/mcp/server.ts'
import {
  cacheableResultFields,
  normalizeCachePolicy,
  PROTOCOL_VERSION,
  type WireRequest,
} from '../src/mcp/protocol.ts'
import { createMcpHost } from '../src/mcp/host-binding.ts'

const META = {
  'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'cache-policy-test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

/** The cacheable fields this test reads back from a dispatched result. */
interface CacheFields {
  readonly cacheScope?: unknown
  readonly ttlMs?: unknown
}

function request(method: 'tools/list' | 'server/discover') {
  return {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: { _meta: META },
  } satisfies WireRequest
}

function stubHost(cachePolicy?: McpHost['cachePolicy']): McpHost {
  const base: McpHost = {
    serverInfo: { name: '@try-works/dsh-tool-mode', version: 'test' },
    listTools: () => [],
    callTool: async () => ({ structured: null, text: '' }),
  }
  return cachePolicy === undefined ? base : { ...base, cachePolicy }
}

async function fieldsFor(method: 'tools/list' | 'server/discover', cachePolicy?: McpHost['cachePolicy']) {
  const outcome = await dispatch(request(method), stubHost(cachePolicy))
  assert.equal(outcome.httpStatus, 200)
  // SAFETY: dispatch returns a success envelope for these two methods, and its result
  // carries the CacheableResult fields this test asserts immediately below.
  const response = outcome.response as { readonly result?: CacheFields }
  return { cacheScope: response.result?.cacheScope, ttlMs: response.result?.ttlMs }
}

describe('P26-14 catalog cache policy', () => {
  it('defaults to private/0 when no policy is configured', async () => {
    assert.deepEqual(normalizeCachePolicy(), { cacheScope: 'private', ttlMs: 0 })
    assert.deepEqual(cacheableResultFields(), { cacheScope: 'private', ttlMs: 0 })
    assert.deepEqual(await fieldsFor('tools/list'), { cacheScope: 'private', ttlMs: 0 })
    assert.deepEqual(await fieldsFor('server/discover'), { cacheScope: 'private', ttlMs: 0 })
  })

  it('reflects a configured TTL on tools/list AND server/discover', async () => {
    const policy = normalizeCachePolicy({ ttlMs: 60_000, cacheScope: 'private' })
    assert.deepEqual(policy, { cacheScope: 'private', ttlMs: 60_000 })
    assert.deepEqual(await fieldsFor('tools/list', policy), { cacheScope: 'private', ttlMs: 60_000 })
    assert.deepEqual(await fieldsFor('server/discover', policy), { cacheScope: 'private', ttlMs: 60_000 })
  })

  it('refuses a non-private cache scope with a named error (authorization-filtered catalog)', () => {
    assert.throws(
      () => normalizeCachePolicy({ ttlMs: 10, cacheScope: 'public' }),
      /INVALID_CATALOG_CACHE_SCOPE/,
    )
    // The factory accepts the UNVALIDATED config shape, so an invalid scope reaches its
    // validation (rather than being rejected by the type system) and gets refused.
    assert.throws(
      () => createMcpHost({
        serverInfo: { name: 'test', version: '1.0.0' },
        surface: { published: [] },
        cachePolicy: { cacheScope: 'shared', ttlMs: 10 },
      }),
      /INVALID_CATALOG_CACHE_SCOPE/,
    )
  })

  it('refuses a negative or non-finite TTL with a named error', () => {
    for (const ttlMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () => normalizeCachePolicy({ ttlMs }),
        /INVALID_CATALOG_CACHE_TTL/,
        `ttlMs=${String(ttlMs)} must be refused`,
      )
    }
    assert.throws(
      () => createMcpHost({
        serverInfo: { name: 'test', version: '1.0.0' },
        surface: { published: [] },
        cachePolicy: { cacheScope: 'private', ttlMs: -5 },
      }),
      /INVALID_CATALOG_CACHE_TTL/,
      'host construction must refuse an invalid TTL',
    )
  })
})
