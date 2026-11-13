/**
 * Domain-neutral confidence routing and evaluation for judgment tools.
 *
 * Two general lessons are drawn from a published identity-resolution evaluation
 * (Hightouch, 2026-11-04); that domain is provenance, not scope:
 * - a fixed 50% cutoff is arbitrary; thresholds trade false positives for false negatives;
 * - a well-calibrated cheap judge can escalate only its uncertain band to an expensive
 *   evaluator and approach frontier accuracy at much lower cost.
 *
 * These functions are pure. They never call a model; the caller supplies the primary
 * probability (and, when escalations happen, the secondary one).
 */

/** A routing policy over one probability. */
export interface ConfidenceRoute {
  /** `accept` true, `reject` false, or `escalate` to the secondary judge. */
  readonly route: 'accept' | 'reject' | 'escalate'
  /** The decision when `route` is not escalate; null when a second opinion is needed. */
  readonly decision: boolean | null
  /** Which part of the band the probability fell in. */
  readonly band: 'high' | 'middle' | 'low'
  readonly reason: string
}

/**
 * Route a primary judgment by a two-sided confidence band.
 *
 * The defaults are the article's shape (middle band escalated), but NOT a claim
 * that these thresholds are calibrated for our models: pass reviewed thresholds.
 * @param probability - the primary judge's probability that the condition is true.
 * @param acceptAt - at or above this, accept true (default 0.9).
 * @param rejectAt - at or below this, accept false (default 0.1).
 * @returns the route, decision and band.
 */
export function routeConfidence(probability: number, acceptAt = 0.9, rejectAt = 0.1): ConfidenceRoute {
  if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error('probability must be a finite number in [0,1]')
  }
  if (!Number.isFinite(acceptAt) || !Number.isFinite(rejectAt) || rejectAt < 0 || acceptAt > 1 || rejectAt >= acceptAt) {
    throw new Error('thresholds must satisfy 0 <= rejectAt < acceptAt <= 1')
  }
  if (probability >= acceptAt) {
    return { route: 'accept', decision: true, band: 'high', reason: `p=${probability.toFixed(4)} >= acceptAt=${acceptAt}` }
  }
  if (probability <= rejectAt) {
    return { route: 'reject', decision: false, band: 'low', reason: `p=${probability.toFixed(4)} <= rejectAt=${rejectAt}` }
  }
  return { route: 'escalate', decision: null, band: 'middle', reason: `p=${probability.toFixed(4)} lies in (${rejectAt}, ${acceptAt})` }
}

/** One labeled observation for evaluation. */
export interface DecisionCase {
  readonly id?: string
  readonly expected: boolean
  /** Primary judge's P(true). */
  readonly probability: number
  /** Optional secondary judge's P(true), used only inside the escalation band. */
  readonly escalatedProbability?: number
  /** Optional observed cost of the primary call, in USD. */
  readonly costUsd?: number
  /** Optional observed latency of the primary call, in ms. */
  readonly latencyMs?: number
}

/** Metrics for one decision rule over the cases. */
export interface DecisionMetrics {
  readonly count: number
  readonly correct: number
  readonly accuracy: number
  readonly truePositives: number
  readonly trueNegatives: number
  readonly falsePositives: number
  readonly falseNegatives: number
  readonly falsePositiveRate: number
  readonly falseNegativeRate: number
  readonly brier: number
  readonly expectedCalibrationError: number
}

/** The full evaluation, with an optional hybrid escalation arm. */
export interface DecisionEvaluation {
  readonly threshold: number
  readonly base: DecisionMetrics
  readonly bestThreshold: number
  readonly bestAccuracy: number
  readonly sweep: readonly { readonly threshold: number; readonly accuracy: number }[]
  readonly calibration: readonly { readonly low: number; readonly high: number; readonly count: number; readonly meanPredicted: number | null; readonly observedRate: number | null }[]
  readonly hybrid?: {
    readonly rejectAt: number
    readonly acceptAt: number
    readonly escalated: number
    readonly escalationRate: number
    readonly accuracy: number
    readonly truePositives: number
    readonly trueNegatives: number
    readonly falsePositives: number
    readonly falseNegatives: number
    readonly falsePositiveRate: number
    readonly falseNegativeRate: number
    readonly escalatedCostUsd: number
    readonly escalatedLatencyMs: number
  }
}

