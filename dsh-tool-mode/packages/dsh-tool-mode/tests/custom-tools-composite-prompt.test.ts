/**
 * Prompt, composite and dispatch tests (plan Slice 4).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  CustomToolCompositeError,
  CustomToolPromptError,
  CustomToolStore,
  executeCompositeCustomTool,
  executeCustomTool,
  executePromptCustomTool,
} from '../src/custom-tools/index.ts'
import type { CustomToolDraft } from '../src/custom-tools/types.ts'
import { tempDir } from './helpers.ts'

function save(overrides: Partial<CustomToolDraft>) {
  const store = new CustomToolStore({ rootDir: join(tempDir(), 'store') })
  return store.save({
    id: 'custom.test',
    name: 'custom_test',
    title: 'Test',
    description: 'Test tool.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' }, city: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    execution: { kind: 'prompt', prompt: { template: 'Echo {{text}}', maxOutputTokens: 100 } },
    policy: {
      timeoutMs: 5_000,
      readOnly: true,
      networkOrigins: [],
      agentExpose: true,
      mcpExpose: false,
    },
    examples: [],
    ...overrides,
  })
}

describe('prompt executor', () => {
  it('interpolates one model call and passes model settings', async () => {
    const record = save({})
    let seen: unknown
    const value = await executePromptCustomTool(record, { text: 'hello' }, { signal: new AbortController().signal }, {
      runPrompt: async input => {
        seen = input
        return 'answer'
      },
    })
    assert.equal(value, 'answer')
    assert.deepEqual(seen, {
      prompt: 'Echo hello',
      maxOutputTokens: 100,
      signal: (seen as { signal: AbortSignal }).signal,
    })
  })

  it('refuses when no provider is composed', async () => {
    await assert.rejects(
      executePromptCustomTool(save({}), { text: 'x' }, { signal: new AbortController().signal }),
      (error: unknown) => error instanceof CustomToolPromptError && error.code === 'custom-tool-prompt-unavailable',
    )
  })

  it('names a missing template argument', async () => {
    await assert.rejects(
      executePromptCustomTool(save({}), {}, { signal: new AbortController().signal }, { runPrompt: async () => 'x' }),
      (error: unknown) => error instanceof CustomToolPromptError && error.code === 'custom-tool-prompt-template-invalid',
    )
  })
})

function composite(overrides: Partial<CustomToolDraft> = {}) {
  return save({
    execution: {
      kind: 'composite',
      composite: {
        steps: [
          { tool: 'lookup', args: { q: '{{city}}' } },
          { tool: 'format', args: { value: '{{steps.0.result}}', label: 'Weather' } },
        ],
      },
    },
    ...overrides,
  })
}

describe('composite executor', () => {
  it('runs steps sequentially, interpolates previous results and returns the last value', async () => {
    const calls: unknown[] = []
    const value = await executeCompositeCustomTool(composite(), { city: 'Berlin' }, { signal: new AbortController().signal }, {
      callTool: async (name, args) => {
        calls.push([name, args])
        return name === 'lookup' ? { temp: 12 } : `${args['label']}: ${args['value']}`
      },
    })
    assert.equal(value, 'Weather: {"temp":12}')
    assert.deepEqual(calls, [['lookup', { q: 'Berlin' }], ['format', { value: '{"temp":12}', label: 'Weather' }]])
  })

  it('supports an explicit output path', async () => {
    const record = save({
      execution: {
        kind: 'composite',
        composite: {
          steps: [{ tool: 'lookup', args: { q: '{{city}}' } }],
          output: 'steps.0.result.temp',
        },
      },
    })
    const value = await executeCompositeCustomTool(record, { city: 'Berlin' }, { signal: new AbortController().signal }, {
      callTool: async () => ({ temp: 12 }),
    })
    assert.equal(value, 12)
  })

  it('refuses a self-call and a denied approval', async () => {
    const self = save({
      execution: { kind: 'composite', composite: { steps: [{ tool: 'custom_test', args: {} }] } },
    })
    await assert.rejects(
      executeCompositeCustomTool(self, {}, { signal: new AbortController().signal }, { callTool: async () => null }),
      (error: unknown) => error instanceof CustomToolCompositeError && error.code === 'custom-tool-composite-step-invalid',
    )
    const protectedStep = save({
      execution: {
        kind: 'composite',
        composite: { steps: [{ tool: 'delete', args: {}, requiresApproval: true }] },
      },
    })
    await assert.rejects(
      executeCompositeCustomTool(protectedStep, {}, { signal: new AbortController().signal }, { callTool: async () => null }),
      (error: unknown) => error instanceof CustomToolCompositeError && error.code === 'custom-tool-composite-approval-denied',
    )
    await assert.rejects(
      executeCompositeCustomTool(protectedStep, {}, { signal: new AbortController().signal }, {
        callTool: async () => null,
        approve: async () => false,
      }),
      (error: unknown) => error instanceof CustomToolCompositeError && error.code === 'custom-tool-composite-approval-denied',
    )
  })

  it('wraps a failed step without losing the step name', async () => {
    await assert.rejects(
      executeCompositeCustomTool(composite(), { city: 'Berlin' }, { signal: new AbortController().signal }, {
        callTool: async () => { throw new Error('upstream down') },
      }),
      (error: unknown) => error instanceof CustomToolCompositeError
        && error.code === 'custom-tool-composite-failed'
        && /lookup/.test(error.message),
    )
  })
})

describe('custom-tool dispatch', () => {
  it('routes prompt and composite records to their executors', async () => {
    const prompt = save({})
    assert.equal(await executeCustomTool(prompt, { text: 'x' }, { signal: new AbortController().signal }, {
      prompt: { runPrompt: async () => 'prompt-result' },
    }), 'prompt-result')
    const pipeline = composite()
    assert.equal(await executeCustomTool(pipeline, { city: 'Berlin' }, { signal: new AbortController().signal }, {
      composite: {
        callTool: async (name, args) => name === 'lookup' ? { temp: 5 } : String(args['value']),
      },
    }), '{"temp":5}')
  })
})
