/**
 * createProviderFromRecipe tests (PHASE3 processor uhm/waveform-v1, end to end over fakes).
 *
 * The engine is injected, so a test can state the exact frame timeline the model would
 * produce and assert the exact payload the SDK contract requires: the descriptor
 * `{ audio_path }`, the closed input key set, `context.resolvePath`, the WAV pipeline, two
 * windows over 30 s of audio, the merge across their overlap, and the typed failures.
 *
 * @module tests/provider-factory
 */

/*
 * The provider returns the tool payload as JSON (`JsonObject`), so assertions about a
 * filler read through `JsonValue` on purpose: the test is checking the contract a HOST
 * receives, not a type the provider re-exports.
 */
/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { InvocationContextV1, JsonObject } from '@try-works/tool-mode-extension-sdk'
import {
  InferenceFailed,
  InvalidInput,
  RuntimeUnavailable,
} from '@try-works/tool-mode-runtime-core'

import {
  UHM_WAVEFORM_PROCESSOR,
  UHM_WINDOW_SAMPLES,
  createProviderFromRecipe,
  type ProviderFactoryOptions,
} from '../src/index.ts'
import {
  buildWav,
  fakeLoader,
  invocationContext,
  preparedAssetsAsDirectory,
  preparedAssetsAsFile,
  sine,
  sparseRows,
  tensorFromRows,
  uhmRecipe,
  withTempDir,
  writeUhmAssets,
} from './support.ts'

/** Fake model bytes: the loader is injected, so the bytes are never parsed. */
const MODEL_BYTES = new Uint8Array([1, 2, 3, 4])

/** The implementation id the host passes for the recipe. */
const IMPLEMENTATION = 'detect-fillers'

/** Load a provider over a prepared directory. */
async function loadProvider(
  directory: string,
  options: ProviderFactoryOptions = {},
  projection: (dir: string) => ReturnType<typeof preparedAssetsAsFile> = preparedAssetsAsFile,
) {
  const assets = projection(directory)
  const provider = createProviderFromRecipe(uhmRecipe(), assets, options)
  await provider.load({ assets, signal: new AbortController().signal })
  return provider
}

/** Invoke with a context that authorizes the supplied path. */
function invoke(
  provider: ReturnType<typeof createProviderFromRecipe>,
  input: Readonly<JsonObject>,
  context: InvocationContextV1 = invocationContext(),
) {
  return provider.invoke({ implementationId: IMPLEMENTATION, input, context })
}

/** The readable message and the typed cause of a rejected provider call. */
async function rejected(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof Error)
    return error
  }
  assert.fail('expected the call to reject')
}

/** One window of silence rows plus the supplied filler entries. */
function windowOutput(entries: readonly { readonly frame: number; readonly classIndex: number; readonly probability: number }[]) {
  const tensor = tensorFromRows(sparseRows(1499, entries))
  return { frames: tensor }
}

/** Interleave a mono waveform into a stereo buffer. */
function stereo(samples: Float32Array): Float32Array {
  const interleaved = new Float32Array(samples.length * 2)
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0
    interleaved[index * 2] = value
    interleaved[index * 2 + 1] = value
  }
  return interleaved
}

describe('createProviderFromRecipe — construction', () => {
  it('refuses a recipe that is not an ONNX artifact', () => {
    assert.throws(
      () =>
        createProviderFromRecipe(
          uhmRecipe({ model: { assetSet: 'uhm-onnx', fileName: 'uhm.tflite', format: 'tflite' } }),
          preparedAssetsAsFile('C:/nonexistent'),
        ),
      /onnx/i,
    )
  })

  it('refuses a processor this build does not implement, naming the ones it does', () => {
    assert.throws(
      () => createProviderFromRecipe(uhmRecipe({ processor: { id: 'redact/bert-v1' } }), preparedAssetsAsFile('C:/nonexistent')),
      /redact\/bert-v1/,
    )
  })

  it('publishes the processor id it implements', () => {
    assert.equal(UHM_WAVEFORM_PROCESSOR, 'uhm/waveform-v1')
  })
})

