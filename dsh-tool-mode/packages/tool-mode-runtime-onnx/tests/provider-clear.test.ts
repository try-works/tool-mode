/**
 * createProviderFromRecipe / clear-stft-v1 tests (Phase 3, after uhm).
 *
 * The engine is a deterministic fake that ECHOES the spectrum input, so the test proves the
 * provider's contract and wiring: the descriptor, the 48 kHz pipeline, the model input
 * layout and lookahead, the response budget, the WAV envelope, the loudness stage and the
 * typed failures. It proves nothing about model quality; the gated real test runs the graph.
 *
 * @module tests/provider-clear
 */

/*
 * The payload is the JSON a HOST receives (`JsonObject`), so these assertions read through
 * `JsonValue` deliberately: they check the response contract, not a provider type.
 */
/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { InvocationContextV1, JsonObject, PreparedAssetMapV1 } from '@try-works/tool-mode-extension-sdk'
import type { ModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'
import { InferenceFailed, InvalidInput, RuntimeUnavailable } from '@try-works/tool-mode-runtime-core'

import {
  CLEAR_CHUNK_FRAMES,
  CLEAR_N_DF,
  CLEAR_N_ERB,
  CLEAR_N_FREQ,
  CLEAR_SAMPLE_RATE,
  CLEAR_STFT_PROCESSOR,
  CLEAR_TARGET_LUFS,
  CLEAR_MAX_GAIN_DB,
  createProviderFromRecipe,
  integratedLufs,
  type ProviderFactoryOptions,
} from '../src/index.ts'
import { decodeWav } from '../src/wav.ts'
import {
  buildWav,
  fakeLoader,
  invocationContext,
  uhmRecipe,
  withTempDir,
} from './support.ts'

/** Model bytes: the injected loader never parses them. */
const MODEL_BYTES = new Uint8Array([9, 9, 9])

/** A valid clear recipe, mirroring extension-clear-recipe. */
function clearRecipe(overrides: Partial<ModelRuntimeRecipe> = {}): ModelRuntimeRecipe {
  const base = uhmRecipe({
    model: { assetSet: 'clear-onnx', fileName: 'clear-studio.onnx', format: 'onnx' },
    processor: { id: CLEAR_STFT_PROCESSOR },
    tool: {
      name: 'enhance_speech',
      description: 'Denoise and dereverb a speech recording and return the enhanced 48 kHz mono WAV as base64, with honest coverage of the analysed audio.',
      inputSchema: './schemas/enhance-speech.input.json',
      outputSchema: './schemas/enhance-speech.output.json',
    },
  })
  return { ...base, ...overrides }
}

/** The host-shaped prepared map for the clear asset set (group directory projection). */
function clearAssets(directory: string): PreparedAssetMapV1 {
  return {
    assetIds: ['clear-onnx'],
    get: (assetId) => (assetId === 'clear-onnx' ? { path: directory, digest: 'sha256:clear' } : undefined),
  }
}

/** Write the fake model artifact into a temp directory. */
async function writeClearAssets(directory: string): Promise<string> {
  await writeFile(join(directory, 'clear-studio.onnx'), MODEL_BYTES)
  return directory
}

/** A 48 kHz sine. */
function sine(length: number, amplitude = 0.4, frequency = 440): Float32Array {
  const samples = new Float32Array(length)
  for (let i = 0; i < length; i += 1) samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / CLEAR_SAMPLE_RATE)
  return samples
}

/** An echo engine: spec_enhanced = spec, so the DSP round trip is what the assertions see. */
function echoLoader() {
  return fakeLoader({
    inputNames: ['spec', 'feat_erb', 'feat_spec'],
    outputNames: ['spec_enhanced'],
    run: async (call) => {
      const spec = call.feeds['spec']
      if (spec === undefined) throw new Error('the provider did not feed spec')
      return { spec_enhanced: { data: spec.data, dims: spec.dims } }
    },
  })
}

