/**
 * The deterministic decision maths (H5), model-free and mirroring the vendored
 * runtime's formulas so the tests can pin the mapping WITHOUT weights.
 *
 * The vendored laya-ts `common.js` is the authority for these formulas
 * (softmax, confidenceFromProbs, answerConfidence); this module re-states the
 * same arithmetic so the extension's boundary — logit → label → confidence —
 * is testable in isolation, and so a reviewer can see that the reported
 * confidence is EXACTLY the runtime's uncalibrated probability mass (DEC-08).
 */

/** The option-count bounds the vendored runtime enforces (structured.js). */
export const MAX_OPTIONS = 32
export const MAX_SCORE_LEVELS = 10

/** Softmax, mirroring the vendored common.js exactly. */
export function softmax(z: readonly number[]): number[] {
  const m = Math.max(...z)
  const e = z.map(v => Math.exp(v - m))
  const s = e.reduce((a, b) => a + b, 0)
  return e.map(v => v / s)
}

/** Probability mass on the reported answer — the vendored answerConfidence. */
export function answerConfidence(p: readonly number[]): number {
  if (p.length < 1) return 1
  return Math.min(1, Math.max(0, Math.max(...p)))
}

/** One boundary decision: logits → label + confidence. */
export interface BoundaryDecision {
  readonly index: number
  readonly label: string
  readonly confidence: number
  readonly probabilities: readonly number[]
}

/**
 * Map logits to a boundary decision: softmax, argmax, and ties broken by the
 * INPUT order of the labels (deterministic; the vendored runtime's stable
 * argmax does the same).
 */
export function decideFromLogits(labels: readonly string[], logits: readonly number[]): BoundaryDecision {
  if (labels.length === 0) throw new Error('at least one label is required')
  if (labels.length !== logits.length) throw new Error('one logit per label')
  const probabilities = softmax(logits)
  let index = 0
  for (let i = 1; i < probabilities.length; i += 1) {
    if (probabilities[i]! > probabilities[index]!) index = i
  }
  return {
    index,
    label: labels[index]!,
    confidence: answerConfidence(probabilities),
    probabilities,
  }
}

/**
 * Validate the caller's options: the bounds, the uniqueness and the shape the
 * schema enforces, re-asserted here so the runtime refusal is precise.
 */
export function validateOptions(options: readonly string[], max: number): string[] {
  if (!Array.isArray(options)) throw new Error('"options" must be an array of strings')
  if (options.length < 2) throw new Error(`at least 2 options are required, got ${options.length}`)
  if (options.length > max) throw new Error(`${options.length} options exceed the ${max}-option bound`)
  const seen = new Set<string>()
  for (const option of options) {
    if (typeof option !== 'string' || option.length === 0) throw new Error('every option must be a non-empty string')
    if (seen.has(option)) throw new Error(`duplicate option label ${JSON.stringify(option)} is refused`)
    seen.add(option)
  }
  return [...options]
}

/** The native input rejection codes DEC-05 requires. */
export type DecisionInputErrorCode = 'INPUT_TRUNCATED' | 'INDISTINGUISHABLE_OPTIONS'

/** A refused decision input, carrying the code the caller/UI must surface (DEC-05). */
export class DecisionInputError extends Error {
  override readonly name = 'DecisionInputError'
  /** The stable rejection code. */
  readonly code: DecisionInputErrorCode