describe('createProviderFromRecipe — lifecycle', () => {
  it('reports prepared-cold before load and does not touch the engine', async () => {
    const fake = fakeLoader({ run: async () => ({}) })
    const provider = createProviderFromRecipe(uhmRecipe(), preparedAssetsAsFile('C:/nonexistent'), {
      loader: fake.loader,
    })
    const inspection = await provider.inspect(new AbortController().signal)
    assert.equal(inspection.readiness, 'prepared-cold')
    assert.deepEqual(inspection.features, [UHM_WAVEFORM_PROCESSOR])
    assert.equal(fake.loads.length, 0)
  })

  it('refuses invoke before load', async () => {
    const fake = fakeLoader({ run: async () => ({}) })
    const provider = createProviderFromRecipe(uhmRecipe(), preparedAssetsAsFile('C:/nonexistent'), {
      loader: fake.loader,
    })
    const error = await rejected(invoke(provider, { audio_path: 'C:/audio.wav' }))
    assert.match(error.message, /not loaded/i)
  })

  it('fails load with RuntimeUnavailable when the asset set is not prepared', async () => {
    const fake = fakeLoader({ run: async () => ({}) })
    const provider = createProviderFromRecipe(uhmRecipe(), preparedAssetsAsFile('C:/nonexistent'), {
      loader: fake.loader,
    })
    const error = await rejected(provider.load({ assets: preparedAssetsAsFile('C:/nonexistent'), signal: new AbortController().signal }))
    assert.ok(error.cause instanceof RuntimeUnavailable)
    assert.match(error.cause.reason, /uhm-onnx/)
    const inspection = await provider.inspect(new AbortController().signal)
    assert.equal(inspection.readiness, 'failed')
  })

  it('loads the artifact and the labels from the prepared directory and is ready', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const fake = fakeLoader({ run: async () => windowOutput([]) })
      const provider = await loadProvider(dir, { loader: fake.loader })
      assert.equal(fake.loads.length, 1)
      assert.deepEqual(fake.loads[0]?.accelerators, ['cpu'])
      assert.deepEqual(fake.loads[0]?.modelBytes, MODEL_BYTES)
      const inspection = await provider.inspect(new AbortController().signal)
      assert.equal(inspection.readiness, 'ready')
    })
  })

  it('accepts the host group-directory projection as well as the asset-file projection', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const fake = fakeLoader({ run: async () => windowOutput([]) })
      const provider = await loadProvider(dir, { loader: fake.loader }, preparedAssetsAsDirectory)
      const inspection = await provider.inspect(new AbortController().signal)
      assert.equal(inspection.readiness, 'ready')
    })
  })

  it('fails load when the labels file is missing', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'uhm.onnx'), MODEL_BYTES)
      const fake = fakeLoader({ run: async () => ({}) })
      const error = await rejected(loadProvider(dir, { loader: fake.loader }))
      assert.ok(error.cause instanceof RuntimeUnavailable)
      assert.match(error.cause.reason, /labels\.json/)
    })
  })

  it('unload returns to prepared-cold and a later load works again', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const fake = fakeLoader({ run: async () => windowOutput([]) })
      const provider = await loadProvider(dir, { loader: fake.loader })
      await provider.unload(new AbortController().signal)
      assert.equal(fake.releases(), 1)
      assert.equal((await provider.inspect(new AbortController().signal)).readiness, 'prepared-cold')
      await provider.load({ assets: preparedAssetsAsFile(dir), signal: new AbortController().signal })
      assert.equal(fake.loads.length, 2)
    })
  })

  it('dispose is idempotent, releases once and refuses later work', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const fake = fakeLoader({ run: async () => windowOutput([]) })
      const provider = await loadProvider(dir, { loader: fake.loader })
      await provider.dispose()
      await provider.dispose()
      assert.equal(fake.releases(), 1)
      assert.equal((await provider.inspect(new AbortController().signal)).readiness, 'unavailable')
      const error = await rejected(invoke(provider, { audio_path: join(dir, 'audio.wav') }))
      assert.match(error.message, /disposed/i)
    })
  })
})

