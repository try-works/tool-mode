/**
 * S4 — the external MCP call ledger (plan §3.4).
 *
 * Native agent calls live in session logs; external MCP `tools/call`s do not. The host
 * appends one bounded JSONL row per external call, carrying identity, timings, failure
 * class, sizes and the receipt id — and deliberately no arguments, results or token.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { InvocationAccounting } from '../src/invocation-accounting.ts'
import { McpUsageLedger, recordFromAccounting, type McpCallRecord } from '../src/mcp-usage.ts'
import { tempDir } from './helpers.ts'

const ACCOUNTING: InvocationAccounting = {
  receiptId: 'receipt-1',
  timings: { queuedMs: 1, loadMs: 2, inferenceMs: 3, totalMs: 6 },
  sizes: { inputBytes: 11, outputBytes: 22, assetBytes: 0 },
  failureClass: 'none',
  reason: null,
  timingSource: 'measured',
  measuredOn: { platform: 'win32', architecture: 'x64', nodeVersion: 'v24.0.0', engineVersion: 'test' },
  grantId: 'external:alpha',
  clientId: 'alpha',
}

/** One synthetic ledger row. */
function call(index: number, overrides: Partial<McpCallRecord> = {}): McpCallRecord {
  return {
    time: 1_000 + index,
    tool: 'read',
    clientId: 'alpha',
    grantId: 'external:alpha',
    totalMs: 10 + index,
    queuedMs: 0,
    loadMs: 0,
    inferenceMs: 10 + index,
    failureClass: 'none',
    reason: null,
    inputBytes: 5,
    outputBytes: 6,
    receiptId: `r${index}`,
    ...overrides,
  }
}

describe('S4 ledger records', () => {
  it('maps accounting to a row that carries identity and has no payload fields', () => {
    const row = recordFromAccounting('lang_detect', ACCOUNTING, 1_234)
    assert.deepEqual(Object.keys(row).sort(), [
      'clientId', 'failureClass', 'grantId', 'inferenceMs', 'inputBytes', 'loadMs',
      'outputBytes', 'queuedMs', 'reason', 'receiptId', 'time', 'tool', 'totalMs',
    ].sort())
    assert.equal(row.tool, 'lang_detect')
    assert.equal(row.clientId, 'alpha')
    assert.equal(row.receiptId, 'receipt-1')
    assert.equal(row.totalMs, 6)
    const serialized = JSON.stringify(row)
    assert.equal(serialized.includes('arguments'), false)
    assert.equal(serialized.includes('token'), false)
  })

  it('appends JSONL and reads newest-first with a client filter and pagination', () => {
    const file = join(tempDir(), 'mcp-usage.jsonl')
    const ledger = new McpUsageLedger(file, { maxRows: 100 })
    ledger.record(call(1))
    ledger.record(call(2))
    ledger.record(call(3, { clientId: 'beta', grantId: 'external:beta', failureClass: 'failed' }))
    assert.equal(existsSync(file), true)
    assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 3)

    const page = ledger.read({ page: 1, pageSize: 2 })
    assert.equal(page.total, 3)
    assert.equal(page.calls.length, 2)
    assert.deepEqual(page.calls.map(row => row.receiptId), ['r3', 'r2'])
    assert.deepEqual(page.clients, ['alpha', 'beta'])

    const filtered = ledger.read({ clientId: 'beta', page: 1, pageSize: 10 })
    assert.equal(filtered.total, 1)
    assert.equal(filtered.calls[0]?.receiptId, 'r3')

    const second = ledger.read({ page: 2, pageSize: 2 })
    assert.deepEqual(second.calls.map(row => row.receiptId), ['r1'])
    assert.deepEqual(ledger.read({ page: 99, pageSize: 2 }).calls, [], 'an out-of-range page is empty, not clamped to a wrong page')
  })

  it('skips a corrupt line instead of failing the whole ledger', () => {
    const file = join(tempDir(), 'mcp-usage.jsonl')
    const ledger = new McpUsageLedger(file, { maxRows: 100 })
    ledger.record(call(1))
    writeFileSync(file, `${readFileSync(file, 'utf8')}{not json}\n${JSON.stringify(call(2))}\n`)
    const page = ledger.read()
    assert.equal(page.total, 2)
    assert.deepEqual(page.calls.map(row => row.receiptId).sort(), ['r1', 'r2'])
  })

  it('trims the file at the bound, keeping the newest rows', () => {
    const file = join(tempDir(), 'mcp-usage.jsonl')
    const ledger = new McpUsageLedger(file, { maxRows: 4 })
    for (let index = 1; index <= 6; index += 1) ledger.record(call(index))
    const page = ledger.read()
    assert.equal(page.total, 4)
    assert.deepEqual(page.calls.map(row => row.receiptId), ['r6', 'r5', 'r4', 'r3'])
    assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 4)
  })

  it('summarizes clients and tools truthfully from the ledger', () => {
    const file = join(tempDir(), 'mcp-usage.jsonl')
    const ledger = new McpUsageLedger(file, { maxRows: 100 })
    ledger.record(call(1))
    ledger.record(call(2, { failureClass: 'timeout' }))
    ledger.record(call(3, { tool: 'lang_detect', clientId: 'beta', grantId: 'external:beta' }))
    const summary = ledger.summarize()
    assert.equal(summary.total, 3)
    assert.deepEqual(summary.clients.map(client => [client.clientId, client.calls, client.errors, client.lastSeen]), [
      ['alpha', 2, 1, 1_002],
      ['beta', 1, 0, 1_003],
    ])
    assert.deepEqual(summary.tools.map(tool => [tool.tool, tool.calls]), [['read', 2], ['lang_detect', 1]])
  })
})
