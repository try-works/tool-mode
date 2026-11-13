import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { discoverExtension } from '@try-works/tool-mode-extension-sdk'
import { answerConfidence, assertDecisionInputSafe, decideFromLogits, DecisionInputError, mapProviderOptionKeys, MAX_OPTIONS, MAX_SCORE_LEVELS, scoreLevelFromProbabilities, softmax, standardChooseFromNative, validateOptions, validateProbabilityDistribution } from '../src/pure.ts'

const PACKAGE_DIR = join(process.cwd(), 'packages', 'extension-laya')

test('H5: softmax mirrors the vendored runtime (stable max subtraction)', () => {
  const p = softmax([1, 2, 3])
  const sum = p.reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9)
  assert.ok(p[0]! < p[1]! && p[1]! < p[2]!)
  // Large logits stay finite: the max-subtraction prevents overflow.
  const large = softmax([1000, 1000.1])
  assert.ok(Number.isFinite(large[0]) && Number.isFinite(large[1]))
})

test('H5: decideFromLogits argmaxes with EXACT ties broken by input order', () => {
  const tied = decideFromLogits(['a', 'b', 'c'], [0.5, 0.5, 0.1])
  assert.equal(tied.label, 'a')
  assert.ok(Math.abs(tied.probabilities[0]! - tied.probabilities[1]!) < 1e-9)
  const clear = decideFromLogits(['a', 'b'], [-1, 2])
  assert.equal(clear.label, 'b')
  assert.equal(clear.index, 1)
  // The confidence is the probability mass on the answer (answerConfidence).
  assert.equal(clear.confidence, answerConfidence(clear.probabilities))
  assert.ok(clear.confidence > 0.5)
})

test('H5: option bounds + duplicates + shape refusals are precise', () => {
  assert.deepEqual(validateOptions(['x', 'y'], MAX_OPTIONS), ['x', 'y'])
  assert.throws(() => validateOptions(['only-one'], MAX_OPTIONS), /at least 2 options/)
  assert.throws(() => validateOptions(Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => String(i)), MAX_OPTIONS), /exceed the 32-option bound/)
  assert.throws(() => validateOptions(['a', 'a'], MAX_OPTIONS), /duplicate option label/)
  assert.throws(() => validateOptions(['a', ''], MAX_OPTIONS), /non-empty string/)
  assert.throws(() => validateOptions(Array.from({ length: MAX_SCORE_LEVELS + 1 }, (_, i) => String(i)), MAX_SCORE_LEVELS), /exceed the 10-option bound/)
})

/**
 * A score answer is a DISTRIBUTION, not a label: the runtime reports an expected
 * value plus per-index probabilities. The contract wants the level label, so the
 * extension takes the argmax — the runtime's own `best()` — over the caller's
 * levels. The first live decision_score call failed the schema because the float
 * expected value was passed through as `score`.
 */
test('H5: a score distribution maps to the argmax level label', () => {
  const levels = ['low', 'medium', 'high']
  assert.equal(scoreLevelFromProbabilities({ 0: 0.2768, 1: 0.4107, 2: 0.3125 }, levels), 'medium')
  assert.equal(scoreLevelFromProbabilities({ 0: 0.9, 1: 0.05, 2: 0.05 }, levels), 'low')
  assert.equal(scoreLevelFromProbabilities({ 7: 0.9, 0: 0.1 }, levels), 'low', 'an out-of-range key is ignored')
  assert.equal(scoreLevelFromProbabilities({}, levels), null)
  assert.equal(scoreLevelFromProbabilities({ 0: Number.NaN, 1: 0.2 }, levels), 'medium')
})

test('H5: score distributions are validated for length, bounds, finiteness and sum', () => {
  assert.deepEqual(
    validateProbabilityDistribution({ 0: 0.2, 1: 0.3, 2: 0.5 }, 3),
    { 0: 0.2, 1: 0.3, 2: 0.5 },
  )
  assert.throws(() => validateProbabilityDistribution({ 0: 0.2, 1: 0.3 }, 3), /3 entries/)
  assert.throws(() => validateProbabilityDistribution({ 0: 0.5, 1: 0.5 }, 2) && validateProbabilityDistribution({ 0: 1.2, 1: -0.2 }, 2), /between 0 and 1/)
  assert.throws(() => validateProbabilityDistribution({ 0: Number.NaN, 1: 1 }, 2), /finite/)
  assert.throws(() => validateProbabilityDistribution({ 0: 0.2, 1: 0.2 }, 2), /sum to 1/)
})

test('H5: unsafe option IDs get a stable reversible provider-key mapping', () => {
  const mapping = mapProviderOptionKeys(['apple', '__proto__', 'constructor', 'prototype'])
  assert.deepEqual(Object.keys(mapping.criteria), ['apple', '__option_1', '__option_2', '__option_3'])
  assert.equal(mapping.toOriginal('__option_1'), '__proto__')
  assert.equal(mapping.toOriginal('__option_2'), 'constructor')
  assert.equal(mapping.toOriginal('__option_3'), 'prototype')
  assert.equal(mapping.toOriginal('apple'), 'apple')
  assert.deepEqual(mapping.originalToProvider, ['apple', '__option_1', '__option_2', '__option_3'])
  const restored = mapping.toOriginalProbabilities({ apple: 0.6, __option_1: 0.4 })
  assert.equal(restored['apple'], 0.6)
  assert.equal(restored['__proto__'], 0.4)
  assert.ok(Object.keys(restored).includes('__proto__'))
  // Stable across calls with the same input.
  assert.deepEqual(mapProviderOptionKeys(['apple', '__proto__']).originalToProvider, mapping.originalToProvider.slice(0, 2))
})