describe('createProviderFromRecipe — input contract', () => {
  it('refuses unknown input keys by name', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const provider = await loadProvider(dir, { loader: fakeLoader({ run: async () => windowOutput([]) }).loader })
      const error = await rejected(invoke(provider, { audio_path: join(dir, 'a.wav'), text: 'hello' }))
      assert.ok(error.cause instanceof InvalidInput)
      assert.equal(error.cause.field, 'text')
    })
  })

  it('requires audio_path as a non-empty string', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const provider = await loadProvider(dir, { loader: fakeLoader({ run: async () => windowOutput([]) }).loader })
      const inputs: readonly JsonObject[] = [{}, { audio_path: '' }, { audio_path: 42 }]
      for (const input of inputs) {
        const error = await rejected(invoke(provider, input))
        assert.ok(error.cause instanceof InvalidInput)
        assert.equal(error.cause.field, 'audio_path')
      }
    })
  })

  it('refuses an input over the recipe byte limit before reading audio', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const limited = createProviderFromRecipe(
        uhmRecipe({ limits: { maxInputBytes: 16, timeoutMs: 120_000 } }),
        preparedAssetsAsFile(dir),
        { loader: fakeLoader({ run: async () => windowOutput([]) }).loader },
      )
      await limited.load({ assets: preparedAssetsAsFile(dir), signal: new AbortController().signal })
      const error = await rejected(invoke(limited, { audio_path: join(dir, 'a-very-long-audio-file-name.wav') }))
      assert.equal(error.cause instanceof InvalidInput ? error.cause.field : '', 'input')
    })
  })

  it('resolves the path through context.resolvePath before reading it', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const wavPath = join(dir, 'audio.wav')
      await writeFile(wavPath, buildWav({ samples: sine(0.5) }))
      const fake = fakeLoader({ run: async () => windowOutput([]) })
      const provider = await loadProvider(dir, { loader: fake.loader })
      const asked: string[] = []
      await invoke(provider, { audio_path: '/granted/audio.wav' }, invocationContext({
        resolvePath: (candidate) => {
          asked.push(candidate)
          return wavPath
        },
      }))
      assert.deepEqual(asked, ['/granted/audio.wav'])
      assert.equal(fake.calls.length, 1)
    })
  })

  it('maps an unauthorized path to InvalidInput', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const provider = await loadProvider(dir, { loader: fakeLoader({ run: async () => windowOutput([]) }).loader })
      const error = await rejected(
        invoke(provider, { audio_path: '/secret/audio.wav' }, invocationContext({
          resolvePath: () => {
            throw new Error('the path is not in the caller grants')
          },
        })),
      )
      assert.ok(error.cause instanceof InvalidInput)
      assert.equal(error.cause.field, 'audio_path')
      assert.match(error.cause.message, /grants/)
    })
  })

  it('maps an unreadable audio file and an undecodable WAV to InvalidInput', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const provider = await loadProvider(dir, { loader: fakeLoader({ run: async () => windowOutput([]) }).loader })

      const missing = await rejected(invoke(provider, { audio_path: join(dir, 'missing.wav') }))
      assert.ok(missing.cause instanceof InvalidInput)
      assert.equal(missing.cause.field, 'audio_path')

      const garbage = join(dir, 'garbage.wav')
      await writeFile(garbage, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
      const undecodable = await rejected(invoke(provider, { audio_path: garbage }))
      assert.ok(undecodable.cause instanceof InvalidInput)
      assert.equal(undecodable.cause.field, 'audio_path')
      assert.match(undecodable.cause.message, /RIFF|WAVE/i)
    })
  })
})