function validCase(raw: unknown, index: number): DecisionCase {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`cases[${index}] must be an object`)
  const c = raw as Record<string, unknown>
  if (typeof c.expected !== 'boolean') throw new Error(`cases[${index}].expected must be a boolean`)
  if (typeof c.probability !== 'number' || !Number.isFinite(c.probability) || c.probability < 0 || c.probability > 1) {
    throw new Error(`cases[${index}].probability must be a finite number in [0,1]`)
  }
  if (c.escalatedProbability !== undefined && (typeof c.escalatedProbability !== 'number' || !Number.isFinite(c.escalatedProbability) || c.escalatedProbability < 0 || c.escalatedProbability > 1)) {
    throw new Error(`cases[${index}].escalatedProbability must be a finite number in [0,1]`)
  }
  for (const [key, value] of [['costUsd', c.costUsd], ['latencyMs', c.latencyMs]] as const) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      throw new Error(`cases[${index}].${key} must be a non-negative finite number`)
    }
  }
  return {
    ...(typeof c.id === 'string' ? { id: c.id } : {}),
    expected: c.expected,
    probability: c.probability,
    ...c.escalatedProbability === undefined ? {} : { escalatedProbability: c.escalatedProbability as number },
    ...c.costUsd === undefined ? {} : { costUsd: c.costUsd as number },
    ...c.latencyMs === undefined ? {} : { latencyMs: c.latencyMs as number },
  }
}

function metrics(cases: readonly DecisionCase[], decide: (c: DecisionCase) => boolean): DecisionMetrics {
  let correct = 0
  let tp = 0
  let tn = 0
  let fp = 0
  let fn = 0
  let brier = 0
  const bins = Array.from({ length: 10 }, () => ({ count: 0, predicted: 0, observed: 0 }))
  for (const c of cases) {
    const predicted = decide(c)
    if (predicted === c.expected) correct += 1
    if (predicted && c.expected) tp += 1
    else if (!predicted && !c.expected) tn += 1
    else if (predicted && !c.expected) fp += 1
    else fn += 1
    brier += (c.probability - (c.expected ? 1 : 0)) ** 2
    const bin = Math.min(9, Math.floor(c.probability * 10))
    const slot = bins[bin]!
    slot.count += 1
    slot.predicted += c.probability
    slot.observed += c.expected ? 1 : 0
  }
  let ece = 0
  for (const slot of bins) {
    if (slot.count === 0) continue
    ece += (slot.count / cases.length) * Math.abs(slot.predicted / slot.count - slot.observed / slot.count)
  }
  const positives = cases.filter(c => c.expected).length
  const negatives = cases.length - positives
  return {
    count: cases.length,
    correct,
    accuracy: cases.length === 0 ? 0 : correct / cases.length,
    truePositives: tp,
    trueNegatives: tn,
    falsePositives: fp,
    falseNegatives: fn,
    falsePositiveRate: negatives === 0 ? 0 : fp / negatives,
    falseNegativeRate: positives === 0 ? 0 : fn / positives,
    brier: cases.length === 0 ? 0 : brier / cases.length,
    expectedCalibrationError: cases.length === 0 ? 0 : ece,
  }
}

/**
 * Evaluate a labeled set: fixed threshold, best observed threshold, calibration bins,
 * and an optional hybrid arm that sends the middle band to the secondary probability.
 * @param rawCases - labeled observations.
 * @param threshold - the primary cutoff (default 0.5).
 * @param escalation - optional `{rejectAt, acceptAt}` hybrid band.
 * @returns metrics, sweep and optional hybrid metrics.
 */
