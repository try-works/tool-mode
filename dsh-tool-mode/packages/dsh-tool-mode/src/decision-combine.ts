/**
 * Code makes decisions (TypeSafe "Don't Call It a Decision Model", 2026-11-03).
 *
 * The model returns ATOMIC JUDGMENTS; this module combines facts and judgments
 * with explicit rules and returns the exit plus the evaluated trace. It calls no
 * model. A missing value is a failed check with `actual: null`, never a silent
 * truthy default, and the trace names every rule and condition examined.
 */

export type DecisionSource = 'fact' | 'judgment'
export type DecisionOperator = 'eq' | 'neq' | 'gte' | 'gt' | 'lte' | 'lt' | 'truthy' | 'falsy'

export interface DecisionCondition {
  readonly source: DecisionSource
  readonly key: string
  readonly op: DecisionOperator
  readonly value?: string | number | boolean
}

export interface DecisionRule {
  readonly id: string
  readonly when: readonly DecisionCondition[]
  readonly exit: string
}

export interface DecisionCheck {
  readonly source: DecisionSource
  readonly key: string
  readonly op: DecisionOperator
  readonly expected: string | number | boolean | null
  readonly actual: unknown
  readonly passed: boolean
}

export interface DecisionTraceEntry {
  readonly rule: string
  readonly matched: boolean
  readonly checks: readonly DecisionCheck[]
}

export interface DecisionResult {
  readonly exit: string
  readonly trace: readonly DecisionTraceEntry[]
  readonly fallback: boolean
}

const OPERATORS = new Set<DecisionOperator>(['eq', 'neq', 'gte', 'gt', 'lte', 'lt', 'truthy', 'falsy'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function readCondition(raw: unknown, label: string): DecisionCondition {
  if (!isRecord(raw)) throw new Error(`${label} must be an object`)
  if (raw.source !== 'fact' && raw.source !== 'judgment') throw new Error(`${label}.source must be fact or judgment`)
  if (typeof raw.key !== 'string' || raw.key.length === 0 || raw.key.length > 128) throw new Error(`${label}.key must be a non-empty string`)
  const op = raw.op
  if (typeof op !== 'string' || !OPERATORS.has(op as DecisionOperator)) throw new Error(`${label}.op is not supported`)
  if (raw.value !== undefined && !isScalar(raw.value)) throw new Error(`${label}.value must be a string, number or boolean`)
  if ((op === 'truthy' || op === 'falsy') && raw.value !== undefined) throw new Error(`${label}.value is not used by ${op}`)
  return {
    source: raw.source as DecisionSource,
    key: raw.key,
    op: op as DecisionOperator,
    ...raw.value === undefined ? {} : { value: raw.value },
  }
}

/** Validate and normalize a policy before evaluation. */
export function parseDecisionPolicy(
  facts: unknown,
  judgments: unknown,
  rules: unknown,
): { readonly facts: Record<string, unknown>; readonly judgments: Record<string, number>; readonly rules: readonly DecisionRule[] } {
  if (!isRecord(facts)) throw new Error('facts must be an object')
  if (!isRecord(judgments)) throw new Error('judgments must be an object of probabilities')
  const normalizedJudgments: Record<string, number> = {}
  for (const [key, value] of Object.entries(judgments)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`judgment ${JSON.stringify(key)} must be a finite probability in [0,1]`)
    }
    normalizedJudgments[key] = value
  }
  if (!Array.isArray(rules) || rules.length === 0 || rules.length > 64) throw new Error('rules must be 1–64 entries')
  const ids = new Set<string>()
  const parsed: DecisionRule[] = rules.map((raw, index) => {
    const label = `rules[${index}]`
    if (!isRecord(raw)) throw new Error(`${label} must be an object`)
    if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) throw new Error(`${label}.id must be a non-empty string`)
    if (ids.has(raw.id)) throw new Error(`rule id ${JSON.stringify(raw.id)} is duplicated`)
    ids.add(raw.id)
    if (!Array.isArray(raw.when) || raw.when.length === 0 || raw.when.length > 16) throw new Error(`${label}.when must be 1–16 conditions`)
    const when = raw.when.map((condition, conditionIndex) => readCondition(condition, `${label}.when[${conditionIndex}]`))
    if (typeof raw.exit !== 'string' || raw.exit.length === 0 || raw.exit.length > 256) throw new Error(`${label}.exit must be a non-empty string`)
    return { id: raw.id, when, exit: raw.exit }
  })
  return { facts, judgments: normalizedJudgments, rules: parsed }
}

function compare(actual: unknown, op: DecisionOperator, expected: unknown): boolean {
  if (actual === undefined || actual === null) return false
  if (op === 'truthy') return Boolean(actual)
  if (op === 'falsy') return !actual
  if (op === 'eq') return actual === expected
  if (op === 'neq') return actual !== expected
  if (typeof actual !== 'number' || typeof expected !== 'number' || !Number.isFinite(actual) || !Number.isFinite(expected)) return false
  switch (op) {
    case 'gte': return actual >= expected
    case 'gt': return actual > expected
    case 'lte': return actual <= expected
    case 'lt': return actual < expected
    default: return false
  }
}

/**
 * Evaluate the first matching rule; otherwise return the caller's explicit fallback.
 * @param facts - code-computed facts (booleans, numbers or strings).
 * @param judgments - model probabilities keyed by atomic judgment.
 * @param rules - first-match policy rules.
 * @param fallback - exit when no rule matches.
 * @returns exit, full trace, and whether the fallback was used.
 */
export function combineDecision(
  facts: unknown,
  judgments: unknown,
  rules: unknown,
  fallback: string,
): DecisionResult {
  const parsed = parseDecisionPolicy(facts, judgments, rules)
  if (typeof fallback !== 'string' || fallback.length === 0 || fallback.length > 256) {
    throw new Error('fallback must be a non-empty string')
  }
  const trace: DecisionTraceEntry[] = []
  for (const rule of parsed.rules) {
    const checks = rule.when.map((condition): DecisionCheck => {
      const actual = condition.source === 'fact' ? parsed.facts[condition.key] : parsed.judgments[condition.key]
      return {
        source: condition.source,
        key: condition.key,
        op: condition.op,
        expected: condition.value ?? null,
        actual: actual ?? null,
        passed: compare(actual, condition.op, condition.value),
      }
    })
    const matched = checks.every(check => check.passed)
    trace.push({ rule: rule.id, matched, checks })
    if (matched) return { exit: rule.exit, trace, fallback: false }
  }
  return { exit: fallback, trace, fallback: true }
}

/** The MCP contract for the pure combiner. */
export const DECISION_COMBINE_CONTRACT = {
  contract: 'decision.combine',
  version: '1.0.0',
  toolName: 'decision_combine',
  description: 'Combine code-computed facts and atomic model judgment probabilities through explicit first-match rules; returns the exit and full trace.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['facts', 'judgments', 'rules', 'fallback'],
    properties: {
      facts: { type: 'object', additionalProperties: true },
      judgments: { type: 'object', additionalProperties: true },
      rules: { type: 'array', items: { type: 'object', additionalProperties: true } },
      fallback: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['exit', 'fallback', 'trace'],
    properties: {
      exit: { type: 'string' },
      fallback: { type: 'boolean' },
      trace: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
  },
  semantics: { deterministic: true, readsInputs: true },
  limits: {},
  unsupported: ['no model call', 'no tool dispatch'],
} as const
