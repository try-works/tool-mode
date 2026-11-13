/**
 * Confidence routing and evaluation (Hightouch identity-resolution study, 2026-11-04):
 * thresholds trade error types, calibration matters, and a calibrated cheap judge can
 * escalate only its uncertain band to an expensive second opinion.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { evaluateDecisions, routeConfidence } from '../src/decision-evaluate.ts'

describe('decision_route — confidence bands', () => {
  it('accepts high, rejects low and escalates the middle band', () => {
    assert.deepEqual(routeConfidence(0.95, 0.9, 0.1).route, 'accept')
    assert.equal(routeConfidence(0.95, 0.9, 0.1).decision, true)
    assert.deepEqual(routeConfidence(0.05, 0.9, 0.1).route, 'reject')
    assert.equal(routeConfidence(0.05, 0.9, 0.1).decision, false)
    assert.deepEqual(routeConfidence(0.5, 0.9, 0.1).route, 'escalate')
    assert.equal(routeConfidence(0.5, 0.9, 0.1).decision, null)
  })

  it('refuses inverted or out-of-range thresholds', () => {
    assert.throws(() => routeConfidence(0.5, 0.2, 0.3), /thresholds/)
    assert.throws(() => routeConfidence(1.2), /probability/)
    assert.throws(() => routeConfidence(0.5, 1.1, 0.1), /thresholds/)
  })
})

describe('decision_evaluate — calibration and hybrid escalation', () => {
  const cases = [
    { id: 'a', expected: true, probability: 0.95, escalatedProbability: 0.99, costUsd: 0.001, latencyMs: 150 },
    { id: 'b', expected: true, probability: 0.6, escalatedProbability: 0.9, costUsd: 0.05, latencyMs: 900 },
    { id: 'c', expected: false, probability: 0.4, escalatedProbability: 0.2, costUsd: 0.05, latencyMs: 900 },
    { id: 'd', expected: false, probability: 0.05, costUsd: 0.001, latencyMs: 150 },
  ]

  it('reports confusion, rates, Brier and calibration bins', () => {
    const result = evaluateDecisions(cases, 0.5)
    assert.equal(result.base.count, 4)
    assert.equal(result.base.accuracy, 1)
    assert.equal(result.base.truePositives, 2)
    assert.equal(result.base.trueNegatives, 2)
    assert.equal(result.base.falsePositives, 0)
    assert.equal(result.base.falseNegatives, 0)
    assert.equal(result.base.falsePositiveRate, 0)
    assert.equal(result.base.falseNegativeRate, 0)
    assert.ok(result.base.brier > 0)
    assert.equal(result.calibration.length, 10)
    assert.equal(result.bestThreshold >= 0 && result.bestThreshold <= 1, true)
  })

  it('escalates only the middle band and uses the secondary probability there', () => {
    const result = evaluateDecisions(cases, 0.5, { rejectAt: 0.1, acceptAt: 0.9 })
    assert.equal(result.hybrid?.escalated, 2)
    assert.equal(result.hybrid?.escalationRate, 0.5)
    assert.equal(result.hybrid?.accuracy, 1)
    assert.equal(result.hybrid?.falsePositives, 0)
    assert.equal(result.hybrid?.falseNegatives, 0)
    assert.ok((result.hybrid?.escalatedCostUsd ?? 0) > 0)
    assert.equal(result.hybrid?.truePositives, 2)
  })

  it('refuses malformed cases and thresholds', () => {
    assert.throws(() => evaluateDecisions([{ expected: true, probability: 2 }]), /probability/)
    assert.throws(() => evaluateDecisions([{ expected: 'yes', probability: 0.5 }]), /expected/)
    assert.throws(() => evaluateDecisions(cases, 1.2), /threshold/)
    assert.throws(() => evaluateDecisions(cases, 0.5, { rejectAt: 0.9, acceptAt: 0.1 }), /escalation/)
  })
})
