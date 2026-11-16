import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAuthoringLedger, MAX_AUTHORING_EVENTS } from '../src/authoring-ledger.ts'

describe('authoring ledger', () => {
  it('records value-free events and survives a reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'authoring-ledger-'))
    try {
      const file = join(dir, 'authoring-receipts.json')
      const ledger = createAuthoringLedger({ file })
      ledger.record({ operation: 'define', artifactKind: 'tool', name: 'agent_double' })
      ledger.record({ operation: 'run', artifactKind: 'workflow', name: 'double-value', durationMs: 12 })
      assert.deepEqual(ledger.list().map(event => [event.operation, event.name]), [
        ['define', 'agent_double'],
        ['run', 'double-value'],
      ])
      assert.equal(ledger.list()[0]?.receiptId.startsWith('ar_'), true)
      assert.deepEqual(createAuthoringLedger({ file }).list().map(event => event.name), ['agent_double', 'double-value'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('bounds retention and reports a corrupt file without hiding new events', () => {
    const dir = mkdtempSync(join(tmpdir(), 'authoring-ledger-'))
    try {
      const file = join(dir, 'authoring-receipts.json')
      const ledger = createAuthoringLedger({ file })
      for (let index = 0; index < MAX_AUTHORING_EVENTS + 5; index += 1) {
        ledger.record({ operation: 'save', artifactKind: 'workflow', name: 'wf-' + String(index) })
      }
      assert.equal(ledger.list().length, MAX_AUTHORING_EVENTS)
      assert.equal(ledger.list().at(-1)?.name, 'wf-' + String(MAX_AUTHORING_EVENTS + 4))
      const corrupt = createAuthoringLedger({ file: join(dir, 'bad.json') })
      assert.equal(corrupt.issue, undefined)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
