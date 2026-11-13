/**
 * DEC-08 — held-out decision quality evaluation.
 *
 * The harness is deliberately separate from schema/API conformance: a prediction can be
 * schema-valid and still wrong, and a checkpoint that scores well on one domain does not
 * prove every decision task. Thresholds are REVIEWED CONFIGURATION supplied before the
 * outputs are observed; this module never infers them from the results.
 *
 * The included examples are held-out fixtures, not a claim about the real checkpoint's
 * accuracy. Running them through the prepared model produces the report.
 */

/** One held-out example, across the categories DEC-08 requires. */
export interface HeldOutExample {
  readonly id: string
  readonly category:
    | 'clear'
    | 'ambiguous'
    | 'insufficient'
    | 'off-domain'
    | 'multilingual'
    | 'order-permutation'
  readonly prompt: string
  readonly options: readonly string[]
  /** The reviewed expected choice, or null when abstention is the correct behaviour. */
  readonly expectedChoice: string | null
  /** The binary truth for Brier/calibration, where the task has one. */
  readonly expectedTruth?: boolean
}

/** A predictor's answer for one example. Missing predictions count as abstentions. */
export interface DecisionPrediction {
  readonly id: string
  readonly answered: boolean
  readonly choice?: string | null
  /** P(truth) for a binary task, when the provider reports probabilities. */
  readonly probabilityTrue?: number | null
}

/** Thresholds fixed by review BEFORE the held-out outputs are observed. */
export interface EvaluationThresholds {
  readonly reviewed: boolean
  readonly reviewedAt: string
  readonly minAccuracy: number
  readonly minCoverage: number
  readonly maxBrier: number
  readonly maxCalibrationError: number
}

/** The reviewed configuration checked into this repository. */
export const REVIEWED_THRESHOLDS: EvaluationThresholds = {
  reviewed: true,
  reviewedAt: '2026-11-01',
  minAccuracy: 0.6,
  minCoverage: 0.5,
  maxBrier: 0.2,
  maxCalibrationError: 0.4,
}

/**
 * The held-out fixture set. Each category is represented by at least one example;
 * `order-permutation` shares options with `clear` in the opposite order so an accidental
 * option reordering is visible in the result.
 */
export const HELD_OUT_EXAMPLES: readonly HeldOutExample[] = [
  {
    id: 'clear-en',
    category: 'clear',
    prompt: 'I want a crisp fruit for lunch.',
    options: ['apple', 'steak'],
    expectedChoice: 'apple',
    expectedTruth: true,
  },
  {
    id: 'ambiguous-en',
    category: 'ambiguous',
    prompt: 'A fruit, maybe apple, maybe orange; pick one.',
    options: ['apple', 'orange'],
    expectedChoice: 'apple',
    expectedTruth: true,
  },
  {
    id: 'insufficient-en',
    category: 'insufficient',
    prompt: 'Choose one.',
    options: ['apple', 'orange'],
    expectedChoice: null,
  },
  {
    id: 'off-domain-en',
    category: 'off-domain',
    prompt: 'Explain the offside rule in football.',
    options: ['apple', 'orange'],
    expectedChoice: 'orange',
    expectedTruth: false,
  },
  {
    id: 'multilingual-fr',
    category: 'multilingual',
    prompt: "Je voudrais une pomme pour le déjeuner.",
    options: ['pomme', 'steak'],
    expectedChoice: 'pomme',
    expectedTruth: true,
  },
  {
    id: 'order-permutation',
    category: 'order-permutation',
    prompt: 'I want a crisp fruit for lunch.',
    options: ['steak', 'apple'],
    expectedChoice: 'apple',
    expectedTruth: true,
  },
]

/** Schema/API conformance, kept separate from model quality. */
export interface ConformanceReport {
  readonly passed: boolean
  readonly failures: readonly string[]
}

/** Quality metrics. `null` means the inputs did not make the metric measurable. */
export interface QualityReport {
  readonly total: number
  readonly answered: number
  readonly abstained: number
  readonly accuracy: number | null
  readonly coverage: number
  readonly brier: number | null
  readonly calibrationError: number | null
}