test('H5: permuted options keep the caller order and map probabilities back (AT-56)', () => {
  const mapping = mapProviderOptionKeys(['gamma', 'alpha', 'beta'])
  assert.deepEqual(mapping.originalToProvider, ['gamma', 'alpha', 'beta'])
  assert.deepEqual(Object.keys(mapping.criteria), ['gamma', 'alpha', 'beta'])
  const restored = mapping.toOriginalProbabilities({ gamma: 0.2, alpha: 0.3, beta: 0.5 })
  assert.deepEqual(Object.keys(restored), ['gamma', 'alpha', 'beta'])
  assert.equal(restored['beta'], 0.5)
  // The mapping is a bijection: every original label survives a round trip.
  for (const label of ['gamma', 'alpha', 'beta']) {
    assert.equal(mapping.toOriginal(mapping.originalToProvider[mapping.originalToProvider.indexOf(label)]!), label)
  }
})

test('H5: safe labels keep their native key unchanged', () => {
  const mapping = mapProviderOptionKeys(['yes', 'no'])
  assert.deepEqual(Object.keys(mapping.criteria), ['yes', 'no'])
  assert.deepEqual(mapping.originalToProvider, ['yes', 'no'])
})

test('DEC-05: dropped state tokens and collapsed options are rejected, not hidden', () => {
  assert.throws(
    () => assertDecisionInputSafe({ truncated: true, state_tokens_dropped: 17 }),
    (error: unknown) => error instanceof DecisionInputError && error.code === 'INPUT_TRUNCATED',
  )
  assert.throws(
    () => assertDecisionInputSafe({ options: { '__option_1': 2 } }),
    (error: unknown) => error instanceof DecisionInputError && error.code === 'INDISTINGUISHABLE_OPTIONS',
  )
  // A clean report does not throw.
  assertDecisionInputSafe({ truncated: false, state_tokens_dropped: 0 })
})

test('DEC-05: discovery reports the qualified token/option limits', () => {
  const discovery = discoverExtension(PACKAGE_DIR)
  const text = JSON.stringify(discovery.manifest.tools.map(tool => tool.description))
  assert.match(text, /512/)
  assert.match(text, /192/)
  assert.match(text, /16 options/)
})

test('H5: the manifest declares the decision family with the UNCALIBRATED honesty', () => {
  const discovery = discoverExtension(PACKAGE_DIR)
  const manifest = discovery.manifest
  assert.equal(manifest.id, '@try-works/extension-laya')
  assert.deepEqual(
    manifest.tools.map(tool => tool.name),
    ['decision_choose_local', 'decision_choose', 'decision_test', 'decision_score', 'decision_test_typed', 'decision_score_typed'],
  )
  assert.equal(manifest.implementations.length, 6)
  assert.match(manifest.description, /UNCALIBRATED/)
  assert.equal(manifest.network?.requiredTelemetry, false)
  assert.equal(manifest.network?.otherNetworkUse, false)
})

test('H5: the lock pins the six artifacts with the measured digests (no placeholder hashes)', () => {
  const lock = JSON.parse(readFileSync(join(PACKAGE_DIR, 'models.lock.json'), 'utf8')) as {
    assetSets: {
      'laya-decision-onnx': {
        conversion: { revision: string }
        groups: Array<{ assets: Array<{ digest: string; bytes: number; file: string }> }>
      }
    }
  }
  const set = lock.assetSets['laya-decision-onnx']!
  assert.equal(set.conversion.revision, '7b928d828b7b0e022f929d9bd2e44165aa270148')
  const assets = set.groups.flatMap(group => group.assets)
  assert.equal(assets.length, 6)
  const byFile = new Map(assets.map(asset => [asset.file, asset]))
  assert.equal(byFile.get('encoder.onnx')!.digest, 'A774C5C634B99D1A4CED21ACBF11B9617A5CD55C7C7957BD52480B17D95A97F4')
  assert.equal(byFile.get('encoder.onnx')!.bytes, 2451566)
  assert.equal(byFile.get('encoder.onnx.data')!.bytes, 1227816960)
  assert.equal(byFile.get('head.onnx')!.digest, '7F6B9AC15D5FDF9EEBB352E66BDD3CE799D32885F1446014D268D8C53207858B')
  assert.equal(byFile.get('head.onnx.data')!.digest, '0292A4EB478C2C3EC0B6555B4A4093BC802E965654D7AEB4AC22907A17F261D3')
  assert.equal(byFile.get('tokenizer.json')!.digest, '609D8F4C067CD3950F88594C5A802616CEA245823836EF5848EE4FC40AAB5B6F')
  assert.equal(byFile.get('rl_agent_config.json')!.digest, '25061739243B617AD88D1219BA6F8A9C86C5881CA28DF024FA2D9B3B2FCC30C6')
})

test('TOOL-02: standard decision.choose maps to an option INDEX and revalidates the choice', () => {
  const options = ['red', 'green', 'blue']
  const chosen = standardChooseFromNative(options, 'green', { red: 0.1, green: 0.8, blue: 0.1 }, 0.8)
  assert.deepEqual(chosen, {
    chosen: 1,
    confidence: 'confident',
    reason: 'Chose "green" (uncalibrated probability 0.8000).',
  })
  assert.equal(standardChooseFromNative(options, null, { red: 0.1, green: 0.1, blue: 0.8 }, 0.8).chosen, 2)
  assert.throws(
    () => standardChooseFromNative(options, 'purple', { red: 0.5, green: 0.3, blue: 0.2 }, 0.5),
    /not one of the supplied options/,
  )
  assert.throws(() => standardChooseFromNative(['only-one'], null, { 'only-one': 1 }, 1), /at least 2 options/)
})
