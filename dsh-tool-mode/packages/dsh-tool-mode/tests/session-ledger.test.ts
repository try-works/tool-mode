import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSessionLedger } from '../src/session-ledger.ts'

describe('session adoption ledger', () => {
  it('records offered/called/authored/reused and persists per session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-ledger-'))
    try {
      const file = join(dir, 'session-ledger.json')
      const ledger = createSessionLedger({ file })
      ledger.offered('s1', ['tool_mode_list', 'agent_double'])
      ledger.called('s1', 'tool_mode_list')
      ledger.called('s1', 'agent_double')
      ledger.authored('s1')
      const summary = ledger.summary('s1')
      assert.deepEqual(summary?.offered, ['tool_mode_list', 'agent_double'])
      assert.equal(summary?.called['agent_double'], 1)
      assert.equal(summary?.authored, 1)
      assert.equal(summary?.reused, 1)
      assert.equal(summary?.stepsSaved, null)
      assert.equal(ledger.summary('s2'), undefined)
      assert.deepEqual(createSessionLedger({ file }).summary('s1')?.called, { tool_mode_list: 1, agent_double: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
