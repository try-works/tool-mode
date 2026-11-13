/**
 * Custom-tool schema and durable-store tests (plan Slice 1).
 *
 * These are deliberately transport-free: no host, no network, no model. They pin
 * the exact authoring record, version immutability and fail-closed store rules
 * before any tool can be registered.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CustomToolSchemaError,
  CustomToolStore,
  CustomToolStoreError,
  normalizeCustomToolDraft,
  validateCustomToolDraft,
} from '../src/custom-tools/index.ts'
import type { CustomToolDraft } from '../src/custom-tools/types.ts'
import { tempDir } from './helpers.ts'

function draft(overrides: Partial<CustomToolDraft> = {}): CustomToolDraft {
  return {
    id: 'custom.weather-lookup',
    name: 'custom_weather_lookup',
    title: 'Weather lookup',
    description: 'Use when the user asks for the current weather in a city.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name' } },
      required: ['city'],
      additionalProperties: false,
    },
    execution: {
      kind: 'http',
      http: {
        method: 'GET',
        url: 'https://api.example.com/weather?q={{city}}',
        headers: { Authorization: { secret: 'WEATHER_API_KEY' } },
      },
    },
    policy: {
      timeoutMs: 15_000,
      readOnly: true,
      networkOrigins: ['https://api.example.com'],
      agentExpose: true,
      mcpExpose: false,
    },
    examples: [{ title: 'Berlin', arguments: { city: 'Berlin' } }],
    ...overrides,
  }
}

describe('custom-tool draft validation', () => {
  it('accepts a complete HTTP draft and normalizes defaults', () => {
    const verdict = validateCustomToolDraft(draft())
    assert.equal(verdict.ok, true, JSON.stringify(verdict.issues))
    const normalized = normalizeCustomToolDraft(draft())
    assert.equal(normalized.name, 'custom_weather_lookup')
    assert.equal(normalized.policy.agentExpose, true)
    assert.equal(normalized.policy.mcpExpose, false)
    assert.deepEqual(normalized.policy.networkOrigins, ['https://api.example.com'])
  })

  it('requires the name to match the id and a custom_ prefix', () => {
    const badName = validateCustomToolDraft(draft({ name: 'weather_lookup' }))
    assert.equal(badName.ok, false)
    assert.ok(badName.issues.some(issue => issue.path === 'name'))
    const mismatch = validateCustomToolDraft(draft({ id: 'custom.weather', name: 'custom_other' }))
    assert.ok(mismatch.issues.some(issue => issue.path === 'name' && /must be custom_weather/.test(issue.message)))
  })

  it('requires an https URL and at least one exact origin for HTTP', () => {
    const insecure = draft({
      execution: { kind: 'http', http: { method: 'GET', url: 'http://example.com/{{city}}', headers: {} } },
    })
    assert.ok(validateCustomToolDraft(insecure).issues.some(issue => issue.path === 'execution.http.url'))
    const noOrigins = draft({ policy: { ...draft().policy, networkOrigins: [] } })
    assert.ok(validateCustomToolDraft(noOrigins).issues.some(issue => issue.path === 'policy.networkOrigins'))
    const pathOrigin = draft({ policy: { ...draft().policy, networkOrigins: ['https://api.example.com/v1'] } })
    assert.ok(validateCustomToolDraft(pathOrigin).issues.some(issue => issue.path === 'policy.networkOrigins'))
  })

  it('validates prompt and composite shapes', () => {
    const prompt = draft({
      execution: { kind: 'prompt', prompt: { template: 'Summarize {{text}}', maxOutputTokens: 200 } },
      policy: { ...draft().policy, networkOrigins: [] },
    })
    assert.equal(validateCustomToolDraft(prompt).ok, true)
    const composite = draft({
      execution: {
        kind: 'composite',
        composite: { steps: [{ tool: 'custom_weather_lookup', args: { city: '{{city}}' } }] },
      },
      policy: { ...draft().policy, networkOrigins: [] },
    })
    assert.equal(validateCustomToolDraft(composite).ok, true)
    const tooMany = draft({
      execution: {
        kind: 'composite',
        composite: { steps: Array.from({ length: 11 }, () => ({ tool: 'lang_detect', args: {} })) },
      },
      policy: { ...draft().policy, networkOrigins: [] },
    })
    assert.ok(validateCustomToolDraft(tooMany).issues.some(issue => issue.path === 'execution.composite.steps'))
  })

  it('throws one named error carrying every issue', () => {
    assert.throws(
      () => normalizeCustomToolDraft({ ...draft(), title: '', description: '' }),
      (error: unknown) => error instanceof CustomToolSchemaError
        && error.issues.some(issue => issue.path === 'title')
        && error.issues.some(issue => issue.path === 'description'),
    )
  })
})

describe('custom-tool durable store', () => {
  it('saves version 1, creates version 2 immutably, and toggles enabled', () => {
    const root = join(tempDir(), 'custom-tools')
    const store = new CustomToolStore({ rootDir: root, now: () => new Date('2026-10-25T12:00:00.000Z') })
    const first = store.save(draft())
    assert.equal(first.version, 1)
    assert.equal(first.enabled, true)
    assert.equal(store.list().length, 1)
    const versionOneFile = join(root, 'custom.weather-lookup', '1.json')
    const versionOneBytes = readFileSync(versionOneFile, 'utf8')
    const second = store.save(draft({ title: 'Weather lookup v2' }))
    assert.equal(second.version, 2)
    assert.equal(store.read('custom.weather-lookup')?.title, 'Weather lookup v2')
    assert.equal(readFileSync(versionOneFile, 'utf8'), versionOneBytes, 'version 1 is immutable')
    assert.equal(store.setEnabled('custom.weather-lookup', false).enabled, false)
    assert.equal(store.read('custom.weather-lookup')?.enabled, false)
    assert.deepEqual(store.listIds(), ['custom.weather-lookup'])
    assert.deepEqual(store.versions('custom.weather-lookup'), [1, 2])
  })

  it('fails closed on a corrupt index and refuses path-like ids', () => {
    const root = join(tempDir(), 'custom-tools')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'index.json'), '{"schemaVersion":1,"tools":{"../escape":{"activeVersion":1,"enabled":true,"updatedAt":"x"}}}')
    const store = new CustomToolStore({ rootDir: root })
    assert.throws(() => store.readIndex(), CustomToolStoreError)
    const clean = new CustomToolStore({ rootDir: join(tempDir(), 'clean') })
    assert.throws(() => clean.read('../escape'), CustomToolStoreError)
  })

  it('deletes the active pointer but keeps version files', () => {
    const root = join(tempDir(), 'custom-tools')
    const store = new CustomToolStore({ rootDir: root })
    store.save(draft())
    assert.equal(store.delete('custom.weather-lookup'), true)
    assert.equal(store.read('custom.weather-lookup'), undefined)
    assert.deepEqual(store.versions('custom.weather-lookup'), [1])
    assert.equal(store.delete('custom.weather-lookup'), false)
  })
})