  constructor(code: DecisionInputErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** The runtime's per-answer usage report, as far as DEC-05 needs it. */
export interface DecisionUsageReport {
  readonly truncated?: boolean
  readonly state_tokens_dropped?: number
  readonly truncated_questions?: readonly string[]
  readonly options?: Readonly<Record<string, number>>
}

/**
 * Reject a decision whose input the model did not fully receive (DEC-05).
 *
 * The native runtime reports both dropped state tokens (`truncated`, a token-budget
 * fact) and options that collapsed to the same head representation (`options`).
 * Returning a confident answer over either would hide the loss.
 * @param usage - the runtime's usage report.
 * @throws DecisionInputError with `INPUT_TRUNCATED` or `INDISTINGUISHABLE_OPTIONS`.
 */
export function assertDecisionInputSafe(usage: DecisionUsageReport | undefined): void {
  if (usage === undefined) return
  const dropped = Number(usage.state_tokens_dropped ?? 0)
  if (usage.truncated === true || (Number.isFinite(dropped) && dropped > 0)) {
    const questions = usage.truncated_questions?.length ? ` (questions: ${usage.truncated_questions.join(', ')})` : ''
    throw new DecisionInputError(
      'INPUT_TRUNCATED',
      `the decision input exceeded the prepared checkpoint's token budget and dropped ${dropped} state token(s)${questions}; `
      + 'rejecting rather than returning a confident decision over input the model did not receive (DEC-05)',
    )
  }
  if (usage.options !== undefined && Object.keys(usage.options).length > 0) {
    throw new DecisionInputError(
      'INDISTINGUISHABLE_OPTIONS',
      'distinct options collapsed to the same model representation; rejecting the request rather than returning a decision '
      + 'that cannot distinguish them (DEC-05)',
    )
  }
}

/**
 * Validate a probability distribution the runtime reported (DEC-04).
 *
 * The native API returns probabilities as an object; a malformed vector is not a
 * weaker answer, it is an answer the extension must not report as probabilities.
 * Length must match the declared options/levels, every value must be finite and in
 * [0,1], and the total must be 1 within a small floating-point tolerance.
 * @param probabilities - the runtime's index/label → probability map.
 * @param expectedEntries - how many options/levels the answer covers.
 * @returns the same map, when valid.
 * @throws Error naming the violated property.
 */
export function validateProbabilityDistribution(
  probabilities: Readonly<Record<string, number>>,
  expectedEntries: number,
): Readonly<Record<string, number>> {
  const entries = Object.entries(probabilities)
  if (entries.length !== expectedEntries) {
    throw new Error(`probability vector must have ${expectedEntries} entries, got ${entries.length}`)
  }
  let sum = 0
  for (const [key, value] of entries) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`probability for ${JSON.stringify(key)} must be finite`)
    }
    if (value < 0 || value > 1) {
      throw new Error(`probability for ${JSON.stringify(key)} must be between 0 and 1`)
    }
    sum += value
  }
  if (Math.abs(sum - 1) > 1e-3) {
    throw new Error(`probabilities must sum to 1 within 1e-3, got ${sum}`)
  }
  return probabilities
}

/** Object keys that cannot safely be used as native choice criteria keys (DEC-03). */
const UNSAFE_PROVIDER_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** A stable, reversible mapping between caller option IDs and native criteria keys. */
export interface ProviderKeyMapping {
  /** The native choice criteria: provider key → null description, input order. */
  readonly criteria: Record<string, null>
  /** Provider keys in caller order. */
  readonly originalToProvider: readonly string[]
  /** Map a provider key back to the caller's original ID. */
  toOriginal(providerKey: string): string
  /** Map a native probability object back to the caller's original IDs. */
  toOriginalProbabilities(probabilities: Readonly<Record<string, number>>): Record<string, number>
}

/**
 * Build a stable reversible provider-key mapping for choice options (DEC-03).
 *
 * The native API uses each criterion key as both the option text and the answer
 * key. Ordinary labels are therefore passed through unchanged. The reserved object
 * keys (`__proto__`, `constructor`, `prototype`) are unsafe as object keys and get a
 * deterministic `__option_<index>` surrogate instead; every answer is mapped back to
 * the caller's original ID before it is returned. Surrogates never collide with a
 * caller label in the same question.
 * @param options - the caller's validated option labels, in input order.
 * @returns the native criteria plus the reverse mapping.
 */
export function mapProviderOptionKeys(options: readonly string[]): ProviderKeyMapping {
  const reserved = new Set(options)
  const providerKeys = options.map((label, index) => {
    if (!UNSAFE_PROVIDER_KEYS.has(label)) return label
    let candidate = `__option_${index}`
    while (reserved.has(candidate)) candidate = `_${candidate}`
    reserved.add(candidate)
    return candidate
  })
  const reverse = new Map(providerKeys.map((key, index) => [key, options[index]!]))
  const criteria = Object.fromEntries(providerKeys.map(key => [key, null])) as Record<string, null>
  return {
    criteria,
    originalToProvider: providerKeys,
    toOriginal: providerKey => reverse.get(providerKey) ?? providerKey,
    toOriginalProbabilities: probabilities => Object.fromEntries(
      Object.entries(probabilities).map(([key, value]) => [reverse.get(key) ?? key, value]),
    ),
  }
}