/** Load a provider over a prepared directory. */
async function loadProvider(directory: string, options: ProviderFactoryOptions = {}, recipe = clearRecipe()) {
  const assets = clearAssets(directory)
  const provider = createProviderFromRecipe(recipe, assets, options)
  await provider.load({ assets, signal: new AbortController().signal })
  return provider
}

/** Invoke with a context that authorizes the supplied path. */
function invoke(
  provider: ReturnType<typeof createProviderFromRecipe>,
  input: Readonly<JsonObject>,
  context: InvocationContextV1 = invocationContext(),
) {
  return provider.invoke({ implementationId: 'enhance-speech', input, context })
}

/** The rejection of a provider call. */
async function rejected(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof Error)
    return error
  }
  assert.fail('expected the call to reject')
}

/** The decoded audio a payload carries. */
interface DecodedPayloadAudio {
  readonly wav: Uint8Array
  readonly samples: Float32Array
  readonly sampleRate: number
  readonly channels: number
}

/** Read the audio out of a payload. */
function payloadAudio(payload: JsonObject): DecodedPayloadAudio {
  const base64 = payload['audio_base64']
  if (typeof base64 !== 'string') assert.fail('audio_base64 must be a string')
  const bytes = Buffer.from(base64, 'base64')
  const wav = new Uint8Array(bytes)
  const decoded = decodeWav(wav)
  if (!decoded.ok) assert.fail('the payload WAV must decode: ' + decoded.reason)
  return { wav, samples: decoded.audio.samples, sampleRate: decoded.audio.sampleRate, channels: decoded.audio.channels }
}

/** The coverage object of a payload. */
function payloadCoverage(payload: JsonObject): { complete: boolean; processedSeconds: number; totalSeconds: number; reason?: string } {
  const coverage = payload['coverage']
  if (typeof coverage !== 'object' || coverage === null || Array.isArray(coverage)) assert.fail('coverage must be an object')
  return coverage as { complete: boolean; processedSeconds: number; totalSeconds: number; reason?: string }
}

/** Max absolute sample. */
function peak(samples: Float32Array): number {
  let max = 0
  for (const value of samples) max = Math.max(max, Math.abs(value))
  return max
}

describe('createProviderFromRecipe — clear construction', () => {
  it('refuses a recipe that is not an ONNX artifact', () => {
    assert.throws(
      () => createProviderFromRecipe(clearRecipe({ model: { assetSet: 'clear-onnx', fileName: 'clear.tflite', format: 'tflite' } }), clearAssets('C:/none'), {}),
      /onnx/i,
    )
  })

  it('refuses a processor it does not implement, naming the two it does', () => {
    assert.throws(
      () => createProviderFromRecipe(clearRecipe({ processor: { id: 'redact/bert-v1' } }), clearAssets('C:/none'), {}),
      /clear\/stft-v1/,
    )
  })
})

describe('createProviderFromRecipe — clear graph binding', () => {
  it('fails load when the graph lacks a required input, naming the actual tensor names', async () => {
    await withTempDir(async (dir) => {
      await writeClearAssets(dir)
      const fake = fakeLoader({
        inputNames: ['spec', 'feat_erb'],
        outputNames: ['spec_enhanced'],
        run: async () => ({}),
      })
      const assets = clearAssets(dir)
      const provider = createProviderFromRecipe(clearRecipe(), assets, { loader: fake.loader })
      const error = await rejected(provider.load({ assets, signal: new AbortController().signal }))
      assert.ok(error.cause instanceof RuntimeUnavailable)
      assert.match(error.cause.reason, /feat_spec/)
      assert.match(error.cause.reason, /spec, feat_erb/)
    })
  })

  it('fails load when the graph lacks the spec_enhanced output', async () => {
    await withTempDir(async (dir) => {
      await writeClearAssets(dir)
      const fake = fakeLoader({
        inputNames: ['spec', 'feat_erb', 'feat_spec'],
        outputNames: ['enhanced'],
        run: async () => ({}),
      })
      const assets = clearAssets(dir)
      const provider = createProviderFromRecipe(clearRecipe(), assets, { loader: fake.loader })
      const error = await rejected(provider.load({ assets, signal: new AbortController().signal }))
      assert.ok(error.cause instanceof RuntimeUnavailable)
      assert.match(error.cause.reason, /spec_enhanced/)
      assert.match(error.cause.reason, /enhanced/)
    })
  })

  it('loads with the pinned tensor names and reports ready', async () => {
    await withTempDir(async (dir) => {
      await writeClearAssets(dir)
      const provider = await loadProvider(dir, { loader: echoLoader().loader })
      const inspection = await provider.inspect(new AbortController().signal)
      assert.equal(inspection.readiness, 'ready')
      assert.deepEqual(inspection.features, [CLEAR_STFT_PROCESSOR])
    })
  })
})

