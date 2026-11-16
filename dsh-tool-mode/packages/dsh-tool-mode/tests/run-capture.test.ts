import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRunCaptureStore, schemaShape } from '../src/run-capture.ts'

describe('run capture store', () => {
  it('stores a shape-only schema, never the values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-capture-'))
    try {
      const file = join(dir, 'run-captures.json')
      const store = createRunCaptureStore({ file })
      const shape = schemaShape({ path: '/secret/place/file.txt', count: 2, tags: ['a'] })
      const capture = store.record({
        runId: 'rcpt_1',
        program: 'return { count: input.count }',
        tools: ['read'],
        inputSchema: shape,
        contracts: ['read'],
      })
      assert.ok(capture !== undefined)
      const text = readFileSync(file, 'utf8')
      assert.equal(text.includes('/secret/place/file.txt'), false, 'the value must not be stored')
      assert.equal(text.includes('file.txt'), false)
      assert.deepEqual(store.get('rcpt_1')?.inputSchema, {
        type: 'object',
        properties: { path: { type: 'string' }, count: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } },
        required: ['path', 'count', 'tags'],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is empty and honest when nothing has been captured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-capture-'))
    try {
      const store = createRunCaptureStore({ file: join(dir, 'none.json') })
      assert.deepEqual(store.list(), [])
      assert.equal(store.get('missing'), undefined)
      assert.equal(store.issue, undefined)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
