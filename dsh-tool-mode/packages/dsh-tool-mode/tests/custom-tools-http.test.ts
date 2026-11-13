/**
 * HTTP custom-tool executor tests (plan Slice 3).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  CustomToolHttpError,
  CustomToolStore,
  executeHttpCustomTool,
  isPrivateAddress,
} from '../src/custom-tools/index.ts'
import type { CustomToolDraft } from '../src/custom-tools/types.ts'
import { tempDir } from './helpers.ts'

function record(overrides: Partial<CustomToolDraft> = {}) {
  const store = new CustomToolStore({ rootDir: join(tempDir(), 'store') })
  return store.save({
    id: 'custom.weather',
    name: 'custom_weather',
    title: 'Weather',
    description: 'Look up the weather for a city.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
      additionalProperties: false,
    },
    execution: {
      kind: 'http',
      http: {
        method: 'GET',
        url: 'https://api.example.com/weather?q={{city}}',
        headers: { Authorization: { secret: 'WEATHER_API_KEY' } },
        extract: 'current.temp',
      },
    },
    policy: {
      timeoutMs: 5_000,
      readOnly: true,
      networkOrigins: ['https://api.example.com'],
      agentExpose: true,
      mcpExpose: false,
    },
    examples: [],
    ...overrides,
  })
}

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

function jsonFetch(body: unknown, seen?: { headers?: Record<string, string>; url?: string; body?: string | null }) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (seen !== undefined) {
      seen.url = String(input)
      seen.headers = init?.headers as Record<string, string>
      seen.body = typeof init?.body === 'string' ? init.body : null
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

describe('private-address classification', () => {
  it('rejects loopback, private, link-local, metadata and mapped addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      assert.equal(isPrivateAddress(address), true, address)
    }
    for (const address of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) {
      assert.equal(isPrivateAddress(address), false, address)
    }
  })
})

describe('HTTP executor', () => {
  it('interpolates, resolves a secret, extracts JSON and never returns the secret', async () => {
    const tool = record()
    const seen: { headers?: Record<string, string>; url?: string; body?: string | null } = {}
    const value = await executeHttpCustomTool(
      tool,
      { city: 'New York' },
      { signal: new AbortController().signal },
      {
        lookup: publicLookup,
        resolveCredential: async name => name === 'WEATHER_API_KEY' ? 'super-secret' : undefined,
        fetchImpl: jsonFetch({ current: { temp: 19 } }, seen),
      },
    )
    assert.equal(value, 19)
    assert.equal(seen.url, 'https://api.example.com/weather?q=New%20York')
    assert.equal(seen.headers?.['Authorization'], 'super-secret')
    assert.equal(JSON.stringify(value).includes('super-secret'), false)
  })

  it('refuses a non-allowlisted origin and a private target', async () => {
    const denied = record({ policy: { ...record().policy, networkOrigins: ['https://other.example.com'] } })
    await assert.rejects(
      executeHttpCustomTool(denied, { city: 'x' }, { signal: new AbortController().signal }, { lookup: publicLookup }),
      (error: unknown) => error instanceof CustomToolHttpError && error.code === 'custom-tool-http-origin-denied',
    )
    const privateTool = record({
      execution: { kind: 'http', http: { method: 'GET', url: 'https://127.0.0.1/', headers: {} } },
      policy: { ...record().policy, networkOrigins: ['https://127.0.0.1'] },
    })
    await assert.rejects(
      executeHttpCustomTool(privateTool, {}, { signal: new AbortController().signal }),
      (error: unknown) => error instanceof CustomToolHttpError && error.code === 'custom-tool-http-private-address',
    )
  })

  it('refuses a missing credential without leaking a value', async () => {
    await assert.rejects(
      executeHttpCustomTool(record(), { city: 'x' }, { signal: new AbortController().signal }, {
        lookup: publicLookup,
        resolveCredential: async () => undefined,
        fetchImpl: jsonFetch({}),
      }),
      (error: unknown) => error instanceof CustomToolHttpError
        && error.code === 'custom-tool-http-credential-unavailable'
        && !error.message.includes('super-secret'),
    )
  })

  it('caps the response body', async () => {
    await assert.rejects(
      executeHttpCustomTool(record(), { city: 'x' }, { signal: new AbortController().signal }, {
        lookup: publicLookup,
        resolveCredential: async () => 'secret',
        maxResponseBytes: 4,
        fetchImpl: async () => new Response('0123456789', { status: 200, headers: { 'content-type': 'text/plain' } }),
      }),
      (error: unknown) => error instanceof CustomToolHttpError && error.code === 'custom-tool-http-response-too-large',
    )
  })

  it('refuses a public hostname that resolves to a private address', async () => {
    await assert.rejects(
      executeHttpCustomTool(record(), { city: 'x' }, { signal: new AbortController().signal }, {
        lookup: async () => [{ address: '10.0.0.7', family: 4 }],
        resolveCredential: async () => 'secret',
        fetchImpl: jsonFetch({}),
      }),
      (error: unknown) => error instanceof CustomToolHttpError && error.code === 'custom-tool-http-private-address',
    )
  })
})
