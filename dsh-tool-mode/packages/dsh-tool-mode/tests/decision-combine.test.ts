/**
 * `decision_combine` — code composes atomic judgments and facts with an explicit
 * trace. These tests never call a model (the article's split: Jev judges, code decides).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { combineDecision, parseDecisionPolicy } from '../src/decision-combine.ts'
import { mountPlugin } from './helpers.ts'

const rules = [
  {
    id: 'fraud',
    when: [{ source: 'judgment', key: 'reports_unauthorized', op: 'gte', value: 0.6 }],
    exit: 'fraud_team',
  },
  {
    id: 'refund-small',
    when: [
      { source: 'judgment', key: 'wants_money_back', op: 'gte', value: 0.5 },
      { source: 'fact', key: 'refund_eligible', op: 'truthy' },
      { source: 'fact', key: 'amount', op: 'lte', value: 25 },
    ],
    exit: 'refund_now',
  },
]

describe('decision_combine — code makes decisions', () => {
  it('returns the first matching rule with the full evaluated trace', () => {
    const result = combineDecision(
      { refund_eligible: true, amount: 20 },
      { reports_unauthorized: 0.94, wants_money_back: 0.99 },
      rules,
      'answer',
    )
    assert.equal(result.exit, 'fraud_team')
    assert.equal(result.fallback, false)
    assert.equal(result.trace.length, 1)
    assert.equal(result.trace[0]?.rule, 'fraud')
    assert.equal(result.trace[0]?.checks[0]?.passed, true)
  })

  it('shows every condition of a non-matching rule, not just the first failure', () => {
    const result = combineDecision(
      { refund_eligible: true, amount: 240 },
      { reports_unauthorized: 0.1, wants_money_back: 0.99 },
      rules,
      'answer',
    )
    assert.equal(result.exit, 'answer')
    assert.equal(result.fallback, true)
    assert.equal(result.trace.length, 2)
    assert.deepEqual(result.trace[1]?.checks.map(check => check.passed), [true, true, false])
    assert.equal(result.trace[1]?.checks[2]?.actual, 240)
  })

  it('is domain-neutral: a release gate uses the same shape', () => {
    const result = combineDecision(
      { tests_green: true, changed_files: 2 },
      { intent_is_clear: 0.93, is_high_risk: 0.12 },
      [
        { id: 'block', when: [{ source: 'judgment', key: 'is_high_risk', op: 'gte', value: 0.75 }], exit: 'block' },
        { id: 'merge', when: [
          { source: 'fact', key: 'tests_green', op: 'truthy' },
          { source: 'judgment', key: 'intent_is_clear', op: 'gte', value: 0.8 },
          { source: 'fact', key: 'changed_files', op: 'lte', value: 10 },
        ], exit: 'merge' },
      ],
      'review',
    )
    assert.equal(result.exit, 'merge')
    assert.equal(result.trace.length, 2)
  })

  it('treats a missing judgment/fact as a failed check and records null', () => {
    const result = combineDecision({}, {}, rules, 'answer')
    assert.equal(result.exit, 'answer')
    assert.equal(result.trace[0]?.checks[0]?.actual, null)
    assert.equal(result.trace[0]?.checks[0]?.passed, false)
  })

  it('refuses malformed policies instead of silently widening them', () => {
    assert.throws(() => parseDecisionPolicy({}, {}, []), /1–64/)
    assert.throws(() => parseDecisionPolicy({}, { p: 1.1 }, rules), /probability/)
    assert.throws(() => parseDecisionPolicy({}, {}, [{ id: 'x', when: [], exit: 'y' }]), /when/)
    assert.throws(() => parseDecisionPolicy({}, {}, [{ id: 'x', when: [{ source: 'model', key: 'p', op: 'eq', value: 1 }], exit: 'y' }]), /source/)
    assert.throws(() => combineDecision({}, {}, rules, ''), /fallback/)
  })
})

describe('decision_combine — host tool', () => {
  it('is registered and returns the trace through the real tool runtime', async () => {
    const ctx = await mountPlugin()
    try {
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: 'decision_combine_test' as never,
        name: 'decision_combine',
        arguments: {
          facts: { refund_eligible: false, amount: 240 },
          judgments: { reports_unauthorized: 0.94 },
          rules: [{ id: 'fraud', when: [{ source: 'judgment', key: 'reports_unauthorized', op: 'gte', value: 0.6 }], exit: 'fraud_team' }],
          fallback: 'answer',
        },
      })
      assert.equal(result.isError, false)
      const value = result.value as { exit: string; trace: { rule: string }[] }
      assert.equal(value.exit, 'fraud_team')
      assert.equal(value.trace[0]?.rule, 'fraud')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
