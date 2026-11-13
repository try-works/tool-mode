/** TDD-06 — a bare N/A is not a false pass. */
import assert from 'node:assert/strict'
import test from 'node:test'

import { validateNotApplicableReasons } from '../../../scripts/gen-verification.mjs'

test('an N/A requirement without a reviewed reason is refused', () => {
  assert.throws(
    () => validateNotApplicableReasons({ requirements: { 'DR-01': { status: 'N/A', evidence: 'x' } } }),
    /reviewed notApplicableReason/,
  )
  assert.throws(
    () => validateNotApplicableReasons({ requirements: { 'DR-02': { status: 'N/A', notApplicableReason: 'too short' } } }),
    /DR-02/,
  )
})

test('an N/A requirement with a reviewed reason passes, and other statuses are untouched', () => {
  assert.doesNotThrow(() => validateNotApplicableReasons({
    requirements: {
      'DR-03': { status: 'N/A', notApplicableReason: 'this host has no such optional hardware interface, reviewed by the operator' },
      'DR-04': { status: 'PARTIAL', evidence: 'still working' },
      'DR-05': { status: 'BLOCKED', evidence: 'external condition' },
    },
  }))
})
