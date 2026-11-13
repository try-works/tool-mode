/**
 * DEC-06 — the canonical TYPED decision surfaces over the SAME prepared Laya
 * checkpoint and head as `decision_test` / `decision_score`.
 *
 * This module is pure and model-free: input validation, native-answer → declared
 * payload mapping, and the native probability preservation rules live here so they
 * are testable without weights. The provider in `index.ts` owns only the runtime
 * call and reuses these functions.
 *
 * Honesty rules this module enforces:
 * - `probabilityTrue` / the level probabilities are the runtime's native probability
 *   mass, explicitly uncalibrated (`probabilityKind: "model_probability"`); nothing
 *   here is calibrated or ground truth.
 * - The score output preserves the native ORDINAL DISTRIBUTION and reports
 *   `expectedIndex = Σ i·p_i` unrounded (a fractional expectation is a mean, not a
 *   level). It is never converted to an argmax/hard label.
 * - Abstention reports nulls rather than a guessed answer, and only when the native
 *   answer is absent or the runtime itself marked it low-confidence. No confidence
 *   threshold is invented for abstention.
 * - Truncation/collapse is rejected through the same `assertDecisionInputSafe`
 *   (DEC-05) the compatibility tools use.
 */

import {
  assertDecisionInputSafe,
  validateProbabilityDistribution,
  type DecisionUsageReport,
} from './pure.js'

/** Maximum `state` length accepted by the typed surfaces. */
export const TYPED_STATE_MAX = 32768
/** Maximum `proposition` / `question` length accepted by the typed surfaces. */
export const TYPED_TEXT_MAX = 4096
/** Minimum number of ordinal levels for the typed score surface (DEC-06: 2–32). */
export const TYPED_LEVEL_MIN = 2
/** Maximum number of ordinal levels for the typed score surface (DEC-06: 2–32). */
export const TYPED_LEVEL_MAX = 32
/** Maximum level id length. */
export const TYPED_LEVEL_ID_MAX = 128
/** Maximum level description length. */
export const TYPED_LEVEL_DESCRIPTION_MAX = 256
/**
 * Reviewed boolean policy v1 (DEC-06: "Boolean answer thresholds come from the
 * reviewed policy"). P(true) at or above this value maps to `answer: true`; it is a
 * disclosed decision rule over an UNCALIBRATED probability, not a claim of truth.
 */
export const TYPED_BOOLEAN_ANSWER_THRESHOLD = 0.5

/** The declared input of `decision_test_typed`. */
export interface DecisionTestInput {
  readonly state: string
  readonly proposition: string
}

/** The declared output of `decision_test_typed` (the host adds `meta`). */
export interface DecisionTestOutput {
  readonly status: 'answered' | 'abstained'
  readonly answer: boolean | null
  readonly probabilityTrue: number | null
  readonly probabilityKind: 'model_probability'
}

/** One ordered level, least to most intense. */
export interface TypedLevel {
  readonly id: string
  readonly description: string
}

/** The declared input of `decision_score_typed`. */
export interface DecisionScoreInput {
  readonly state: string
  readonly question: string
  readonly levels: readonly TypedLevel[]
}

/** The declared output of `decision_score_typed` (the host adds `meta`). */
export interface DecisionScoreOutput {
  readonly status: 'scored' | 'abstained'
  readonly expectedIndex: number | null
  readonly probabilities: readonly { readonly levelId: string; readonly probability: number }[]
  readonly probabilityKind: 'model_probability'
}

/** The native answer fields the typed mapping consumes (the rest is ignored). */
export interface TypedNativeAnswer {
  readonly probabilities?: Readonly<Record<string, number>>
  readonly low_confidence?: boolean
}

/** A typed question as it is sent to the prepared head. */
export interface TypedQuestionPlan {
  readonly kind: 'test' | 'score'
  readonly questionType: 'choice' | 'score'
  readonly criteria: Record<string, null> | readonly string[]
  readonly prompt: string
  readonly expectedProbabilities: number
}

function record(value: unknown, label: string, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const result = value as Record<string, unknown>
  const unknown = Object.keys(result).find(key => !allowed.includes(key))
  if (unknown !== undefined) {
    throw new Error(`unknown field ${JSON.stringify(unknown)}; the typed schema is closed`)
  }
  return result
}

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`"${field}" must be a non-empty string`)
  }
  if (value.length > max) throw new Error(`"${field}" must be at most ${max} characters, got ${value.length}`)
  return value
}

