/**
 * operations[]: one catalog model, several callable tools, one card.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadCatalog, modelOperations } from '../src/catalog.ts'
import { registerModelTool } from '../src/registrar.ts'
import { describeModels } from '../src/index.ts'
import { resolveCapability } from '../src/capability.ts'
import type { ModelAdapter } from '../src/adapters/index.ts'

function catalogFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'model-operations-'))
  const entry = {
    id: 'multi',
    name: 'Multi',
    summary: 'A test model with two operations.',
    capability: 'text.test',
    contract: null,
    input: 'text',
    output: 'An operation result.',
    languages: null,
    modelSizeMB: 1,
    appleOnly: false,
    closedBeta: false,
    verifiedRunnableOnWindows: true,
    windowsSupport: 'native-node',
    npmPackage: null,
    npmSubpath: null,
    requiresRuntime: [],
    cliVerb: null,
    license: 'test',
    docsUrl: 'https://example.invalid/',
    hfRepo: 'https://example.invalid/',
    tool: {
      name: 'multi_one',
      description: 'First operation.',
      params: { text: 'Input text.' },
      returns: 'First result.',
    },
    operations: [
      {
        id: 'one',
        contract: null,
        tool: {
          name: 'multi_one',
          description: 'First operation.',
          params: { text: 'Input text.' },
          returns: 'First result.',
        },
      },
      {
        id: 'two',
        contract: null,
        tool: {
          name: 'multi_two',
          description: 'Second operation.',
          params: { text: 'Input text.', limit: { description: 'How many.', type: 'integer' } },
          returns: 'Second result.',
        },
      },
    ],
    skill: { name: 'multi-skill', description: 'Multi skill.' },
  }
  const file = join(dir, 'catalog.json')
  writeFileSync(file, JSON.stringify([entry]))
  return file
}

describe('catalog operations[]', () => {
  it('parses both operations and exposes them on the capability card', () => {
    const [entry] = loadCatalog(catalogFile())
    assert.ok(entry !== undefined)
    assert.equal(modelOperations(entry).length, 2)
    const verdict = resolveCapability(entry, { resolve: () => false, platform: 'win32', cliAvailable: false })
    const [card] = describeModels([{ entry, verdict }])
    assert.ok(card !== undefined)
    assert.deepEqual(card.operations.map(operation => operation.tool), ['multi_one', 'multi_two'])
    assert.deepEqual(card.operations[1]?.parameters.map(parameter => parameter.name), ['text', 'limit'])
    assert.deepEqual(card.operations[1]?.inputSchema.required, [])
    assert.equal((card.operations[1]?.inputSchema.properties as Record<string, unknown>).limit !== undefined, true)
  })

  it('registers each operation as its own callable tool', async () => {
    const [entry] = loadCatalog(catalogFile())
    assert.ok(entry !== undefined)
    const definitions = new Map<string, { execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown> }>()
    const ctx = {
      tools: {
        register(definition: { name: string }) {
          definitions.set(definition.name, definition as unknown as { execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown> })
          return () => { definitions.delete(definition.name) }
        },
      },
    }
    const seen: string[] = []
    const adapter: ModelAdapter = {
      modelId: entry.id,
      async invoke(invocation) {
        seen.push(invocation.operationId ?? 'missing')
        return { operation: invocation.operationId ?? 'missing' }
      },
    }
    for (const operation of modelOperations(entry)) {
      registerModelTool(ctx as never, entry, adapter, {}, operation)
    }
    assert.deepEqual([...definitions.keys()].sort(), ['multi_one', 'multi_two'])
    const value = await definitions.get('multi_two')!.execute(
      { text: 'hello', limit: 2 },
      { signal: new AbortController().signal },
    )
    assert.deepEqual(value, { operation: 'two' })
    assert.deepEqual(seen, ['two'])
  })
})
