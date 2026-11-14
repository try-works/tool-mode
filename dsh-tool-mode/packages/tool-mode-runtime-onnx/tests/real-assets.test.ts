/**
 * The real-inference gate (PHASE3).
 *
 * Skipped unless TOOL_MODE_REAL_ASSETS=1 and the pinned assets are present under
 * .assets/uhm (see scripts/fetch-uhm-assets.mjs). When it runs it drives the REAL
 * onnxruntime-node CPU session through the same factory the host calls, on a synthetic
 * WAV. It proves the pinned geometry, the pipeline and the response contract — it does
 * NOT claim filler-detection quality, because a synthetic clip has no fillers to find.
 *
 * @module tests/real-assets
 */

/*
 * The payload is the JSON a HOST receives (`JsonObject`), so these assertions read through
 * `JsonValue` deliberately: they are checking the response contract, not a provider type.
 */
/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion */

import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Effect } from 'effect'

import type { InvocationContextV1, JsonObject, PreparedAssetMapV1 } from '@try-works/tool-mode-extension-sdk'

import {
  OnnxSession,
  UHM_FILLER_TYPES,
  UHM_SAMPLE_RATE,
  UHM_WAVEFORM_PROCESSOR,
  UHM_WINDOW_SAMPLES,
  createProviderFromRecipe,
  onnxLayer,
} from '../src/index.ts'
import { buildWav, invocationContext, sine, uhmRecipe, withTempDir } from './support.ts'

/** The prepared-asset directory this repo's fetch script writes. */
const ASSETS_DIR = fileURLToPath(new URL('../../../.assets/uhm/', import.meta.url))

/** The pinned uhm artifacts. */
const MODEL_PATH = join(ASSETS_DIR, 'uhm.onnx')
const LABELS_PATH = join(ASSETS_DIR, 'labels.json')

/** The same two projections the real host offers: asset file handles. */
function preparedAssets(): PreparedAssetMapV1 {
  return {
    assetIds: ['uhm-onnx', 'uhm-labels'],
    get: (assetId) =>
      assetId === 'uhm-onnx'
        ? { path: MODEL_PATH, digest: 'sha256:fbd19765def76893841e0c70e498bf632d6c68175ceae5a2da8fe3bf7d9d0314' }
        : assetId === 'uhm-labels'
          ? { path: LABELS_PATH, digest: 'sha256:9b3a8579b0185771f137873e5cbcbdd67572c34fdbeeac778580170c9248f9a3' }
          : undefined,
  }
}

const enabled = process.env.TOOL_MODE_REAL_ASSETS === '1'
const skip = !enabled
  ? 'TOOL_MODE_REAL_ASSETS is not 1'
  : !existsSync(MODEL_PATH)
    ? '.assets/uhm/uhm.onnx is absent; run node scripts/fetch-uhm-assets.mjs'
    : !existsSync(LABELS_PATH)
      ? '.assets/uhm/labels.json is absent; run node scripts/fetch-uhm-assets.mjs'
      : false

/** A synthetic one-second 440 Hz clip at the native rate. */
function syntheticClip(): Uint8Array {
  return buildWav({ sampleRate: UHM_SAMPLE_RATE, samples: sine(1) })
}

describe('uhm real inference', () => {
  it('reports the pinned (1,1499,6) output geometry', { skip }, async () => {
    const modelBytes = new Uint8Array(readFileSync(MODEL_PATH))
    const layer = onnxLayer({ modelBytes, accelerators: ['cpu'] })
    const geometry = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const session = yield* OnnxSession
          const inputName = session.inputNames[0]
          const outputName = session.outputNames[0]
          if (inputName === undefined || outputName === undefined) assert.fail('the pinned graph exposes no input/output')
          const outputs = yield* session.run({
            [inputName]: { data: new Float32Array(UHM_WINDOW_SAMPLES), dims: [1, UHM_WINDOW_SAMPLES] },
          })
          const output = outputs[outputName]
          if (output === undefined) assert.fail('the pinned graph produced no output')
          return { provider: session.executionProvider, dims: [...output.dims], length: output.data.length }
        }),
        layer,
      ),
    )
    console.log('uhm real geometry:', JSON.stringify(geometry))
    assert.equal(geometry.provider, 'cpu')
    assert.deepEqual(geometry.dims, [1, 1499, 6])
    assert.equal(geometry.length, 1499 * 6)
  })

  it('runs the factory end to end on a synthetic clip with honest coverage', { skip }, async () => {
    await withTempDir(async (dir) => {
      const wavPath = join(dir, 'synthetic.wav')
      await writeFile(wavPath, syntheticClip())
      const assets = preparedAssets()
      const provider = createProviderFromRecipe(uhmRecipe(), assets)
      const controller = new AbortController()
      await provider.load({ assets, signal: controller.signal })
      const inspection = await provider.inspect(controller.signal)
      assert.equal(inspection.readiness, 'ready')
      assert.deepEqual(inspection.features, [UHM_WAVEFORM_PROCESSOR])

      const context: InvocationContextV1 = invocationContext({ signal: controller.signal })
      const started = Date.now()
      const payload = await provider.invoke({
        implementationId: 'detect-fillers',
        input: { audio_path: wavPath } as JsonObject,
        context,
      })
      console.log('uhm real payload:', JSON.stringify(payload), 'in', String(Date.now() - started), 'ms')

      assert.deepEqual(Object.keys(payload).sort(), ['coverage', 'fillers'])
      const coverage = payload['coverage']
      if (typeof coverage !== 'object' || coverage === null || Array.isArray(coverage)) {
        assert.fail('coverage must be an object')
      }
      const fillers = payload['fillers']
      assert.ok(Array.isArray(fillers))
      assert.equal(coverage['complete'], true)
      assert.equal(coverage['totalSeconds'], 1)
      assert.equal(coverage['processedSeconds'], 1)
      for (const filler of fillers) {
        if (typeof filler !== 'object' || filler === null || Array.isArray(filler)) {
          assert.fail('a filler must be an object')
        }
        assert.ok(UHM_FILLER_TYPES.includes(filler['type'] as (typeof UHM_FILLER_TYPES)[number]))
        assert.ok(Number.isInteger(filler['startMs']))
        assert.ok(Number.isInteger(filler['endMs']))
        assert.ok((filler['startMs'] as number) >= 0)
        assert.ok((filler['endMs'] as number) <= 1000)
        assert.ok((filler['startMs'] as number) < (filler['endMs'] as number))
        assert.ok((filler['confidence'] as number) >= 0 && (filler['confidence'] as number) <= 1)
      }
      await provider.dispose()
    })
  })
})