function requireState(value: unknown): string {
  return requireString(value, 'state', TYPED_STATE_MAX)
}

/** Validate and normalize one ordinal level entry. */
function validateLevel(value: unknown, index: number): TypedLevel {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`levels[${index}] must be an object`)
  }
  const candidate = value as Record<string, unknown>
  const unknown = Object.keys(candidate).filter(key => key !== 'id' && key !== 'description')
  if (unknown.length > 0) {
    throw new Error(`levels[${index}] has unknown field ${JSON.stringify(unknown[0])}; the level entry is closed`)
  }
  const id = candidate['id']
  const description = candidate['description']
  if (typeof id !== 'string' || id.length === 0) throw new Error(`levels[${index}] id must be a non-empty string`)
  if (id.length > TYPED_LEVEL_ID_MAX) {
    throw new Error(`levels[${index}] id must be at most ${TYPED_LEVEL_ID_MAX} characters`)
  }
  if (typeof description !== 'string' || description.length === 0) {
    throw new Error(`levels[${index}] description must be a non-empty string`)
  }
  if (description.length > TYPED_LEVEL_DESCRIPTION_MAX) {
    throw new Error(`levels[${index}] description must be at most ${TYPED_LEVEL_DESCRIPTION_MAX} characters`)
  }
  return { id, description }
}

/**
 * Validate the typed score input: a bounded state/question and 2–32 ordered levels
 * with UNIQUE IDs and UNIQUE descriptions (a duplicated criterion would make the
 * native criteria indistinguishable, DEC-05).
 * @param input - the untrusted tool arguments.
 * @returns the normalized input.
 */
export function validateDecisionScoreInput(input: unknown): DecisionScoreInput {
  const candidate = record(input, 'decision_score_typed input', ['state', 'question', 'levels'])
  const state = requireState(candidate['state'])
  const question = requireString(candidate['question'], 'question', TYPED_TEXT_MAX)
  const rawLevels = candidate['levels']
  if (!Array.isArray(rawLevels)) throw new Error('"levels" must be an array of {id, description}')
  if (rawLevels.length < TYPED_LEVEL_MIN || rawLevels.length > TYPED_LEVEL_MAX) {
    throw new Error(`"levels" must contain ${TYPED_LEVEL_MIN}..${TYPED_LEVEL_MAX} entries, got ${rawLevels.length}`)
  }
  const levels = rawLevels.map((level, index) => validateLevel(level, index))
  const ids = new Set<string>()
  const descriptions = new Set<string>()
  for (const level of levels) {
    if (ids.has(level.id)) throw new Error(`levels must have a unique id per entry; duplicate ${JSON.stringify(level.id)}`)
    if (descriptions.has(level.description)) {
      throw new Error(`levels must have a unique description per entry; duplicate ${JSON.stringify(level.description)}`)
    }
    ids.add(level.id)
    descriptions.add(level.description)
  }
  return { state, question, levels }
}

/**
 * Validate the typed test input.
 * @param input - the untrusted tool arguments.
 * @returns the normalized input.
 */
export function validateDecisionTestInput(input: unknown): DecisionTestInput {
  const candidate = record(input, 'decision_test_typed input', ['state', 'proposition'])
  const state = requireState(candidate['state'])
  const proposition = requireString(candidate['proposition'], 'proposition', TYPED_TEXT_MAX)
  return { state, proposition }
}

/**
 * Compose the native prompt for the typed boolean question.
 *
 * The state and proposition travel as separate labelled blocks so a proposition
 * that looks like state cannot be silently merged; the runtime's own token budget
 * decides truncation and the usage report is checked afterwards (DEC-05).
 * @param input - the validated test input.
 * @returns the prompt text.
 */
export function decisionTestPrompt(input: DecisionTestInput): string {
  return `State:\n${input.state}\n\nProposition:\n${input.proposition}`
}

/**
 * Compose the native prompt for the typed ordinal question.
 * @param input - the validated score input.
 * @returns the prompt text.
 */
export function decisionScorePrompt(input: DecisionScoreInput): string {
  return `State:\n${input.state}\n\nQuestion:\n${input.question}`
}