/**
 * Map a SCORE answer onto the caller's level label.
 *
 * The runtime answers a score question with BOTH an expected value
 * (`score: Σ i·p_i`, a float) and per-index probabilities plus a legend. The
 * declared output schema requires a LABEL (`score: string|null`), so the label is
 * the argmax of those probabilities — exactly what the vendored runtime's own
 * `best()` returns — mapped through the levels the caller supplied. The expected
 * value is deliberately NOT reported as the score: it is a mean, not a level.
 * @param probabilities - the answer's index→probability map.
 * @param levels - the caller's levels, lowest first.
 * @returns the level label, or null when no index maps to a level.
 */
/** The standard `decision.choose` payload. */
export interface StandardDecisionChoice {
  readonly chosen: number
  readonly confidence: 'confident' | 'likely' | 'tentative'
  readonly reason: string
}

/**
 * Map a native choice onto the STANDARD `decision.choose` contract.
 *
 * The runtime's own chosen label is revalidated against the caller's FULL option
 * set before it is used; an unknown label refuses instead of being rendered. When
 * the runtime abstained (null choice), the argmax over the caller's options is
 * used so the standard payload always names an option.
 * @param options - the caller's complete options, in order.
 * @param chosenLabel - the runtime's choice, or null when it abstained.
 * @param probabilities - per-option probabilities, keyed by option label.
 * @param confidence - the runtime's uncalibrated confidence mass.
 * @returns the standard contract payload, never with a label outside `options`.
 */
export function standardChooseFromNative(
  options: readonly string[],
  chosenLabel: string | null,
  probabilities: Readonly<Record<string, number>>,
  confidence: number,
): StandardDecisionChoice {
  validateOptions(options, 16)
  let chosenLabelOrNull = chosenLabel
  if (chosenLabelOrNull !== null && !options.includes(chosenLabelOrNull)) {
    throw new Error(`the runtime chose ${JSON.stringify(chosenLabelOrNull)}, which is not one of the supplied options`)
  }
  if (chosenLabelOrNull === null) {
    let best = Number.NEGATIVE_INFINITY
    for (const option of options) {
      const value = probabilities[option]
      if (typeof value === 'number' && Number.isFinite(value) && value > best) {
        best = value
        chosenLabelOrNull = option
      }
    }
    if (chosenLabelOrNull === null) throw new Error('the runtime abstained and no option carries a probability')
  }
  const chosen = options.indexOf(chosenLabelOrNull)
  if (chosen < 0) throw new Error('the chosen option is not in the supplied option set')
  const mass = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0
  const confidenceLabel = mass >= 0.6 ? 'confident' : mass >= 0.35 ? 'likely' : 'tentative'
  return {
    chosen,
    confidence: confidenceLabel,
    reason: `Chose ${JSON.stringify(chosenLabelOrNull)} (uncalibrated probability ${mass.toFixed(4)}).`,
  }
}

/**
 * Map a SCORE answer onto the caller's level label.
 *
 * The runtime answers a score question with BOTH an expected value
 * (`score: Σ i·p_i`, a float) and per-index probabilities plus a legend. The
 * declared output schema requires a LABEL (`score: string|null`), so the label is
 * the argmax of those probabilities — exactly what the vendored runtime's own
 * `best()` returns — mapped through the levels the caller supplied. The expected
 * value is deliberately NOT reported as the score: it is a mean, not a level.
 * @param probabilities - the answer's index→probability map.
 * @param levels - the caller's levels, lowest first.
 * @returns the level label, or null when no index maps to a level.
 */
export function scoreLevelFromProbabilities(
  probabilities: Readonly<Record<string, number>>,
  levels: readonly string[],
): string | null {
  let bestIndex = -1
  let bestValue = Number.NEGATIVE_INFINITY
  for (const [key, value] of Object.entries(probabilities)) {
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= levels.length) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (value > bestValue) {
      bestValue = value
      bestIndex = index
    }
  }
  return bestIndex === -1 ? null : (levels[bestIndex] ?? null)
}
