/**
 * Remote Jev (TypeSafe System One) adapter (TOOL-02, DEC-07).
 *
 * Jev is a remote typed-question service, not a local checkpoint and not a chat
 * endpoint. This module speaks its native `systemOne` request/response shape and
 * converts a choice answer onto the standard `decision.choose` result. The
 * conversion is VERSIONED and tested; an invalid probability set or an unknown
 * choice is an error, never an abstention.
 *
 * @module @try-works/dsh-tool-mode/jev
 */

/** The version of the native-to-standard conversion this build implements. */
export const JEV_CONVERSION_VERSION = '1.0.0'

/** A configuration or transport failure; never carries the API key or response body. */
export class JevError extends Error {
  /** Stable failure class. */
  readonly code: string
  /** HTTP status, when the failure came from a response. */
  readonly status?: number
  constructor(code: string, message: string, status?: number) {
    super(message)
    this.name = 'JevError'
    this.code = code
    if (status !== undefined) this.status = status
  }
}

/** The standard `decision.choose` result. */
export interface JevChoiceResult {
  /** Zero-based index into the caller's option list. */
  readonly chosen: number
  /** Bucket over the uncalibrated probability mass. */
  readonly confidence: 'confident' | 'likely' | 'tentative'
  /** Human-readable reason naming the option and its uncalibrated probability. */
  readonly reason: string
}

/** The remote request one choice becomes. */
export interface JevChoiceRequest {
  readonly model: string
  readonly state: { readonly decision: string }
  readonly questions: {
    readonly choice: {
      readonly type: 'choice'
      readonly instructions: string
      readonly criteria: Readonly<Record<string, string>>
    }
  }
}

/** Configuration for one Jev client. */
export interface JevConfig {
  readonly enabled?: boolean
  readonly apiKey?: string
  readonly apiKeyEnv?: string
  readonly credentialRef?: string
  readonly baseURL?: string
  readonly model?: string
}

/** Configuration for one Jev client. */
export interface JevClientConfig {
  readonly apiKey: string
  /** API root ending before `/v1/systemone`. */
  readonly baseURL?: string
  /** Pinned model id, e.g. `jev-1.14`. */
  readonly model?: string
  readonly timeoutMs?: number
  /** Injected transport for tests; defaults to the global fetch. */
  readonly fetch?: typeof fetch
}

/** The default TypeSafe API root (the `/v1/systemone` path is appended). */
export const JEV_DEFAULT_BASE_URL = 'https://api.typesafe.ai'
/** The default pinned model; callers may pin another documented model. */
export const JEV_DEFAULT_MODEL = 'jev-1.14'

/** Convert a probability mass to the standard bucket. */
export function confidenceBucket(mass: number): 'confident' | 'likely' | 'tentative' {
  if (!Number.isFinite(mass)) throw new JevError('invalid_response', 'the answer carries no finite confidence')
  const clamped = Math.max(0, Math.min(1, mass))
  return clamped >= 0.6 ? 'confident' : clamped >= 0.35 ? 'likely' : 'tentative'
}

/**
 * Build the native request for a choice.
 * @param decision - the decision text.
 * @param options - 2–16 distinct nonempty labels.
 * @param model - the pinned model id.
 * @returns the native request body.
 */
export function buildJevChoiceRequest(
  decision: string,
  options: readonly string[],
  model: string = JEV_DEFAULT_MODEL,
): JevChoiceRequest {
  if (decision.trim().length === 0) throw new JevError('invalid_request', 'the decision must not be empty')
  if (options.length < 2 || options.length > 16) throw new JevError('invalid_request', 'a choice needs 2–16 options')
  const seen = new Set<string>()
  const criteria: Record<string, string> = {}
  for (let index = 0; index < options.length; index += 1) {
    const label = options[index]!
    if (label.trim().length === 0) throw new JevError('invalid_request', 'an option label must not be empty')
    if (seen.has(label)) throw new JevError('invalid_request', 'option labels must be distinct')
    seen.add(label)
    criteria[`option_${index}`] = label
  }
  return {
    model,
    state: { decision },
    questions: {
      choice: {
        type: 'choice',
        instructions: decision,
        criteria,
      },
    },
  }
}

