/**
 * P? authoring quality: the from-run inference, honest card examples and the
 * capture disclosure are the model-facing text/tools of agent authoring, so each
 * is pinned here rather than left to the caller.
 *
 * The rules these tests defend: a capture is SHAPE-ONLY (no input values, no
 * invented enums/defaults), a suggested tool name is always valid, a card example
 * is only ever text the author supplied (never a generated placeholder), and the
 * capture disclosure says what is retained and what is not.
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'

import {
  MAX_RUN_CAPTURES,
  createRunCaptureStore,
  type RunCapture,
} from '../src/run-capture.ts'
import {
  captureDisclosure,
  cardExample,
  inferRunInputSchema,
  suggestAgentName,
  type JsonObject,
} from '../src/authoring-quality.ts'
import { cleanup, tempDir } from './helpers.ts'

test.after(async () => { await cleanup() })

/** A minimal successful capture. */
function captureWith(inputSchema: JsonObject): RunCapture {
  return {
    runId: 'run-1',
    at: '2026-01-01T00:00:00.000Z',
    program: 'return await tools.lang_detect({ text: input.text })',
    tools: ['lang_detect'],
    inputSchema,
    contracts: ['text.language_detect'],
  }
}

test('inferRunInputSchema reports observed shape-only provenance', () => {
  const inferred = inferRunInputSchema(captureWith({
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  }))
  assert.equal(inferred.typed, false)
  assert.equal(inferred.schemaSource, 'observed')
  assert.equal(inferred.schemaCompleteness, 'observed')
  assert.deepEqual(inferred.schema, {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  })
})

test('inferRunInputSchema falls back to an empty object schema when the capture has none', () => {
  const inferred = inferRunInputSchema(captureWith({}))
  assert.deepEqual(inferred.schema, { type: 'object', properties: {} })
  assert.equal(inferred.typed, false)
  assert.equal(inferred.schemaSource, 'observed')
  assert.equal(inferred.schemaCompleteness, 'observed')
})

test('inferRunInputSchema never invents enums or defaults and keeps values out', () => {
  const source = { type: 'object', properties: { mode: { type: 'string' } } }
  const inferred = inferRunInputSchema(captureWith(source))
  const rendered = JSON.stringify(inferred.schema)
  assert.equal(rendered.includes('enum'), false)
  assert.equal(rendered.includes('default'), false)
  assert.equal(rendered.includes('secret-value'), false)
})

test('suggestAgentName always returns a valid bounded agent name', () => {
  const name = suggestAgentName('Run 12 / Weird:Id!!')
  assert.match(name, /^agent_[a-z0-9_]{2,60}$/)
  assert.ok(name.length <= 64)
  assert.ok(name.startsWith('agent_from_'))
  assert.equal(name, 'agent_from_run_12_weird_id')
  const long = suggestAgentName('x'.repeat(200))
  assert.ok(long.length <= 64)
  assert.match(long, /^agent_[a-z0-9_]{2,60}$/)
  const empty = suggestAgentName('')
  assert.match(empty, /^agent_[a-z0-9_]{2,60}$/)
  assert.ok(empty.length <= 64)
})

test('cardExample returns ONLY an explicit example, never a generated placeholder', () => {
  const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
  const omitted = cardExample({ name: 'agent_echo', inputSchema: schema })
  assert.equal(omitted.example, undefined)
  assert.equal(omitted.omittedReason, 'no-explicit-example')
  const explicit = '{"text":"hello"}'
  const supplied = cardExample({ name: 'agent_echo', inputSchema: schema, example: explicit })
  assert.equal(supplied.example, explicit)
  assert.equal(supplied.omittedReason, undefined)
  // The generated-placeholder defect: {"param":"example"} must never appear.
  assert.notEqual(supplied.example, JSON.stringify({ param: 'example' }))
})

test('cardExample refuses invalid JSON and a schema mismatch, with the reason', () => {
  const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
  const badJson = cardExample({ name: 'agent_echo', inputSchema: schema, example: '{not json' })
  assert.equal(badJson.example, undefined)
  assert.equal(badJson.omittedReason, 'invalid-example-json')
  const mismatch = cardExample({ name: 'agent_echo', inputSchema: schema, example: '{"text":42}' })
  assert.equal(mismatch.example, undefined)
  assert.equal(mismatch.omittedReason, 'example-schema-mismatch')
  const unknownKey = cardExample({ name: 'agent_echo', inputSchema: schema, example: '{"unknown":true}' })
  assert.equal(unknownKey.example, undefined)
  assert.equal(unknownKey.omittedReason, 'example-schema-mismatch')
})

test('captureDisclosure states what is retained locally and how to opt out', () => {
  const on = captureDisclosure({ captureRunPrograms: true, runCaptureFile: 'C:/state/run-captures.json' })
  assert.equal(on.enabled, true)
  assert.equal(on.file, 'C:/state/run-captures.json')
  assert.equal(on.maxCaptures, MAX_RUN_CAPTURES)
  assert.equal(on.optOut, true)
  assert.match(on.notice, /retained locally/i)
  assert.match(on.notice, /program text/i)
  assert.match(on.notice, /input values/i)
  assert.match(on.notice, /captureRunPrograms: false/i)
  const defaults = captureDisclosure({})
  assert.equal(defaults.enabled, true)
  assert.equal(defaults.file, null)
  const off = captureDisclosure({ captureRunPrograms: false })
  assert.equal(off.enabled, false)
  assert.match(off.notice, /disabled|captureRunPrograms: false/i)
})

test('a stored capture keeps its shape-only schema and optional provenance', () => {
  const file = join(tempDir(), 'run-captures.json')
  const store = createRunCaptureStore({ file })
  const recorded = store.record({
    runId: 'run-2',
    program: 'return 1',
    tools: [],
    inputSchema: { type: 'object', properties: {} },
    contracts: [],
    schemaSource: 'observed',
    schemaCompleteness: 'observed',
    capturedAt: '2026-01-02T00:00:00.000Z',
  })
  assert.ok(recorded !== undefined)
  assert.equal(recorded.schemaSource, 'observed')
  assert.equal(recorded.schemaCompleteness, 'observed')
  assert.equal(recorded.capturedAt, '2026-01-02T00:00:00.000Z')
  const readBack = createRunCaptureStore({ file }).get('run-2')
  assert.ok(readBack !== undefined)
  assert.equal(readBack.schemaSource, 'observed')
  assert.equal(readBack.capturedAt, '2026-01-02T00:00:00.000Z')
})