describe('createProviderFromRecipe — inference over one second of audio', () => {
  it('runs one padded window and returns the merged fillers and honest coverage', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const wavPath = join(dir, 'audio.wav')
      const mono = sine(1)
      await writeFile(wavPath, buildWav({ samples: mono }))
      const fake = fakeLoader({
        run: async () =>
          windowOutput([
            { frame: 10, classIndex: 1, probability: 0.9 },
            { frame: 11, classIndex: 1, probability: 0.7 },
          ]),
      })
      const provider = await loadProvider(dir, { loader: fake.loader })
      const payload = await invoke(provider, { audio_path: wavPath })

      assert.equal(fake.calls.length, 1)
      const feed = fake.calls[0]?.feeds['audio']
      assert.ok(feed !== undefined)
      assert.deepEqual(feed.dims, [1, UHM_WINDOW_SAMPLES])
      assert.equal(feed.data.length, UHM_WINDOW_SAMPLES)
      // PCM 16-bit quantises the sine, so the feed is compared with the quantisation step.
      assert.ok(Math.abs((feed.data[0] ?? 0) - (mono[0] ?? 0)) <= 1 / 32_000)
      assert.ok(Math.abs((feed.data[1] ?? 0) - (mono[1] ?? 0)) <= 1 / 32_000)
      assert.equal(feed.data[16_000], 0)

      const fillers = payload['fillers']
      assert.ok(Array.isArray(fillers))
      assert.equal(fillers.length, 1)
      const filler = fillers[0]
      if (typeof filler !== 'object' || filler === null || Array.isArray(filler)) assert.fail('expected a filler object')
      assert.equal(filler['startMs'], 200)
      assert.equal(filler['endMs'], 240)
      assert.equal(filler['type'], 'uh')
      // Probabilities arrive as float32, so the mean is compared with a tolerance.
      assert.ok(Math.abs((filler['confidence'] as number) - (0.9 + 0.7) / 2) < 1e-6)
      assert.deepEqual(payload['coverage'], { complete: true, processedSeconds: 1, totalSeconds: 1 })
    })
  })

  it('decodes a 44.1 kHz stereo file, resamples it and runs two overlapping windows', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const wavPath = join(dir, 'stereo.wav')
      await writeFile(wavPath, buildWav({ sampleRate: 44_100, channels: 2, samples: stereo(sine(30, 440, 44_100)) }))
      const overlappingFrame = 1450
      const fake = fakeLoader({
        run: async (call) =>
          call.index === 0
            ? windowOutput([{ frame: overlappingFrame, classIndex: 1, probability: 0.6 }])
            : windowOutput([{ frame: 0, classIndex: 2, probability: 0.9 }]),
      })
      const provider = await loadProvider(dir, { loader: fake.loader })
      const payload = await invoke(provider, { audio_path: wavPath })

      assert.equal(fake.calls.length, 2)
      assert.deepEqual(fake.calls[0]?.feeds['audio']?.dims, [1, UHM_WINDOW_SAMPLES])
      assert.deepEqual(fake.calls[1]?.feeds['audio']?.dims, [1, UHM_WINDOW_SAMPLES])
      // The second window repeats the last second, so its first frame is the same moment.
      const fillers = payload['fillers']
      assert.ok(Array.isArray(fillers))
      assert.equal(fillers.length, 1)
      const filler = fillers[0]
      if (typeof filler !== 'object' || filler === null || Array.isArray(filler)) assert.fail('expected a filler object')
      assert.equal(filler['startMs'], overlappingFrame * 20)
      assert.equal(filler['endMs'], overlappingFrame * 20 + 20)
      assert.equal(filler['type'], 'um')
      assert.ok(Math.abs((filler['confidence'] as number) - 0.9) < 1e-6)
      assert.deepEqual(payload['coverage'], { complete: true, processedSeconds: 30, totalSeconds: 30 })
    })
  })

  it('maps an engine failure to a readable rejection whose cause is InferenceFailed', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const wavPath = join(dir, 'audio.wav')
      await writeFile(wavPath, buildWav({ samples: sine(1) }))
      const fake = fakeLoader({
        run: async () => {
          throw new Error('the graph exploded')
        },
      })
      const provider = await loadProvider(dir, { loader: fake.loader })
      const error = await rejected(invoke(provider, { audio_path: wavPath }))
      assert.ok(error.cause instanceof InferenceFailed)
      assert.equal(error.cause.phase, 'run')
      assert.match(error.message, /graph exploded/)
    })
  })

  it('refuses a model output whose class count does not match the labels', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const wavPath = join(dir, 'audio.wav')
      await writeFile(wavPath, buildWav({ samples: sine(1) }))
      const fake = fakeLoader({
        run: async () => {
          const tensor = tensorFromRows(sparseRows(1499, [], 5), { frames: 1499, classes: 5 })
          return { frames: tensor }
        },
      })
      const provider = await loadProvider(dir, { loader: fake.loader })
      const error = await rejected(invoke(provider, { audio_path: wavPath }))
      assert.ok(error.cause instanceof InferenceFailed)
      assert.equal(error.cause.phase, 'post')
      assert.match(error.cause.message, /class/i)
    })
  })

  it('maps a timeout to a typed InferenceFailed in the run phase', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const wavPath = join(dir, 'audio.wav')
      await writeFile(wavPath, buildWav({ samples: sine(1) }))
      const fake = fakeLoader({ run: async () => new Promise<never>(() => undefined) })
      const timed = createProviderFromRecipe(
        uhmRecipe({ limits: { maxInputBytes: 4_194_304, timeoutMs: 25 } }),
        preparedAssetsAsFile(dir),
        { loader: fake.loader },
      )
      await timed.load({ assets: preparedAssetsAsFile(dir), signal: new AbortController().signal })
      const error = await rejected(invoke(timed, { audio_path: wavPath }))
      assert.match(error.message, /timed out/i)
      assert.equal(error.cause instanceof InferenceFailed ? error.cause.phase : '', 'run')
    })
  })

  it('returns an empty result for a zero-length WAV instead of inventing fillers', async () => {
    await withTempDir(async (dir) => {
      await writeUhmAssets(dir, MODEL_BYTES)
      const wavPath = join(dir, 'empty.wav')
      await writeFile(wavPath, buildWav({ samples: [] }))
      const fake = fakeLoader({ run: async () => windowOutput([]) })
      const provider = await loadProvider(dir, { loader: fake.loader })
      const payload = await invoke(provider, { audio_path: wavPath })
      assert.deepEqual(payload, {
        fillers: [],
        coverage: { complete: true, processedSeconds: 0, totalSeconds: 0 },
      })
      assert.equal(fake.calls.length, 0)
    })
  })
})
