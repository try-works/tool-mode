import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// @ts-expect-error — the report is a plain ESM script without a declaration file.
import { summarize } from '../../../scripts/adoption-report.mjs'

describe('adoption report', () => {
  it('groups sessions by arm and computes session reuse rate', () => {
    const rows = summarize({
      sessions: {
        a: { arm: 'D', called: { lang_detect: 3 }, reused: 0, authored: 0, saveOffers: 0 },
        b: { arm: 'O', called: { workflow_x: 2, lang_detect: 1 }, reused: 2, authored: 1, saveOffers: 2 },
      },
    }, undefined)
    assert.deepEqual(rows.map(row => row.arm), ['D', 'O'])
    const o = rows.find(row => row.arm === 'O')
    assert.equal(o?.sessions, 1)
    assert.equal(o?.calls, 3)
    assert.equal(o?.sessionsWithReuse, 1)
    assert.equal(o?.reuseRate, 1)
    assert.equal(o?.saveOffers, 2)
  })
})
