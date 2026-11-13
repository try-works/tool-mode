/**
 * Custom-tool MCP publication tests: agent exposure and MCP exposure are
 * separate, and a non-exportable tool is withheld with a reason.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { CustomToolStore, customToolPublishedTools } from '../src/custom-tools/index.ts'
import type { CustomToolDraft } from '../src/custom-tools/types.ts'
import { tempDir } from './helpers.ts'

function record(overrides: Partial<CustomToolDraft> = {}) {
  const store = new CustomToolStore({ rootDir: join(tempDir(), 'store') })
  return store.save({
    id: 'custom.weather',
    name: 'custom_weather',
    title: 'Weather',
    description: 'Look up weather.',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { temp: { type: 'number' } }, additionalProperties: false },
    execution: { kind: 'prompt', prompt: { template: '{{city}}' } },
    policy: { timeoutMs: 5_000, readOnly: true, networkOrigins: [], agentExpose: true, mcpExpose: false },
    examples: [],
    ...overrides,
  })
}

describe('custom-tool MCP surface', () => {
  it('withholds a tool while MCP exposure is off', () => {
    const [row] = customToolPublishedTools([record()])
    assert.ok(row !== undefined)
    assert.equal(row.toolName, 'custom_weather')
    assert.match(row.notExportableReason ?? '', /MCP exposure is off/)
  })

  it('exports an opted-in tool with a declared output schema', () => {
    const [row] = customToolPublishedTools([record({
      policy: { ...record().policy, mcpExpose: true },
    })])
    assert.ok(row !== undefined)
    assert.equal(row.notExportableReason, undefined)
    assert.equal(row.contract.contract, 'custom.weather')
    assert.deepEqual(row.contract.outputSchema, {
      type: 'object', properties: { temp: { type: 'number' } }, additionalProperties: false,
    })
  })

  it('withholds an opted-in tool that declares no output schema', () => {
    const noOutput = record({ policy: { ...record().policy, mcpExpose: true } })
    const recordWithoutSchema = { ...noOutput }
    delete (recordWithoutSchema as { outputSchema?: unknown }).outputSchema
    const [row] = customToolPublishedTools([recordWithoutSchema])
    assert.ok(row !== undefined)
    assert.match(row.notExportableReason ?? '', /no output schema/)
  })
})
