/**
 * The real-inference gate for clear/stft-v1 (PHASE3).
 *
 * Skipped unless TOOL_MODE_REAL_ASSETS=1 and the pinned artifact is present under
 * .assets/clear (see scripts/fetch-clear-assets.mjs). When it runs it drives the REAL
 * onnxruntime-node CPU session through the same factory the host calls, on a synthetic
 * 48 kHz clip. It proves the graph accepts the host-computed features, the response
 * contract holds, and the audio comes back bounded — it does NOT claim enhancement
 * quality on a synthetic clip.
 *
 * @module tests/real-clear
 */

/*
 * The payload is the JSON a HOST receives (`JsonObject`), so these assertions read through
 * `JsonValue` deliberately: they check the response contract, not a provider type.
 */
/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion */

import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { InvocationContextV1, JsonObject, PreparedAssetMapV1 } from '@try-works/tool-mode-extension-sdk'

import {
  CLEAR_PEAK_CEILING_DBTP,
  CLEAR_SAMPLE_RATE,
  CLEAR_STFT_PROCESSOR,
  createProviderFromRecipe,
  type ProviderFactoryOptions,
} from '../src/index.ts'
import { decodeWav } from '../src/wav.ts'
import { buildWav, invocationContext, uhmRecipe, withTempDir } from './support.ts'

/** The prepared-asset directory this repo's fetch script writes. */
const ASSETS_DIR = fileURLToPath(new URL('../../../.assets/clear/', import.meta.url))
/** The pinned clear artifact. */
const MODEL_PATH = join(ASSETS_DIR, 'clear-studio.onnx')

/** The host-shaped prepared map for the pinned artifact (asset-file projection). */
function preparedAssets(): PreparedAssetMapV1 {
  return {
    assetIds: ['clear-onnx'],
    get: (assetId) =>
      assetId === 'clear-onnx'
        ? { path: MODEL_PATH, digest: 'sha256:4176990296374e972f0c347ddcc7988d216829cafc58e4d54a98dccd715107d9' }
        : undefined,
  }
}

/** The recipe extension-clear-recipe ships. */
function clearRecipe() {
  return uhmRecipe({
    model: { assetSet: 'clear-onnx', fileName: 'clear-studio.onnx', format: 'onnx' },
    processor: { id: CLEAR_STFT_PROCESSOR },
    tool: {
      name: 'enhance_speech',
      description: 'Denoise and dereverb a speech recording.',
      inputSchema: './schemas/enhance-speech.input.json',
      outputSchema: './schemas/enhance-speech.output.json',
    },
  })
}

const enabled = process.env.TOOL_MODE_REAL_ASSETS === '1'
const skip = !enabled
  ? 'TOOL_MODE_REAL_ASSETS is not 1'
  : !existsSync(MODEL_PATH)
    ? '.assets/clear/clear-studio.onnx is absent; run node scripts/fetch-clear-assets.mjs'
    : false

/** A deterministic synthetic clip: two tones plus low noise, one second at 48 kHz. */
function syntheticClip(): Float32Array {
  const samples = new Float32Array(CLEAR_SAMPLE_RATE)
  let state = 123_456_789
  for (let i = 0; i < samples.length; i += 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    const noise = ((state / 0xffff_ffff) * 2 - 1) * 0.02
    const tone = 0.15 * Math.sin((2 * Math.PI * 220 * i) / CLEAR_SAMPLE_RATE)
      + 0.05 * Math.sin((2 * Math.PI * 660 * i) / CLEAR_SAMPLE_RATE)
    samples[i] = tone + noise
  }
  return samples
}

/** Max absolute sample. */
function peak(samples: Float32Array): number {
  let max = 0
  for (const value of samples) max = Math.max(max, Math.abs(value))
  return max
}

describe('clear real inference', () => {
  it('enhances a synthetic 48 kHz clip through the pinned artifact', { skip }, async () => {
    await withTempDir(async (dir) => {
      const input = syntheticClip()
      const wavPath = join(dir, 'synthetic.wav')
      await writeFile(wavPath, buildWav({ sampleRate: CLEAR_SAMPLE_RATE, samples: input }))

      const assets = preparedAssets()
      const provider = createProviderFromRecipe(clearRecipe(), assets, {} satisfies ProviderFactoryOptions)
      const controller = new AbortController()
      await provider.load({ assets, signal: controller.signal })
      assert.equal((await provider.inspect(controller.signal)).readiness, 'ready')

      const context: InvocationContextV1 = invocationContext({ signal: controller.signal })
      const started = Date.now()
      const payload = await provider.invoke({
        implementationId: 'enhance-speech',
        input: { audio_path: wavPath } as JsonObject,
        context,
      })
      console.log('clear real payload: keys', JSON.stringify(Object.keys(payload).sort()), 'in', String(Date.now() - started), 'ms')

      assert.deepEqual(Object.keys(payload).sort(), ['audio_base64', 'coverage', 'durationSeconds', 'sampleRate'])
      assert.equal(payload['sampleRate'], CLEAR_SAMPLE_RATE)
      assert.ok(Math.abs((payload['durationSeconds'] as number) - 1) < 1e-6)

      const coverage = payload['coverage']
      if (typeof coverage !== 'object' || coverage === null || Array.isArray(coverage)) assert.fail('coverage must be an object')
      assert.equal(coverage['complete'], true)
      assert.ok(Math.abs((coverage['totalSeconds'] as number) - 1) < 1e-6)

      const base64 = payload['audio_base64']
      if (typeof base64 !== 'string') assert.fail('audio_base64 must be a string')
      const wav = new Uint8Array(Buffer.from(base64, 'base64'))
      const decoded = decodeWav(wav)
      if (!decoded.ok) assert.fail('the enhanced WAV must decode: ' + decoded.reason)
      assert.equal(decoded.audio.sampleRate, CLEAR_SAMPLE_RATE)
      assert.equal(decoded.audio.channels, 1)
      assert.equal(decoded.audio.samples.length, CLEAR_SAMPLE_RATE)
      for (const value of decoded.audio.samples) assert.ok(Number.isFinite(value))
      // The mastering limiter holds the -1.5 dBTP ceiling.
      assert.ok(peak(decoded.audio.samples) <= Math.pow(10, CLEAR_PEAK_CEILING_DBTP / 20) + 1e-6)

      // Log how far the model moved the signal, without claiming quality on a synthetic
      // clip: a broken feature layout would still produce finite, bounded audio.
      let signal = 0
      let difference = 0
      for (let i = 0; i < input.length; i += 1) {
        signal += (input[i] ?? 0) ** 2
        difference += ((decoded.audio.samples[i] ?? 0) - (input[i] ?? 0)) ** 2
      }
      console.log(
        'clear real change: rms ratio',
        (Math.sqrt(difference / Math.max(1, signal))).toFixed(3),
        'output peak',
        peak(decoded.audio.samples).toFixed(4),
      )
      await provider.dispose()
    })
  })
})
