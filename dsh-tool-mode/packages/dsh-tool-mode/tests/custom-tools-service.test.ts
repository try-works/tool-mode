/**
 * Custom-tools host service tests (plan Slice 4b): save/test/enable/delete and
 * credential wiring through the same dispatch the tool will use.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  CustomToolRegistrar,
  CustomToolStore,
  CustomToolsService,
} from '../src/custom-tools/index.ts'
import type { CustomToolDraft } from '../src/custom-tools/types.ts'
import { tempDir } from './helpers.ts'

function draft(overrides: Partial<CustomToolDraft> = {}): CustomToolDraft {
  return {
    id: 'custom.echo',
    name: 'custom_echo',
    title: 'Echo',
    description: 'Echo the supplied text.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    execution: { kind: 'prompt', prompt: { template: '{{text}}' } },
    policy: {
      timeoutMs: 5_000,
      readOnly: true,
      networkOrigins: [],
      agentExpose: true,
      mcpExpose: false,
    },
    examples: [],
    ...overrides,
  }
}

function fakeTools() {
  const definitions = new Map<string, unknown>()
  return {
    definitions,
    get: (name: string) => definitions.get(name),
    register: (definition: unknown) => {
      const name = (definition as { name: string }).name
      if (definitions.has(name)) throw new Error(`duplicate ${name}`)
      definitions.set(name, definition)
      return () => { definitions.delete(name) }
    },
  }
}

function service(prompt: (input: { prompt: string }) => Promise<string> = async input => input.prompt) {
  const tools = fakeTools()
  const store = new CustomToolStore({ rootDir: join(tempDir(), 'store') })
  const registrar = new CustomToolRegistrar({ store, tools, execute: async () => 'executed' })
  const dispatch = {
    prompt: { runPrompt: async (input: { prompt: string }) => prompt(input) },
    http: {
      resolveCredential: async () => 'secret',
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    },
  }
  return {
    tools,
    store,
    registrar,
    svc: new CustomToolsService({ store, registrar, dispatch }),
  }
}

describe('custom-tools service', () => {
  it('saves, describes, tests and disables without leaking definitions', async () => {
    const { svc, tools } = service()
    const record = svc.save(draft())
    assert.equal(record.version, 1)
    const snapshot = svc.describe()
    assert.equal(snapshot.tools.length, 1)
    assert.equal(snapshot.tools[0]?.name, 'custom_echo')
    assert.equal('execution' in snapshot.tools[0]!, false)
    const test = await svc.test(draft(), { text: 'hello' })
    assert.deepEqual(test, { ok: true, value: 'hello' })
    assert.equal(svc.store.list().length, 1, 'test did not persist a second record')
    assert.equal(svc.get('custom.echo')?.name, 'custom_echo')
    svc.setEnabled('custom.echo', false)
    assert.equal(tools.definitions.size, 0)
    assert.equal(svc.describe().tools[0]?.enabled, false)
  })

  it('returns a named test failure when the prompt provider is unavailable', async () => {
    const { svc } = service()
    const missing = new CustomToolsService({
      store: svc.store,
      registrar: svc.registrar,
      dispatch: {},
    })
    const result = await missing.test(draft(), { text: 'x' })
    assert.equal(result.ok, false)
    assert.equal(result.error?.code, 'custom-tool-prompt-unavailable')
  })

  it('wires credential resolution into the HTTP test path', async () => {
    const { store, registrar } = service()
    const svc = new CustomToolsService({
      store,
      registrar,
      dispatch: {
        http: {
          lookup: async () => [{ address: '93.184.216.34', family: 4 }],
          resolveCredential: async name => name === 'WEATHER_API_KEY' ? 'secret' : undefined,
          fetchImpl: async (_input, init) => {
            assert.equal((init?.headers as Record<string, string>)['Authorization'], 'secret')
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
          },
        },
      },
    })
    const http = draft({
      execution: {
        kind: 'http',
        http: {
          method: 'GET',
          url: 'https://api.example.com/weather?q={{text}}',
          headers: { Authorization: { secret: 'WEATHER_API_KEY' } },
        },
      },
      policy: { ...draft().policy, networkOrigins: ['https://api.example.com'] },
    })
    const result = await svc.test(http, { text: 'Berlin' })
    assert.equal(result.ok, true)
    assert.deepEqual(result.value, { ok: true })
  })

  it('deletes the active tool and registration', () => {
    const { svc, tools } = service()
    svc.save(draft())
    assert.equal(tools.definitions.size, 1)
    assert.equal(svc.delete('custom.echo'), true)
    assert.equal(tools.definitions.size, 0)
    assert.deepEqual(svc.describe().tools, [])
  })

  it('asks the host model for a validated draft and never persists it', async () => {
    const { store, registrar } = service()
    const svc = new CustomToolsService({
      store,
      registrar,
      draftModel: async () => `Here is the draft:\n${JSON.stringify(draft())}\nDone.`,
    })
    const result = await svc.draft('Echo text back')
    assert.equal(result.ok, true)
    assert.equal(result.draft?.name, 'custom_echo')
    assert.equal(svc.describe().tools.length, 0)
    assert.equal(store.listIds().length, 0)
  })

  it('refuses an invalid agent draft and an absent model', async () => {
    const { store, registrar } = service()
    const missing = new CustomToolsService({ store, registrar })
    assert.equal((await missing.draft('x')).error?.code, 'custom-tool-draft-unavailable')
    const invalid = new CustomToolsService({ store, registrar, draftModel: async () => 'no json here' })
    assert.equal((await invalid.draft('x')).error?.code, 'custom-tool-draft-invalid')
  })
})
