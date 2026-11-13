/**
 * DEC-08 — decision quality evaluation.
 *
 * The harness must include held-out examples across the required categories, use
 * thresholds fixed BEFORE the outputs are observed, and keep schema/API conformance
 * separate from model accuracy. These tests use a deterministic predictor; they say
 * nothing about the real checkpoint's accuracy.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateDecisionQuality,
  HELD_OUT_EXAMPLES,
  REVIEWED_THRESHOLDS,
  type DecisionPrediction,
} from '../src/evaluation.ts'

const ids = HELD_OUT_EXAMPLES.map(example => example.id)

test('DEC-08: held-out examples cover every required category', () => {
  const categories = new Set(HELD_OUT_EXAMPLES.map(example => example.category))
  for (const required of ['clear', 'ambiguous', 'insufficient', 'off-domain', 'multilingual', 'order-permutation']) {
    assert.ok(categories.has(required as never), `missing held-out category ${required}`)
  }
  assert.ok(HELD_OUT_EXAMPLES.length >= 6)
  assert.equal(new Set(ids).size, ids.length, 'example ids must be unique')
})

test('DEC-08: reports accuracy, coverage, Brier and calibration separately', () => {
  const predictions: DecisionPrediction[] = [
    { id: 'clear-en', answered: true, choice: 'apple', probabilityTrue: 0.9 },
    { id: 'ambiguous-en', answered: true, choice: 'apple', probabilityTrue: 0.6 },
    { id: 'insufficient-en', answered: false },
    { id: 'off-domain-en', answered: true, choice: 'apple', probabilityTrue: 0.8 },
  ]
  const report = evaluateDecisionQuality(HELD_OUT_EXAMPLES, predictions, REVIEWED_THRESHOLDS, {
    passed: true,
    failures: [],
  })
  assert.equal(report.quality.answered, 3)
  assert.equal(report.quality.total, HELD_OUT_EXAMPLES.length)
  assert.equal(report.quality.coverage, 3 / HELD_OUT_EXAMPLES.length)
  // clear and ambiguous correct, off-domain wrong: 2/3
  assert.ok(Math.abs(report.quality.accuracy! - 2 / 3) < 1e-9)
  // Brier over the three probabilistic answers.
  const expectedBrier = ((0.9 - 1) ** 2 + (0.6 - 1) ** 2 + (0.8 - 0) ** 2) / 3
  assert.ok(Math.abs(report.quality.brier! - expectedBrier) < 1e-9)
  assert.ok(report.quality.calibrationError! >= 0)
  assert.equal(report.conformance.passed, true, 'conformance stays a separate field')
  assert.ok(Array.isArray(report.failures))
})

test('DEC-08: a failed threshold is named, not collapsed into accuracy', () => {
  const predictions: DecisionPrediction[] = [
    { id: 'clear-en', answered: true, choice: 'apple', probabilityTrue: 0.9 },
    { id: 'ambiguous-en', answered: true, choice: 'apple', probabilityTrue: 0.6 },
    { id: 'insufficient-en', answered: true, choice: 'apple', probabilityTrue: 0.7 },
    { id: 'off-domain-en', answered: false },
  ]
  const report = evaluateDecisionQuality(HELD_OUT_EXAMPLES, predictions, {
    ...REVIEWED_THRESHOLDS,
    minCoverage: 0.9,
    maxBrier: 0.01,
  }, { passed: false, failures: ['the output schema rejected example clear-en'] })
  assert.equal(report.passed, false)
  assert.ok(report.failures.some(reason => reason.includes('coverage')))
  assert.ok(report.failures.some(reason => reason.includes('Brier')))
  assert.equal(report.conformance.passed, false)
  assert.equal(report.conformance.failures.length, 1)
})

test('DEC-08: thresholds are reviewed configuration, not inferred from outcomes', () => {
  assert.equal(REVIEWED_THRESHOLDS.reviewed, true)
  assert.ok(REVIEWED_THRESHOLDS.reviewedAt.length > 0)
  assert.ok(REVIEWED_THRESHOLDS.minAccuracy > 0)
})