interface JevChoiceAnswer {
  readonly type?: unknown
  readonly choice?: unknown
  readonly probabilities?: unknown
  readonly confidence?: unknown
  readonly answer_confidence?: unknown
}

/**
 * Convert a native response payload to the standard result.
 * @param payload - the parsed JSON response.
 * @param options - the caller's option labels, in order.
 * @returns the standard result.
 */
export function convertJevChoiceResponse(payload: unknown, options: readonly string[]): JevChoiceResult {
  if (typeof payload !== 'object' || payload === null) throw new JevError('invalid_response', 'the response is not an object')
  const answers = (payload as { answers?: unknown }).answers
  if (typeof answers !== 'object' || answers === null) throw new JevError('invalid_response', 'the response has no answers object')
  const answer = (answers as Record<string, unknown>).choice as JevChoiceAnswer | undefined
  if (typeof answer !== 'object' || answer === null) throw new JevError('invalid_response', 'the response has no choice answer')
  if (answer.type !== 'choice') throw new JevError('invalid_response', 'the choice answer has the wrong type')
  if (typeof answer.choice !== 'string') throw new JevError('invalid_response', 'the choice answer has no chosen id')
  const match = /^option_(\d+)$/.exec(answer.choice)
  if (match === null) throw new JevError('invalid_response', 'the chosen id is not a supplied option id')
  const chosen = Number(match[1])
  if (!Number.isInteger(chosen) || chosen < 0 || chosen >= options.length) {
    throw new JevError('invalid_response', 'the chosen option is outside the supplied option set')
  }
  const probabilities = answer.probabilities
  if (typeof probabilities !== 'object' || probabilities === null || Array.isArray(probabilities)) {
    throw new JevError('invalid_response', 'the answer carries no probability map')
  }
  const map = probabilities as Record<string, unknown>
  const expected = new Set(options.map((_, index) => `option_${index}`))
  const actual = Object.keys(map)
  if (actual.length !== expected.size || actual.some(key => !expected.has(key))) {
    throw new JevError('invalid_response', 'the probability map does not match the supplied options')
  }
  let sum = 0
  for (const key of actual) {
    const value = map[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new JevError('invalid_response', 'the probability map contains an invalid value')
    }
    sum += value
  }
  if (Math.abs(sum - 1) > 1e-6) throw new JevError('invalid_response', 'the probability mass is not normalized')
  const mass = chosen === undefined ? Number.NaN : Number(map[`option_${chosen}`])
  const reported = answer.confidence ?? answer.answer_confidence
  if (typeof reported !== 'number' || !Number.isFinite(reported) || reported < 0 || reported > 1) {
    throw new JevError('invalid_response', 'the answer carries no finite confidence in [0,1]')
  }
  // The reported confidence is the provider's own value; the probability mass is
  // retained in the map and named in the reason. Both are UNCALIBRATED (DEC-08).
  const label = options[chosen]!
  return {
    chosen,
    confidence: confidenceBucket(reported),
    reason: `Chose ${JSON.stringify(label)} (Jev uncalibrated probability ${mass.toFixed(4)}, conversion ${JEV_CONVERSION_VERSION}).`,
  }
}

/**
 * Ask Jev one choice question through its native API.
 * @param decision - the decision text.
 * @param options - the caller's labels.
 * @param config - API key, base URL, model and optional transport.
 * @param signal - cancellation.
 * @returns the standard result.
 */