/**
 * Plan the native question for a typed implementation id.
 *
 * Returns undefined for every non-typed implementation, so the compatibility tools'
 * branches are not intercepted. The criteria are the SAME prepared head's native
 * question representation: `{true,false}` for the boolean surface and the level
 * descriptions (positional) for the ordinal one.
 * @param implementationId - the manifest implementation id being invoked.
 * @param input - the untrusted tool arguments.
 * @returns the plan, or undefined when this id is not a typed surface.
 */
export function typedQuestionPlan(implementationId: string, input: unknown): TypedQuestionPlan | undefined {
  if (implementationId === 'laya-onnx-decision-test-typed') {
    const validated = validateDecisionTestInput(input)
    return {
      kind: 'test',
      questionType: 'choice',
      criteria: { true: null, false: null },
      prompt: decisionTestPrompt(validated),
      expectedProbabilities: 2,
    }
  }
  if (implementationId === 'laya-onnx-decision-score-typed') {
    const validated = validateDecisionScoreInput(input)
    return {
      kind: 'score',
      questionType: 'score',
      criteria: validated.levels.map(level => level.description),
      prompt: decisionScorePrompt(validated),
      expectedProbabilities: validated.levels.length,
    }
  }
  return undefined
}

/** Whether the native answer means "the model declined", without inventing a threshold. */
function abstained(answer: TypedNativeAnswer | undefined): boolean {
  return answer === undefined || answer.low_confidence === true
}

/**
 * Map the native boolean answer onto the declared typed-test payload.
 *
 * `probabilityTrue` is the native P(true) mass, uncalibrated. `answer` applies the
 * disclosed reviewed policy threshold; an abstention (no native answer or the
 * runtime's own low-confidence marker) reports nulls instead of a guess.
 * @param input - the validated test input.
 * @param answer - the native answer (absent when the model produced none).
 * @param usage - the runtime's truncation/collapse report (DEC-05).
 * @returns the declared payload.
 */
export function typedTestFromNative(
  input: DecisionTestInput,
  answer: TypedNativeAnswer | undefined,
  usage?: DecisionUsageReport,
): DecisionTestOutput {
  void input
  assertDecisionInputSafe(usage)
  if (abstained(answer)) {
    return { status: 'abstained', answer: null, probabilityTrue: null, probabilityKind: 'model_probability' }
  }
  const probabilities = validateProbabilityDistribution(answer!.probabilities ?? {}, 2)
  const probabilityTrue = probabilities['true']
  if (typeof probabilityTrue !== 'number') {
    throw new Error('the native answer has no "true" probability; refusing to fabricate probabilityTrue')
  }
  return {
    status: 'answered',
    answer: probabilityTrue >= TYPED_BOOLEAN_ANSWER_THRESHOLD,
    probabilityTrue,
    probabilityKind: 'model_probability',
  }
}

/**
 * Map the native ordinal answer onto the declared typed-score payload.
 *
 * The distribution is preserved in level order and `expectedIndex` is the native
 * probability-weighted index, unrounded. No argmax/hard label is produced.
 * @param input - the validated score input.
 * @param answer - the native answer (absent when the model produced none).
 * @param usage - the runtime's truncation/collapse report (DEC-05).
 * @returns the declared payload.
 */
export function typedScoreFromNative(
  input: DecisionScoreInput,
  answer: TypedNativeAnswer | undefined,
  usage?: DecisionUsageReport,
): DecisionScoreOutput {
  assertDecisionInputSafe(usage)
  if (abstained(answer)) {
    return { status: 'abstained', expectedIndex: null, probabilities: [], probabilityKind: 'model_probability' }
  }
  const probabilities = validateProbabilityDistribution(
    answer!.probabilities ?? {},
    input.levels.length,
  )
  const ordered = input.levels.map((level, index) => {
    const probability = probabilities[String(index)]
    if (typeof probability !== 'number') {
      throw new Error(`the native score distribution has no probability for level index ${index}; refusing to fabricate one`)
    }
    return { levelId: level.id, probability }
  })
  const expectedIndex = ordered.reduce((sum, entry, index) => sum + index * entry.probability, 0)
  return { status: 'scored', expectedIndex, probabilities: ordered, probabilityKind: 'model_probability' }
}
