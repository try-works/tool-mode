/**
 * Custom-tool compiler and runtime registration tests (plan Slice 2).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  CustomToolRegistrar,
  CustomToolStore,
  compileCustomTool,
} from '../src/custom-tools/index.ts'
import type { CustomToolDraft } from '../src/custom-tools/types.ts'
import { tempDir } from './helpers.ts'

function draft(overrides: Partial<CustomToolDraft> = {}): CustomToolDraft {
  return {
    id: 'custom.echo',
    name: 'custom_echo',
    title: 'Echo',
    description: 'Echo the supplied text back to the caller.',
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

interface FakeDefinition {
  name: string
  description: string
  timeoutMs?: number
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

class FakeTools {
  readonly definitions = new Map<string, FakeDefinition>()
  register(definition: unknown): () => void {
    const tool = definition as FakeDefinition
    if (this.definitions.has(tool.name)) throw new Error(`duplicate ${tool.name}`)
    this.definitions.set(tool.name, tool)
    return () => { this.definitions.delete(tool.name) }
  }

  get(name: string): unknown {
    return this.definitions.get(name)
  }
}

describe('custom-tool compiler', () => {
  it('emits the registry fields and routes execute through the executor', async () => {
    const store = new CustomToolStore({ rootDir: join(tempDir(), 'store') })
    const record = store.save(draft())
    const calls: unknown[] = []
    const definition = compileCustomTool(record, async (seen, args, context) => {
      calls.push([seen.id, args, context.signal.aborted])
      return { echoed: args['text'] }
    }) as unknown as FakeDefinition
    assert.equal(definition.name, 'custom_echo')
    assert.equal(definition.description, draft().description)
    assert.equal(definition.timeoutMs, 5_000)
    const controller = new AbortController()
    const value = await definition.execute({ text: 'hello' }, { signal: controller.signal })
    assert.deepEqual(value, { echoed: 'hello' })
    assert.deepEqual(calls, [['custom.echo', { text: 'hello' }, false]])
  })
})

describe('custom-tool registrar', () => {
  it('registers enabled tools and skips disabled or agent-hidden ones', () => {
    const store = new CustomToolStore({ rootDir: join(tempDir(), 'store') })
    store.save(draft())
    store.save(draft({ id: 'custom.hidden', name: 'custom_hidden', title: 'Hidden', policy: { ...draft().policy, agentExpose: false } }))
    store.save(draft({ id: 'custom.off', name: 'custom_off', title: 'Off' }))
    store.setEnabled('custom.off', false)
    const tools = new FakeTools()
    const registrar = new CustomToolRegistrar({ store, tools, execute: async () => 'ok' })
    const result = registrar.sync()
    assert.deepEqual(result.registered.map(entry => entry.id), ['custom.echo'])
    assert.deepEqual(result.skipped.map(entry => `${entry.id}:${entry.reason}`).sort(), [
      'custom.hidden:not-agent-exposed',
      'custom.off:disabled',
    ])
    assert.deepEqual([...tools.definitions.keys()], ['custom_echo'])
  })

  it('replaces a live version and restores on a second registrar', () => {
    const root = join(tempDir(), 'store')
    const store = new CustomToolStore({ rootDir: root })
    store.save(draft())
    const firstTools = new FakeTools()
    const first = new CustomToolRegistrar({ store, tools: firstTools, execute: async () => 'v1' })
    assert.equal(first.sync().registered[0]?.version, 1)
    assert.ok(first.dispose('custom.echo'))
    assert.equal(firstTools.definitions.size, 0)

    store.save(draft({ title: 'Echo v2' }))
    const secondTools = new FakeTools()
    const second = new CustomToolRegistrar({ store, tools: secondTools, execute: async () => 'v2' })
    const result = second.sync()
    assert.equal(result.registered[0]?.version, 2)
    assert.equal(second.get('custom.echo')?.version, 2)
    assert.equal(secondTools.definitions.get('custom_echo')?.description, draft().description)
  })

  it('refuses a name collision with another owner and reports it without stopping others', () => {
    const store = new CustomToolStore({ rootDir: join(tempDir(), 'store') })
    store.save(draft())
    const tools = new FakeTools()
    tools.register({ name: 'custom_echo', description: 'other', execute: async () => null })
    const registrar = new CustomToolRegistrar({ store, tools, execute: async () => 'ok' })
    const result = registrar.sync()
    assert.equal(result.registered.length, 0)
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0]?.reason ?? '', /custom-tool-name-conflict/)
    assert.equal(registrar.list().length, 0)
  })

  it('disposeAll removes every live definition', () => {
    const store = new CustomToolStore({ rootDir: join(tempDir(), 'store') })
    store.save(draft())
    const tools = new FakeTools()
    const registrar = new CustomToolRegistrar({ store, tools, execute: async () => 'ok' })
    registrar.sync()
    registrar.disposeAll()
    assert.equal(tools.definitions.size, 0)
    assert.deepEqual(registrar.list(), [])
  })
})