export async function chooseWithJev(
  decision: string,
  options: readonly string[],
  config: JevClientConfig,
  signal?: AbortSignal,
): Promise<JevChoiceResult> {
  if (typeof config.apiKey !== 'string' || config.apiKey.trim().length === 0) {
    throw new JevError('api_key_missing', 'no Jev API key is configured')
  }
  const request = buildJevChoiceRequest(decision, options, config.model ?? JEV_DEFAULT_MODEL)
  const transport = config.fetch ?? fetch
  const base = (config.baseURL ?? JEV_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 30_000)
  const forwardAbort = (): void => controller.abort()
  signal?.addEventListener('abort', forwardAbort, { once: true })
  let response: Response
  try {
    response = await transport(`${base}/v1/systemone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) throw new JevError('aborted', 'the Jev call was aborted')
    throw new JevError('connection', 'the Jev request failed before a response arrived')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', forwardAbort)
  }
  if (!response.ok) throw new JevError('http', `the Jev service returned HTTP ${response.status}`, response.status)
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new JevError('invalid_response', 'the Jev response is not JSON')
  }
  return convertJevChoiceResponse(payload, options)
}

/** One atomic judgment question in the native multi-question shape. */
export type JevJudgmentQuestion =
  | { readonly id: string; readonly type: 'boolean'; readonly proposition: string }
  | { readonly id: string; readonly type: 'choice'; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> }

/** Native answers returned for a batch of independent judgments. */
export interface JevJudgmentsResult {
  readonly model: string
  readonly judgments: Readonly<Record<string, Record<string, unknown>>>
}

/** Build the native multi-question request. */
export function buildJevJudgmentsRequest(
  state: unknown,
  questions: readonly JevJudgmentQuestion[],
  model: string = JEV_DEFAULT_MODEL,
): { readonly model: string; readonly state: unknown; readonly questions: Record<string, unknown> } {
  if (!Array.isArray(questions) || questions.length === 0 || questions.length > 16) {
    throw new JevError('invalid_request', 'a judgment batch needs 1–16 questions')
  }
  const seen = new Set<string>()
  const native: Record<string, unknown> = {}
  for (const question of questions) {
    if (typeof question.id !== 'string' || question.id.length === 0 || question.id.length > 64) {
      throw new JevError('invalid_request', 'every question needs a 1–64 character id')
    }
    if (seen.has(question.id)) throw new JevError('invalid_request', `question id ${JSON.stringify(question.id)} is duplicated`)
    seen.add(question.id)
    if (question.type === 'boolean') {
      if (typeof question.proposition !== 'string' || question.proposition.trim().length === 0) {
        throw new JevError('invalid_request', `question ${question.id} needs a non-empty proposition`)
      }
      native[question.id] = { type: 'noul', instructions: question.proposition }
      continue
    }
    if (question.type !== 'choice') throw new JevError('invalid_request', `question ${question.id} has an unknown type`)
    if (typeof question.instructions !== 'string' || question.instructions.trim().length === 0) {
      throw new JevError('invalid_request', `question ${question.id} needs non-empty instructions`)
    }
    const entries = Object.entries(question.criteria ?? {})
    if (entries.length < 2 || entries.length > 32) throw new JevError('invalid_request', `question ${question.id} needs 2–32 criteria`)
    for (const [key, description] of entries) {
      if (key.length === 0 || typeof description !== 'string' || description.length === 0) {
        throw new JevError('invalid_request', `question ${question.id} has an invalid criterion`)
      }
    }
    native[question.id] = { type: 'choice', instructions: question.instructions, criteria: question.criteria }
  }
  return { model, state, questions: native }
}

/** Convert the native batch response; missing or invalid answers are errors. */
export function convertJevJudgmentsResponse(payload: unknown, questions: readonly JevJudgmentQuestion[]): JevJudgmentsResult {
  if (typeof payload !== 'object' || payload === null) throw new JevError('invalid_response', 'the response is not an object')
  const root = payload as { answers?: unknown; model?: unknown }
  if (typeof root.answers !== 'object' || root.answers === null) throw new JevError('invalid_response', 'the response has no answers object')
  const answers = root.answers as Record<string, unknown>
  const judgments: Record<string, Record<string, unknown>> = {}
  for (const question of questions) {
    const raw = answers[question.id]
    if (typeof raw !== 'object' || raw === null) throw new JevError('invalid_response', `the response is missing question ${question.id}`)
    const answer = raw as Record<string, unknown>
    if (question.type === 'boolean') {
      if (answer.type !== 'noul') throw new JevError('invalid_response', `question ${question.id} is not a noul answer`)
      const probability = answer.noul
      if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new JevError('invalid_response', `question ${question.id} has no probability in [0,1]`)
      }
      judgments[question.id] = { type: 'boolean', probability }
      continue
    }
    if (answer.type !== 'choice') throw new JevError('invalid_response', `question ${question.id} is not a choice answer`)
    const chosen = answer.choice
    if (chosen !== null && typeof chosen !== 'string') throw new JevError('invalid_response', `question ${question.id} has an invalid chosen value`)
    if (typeof chosen === 'string' && !Object.hasOwn(question.criteria, chosen)) {
      throw new JevError('invalid_response', `question ${question.id} chose ${JSON.stringify(chosen)}, not a supplied criterion`)
    }
    const probabilities = answer.probabilities
    if (typeof probabilities !== 'object' || probabilities === null || Array.isArray(probabilities)) {
      throw new JevError('invalid_response', `question ${question.id} has no probability map`)
    }
    const map = probabilities as Record<string, unknown>
    const expected = Object.keys(question.criteria)
    if (Object.keys(map).length !== expected.length || expected.some(key => !Object.hasOwn(map, key))) {
      throw new JevError('invalid_response', `question ${question.id} probability keys do not match its criteria`)
    }
    let sum = 0
    for (const key of expected) {
      const value = map[key]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new JevError('invalid_response', `question ${question.id} has an invalid probability`)
      }
      sum += value
    }
    if (Math.abs(sum - 1) > 1e-6) throw new JevError('invalid_response', `question ${question.id} probabilities are not normalized`)
    const confidence = answer.confidence
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new JevError('invalid_response', `question ${question.id} has no finite confidence`)
    }
    judgments[question.id] = { type: 'choice', chosen, probabilities: map, confidence }
  }
  return { model: typeof root.model === 'string' ? root.model : 'unknown', judgments }
}

/**
 * Ask independent atomic judgments in ONE native request.
 * @param state - the same state for every question.
 * @param questions - 1–16 independent questions.
 * @param config - API key, base URL, model and optional transport.
 * @param signal - cancellation.
 * @returns native judgments keyed by question id.
 */
export async function judgeWithJev(
  state: unknown,
  questions: readonly JevJudgmentQuestion[],
  config: JevClientConfig,
  signal?: AbortSignal,
): Promise<JevJudgmentsResult> {
  if (typeof config.apiKey !== 'string' || config.apiKey.trim().length === 0) {
    throw new JevError('api_key_missing', 'no Jev API key is configured')
  }
  const request = buildJevJudgmentsRequest(state, questions, config.model ?? JEV_DEFAULT_MODEL)
  const transport = config.fetch ?? fetch
  const base = (config.baseURL ?? JEV_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 30_000)
  const forwardAbort = (): void => controller.abort()
  signal?.addEventListener('abort', forwardAbort, { once: true })
  let response: Response
  try {
    response = await transport(`${base}/v1/systemone`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
  } catch {
    if (controller.signal.aborted) throw new JevError('aborted', 'the Jev call was aborted')
    throw new JevError('connection', 'the Jev request failed before a response arrived')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', forwardAbort)
  }
  if (!response.ok) throw new JevError('http', `the Jev service returned HTTP ${response.status}`, response.status)
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new JevError('invalid_response', 'the Jev response is not JSON')
  }
  return convertJevJudgmentsResponse(payload, questions)
}

/** The MCP contract for the atomic judgment batch. */
export const JEV_JUDGMENTS_CONTRACT = {
  contract: 'decision.judgments.jev',
  version: '1.0.0',
  toolName: 'decision_judgments_jev',
  description: 'Ask independent atomic boolean/choice questions through Jev in one native request.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['state', 'questions'],
    properties: {
      state: { type: 'object', additionalProperties: true },
      questions: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['model', 'judgments'],
    properties: {
      model: { type: 'string' },
      judgments: { type: 'object', additionalProperties: true },
    },
  },
  semantics: { deterministic: false, readsInputs: true },
  limits: {},
  unsupported: ['no local Jev weights', 'no chat schema'],
} as const

/** The MCP contract for the single-choice Jev tool. */
export const JEV_CHOOSE_CONTRACT = {
  contract: 'decision.choose.jev', version: '1.0.0', toolName: 'decision_choose_jev',
  description: 'Choose 2–16 options through the remote Jev typed-question API on the standard decision result.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['decision','options'], properties: { decision: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } } },
  outputSchema: { type: 'object', additionalProperties: false, required: ['chosen','confidence','reason'], properties: { chosen: { type: 'integer' }, confidence: { type: 'string', enum: ['confident','likely','tentative'] }, reason: { type: 'string' } } },
  semantics: { deterministic: false, readsInputs: true }, limits: {},
} as const