export function evaluateDecisions(
  rawCases: unknown,
  threshold = 0.5,
  escalation?: { readonly rejectAt: number; readonly acceptAt: number },
): DecisionEvaluation {
  if (!Array.isArray(rawCases) || rawCases.length === 0 || rawCases.length > 10_000) throw new Error('cases must be 1–10,000 observations')
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('threshold must be a finite number in [0,1]')
  if (escalation !== undefined && (!Number.isFinite(escalation.rejectAt) || !Number.isFinite(escalation.acceptAt) || escalation.rejectAt < 0 || escalation.acceptAt > 1 || escalation.rejectAt >= escalation.acceptAt)) {
    throw new Error('escalation thresholds must satisfy 0 <= rejectAt < acceptAt <= 1')
  }
  const cases = rawCases.map(validCase)
  const base = metrics(cases, c => c.probability >= threshold)
  let bestThreshold = threshold
  let bestAccuracy = base.accuracy
  const sweep: { threshold: number; accuracy: number }[] = []
  for (let step = 0; step <= 100; step += 1) {
    const candidate = step / 100
    const result = metrics(cases, c => c.probability >= candidate)
    sweep.push({ threshold: candidate, accuracy: result.accuracy })
    if (result.accuracy > bestAccuracy) {
      bestAccuracy = result.accuracy
      bestThreshold = candidate
    }
  }
  const calibration = Array.from({ length: 10 }, (_, index) => {
    const low = index / 10
    const high = (index + 1) / 10
    const bucket = cases.filter(c => c.probability >= low && (index === 9 ? c.probability <= high : c.probability < high))
    return {
      low,
      high,
      count: bucket.length,
      meanPredicted: bucket.length === 0 ? null : bucket.reduce((sum, c) => sum + c.probability, 0) / bucket.length,
      observedRate: bucket.length === 0 ? null : bucket.filter(c => c.expected).length / bucket.length,
    }
  })
  if (escalation === undefined) return { threshold, base, bestThreshold, bestAccuracy, sweep, calibration }
  let escalated = 0
  let escalatedCostUsd = 0
  let escalatedLatencyMs = 0
  const hybridDecisions = cases.map(c => {
    const route = routeConfidence(c.probability, escalation.acceptAt, escalation.rejectAt)
    if (route.route !== 'escalate') return c.probability >= escalation.acceptAt
    escalated += 1
    escalatedCostUsd += c.costUsd ?? 0
    escalatedLatencyMs += c.latencyMs ?? 0
    return (c.escalatedProbability ?? c.probability) >= threshold
  })
  let tp = 0
  let tn = 0
  let fp = 0
  let fn = 0
  for (let index = 0; index < cases.length; index += 1) {
    const c = cases[index]!
    const predicted = hybridDecisions[index]!
    if (predicted && c.expected) tp += 1
    else if (!predicted && !c.expected) tn += 1
    else if (predicted) fp += 1
    else fn += 1
  }
  const positives = cases.filter(c => c.expected).length
  const negatives = cases.length - positives
  return {
    threshold,
    base,
    bestThreshold,
    bestAccuracy,
    sweep,
    calibration,
    hybrid: {
      rejectAt: escalation.rejectAt,
      acceptAt: escalation.acceptAt,
      escalated,
      escalationRate: cases.length === 0 ? 0 : escalated / cases.length,
      accuracy: (tp + tn) / cases.length,
      truePositives: tp,
      trueNegatives: tn,
      falsePositives: fp,
      falseNegatives: fn,
      falsePositiveRate: negatives === 0 ? 0 : fp / negatives,
      falseNegativeRate: positives === 0 ? 0 : fn / positives,
      escalatedCostUsd,
      escalatedLatencyMs,
    },
  }
}

/** The MCP contract for confidence routing. */
export const DECISION_ROUTE_CONTRACT = {
  contract: 'decision.route', version: '1.0.0', toolName: 'decision_route',
  description: 'Route a primary judgment probability into accept, reject or the escalate band.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['probability'], properties: { probability: { type: 'number' }, acceptAt: { type: 'number' }, rejectAt: { type: 'number' } } },
  outputSchema: { type: 'object', additionalProperties: false, required: ['route', 'decision', 'band', 'reason'], properties: { route: { type: 'string' }, decision: { type: ['boolean', 'null'] }, band: { type: 'string' }, reason: { type: 'string' } } },
  semantics: { deterministic: true, readsInputs: true }, limits: {},
} as const

/** The MCP contract for decision evaluation. */
export const DECISION_EVALUATE_CONTRACT = {
  contract: 'decision.evaluate', version: '1.0.0', toolName: 'decision_evaluate',
  description: 'Evaluate labeled decision probabilities: accuracy, FPR/FNR, Brier, calibration and an optional escalation arm.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['cases'], properties: { cases: { type: 'array' }, threshold: { type: 'number' }, escalation: { type: 'object' } } },
  outputSchema: { type: 'object', additionalProperties: true },
  semantics: { deterministic: true, readsInputs: true }, limits: {},
} as const