describe('createProviderFromRecipe — clear input contract', () => {
  it('refuses unknown keys, missing paths and unauthorized paths', async () => {
    await withTempDir(async (dir) => {
      await writeClearAssets(dir)
      const provider = await loadProvider(dir, { loader: echoLoader().loader })
      const wavPath = join(dir, 'audio.wav')
      await writeFile(wavPath, buildWav({ sampleRate: CLEAR_SAMPLE_RATE, samples: sine(480) }))

      const unknown = await rejected(invoke(provider, { audio_path: wavPath, output_path: 'x' }))
      assert.ok(unknown.cause instanceof InvalidInput)
      assert.equal(unknown.cause.field, 'output_path')

      const missing = await rejected(invoke(provider, {}))
      assert.ok(missing.cause instanceof InvalidInput)
      assert.equal(missing.cause.field, 'audio_path')

      const unauthorized = await rejected(invoke(provider, { audio_path: wavPath }, invocationContext({
        resolvePath: () => {
          throw new Error('not granted')
        },
      })))
      assert.ok(unauthorized.cause instanceof InvalidInput)
      assert.equal(unauthorized.cause.field, 'audio_path')

      const garbage = join(dir, 'garbage.wav')
      await writeFile(garbage, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
      const undecodable = await rejected(invoke(provider, { audio_path: garbage }))
      assert.ok(undecodable.cause instanceof InvalidInput)
      assert.equal(undecodable.cause.field, 'audio_path')
    })
  })

  it('refuses an empty WAV instead of returning an empty file', async () => {
    await withTempDir(async (dir) => {
      await writeClearAssets(dir)
      const provider = await loadProvider(dir, { loader: echoLoader().loader })
      const wavPath = join(dir, 'empty.wav')
      await writeFile(wavPath, buildWav({ sampleRate: CLEAR_SAMPLE_RATE, samples: [] }))
      const error = await rejected(invoke(provider, { audio_path: wavPath }))
      assert.ok(error.cause instanceof InvalidInput)
      assert.equal(error.cause.field, 'audio_path')
      assert.match(error.cause.message, /samples/i)
    })
  })
})

describe('createProviderFromRecipe — clear inference through an echo engine', () => {
  it('returns the documented payload over one chunk, with a reconstruction at the loudness gain', async () => {
    await withTempDir(async (dir) => {
      await writeClearAssets(dir)
      const input = sine(CLEAR_SAMPLE_RATE, 0.4)
      const wavPath = join(dir, 'audio.wav')
      await writeFile(wavPath, buildWav({ sampleRate: CLEAR_SAMPLE_RATE, samples: input }))

      const fake = echoLoader()
      const provider = await loadProvider(dir, { loader: fake.loader })
      const payload = await invoke(provider, { audio_path: wavPath })

      assert.deepEqual(Object.keys(payload).sort(), ['audio_base64', 'coverage', 'durationSeconds', 'sampleRate'])
      assert.equal(payload['sampleRate'], CLEAR_SAMPLE_RATE)
      assert.ok(Math.abs((payload['durationSeconds'] as number) - 1) < 1e-9)
      const coverage = payloadCoverage(payload)
      assert.equal(coverage.complete, true)
      assert.ok(Math.abs(coverage.totalSeconds - 1) < 1e-9)
      assert.equal(coverage.processedSeconds, payload['durationSeconds'])

      const audio = payloadAudio(payload)
      assert.equal(audio.sampleRate, CLEAR_SAMPLE_RATE)
      assert.equal(audio.channels, 1)
      assert.equal(audio.samples.length, CLEAR_SAMPLE_RATE)
      for (const value of audio.samples) assert.ok(Number.isFinite(value))

      // The echo engine changes nothing, so the delivered signal is the input at the
      // mastering gain: min(+9 dB, -19 LUFS - measured).
      const measured = integratedLufs(input, CLEAR_SAMPLE_RATE)
      assert.ok(measured !== null)
      const gain = Math.pow(10, Math.min(CLEAR_MAX_GAIN_DB, CLEAR_TARGET_LUFS - measured) / 20)
      assert.ok(Math.abs(peak(audio.samples) - 0.4 * gain) < 2e-3, 'peak ' + String(peak(audio.samples)) + ' expected ' + String(0.4 * gain))

      assert.equal(fake.calls.length, 1)
      const spec = fake.calls[0]?.feeds['spec']
      const erb = fake.calls[0]?.feeds['feat_erb']
      const featSpec = fake.calls[0]?.feeds['feat_spec']
      assert.ok(spec !== undefined && erb !== undefined && featSpec !== undefined)
      assert.deepEqual(spec.dims, [1, 1, CLEAR_CHUNK_FRAMES, CLEAR_N_FREQ, 2])
      assert.deepEqual(erb.dims, [1, 1, CLEAR_CHUNK_FRAMES, CLEAR_N_ERB])
      assert.deepEqual(featSpec.dims, [1, 1, CLEAR_CHUNK_FRAMES, CLEAR_N_DF, 2])
      // 1 s = 102 frames, so feature frames 102 and 103 do not exist: rows 100 and 101
      // must be zero-filled (the two-frame lookahead clamp).
      assert.equal(erb.data[100 * CLEAR_N_ERB], 0)
      assert.equal(featSpec.data[100 * CLEAR_N_DF * 2], 0)
      assert.notEqual(erb.data[0], 0)
    })
  })

  it('runs one model window per 200 analysis frames and keeps the output bounded', async () => {
    await withTempDir(async (dir) => {
      await writeClearAssets(dir)
      const wavPath = join(dir, 'audio.wav')
      await writeFile(wavPath, buildWav({ sampleRate: CLEAR_SAMPLE_RATE, samples: sine(3 * CLEAR_SAMPLE_RATE, 0.2) }))
      const fake = echoLoader()
      const provider = await loadProvider(dir, { loader: fake.loader })
      const payload = await invoke(provider, { audio_path: wavPath })
      // 3 s -> 302 frames -> two windows.
      assert.equal(fake.calls.length, 2)
      const audio = payloadAudio(payload)
      assert.equal(audio.samples.length, 3 * CLEAR_SAMPLE_RATE)
      assert.ok(peak(audio.samples) <= Math.pow(10, -1.5 / 20) + 1e-6)
    })
  })

  it('caps the enhanced audio at the host result budget and says so honestly', async () => {
    await withTempDir(async (dir) => {
      await writeClearAssets(dir)
      const input = sine(3 * CLEAR_SAMPLE_RATE, 0.2)
      const wavPath = join(dir, 'audio.wav')
      await writeFile(wavPath, buildWav({ sampleRate: CLEAR_SAMPLE_RATE, samples: input }))
      const budget = 200_000
      const provider = await loadProvider(dir, { loader: echoLoader().loader })
      const context = invocationContext()
      const limited: InvocationContextV1 = {
        ...context,
        limits: { ...context.limits, maxResultBytes: budget },
      }
      const payload = await invoke(provider, { audio_path: wavPath }, limited)
      const coverage = payloadCoverage(payload)
      assert.equal(coverage.complete, false)
      assert.ok(coverage.processedSeconds < 3)
      assert.ok(coverage.totalSeconds === 3)
      assert.match(coverage.reason ?? '', /budget/i)
      assert.ok((payload['durationSeconds'] as number) < 3)
      const audio = payloadAudio(payload)
      assert.ok(audio.samples.length < input.length)
      assert.ok(Buffer.byteLength(JSON.stringify(payload), 'utf8') <= budget)
    })
  })

  it('refuses a result budget that cannot hold a WAV', async () => {
    await withTempDir(async (dir) => {
      await writeClearAssets(dir)
      const wavPath = join(dir, 'audio.wav')
      await writeFile(wavPath, buildWav({ sampleRate: CLEAR_SAMPLE_RATE, samples: sine(480) }))
      const provider = await loadProvider(dir, { loader: echoLoader().loader })
      const context = invocationContext()
      const error = await rejected(invoke(provider, { audio_path: wavPath }, {
        ...context,
        limits: { ...context.limits, maxResultBytes: 64 },
      }))
      assert.ok(error.cause instanceof InvalidInput)
      assert.equal(error.cause.field, 'input')
    })
  })

  it('maps a wrong output tensor to InferenceFailed post', async () => {
    await withTempDir(async (dir) => {
      await writeClearAssets(dir)
      const wavPath = join(dir, 'audio.wav')
      await writeFile(wavPath, buildWav({ sampleRate: CLEAR_SAMPLE_RATE, samples: sine(CLEAR_SAMPLE_RATE) }))
      const fake = fakeLoader({
        inputNames: ['spec', 'feat_erb', 'feat_spec'],
        outputNames: ['spec_enhanced'],
        run: async () => ({ spec_enhanced: { data: new Float32Array(4), dims: [1, 1, 1, 1, 4] } }),
      })
      const provider = await loadProvider(dir, { loader: fake.loader })
      const error = await rejected(invoke(provider, { audio_path: wavPath }))
      assert.ok(error.cause instanceof InferenceFailed)
      assert.equal(error.cause.phase, 'post')
    })

    await withTempDir(async (dir) => {
      await writeClearAssets(dir)
      const wavPath = join(dir, 'audio.wav')
      await writeFile(wavPath, buildWav({ sampleRate: CLEAR_SAMPLE_RATE, samples: sine(CLEAR_SAMPLE_RATE) }))
      const fake = fakeLoader({
        inputNames: ['spec', 'feat_erb', 'feat_spec'],
        outputNames: ['spec_enhanced'],
        run: async () => ({}),
      })
      const provider = await loadProvider(dir, { loader: fake.loader })
      const error = await rejected(invoke(provider, { audio_path: wavPath }))
      assert.ok(error.cause instanceof InferenceFailed)
      assert.equal(error.cause.phase, 'post')
    })
  })

  it('maps an engine failure to InferenceFailed run', async () => {
    await withTempDir(async (dir) => {
      await writeClearAssets(dir)
      const wavPath = join(dir, 'audio.wav')
      await writeFile(wavPath, buildWav({ sampleRate: CLEAR_SAMPLE_RATE, samples: sine(CLEAR_SAMPLE_RATE) }))
      const fake = fakeLoader({
        inputNames: ['spec', 'feat_erb', 'feat_spec'],
        outputNames: ['spec_enhanced'],
        run: async () => {
          throw new Error('graph exploded')
        },
      })
      const provider = await loadProvider(dir, { loader: fake.loader })
      const error = await rejected(invoke(provider, { audio_path: wavPath }))
      assert.ok(error.cause instanceof InferenceFailed)
      assert.equal(error.cause.phase, 'run')
      assert.match(error.cause.message, /graph exploded/)
    })
  })
})
