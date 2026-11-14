/**
 * The gated REAL moderator run.
 *
 * Skips with a stated reason unless TOOL_MODE_REAL_ASSETS=1 AND
 * .assets/moderator/moderator.tflite exists at the repository root. Assets are never
 * downloaded or committed here.
 *
 * PROVENANCE: HF desert-ant-labs/moderator revision
 * 263b727eedee2c439b4f35b4491ee80802ea8a6e; moderator.tflite 9,618,016 B sha256
 * 925d11966ea9086acbfeaf4d00c1dd30c738c531695f2004b68880d3f121cd89 (verified in this test).
 * Preprocessing and decision rules: Sources/Moderator/Preprocess.swift, Model.swift,
 * Moderator.swift (see src/pillow.ts, src/moderator.ts for the file:line references).
 *
 * OOD NOTE (measured 2026-11-14): a FLAT synthetic image is out of distribution and the model
 * returns arbitrary scores for it -- solid mid-grey scores 0.5691 (isNSFW true) at every
 * quality, while black scores 0.368 and white 0.316. That is a property of the model on flat
 * input, NOT a preprocessing defect: tests/moderator-golden.test.ts proves the decoder and the
 * crops are byte-identical to Pillow 13.0.0. This test therefore asserts the INTERNAL
 * CONSISTENCY of scores for the flat image, and a generated sky/ground image (an actual
 * picture-like input) asserts the ordinary isNSFW=false path.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  InvocationContextV1,
  JsonObject,
  PreparedAssetMapV1,
} from '@try-works/tool-mode-extension-sdk'
import type { ModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'

import { MODERATOR_HEADS, createProviderFromRecipe } from '../src/index.ts'
import { encodePng, solidRgb, type RasterImage } from './png-fixtures.ts'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const modelPath = path.join(repoRoot, '.assets', 'moderator', 'moderator.tflite')
const PINNED_BYTES = 9_618_016
const PINNED_SHA256 = '925d11966ea9086acbfeaf4d00c1dd30c738c531695f2004b68880d3f121cd89'

const skipReason =
  process.env['TOOL_MODE_REAL_ASSETS'] !== '1'
    ? 'TOOL_MODE_REAL_ASSETS is not 1; real moderator inference not requested'
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
  model: { assetSet: 'moderator-litert', fileName: 'moderator.tflite', format: 'tflite' },
  processor: { id: 'moderator/crops-v1' },
  limits: { maxInputBytes: 4_194_304, timeoutMs: 120_000 },
  tool: {
    name: 'classify_nsfw',
    description: 'Classify an image.',
    inputSchema: './schemas/moderator.input.json',
    outputSchema: './schemas/moderator.output.json',
  },
}

const signal = (): AbortSignal => new AbortController().signal

const context = (): InvocationContextV1 => ({
  invocationId: 'inv_real_moderator',
  signal: signal(),
  limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 0, maxResultBytes: 4_194_304 },
  resolvePath: (candidate: string) => candidate,
})

/** A picture-like synthetic input: sky blue over grass green. */
const bandsImage = (): RasterImage => {
  const width = 96
  const height = 96
  const pixels = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      const sky = y < height / 2
      pixels[offset] = sky ? 135 : 34
      pixels[offset + 1] = sky ? 206 : 139
      pixels[offset + 2] = sky ? 235 : 34
    }
  }
  return { width, height, channels: 3, pixels }
}

const regionOf = (output: JsonObject, head: string): number => {
  const regions = output['regions']
  assert.ok(typeof regions === 'object' && regions !== null && !Array.isArray(regions))
  const value = (regions as Record<string, unknown>)[head]
  assert.ok(typeof value === 'number', head + ' is a number')
  return value
}

/** Assert the output is internally consistent: standard score = max of the five heads. */
const assertConsistent = (output: JsonObject): number => {
  const values = MODERATOR_HEADS.map((head) => {
    const value = regionOf(output, head)
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, head + ' is finite in 0..1')
    return value
  })
  const score = output['score']
  assert.ok(typeof score === 'number' && Number.isFinite(score))
  assert.ok(Math.abs(score - Math.max(...values)) < 1e-9, 'standard score is the max of the five heads')
  assert.equal(output['isNSFW'], score >= (output['threshold'] as number))
  assert.deepEqual(Object.keys(output as Record<string, unknown>).sort(), [
    'crops', 'isNSFW', 'policy', 'quality', 'regions', 'score', 'threshold',
  ])
  return score
}

describe('the real moderator model through createProviderFromRecipe', () => {
  it(
    'scores generated PNGs: internally consistent on flat grey (OOD), SFW on a picture-like input',
    { skip: skipReason },
    async () => {
      const bytes = await readFile(modelPath)
      assert.equal(bytes.length, PINNED_BYTES, 'the pinned moderator.tflite size')
      assert.equal(createHash('sha256').update(bytes).digest('hex'), PINNED_SHA256, 'the pinned moderator.tflite sha256')

      const assets: PreparedAssetMapV1 = {
        assetIds: ['moderator-litert'],
        get: (id: string) =>
          id === 'moderator-litert' ? { path: path.dirname(modelPath), digest: PINNED_SHA256 } : undefined,
      }

      const dir = await mkdtemp(path.join(os.tmpdir(), 'litert-moderator-real-'))
      try {
        const provider = createProviderFromRecipe(recipe, assets)
        await provider.load({ assets, signal: signal() })
        assert.equal((await provider.inspect(signal())).readiness, 'ready')

        const invoke = (file: string, input: Readonly<Record<string, unknown>>) =>
          provider.invoke({
            implementationId: 'classify-nsfw',
            input: { image_path: file, ...input },
            context: context(),
          })

        // Flat mid-grey: OOD. Assert consistency, finite values and determinism -- not a class.
        const grey = path.join(dir, 'grey.png')
        await writeFile(grey, encodePng(solidRgb(96, 96, 128, 128, 128)))
        const greyFast = await invoke(grey, { quality: 'fast' })
        assertConsistent(greyFast)
        assert.equal(greyFast['quality'], 'fast')
        assert.equal(greyFast['crops'], 1)
        const greyFastAgain = await invoke(grey, { quality: 'fast' })
        assert.deepEqual(greyFastAgain, greyFast, 'the flat-image scores are deterministic')
        const greyBalanced = await invoke(grey, { quality: 'balanced' })
        assertConsistent(greyBalanced)
        assert.equal(greyBalanced['crops'], 4)

        // A sky/ground picture-like input: the ordinary SFW decision path. fast + balanced run
        // the real model here; accurate (8 crops, the same code path plus mirrors) is covered
        // bit-exactly by moderator-golden.test.ts and by the fake-session crop-count test.
        const bands = path.join(dir, 'bands.png')
        await writeFile(bands, encodePng(bandsImage()))
        for (const quality of ['fast', 'balanced'] as const) {
          const output = await invoke(bands, { quality })
          const score = assertConsistent(output)
          assert.equal(output['quality'], quality)
          assert.equal(output['crops'], quality === 'fast' ? 1 : 4)
          assert.equal(output['isNSFW'], false, quality + ' sky/ground image is not NSFW (score ' + String(score) + ')')
        }
        const bandsFirst = await invoke(bands, { quality: 'fast' })
        const bandsAgain = await invoke(bands, { quality: 'fast' })
        assert.deepEqual(bandsAgain, bandsFirst, 'the real inference is deterministic')
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  )
})
