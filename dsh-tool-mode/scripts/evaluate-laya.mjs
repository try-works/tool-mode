#!/usr/bin/env node
/**
 * AT-57 — reproducible held-out Laya metrics, coverage and calibration report.
 *
 * Runs the REAL pinned checkpoint through the vendored laya-ts runtime over the
 * held-out fixture in docs/tool-mode/evaluation/laya-heldout.json. It reports
 * accuracy, coverage, abstention and confidence-bin calibration, and writes the
 * result. It never tunes the adapter with these prompts and never calls a
 * schema-valid decision "correct" by definition.
 *
 * Usage: node scripts/evaluate-laya.mjs [--out <path>]
 * Model dir: LAYA_MODEL_DIR (the pinned encoder/head/tokenizer/config directory).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
const MODEL_DIR = process.env.LAYA_MODEL_DIR ?? 'E:\\dsh-asset-cache\\groups\\@try-works__extension-laya\\laya\\text-backbone'
const FIXTURE = join(ROOT, 'docs', 'tool-mode', 'evaluation', 'laya-heldout.json')
const outIndex = process.argv.indexOf('--out')
const OUT = outIndex === -1 ? join(ROOT, 'docs', 'tool-mode', 'qualification', 'laya-evaluation.json') : resolve(process.argv[outIndex + 1])
const EXPECTED = {
  'encoder.onnx': 'A774C5C634B99D1A4CED21ACBF11B9617A5CD55C7C7957BD52480B17D95A97F4',
  'encoder.onnx.data': 'F1E49A027352064D72831863456BE6160748854296BFF8332DF14130DBF79834',
  'head.onnx': '7F6B9AC15D5FDF9EEBB352E66BDD3CE799D32885F1446014D268D8C53207858B',
  'head.onnx.data': '0292A4EB478C2C3EC0B6555B4A4093BC802E965654D7AEB4AC22907A17F261D3',
  'tokenizer.json': '609D8F4C067CD3950F88594C5A802616CEA245823836EF5848EE4FC40AAB5B6F',
  'rl_agent_config.json': '25061739243B617AD88D1219BA6F8A9C86C5881CA28DF024FA2D9B3B2FCC30C6',
}

const { Agent, createNodeProvider, decide } = await import(
  pathToFileURL(join(ROOT, 'packages', 'extension-laya', 'vendor', 'laya-ts', 'index.js')).href
)
const provider = await createNodeProvider(MODEL_DIR, { expectedSha256: EXPECTED, device: 'cpu' })
const agent = new Agent({ provider })
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const gates = JSON.parse(readFileSync(join(ROOT, 'docs', 'tool-mode', 'evaluation', 'laya-gates.json'), 'utf8'))
const bins = [
  { min: 0, max: 0.25 }, { min: 0.25, max: 0.5 }, { min: 0.5, max: 0.75 }, { min: 0.75, max: 1.0001 },
].map(bin => ({ ...bin, n: 0, correct: 0, confidenceSum: 0 }))
const results = []
let correct = 0
let attempted = 0

for (const item of fixture.items) {
  const started = Date.now()
  const options = item.kind === 'test' ? ['yes', 'no'] : item.options
  const answer = await decide(agent, item.prompt, null, {
    questions: {
      answer: {
        type: 'choice',
        instructions: item.prompt,
        criteria: Object.fromEntries(options.map(option => [option, null])),
      },
    },
  }).then(result => result.answer ?? Object.values(result.answers ?? {})[0])
  const choice = answer.choice ?? null
  const confidence = typeof answer.confidence === 'number' ? answer.confidence : null
  const isAttempt = choice !== null
  const isCorrect = isAttempt && choice === item.expected
  if (isAttempt) attempted += 1
  if (isCorrect) correct += 1
  results.push({
    id: item.id,
    kind: item.kind,
    prompt: item.prompt,
    expected: item.expected,
    choice,
    correct: isCorrect,
    confidence,
    calibrated: answer.calibrated === true,
    probabilities: answer.probabilities,
    action: answer.action,
    durationMs: Date.now() - started,
  })
  if (isAttempt && confidence !== null) {
    const bin = bins.find(candidate => confidence >= candidate.min && confidence < candidate.max) ?? bins.at(-1)
    bin.n += 1
    bin.confidenceSum += confidence
    if (isCorrect) bin.correct += 1
  }
}

const total = fixture.items.length
const withAttempt = bins.filter(bin => bin.n > 0)
const ece = withAttempt.reduce((sum, bin) => {
  const accuracy = bin.correct / bin.n
  const meanConfidence = bin.confidenceSum / bin.n
  return sum + (bin.n / total) * Math.abs(accuracy - meanConfidence)
}, 0)
/** Wilson score interval at 95%, appropriate for a small binomial sample. */
function wilson(successes, n, z = 1.959963984540054) {
  if (n === 0) return null
  const p = successes / n
  const denom = 1 + (z * z) / n
  const center = (p + (z * z) / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom
  return { low: Math.max(0, center - half), high: Math.min(1, center + half), method: 'Wilson score 95%', n }
}
const coverage = total === 0 ? null : attempted / total
const gatePassed = coverage !== null && coverage >= gates.minimumCoverage
const report = {
  acceptance: 'AT-57',
  recordedAt: new Date().toISOString(),
  modelDir: MODEL_DIR,
  fixture: { path: 'docs/tool-mode/evaluation/laya-heldout.json', version: fixture.version, schema: fixture.schema },
  gates: { path: 'docs/tool-mode/evaluation/laya-gates.json', version: gates.version, minimumCoverage: gates.minimumCoverage, passed: gatePassed },
  items: results,
  metrics: {
    total,
    attempted,
    correct,
    accuracy: total === 0 ? null : correct / total,
    coverage,
    abstentionRate: total === 0 ? null : (total - attempted) / total,
    confidenceIntervals: {
      accuracy: wilson(correct, total),
      coverage: wilson(attempted, total),
      note: '95% Wilson score intervals for the held-out sample; they describe this sample, not a population claim.',
    },
    calibration: {
      calibrated: false,
      note: 'The pinned Laya card ships uncalibrated logits/confidences; this report therefore measures raw confidence-bin calibration and never relabels it calibrated.',
      bins: bins.map(bin => ({
        range: `[${bin.min}, ${bin.max})`,
        n: bin.n,
        accuracy: bin.n === 0 ? null : bin.correct / bin.n,
        meanConfidence: bin.n === 0 ? null : bin.confidenceSum / bin.n,
      })),
      expectedCalibrationError: ece,
    },
  },
  limitations: [
    gates.sampleLimit,
    'Confidence is the model\'s raw uncalibrated value (DEC-08); no probability calibration is claimed.',
    'No Jev live endpoint is involved; Jev status remains independently reported.',
  ],
}
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
if (!gatePassed) {
  console.error(`LAYA-EVALUATION-GATE-FAIL coverage=${coverage} < minimumCoverage=${gates.minimumCoverage}`)
  process.exit(1)
}
console.log(`LAYA-EVALUATION-OK ${OUT} total=${total} correct=${correct} attempted=${attempted} accuracy=${report.metrics.accuracy?.toFixed(3)} coverage=${coverage?.toFixed(3)} ece=${ece.toFixed(4)} accuracyCI=${report.metrics.confidenceIntervals.accuracy?.low.toFixed(3)}-${report.metrics.confidenceIntervals.accuracy?.high.toFixed(3)}`)
