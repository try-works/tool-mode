/**
 * S5 — the MCP surface status (plan §3.4, page MCP tab; client contract in
 * `docs/tool-insights/host-contract.md`).
 *
 * The status is derived from real facts only: the bound endpoint (or its absence), the
 * configured `mcpV3` values, the credential store's client identities, the ledger's
 * observed clients and the actual export surface. A disabled endpoint never renders a
 * fabricated listening state, and the token VALUE has no field to travel in.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buildMcpStatus } from '../src/mcp-status.ts'

const LEDGER = {
  total: 3,
  clients: [
    { clientId: 'alpha', grantId: 'external:alpha', calls: 2, errors: 1, lastSeen: 2_000 },
    { clientId: 'beta', grantId: 'external:beta', calls: 1, errors: 0, lastSeen: 3_000 },
  ],
  tools: [{ tool: 'read', calls: 3 }],
}

const CONFIGURED = { host: '127.0.0.1', port: 3865, path: '/mcp' }
const ENDPOINT = { host: '127.0.0.1', port: 3865, url: 'http://127.0.0.1:3865/mcp' }

describe('S5 MCP status', () => {
  it('reports a disabled endpoint without fabricating a listening state', () => {
    const status = buildMcpStatus({
      enabled: false,
      configured: CONFIGURED,
      endpoint: null,
      authMode: 'static-token',
      tokenFile: 'D:/secrets/mcp.token',
      published: ['read', 'lang_detect'],
      withheld: [],
      credentialClients: [],
      staticClientId: 'host',
      startedAt: null,
      ledger: LEDGER,
    })
    assert.equal(status.enabled, false)
    assert.equal(status.listening, false)
    assert.equal(status.endpoint, null)
    assert.equal(status.configured?.port, 3865, 'the configured port is a config fact, not a listening claim')
    assert.deepEqual(status.exposed, [])
    assert.equal(status.uptimeMs, 0)
  })

  it('reports the actual bound port and path, never 3765 or 3080', () => {
    const status = buildMcpStatus({
      enabled: true,
      configured: CONFIGURED,
      endpoint: ENDPOINT,
      authMode: 'static-token',
      tokenFile: null,
      published: ['read', 'lang_detect', 'model_tools'],
      withheld: [],
      credentialClients: [],
      staticClientId: 'host',
      startedAt: 1_000,
      now: 6_000,
      ledger: LEDGER,
    })
    assert.equal(status.listening, true)
    assert.deepEqual(status.endpoint, { host: '127.0.0.1', port: 3865, path: '/mcp', url: 'http://127.0.0.1:3865/mcp' })
    assert.equal(status.uptimeMs, 5_000)
  })

  it('shows one truthful client for a single static token and adds named credential clients', () => {
    const staticOnly = buildMcpStatus({
      enabled: true,
      configured: CONFIGURED,
      endpoint: ENDPOINT,
      authMode: 'static-token',
      tokenFile: null,
      published: ['read'],
      withheld: [],
      credentialClients: [],
      staticClientId: 'host',
      startedAt: null,
      ledger: { total: 0, clients: [], tools: [] },
    })
    assert.deepEqual(staticOnly.clients.map(client => client.id), ['host'])
    assert.equal(staticOnly.clients[0]?.calls, 0)
    assert.equal(staticOnly.clients[0]?.lastSeen, null)

    const named = buildMcpStatus({
      enabled: true,
      configured: CONFIGURED,
      endpoint: ENDPOINT,
      authMode: 'static-token',
      tokenFile: null,
      published: ['read'],
      withheld: [],
      credentialClients: ['cursor'],
      staticClientId: 'host',
      startedAt: null,
      ledger: LEDGER,
    })
    assert.deepEqual(named.clients.map(client => client.id), ['alpha', 'beta', 'cursor', 'host'])
    assert.deepEqual(named.clients.find(client => client.id === 'alpha'), {
      clientId: 'alpha', id: 'alpha', label: 'alpha', grantId: 'external:alpha', calls: 2, errors: 1, lastSeen: 2_000,
    })
    assert.equal(named.clients.find(client => client.id === 'cursor')?.grantId, null)
  })

  it('derives exposed/withheld from the real export surface and always withholds model_tools', () => {
    const status = buildMcpStatus({
      enabled: true,
      configured: CONFIGURED,
      endpoint: ENDPOINT,
      authMode: 'static-token',
      tokenFile: null,
      published: ['read', 'lang_detect', 'model_tools'],
      withheld: ['unstable_tool'],
      credentialClients: [],
      staticClientId: 'host',
      startedAt: null,
      ledger: { total: 0, clients: [], tools: [] },
    })
    assert.equal(status.exposedCount, 2)
    assert.deepEqual(status.exposed, ['lang_detect', 'read'])
    assert.equal(status.withheldCount, 2)
    assert.deepEqual(status.withheld, ['model_tools', 'unstable_tool'])
  })

  it('names the token FILE path but never carries a token value', () => {
    const status = buildMcpStatus({
      enabled: true,
      configured: CONFIGURED,
      endpoint: ENDPOINT,
      authMode: 'static-token',
      tokenFile: 'D:/secrets/mcp.token',
      published: ['read'],
      withheld: [],
      credentialClients: [],
      staticClientId: 'host',
      startedAt: null,
      ledger: { total: 0, clients: [], tools: [] },
    })
    assert.equal(status.auth.tokenFile, 'D:/secrets/mcp.token')
    assert.deepEqual(Object.keys(status.auth).sort(), ['mode', 'scheme', 'tokenFile'])
    assert.equal(JSON.stringify(status).includes('bearer'), false)
  })
})
