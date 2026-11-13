/**
 * DEC-06 — the canonical TYPED decision tools over the same prepared Laya
 * checkpoint, as independent ordinary tools.
 *
 * The typed pair is deliberately separate from decision_test/decision_score
 * (compatibility tools): `decision_test_typed` reports the native P(proposition)
 * and a disclosed boolean policy, and `decision_score_typed` reports the native
 * ORDINAL distribution plus a fractional expected index. Neither fabricates a
 * hard label or a calibrated probability.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { discoverExtension } from '@try-works/tool-mode-extension-sdk'
import { DecisionInputError } from '../src/pure.ts'
import {
  decisionScorePrompt,
  decisionTestPrompt,
  TYPED_BOOLEAN_ANSWER_THRESHOLD,
  TYPED_LEVEL_DESCRIPTION_MAX,
  TYPED_LEVEL_ID_MAX,
  TYPED_LEVEL_MAX,
  TYPED_LEVEL_MIN,
  TYPED_STATE_MAX,
  TYPED_TEXT_MAX,
  typedQuestionPlan,
  typedScoreFromNative,
  typedTestFromNative,
  validateDecisionScoreInput,
  validateDecisionTestInput,
} from '../src/typed-decision.ts'

const PACKAGE_DIR = join(process.cwd(), 'packages', 'extension-laya')
const SCHEMA_DIR = join(PACKAGE_DIR, 'schema')

function schema(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')) as Record<string, unknown>
}

const state = 'The sky is cloudy and the forecast claims rain is likely.'
const levels = [
  { id: 'low', description: 'no confidence at all' },
  { id: 'mid', description: 'some confidence' },
  { id: 'high', description: 'very confident' },
]

test('DEC-06: the manifest publishes both typed tools WITHOUT changing the compatibility trio', () => {
  const manifest = discoverExtension(PACKAGE_DIR).manifest
  assert.deepEqual(
    manifest.tools.map(tool => tool.name),
    ['decision_choose_local', 'decision_choose', 'decision_test', 'decision_score', 'decision_test_typed', 'decision_score_typed'],
  )
  const byName = new Map(manifest.tools.map(tool => [tool.name, tool]))
  const typedTest = byName.get('decision_test_typed')!
  const typedScore = byName.get('decision_score_typed')!
  assert.equal(typedTest.contractId, '@try-works/extension-laya/decision_test_typed')
  assert.equal(typedScore.contractId, '@try-works/extension-laya/decision_score_typed')
  assert.equal(typedTest.inputSchema, './schema/decision-test-typed.input.json')
  assert.equal(typedTest.outputSchema, './schema/decision-test-typed.output.json')
  assert.equal(typedScore.inputSchema, './schema/decision-score-typed.input.json')
  assert.equal(typedScore.outputSchema, './schema/decision-score-typed.output.json')
  // The compatibility tools keep their original schema files and contracts.
  assert.equal(byName.get('decision_test')!.inputSchema, './schema/decision-test.input.json')
  assert.equal(byName.get('decision_score')!.outputSchema, './schema/decision-score.output.json')
  // TOOL-02: the caller-facing standard tool speaks the standard contract.
  const standardChoose = byName.get('decision_choose')!
  assert.equal(standardChoose.contractId, 'decision.choose')
  assert.equal(standardChoose.inputSchema, './schema/decision-choose-standard.input.json')
  assert.equal(standardChoose.outputSchema, './schema/decision-choose-standard.output.json')
  assert.equal(byName.get('decision_choose_local')!.contractId, '@try-works/extension-laya/decision_choose_local')
  assert.equal(manifest.implementations.length, 6)
  const implementationIds = manifest.implementations.map(implementation => implementation.id)
  assert.ok(implementationIds.includes('laya-onnx-decision-test-typed'))
  assert.ok(implementationIds.includes('laya-onnx-decision-score-typed'))
  // Descriptions disclose the bounds and the uncalibrated posture, not a generic JSON claim.
  assert.match(typedTest.description, /32768/)
  assert.match(typedTest.description, /4096/)
  assert.match(typedTest.description, /UNCALIBRATED/)
  assert.match(typedScore.description, /2.{0,3}32/)
  assert.match(typedScore.description, /expected index/)
  assert.match(typedScore.description, /UNCALIBRATED/)
})

test('DEC-06: the typed schemas are closed and carry exactly the declared fields', () => {
  const testInput = schema('decision-test-typed.input.json')
  assert.equal(testInput['additionalProperties'], false)
  assert.deepEqual(testInput['required'], ['state', 'proposition'])
  const testInputProperties = testInput['properties'] as Record<string, Record<string, unknown>>
  assert.deepEqual(Object.keys(testInputProperties).sort(), ['proposition', 'state'])
  assert.equal(testInputProperties['state']!['maxLength'], TYPED_STATE_MAX)
  assert.equal(testInputProperties['proposition']!['maxLength'], TYPED_TEXT_MAX)

  const testOutput = schema('decision-test-typed.output.json')
  assert.equal(testOutput['additionalProperties'], false)
  assert.deepEqual(testOutput['required'], ['status', 'answer', 'probabilityTrue', 'probabilityKind'])
  const testOutputProperties = testOutput['properties'] as Record<string, Record<string, unknown>>
  assert.deepEqual(Object.keys(testOutputProperties).sort(), ['answer', 'probabilityKind', 'probabilityTrue', 'status'])
  assert.deepEqual(testOutputProperties['status']!['enum'], ['answered', 'abstained'])
  assert.equal(testOutputProperties['probabilityKind']!['const'], 'model_probability')
  assert.deepEqual(testOutputProperties['answer']!['type'], ['boolean', 'null'])
  assert.deepEqual(testOutputProperties['probabilityTrue']!['type'], ['number', 'null'])

  const scoreInput = schema('decision-score-typed.input.json')
  assert.equal(scoreInput['additionalProperties'], false)
  assert.deepEqual(scoreInput['required'], ['state', 'question', 'levels'])
  const scoreInputProperties = scoreInput['properties'] as Record<string, Record<string, unknown>>
  assert.deepEqual(Object.keys(scoreInputProperties).sort(), ['levels', 'question', 'state'])
  assert.equal(scoreInputProperties['levels']!['minItems'], TYPED_LEVEL_MIN)
  assert.equal(scoreInputProperties['levels']!['maxItems'], TYPED_LEVEL_MAX)
  const levelItems = scoreInputProperties['levels']!['items'] as Record<string, unknown>
  assert.equal(levelItems['additionalProperties'], false)
  assert.deepEqual(levelItems['required'], ['id', 'description'])

  const scoreOutput = schema('decision-score-typed.output.json')
  assert.equal(scoreOutput['additionalProperties'], false)
  assert.deepEqual(scoreOutput['required'], ['status', 'expectedIndex', 'probabilities', 'probabilityKind'])
  const scoreOutputProperties = scoreOutput['properties'] as Record<string, Record<string, unknown>>
  assert.deepEqual(Object.keys(scoreOutputProperties).sort(), ['expectedIndex', 'probabilities', 'probabilityKind', 'status'])
  assert.deepEqual(scoreOutputProperties['status']!['enum'], ['scored', 'abstained'])
  assert.deepEqual(scoreOutputProperties['expectedIndex']!['type'], ['number', 'null'])
  const probabilityItem = (scoreOutputProperties['probabilities']!['items']) as Record<string, unknown>
  assert.equal(probabilityItem['additionalProperties'], false)
  assert.deepEqual(probabilityItem['required'], ['levelId', 'probability'])
})

test('DEC-06: typed test maps the native P(true) through the disclosed policy, never a hard claim', () => {
  const input = validateDecisionTestInput({ state, proposition: 'It will rain.' })
  const answered = typedTestFromNative(input, {
    probabilities: { false: 0.2, true: 0.8 },
  })
  assert.equal(answered.status, 'answered')
  assert.equal(answered.answer, true)
  assert.equal(answered.probabilityTrue, 0.8)
  assert.equal(answered.probabilityKind, 'model_probability')
  const below = typedTestFromNative(input, { probabilities: { false: 0.7, true: 0.3 } })
  assert.equal(below.answer, false, `P(true)=0.3 is below the reviewed threshold ${TYPED_BOOLEAN_ANSWER_THRESHOLD}`)
  assert.equal(below.probabilityTrue, 0.3)
  // The plan asks the SAME prepared head a native yes/no question.
  const plan = typedQuestionPlan('laya-onnx-decision-test-typed', input)
  assert.deepEqual(plan, {
    kind: 'test',
    questionType: 'choice',
    criteria: { true: null, false: null },
    prompt: decisionTestPrompt(input),
    expectedProbabilities: 2,
  })
})

test('DEC-06: typed score preserves the native ordinal distribution and a FRACTIONAL expected index', () => {
  const input = validateDecisionScoreInput({ state, question: 'How confident?', levels })
  const output = typedScoreFromNative(input, { probabilities: { 0: 0.1, 1: 0.2, 2: 0.7 } })
  assert.equal(output.status, 'scored')
  assert.equal(output.expectedIndex, 0.1 * 0 + 0.2 * 1 + 0.7 * 2)
  assert.ok(Math.abs((output.expectedIndex ?? 0) - 1.6) < 1e-12)
  assert.deepEqual(output.probabilities, [
    { levelId: 'low', probability: 0.1 },
    { levelId: 'mid', probability: 0.2 },
    { levelId: 'high', probability: 0.7 },
  ])
  assert.equal(output.probabilityKind, 'model_probability')
  // No hard label field exists at all: converting the expectation would be a fabrication.
  assert.equal(Object.keys(output).includes('score'), false)
  const plan = typedQuestionPlan('laya-onnx-decision-score-typed', input)
  assert.deepEqual(plan, {
    kind: 'score',
    questionType: 'score',
    criteria: ['no confidence at all', 'some confidence', 'very confident'],
    prompt: decisionScorePrompt(input),
    expectedProbabilities: 3,
  })
})

test('DEC-06: abstention reports nulls and an empty distribution, never a guessed answer', () => {
  const testInput = validateDecisionTestInput({ state, proposition: 'It will rain.' })
  const testAbstained = typedTestFromNative(testInput, undefined)
  assert.deepEqual(testAbstained, {
    status: 'abstained', answer: null, probabilityTrue: null, probabilityKind: 'model_probability',
  })
  assert.equal(typedTestFromNative(testInput, { probabilities: { true: 0.9, false: 0.1 }, low_confidence: true }).status, 'abstained')

  const scoreInput = validateDecisionScoreInput({ state, question: 'How confident?', levels })
  assert.deepEqual(typedScoreFromNative(scoreInput, undefined), {
    status: 'abstained', expectedIndex: null, probabilities: [], probabilityKind: 'model_probability',
  })
  assert.equal(typedScoreFromNative(scoreInput, { probabilities: { 0: 1 }, low_confidence: true }).status, 'abstained')
})

test('DEC-06: level bounds, unique ids AND descriptions, and closed inputs are enforced', () => {
  assert.equal(TYPED_LEVEL_MIN, 2)
  assert.equal(TYPED_LEVEL_MAX, 32)
  assert.throws(() => validateDecisionScoreInput({ state, question: 'q', levels: [levels[0]!] }), /2\.\.32/)
  const tooMany = Array.from({ length: TYPED_LEVEL_MAX + 1 }, (_, index) => ({ id: `l${index}`, description: `d${index}` }))
  assert.throws(() => validateDecisionScoreInput({ state, question: 'q', levels: tooMany }), /2\.\.32/)
  assert.throws(
    () => validateDecisionScoreInput({ state, question: 'q', levels: [levels[0]!, { id: 'low', description: 'other' }] }),
    /unique id/,
  )
  assert.throws(
    () => validateDecisionScoreInput({ state, question: 'q', levels: [levels[0]!, { id: 'other', description: levels[0]!.description }] }),
    /unique description/,
  )
  assert.throws(
    () => validateDecisionScoreInput({ state, question: 'q', levels: [{ id: 'a', description: '' }, { id: 'b', description: 'x' }] }),
    /non-empty|description/,
  )
  assert.throws(
    () => validateDecisionScoreInput({ state, question: 'q', levels: [{ id: 'a'.repeat(TYPED_LEVEL_ID_MAX + 1), description: 'x' }, { id: 'b', description: 'y' }] }),
    /id must be at most/,
  )
  assert.throws(
    () => validateDecisionScoreInput({ state, question: 'q', levels: [{ id: 'a', description: 'x'.repeat(TYPED_LEVEL_DESCRIPTION_MAX + 1) }, { id: 'b', description: 'y' }] }),
    /description must be at most/,
  )
  assert.throws(() => validateDecisionTestInput({ state, proposition: 'p', extra: true }), /unknown field/)
  assert.throws(() => validateDecisionTestInput({ state: '', proposition: 'p' }), /state/)
  assert.throws(() => validateDecisionTestInput({ state: 's'.repeat(TYPED_STATE_MAX + 1), proposition: 'p' }), /state/)
  assert.throws(() => validateDecisionTestInput({ state, proposition: 'p'.repeat(TYPED_TEXT_MAX + 1) }), /proposition/)
})

test('DEC-06: truncation and indistinguishability are rejected for the typed tools too (DEC-05)', () => {
  const testInput = validateDecisionTestInput({ state, proposition: 'It will rain.' })
  assert.throws(
    () => typedTestFromNative(testInput, { probabilities: { true: 0.9, false: 0.1 } }, { truncated: true, state_tokens_dropped: 3 }),
    (error: unknown) => error instanceof DecisionInputError && error.code === 'INPUT_TRUNCATED',
  )
  assert.throws(
    () => typedTestFromNative(testInput, { probabilities: { true: 0.9, false: 0.1 } }, { options: { true: 1 } }),
    (error: unknown) => error instanceof DecisionInputError && error.code === 'INDISTINGUISHABLE_OPTIONS',
  )
  const scoreInput = validateDecisionScoreInput({ state, question: 'How confident?', levels })
  assert.throws(
    () => typedScoreFromNative(scoreInput, { probabilities: { 0: 0.2, 1: 0.3, 2: 0.5 } }, { truncated: true }),
    (error: unknown) => error instanceof DecisionInputError && error.code === 'INPUT_TRUNCATED',
  )
})

test('DEC-06: the typed plans do not intercept the existing implementations', () => {
  for (const existing of ['laya-onnx-decision-choose', 'laya-onnx-decision-test', 'laya-onnx-decision-score']) {
    assert.equal(typedQuestionPlan(existing, {}), undefined)
  }
  const valid = { state, proposition: 'It will rain.' }
  // A malformed typed request fails at validation rather than returning a plan.
  assert.throws(() => typedQuestionPlan('laya-onnx-decision-test-typed', { state: '' }), /state/)
  assert.equal(typedQuestionPlan('laya-onnx-decision-test-typed', valid)?.kind, 'test')
})