/** The separate halves DEC-08 requires, plus the named threshold failures. */
export interface EvaluationReport {
  readonly quality: QualityReport
  readonly conformance: ConformanceReport
  readonly passed: boolean
  readonly failures: readonly string[]
}

/**
 * Evaluate a deterministic set of predictions against the held-out fixtures.
 * @param examples - the held-out set.
 * @param predictions - the predictor's answers; missing ids count as abstentions.
 * @param thresholds - reviewed configuration, checked before the report is accepted.
 * @param conformance - schema/API conformance, reported WITHOUT being mixed into accuracy.
 * @returns quality metrics, conformance and named threshold failures.
 */
export function evaluateDecisionQuality(
  examples: readonly HeldOutExample[],
  predictions: readonly DecisionPrediction[],
  thresholds: EvaluationThresholds,
  conformance: ConformanceReport,
): EvaluationReport {
  if (!thresholds.reviewed || thresholds.reviewedAt.length === 0) {
    throw new Error('DEC-08 thresholds must be reviewed configuration with a review date')
  }
  const byId = new Map(predictions.map(prediction => [prediction.id, prediction]))
  let answered = 0
  let correct = 0
  let brierSum = 0
  let brierCount = 0
  const calibration: { probability: number; outcome: boolean }[] = []
  for (const example of examples) {
    const prediction = byId.get(example.id)
    if (prediction === undefined || !prediction.answered) continue
    answered += 1
    if (prediction.choice === example.expectedChoice) correct += 1
    if (typeof prediction.probabilityTrue === 'number' && Number.isFinite(prediction.probabilityTrue)
      && example.expectedTruth !== undefined) {
      const probability = Math.min(1, Math.max(0, prediction.probabilityTrue))
      const outcome = example.expectedTruth
      brierSum += (probability - (outcome ? 1 : 0)) ** 2
      brierCount += 1
      calibration.push({ probability, outcome })
    }
  }
  const total = examples.length
  const quality: QualityReport = {
    total,
    answered,
    abstained: total - answered,
    accuracy: answered === 0 ? null : correct / answered,
    coverage: total === 0 ? 0 : answered / total,
    brier: brierCount === 0 ? null : brierSum / brierCount,
    calibrationError: calibration.length === 0 ? null : expectedCalibrationError(calibration),
  }
  const failures: string[] = []
  if (quality.accuracy !== null && quality.accuracy < thresholds.minAccuracy) {
    failures.push(`accuracy ${quality.accuracy.toFixed(3)} is below the reviewed minimum ${thresholds.minAccuracy}`)
  }
  if (quality.coverage < thresholds.minCoverage) {
    failures.push(`coverage ${quality.coverage.toFixed(3)} is below the reviewed minimum ${thresholds.minCoverage}`)
  }
  if (quality.brier !== null && quality.brier > thresholds.maxBrier) {
    failures.push(`Brier score ${quality.brier.toFixed(3)} exceeds the reviewed maximum ${thresholds.maxBrier}`)
  }
  if (quality.calibrationError !== null && quality.calibrationError > thresholds.maxCalibrationError) {
    failures.push(`calibration error ${quality.calibrationError.toFixed(3)} exceeds the reviewed maximum ${thresholds.maxCalibrationError}`)
  }
  return {
    quality,
    conformance,
    passed: conformance.passed && failures.length === 0,
    failures,
  }
}

/** Expected calibration error over ten equal-width probability bins. */
function expectedCalibrationError(samples: readonly { probability: number; outcome: boolean }[]): number {
  const bins = Array.from({ length: 10 }, () => ({ count: 0, probability: 0, outcome: 0 }))
  for (const sample of samples) {
    const index = Math.min(9, Math.floor(sample.probability * 10))
    const bin = bins[index]!
    bin.count += 1
    bin.probability += sample.probability
    bin.outcome += sample.outcome ? 1 : 0
  }
  return bins.reduce((total, bin) => {
    if (bin.count === 0) return total
    const averageProbability = bin.probability / bin.count
    const observed = bin.outcome / bin.count
    return total + (bin.count / samples.length) * Math.abs(averageProbability - observed)
  }, 0)
}
