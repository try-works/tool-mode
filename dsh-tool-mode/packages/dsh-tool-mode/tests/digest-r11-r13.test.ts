/**
 * R11/R13 — aggregate verification names the cheap route; evidence does not read as
 * correctness. Pure renderer tests (docs/fix-r11-r13-plan.md).
 * @module tests/digest-r11-r13
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildDirectiveDigest } from '../src/library-digest.ts'

const base = {
  name: 'agent_agg', callableName: 'agent_agg', description: 'Counts languages.',
  uses: 1, failures: 0, sessions: 0,
}

describe('R11 — the aggregate caveat names the cheapest executable route', () => {
  it('names one Code Mode program looping the declared nested tool', () => {
    const text = buildDirectiveDigest([{ ...base, verifiability: 'aggregate', nestedTools: ['lang_detect'] }])
    assert.match(text, /one Code Mode program looping lang_detect over the list/)
    assert.ok(!text.includes('one item at a time'), 'the worst measured route must never be named: ' + text)
  })

  it('names no route when the artifact declares none', () => {
    const text = buildDirectiveDigest([{ ...base, verifiability: 'aggregate' }])
    assert.match(text, /no per-item route is declared/)
    assert.ok(!text.includes('one item at a time'))
  })
})

describe('R13 — the evidence line measures completion, not correctness', () => {
  it('says "completed without a recorded error", not "Evidence"', () => {
    const text = buildDirectiveDigest([{ ...base, uses: 9, failures: 0, sessions: 1 }])
    assert.match(text, /Completed without a recorded error: 9 uses, 0 failures across 1 session/)
    assert.ok(!text.includes('Evidence:'), 'crash-free must not be advertised as evidence of correctness: ' + text)
  })
})
