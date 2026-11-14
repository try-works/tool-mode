/**
 * The gated REAL shapes run through createProviderFromRecipe.
 *
 * Skips with a stated reason unless TOOL_MODE_REAL_ASSETS=1 AND .assets/shapes/shapes.tflite
 * exists at the repository root. Assets are never downloaded or committed here.
 *
 * It asserts the two canonical strokes the model metadata predicts: a horizontal line is
 * class index 1 (line), an axis-aligned rectangle is index 3 (rectangle). Those indices were
 * measured on the pinned artifact; this test is the end-to-end re-proof through the factory,
 * the processor, the Effect session and the socket-free shim.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import type {
  InvocationContextV1,
  PreparedAssetMapV1,
} from '@try-works/tool-mode-extension-sdk'
import type { ModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'

import { createProviderFromRecipe } from '../src/index.ts'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const modelPath = path.join(repoRoot, '.assets', 'shapes', 'shapes.tflite')

const skipReason =
  process.env['TOOL_MODE_REAL_ASSETS'] !== '1'
    ? 'TOOL_MODE_REAL_ASSETS is not 1; real shapes inference not requested'
    : !existsSync(modelPath)
      ? 'real assets are not prepared: ' + modelPath + ' is missing'
      : false

const recipe: ModelRuntimeRecipe = {
  kind: 'model-runtime',
  schemaVersion: 1,
  provider: {
    package: '@try-works/tool-mode-runtime-litert',
    export: 'createProviderFromRecipe',
    accelerators: ['cpu'],
  },
  model: { assetSet: 'shapes-litert', fileName: 'shapes.tflite', format: 'tflite' },
  processor: { id: 'shapes/points-v1' },
  limits: { maxInputBytes: 4_194_304, timeoutMs: 120_000 },
  tool: {
    name: 'shape_recognize',
    description: 'Recognize one hand-drawn stroke.',
    inputSchema: './schemas/shape.input.json',
    outputSchema: './schemas/shape.output.json',
  },
}

const assets: PreparedAssetMapV1 = {
  assetIds: ['shapes-litert'],
  get: (id: string) =>
    id === 'shapes-litert' ? { path: path.dirname(modelPath), digest: 'sha256:real' } : undefined,
}

const signal = (): AbortSignal => new AbortController().signal

const context = (): InvocationContextV1 => ({
  invocationId: 'inv_real',
  signal: signal(),
  limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 0, maxResultBytes: 4_194_304 },
  resolvePath: (candidate: string) => candidate,
})

/** A closed axis-aligned rectangle, excluding the duplicated first point. */
const rectangleStroke = (): number[][] =>
  Array.from({ length: 64 }, (_, index) => {
    const t = (index / 64) * 4
    if (t < 1) return [t, 0]
    if (t < 2) return [1, t - 1]
    if (t < 3) return [1 - (t - 2), 1]
    return [0, 1 - (t - 3)]
  })

describe('the real shapes model through createProviderFromRecipe', () => {
  it(
    'recognizes a line as line and a rectangle as rectangle, deterministically',
    { skip: skipReason },
    async () => {
      const provider = createProviderFromRecipe(recipe, assets)
      await provider.load({ assets, signal: signal() })
      assert.equal((await provider.inspect(signal())).readiness, 'ready')

      const line = await provider.invoke({
        implementationId: 'shape-recognize',
        input: { points: [[0, 0], [100, 0]] },
        context: context(),
      })
      assert.equal(line['shape'], 'line')
      assert.equal(line['rejected'], false)
      const confidence = line['confidence']
      assert.ok(typeof confidence === 'number' && confidence > 0.5)

      const rectangle = await provider.invoke({
        implementationId: 'shape-recognize',
        input: { points: rectangleStroke(), closed: true },
        context: context(),
      })
      assert.equal(rectangle['shape'], 'rectangle')
      assert.equal(rectangle['rejected'], false)

      // The output is the full distribution split as top + 12 runner-ups, and it is stable.
      for (const output of [line, rectangle]) {
        const candidates = output['candidates']
        assert.ok(Array.isArray(candidates))
        assert.equal(candidates.length, 12)
        const scores = [
          output['confidence'] as number,
          ...candidates.map((candidate) => (candidate as { confidence: number }).confidence),
        ]
        const total = scores.reduce((sum, score) => sum + score, 0)
        assert.ok(Math.abs(total - 1) < 1e-3, 'the 13 class probabilities sum to 1; got ' + String(total))
        for (let index = 1; index < scores.length; index += 1) {
          assert.ok((scores[index] ?? 0) <= (scores[index - 1] ?? 0), 'candidates are strongest first')
        }
      }

      const again = await provider.invoke({
        implementationId: 'shape-recognize',
        input: { points: [[0, 0], [100, 0]] },
        context: context(),
      })
      assert.deepEqual(again, line)
    },
  )
})
