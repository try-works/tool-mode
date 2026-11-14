/**
 * ear/mel-v1 through createProviderFromRecipe, with a FAKE engine session.
 *
 * PROVENANCE (Desert-Ant-Labs/desert-ant-core @ baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7):
 * - Sources/Ear/Model.swift:19 languages from languages.json; :72-102 identify (resample,
 *   window offsets, per-window softmax + averaging, alias folding, top-5); :104-114 tensor
 *   name/shape [1, mels, frames]; :119-123 linear resample.
 * - Sources/Ear/Ear.swift:29-34 isReliable (margin 0.25, confusables {no,sv,da}); :54 margin;
 *   :113 defaultWindows = 3; :156-165 non-empty samples and windows > 0.
 * - Sources/Ear/Languages.swift:4-8 aliases (tl->fil, nb->no, yue->zh); :20 confusables; :22-24
 *   canonicalLanguage.
 * - Sources/Ear/Frontend.swift: full front end, see ear-frontend.test.ts.
 * - ear_meta.json: input 'mel', output 'output_0', logits 103, recommended_windows 3,
 *   geometry 400/160/80/3000, clamp 1e-10, floor 8, affine 4/4.
 *
 * WHAT THESE PROVE: the JSON contract, the tensor shape, averaging/folding/reliability
 * arithmetic, input and asset refusals, typed failures. They prove NOTHING about real
 * language identification; the gated test reads .assets/ear.
 */

import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  InvocationContextV1,
  JsonObject,
  JsonValue,
  PreparedAssetMapV1,
} from '@try-works/tool-mode-extension-sdk'
import {
  InferenceFailed,
  InvalidInput,
  RuntimeUnavailable,
} from '@try-works/tool-mode-runtime-core'
import type { ModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'

import {
  EAR_CONFUSABLE_LANGUAGES,
  EAR_DEFAULT_WINDOWS,
  EAR_LANGUAGE_ALIASES,
  EAR_RELIABLE_MARGIN,
  createProviderFromRecipe,
} from '../src/index.ts'
import { EAR_LANGUAGE_CODES, earLanguagesJson, earMetaJson, encodeWav, melFiltersBytes, sine } from './ear-fixtures.ts'
import { createFakeBoot } from './fakes.ts'

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

const recipe = (): ModelRuntimeRecipe => ({
  kind: 'model-runtime',
  schemaVersion: 1,
  provider: {
    package: '@try-works/tool-mode-runtime-litert',
    export: 'createProviderFromRecipe',
    accelerators: ['cpu'],
  },
  model: { assetSet: 'ear-litert', fileName: 'ear.tflite', format: 'tflite' },
  processor: { id: 'ear/mel-v1' },
  limits: { maxInputBytes: 4_194_304, timeoutMs: 120_000 },
  tool: {
    name: 'identify_language',
    description: 'Identify the spoken language of a recording.',
    inputSchema: './schemas/ear.input.json',
    outputSchema: './schemas/ear.output.json',
  },
})

const signal = (): AbortSignal => new AbortController().signal

const context = (resolve?: (candidate: string) => string): InvocationContextV1 => ({
  invocationId: 'inv_ear',
  signal: signal(),
  limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 0, maxResultBytes: 4_194_304 },
  resolvePath: resolve ?? ((candidate: string) => candidate),
})

type Omitted = 'languages' | 'meta' | 'filters'

interface EarAssets {
  readonly dir: string
  readonly assets: Readonly<PreparedAssetMapV1>
}

const makeEarAssets = async (options: {
  readonly omit?: Omitted
  readonly meta?: string
  readonly filters?: Uint8Array
  readonly languages?: string
} = {}): Promise<EarAssets> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'litert-ear-'))
  tempDirs.push(dir)
  await writeFile(path.join(dir, 'ear.tflite'), new Uint8Array([1, 2, 3]))
  if (options.omit !== 'meta') await writeFile(path.join(dir, 'ear_meta.json'), options.meta ?? earMetaJson())
  if (options.omit !== 'languages') await writeFile(path.join(dir, 'languages.json'), options.languages ?? earLanguagesJson())
  if (options.omit !== 'filters') await writeFile(path.join(dir, 'mel_filters.f32'), options.filters ?? melFiltersBytes())
  return {
    dir,
    assets: {
      assetIds: ['ear-litert'],
      get: (id: string) => (id === 'ear-litert' ? { path: dir, digest: 'sha256:test' } : undefined),
    },
  }
}

/** A WAV at 16 kHz with the given mono samples. */
const wavFile = async (dir: string, samples: Float32Array, name = 'audio.wav', sampleRate = 16000): Promise<string> => {
  const file = path.join(dir, name)
  await writeFile(file, encodeWav({ sampleRate, channels: 1, encoding: 'pcm16', samples }))
  return file
}

/** Decode the SDK's JSON result for assertions; the processor constructs this shape. */
const candidatesOf = (output: JsonObject): readonly { language: string; probability: number }[] => {
  const value = output['candidates']
  assert.ok(Array.isArray(value))
  return value.map((entry) => {
    assert.ok(typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    const record = entry as Record<string, JsonValue>
    const language = record['language']
    const probability = record['probability']
    assert.ok(typeof language === 'string')
    assert.ok(typeof probability === 'number')
    return { language, probability }
  })
}

const logits = (entries: readonly (readonly [number, number])[]): Float32Array => {
  const values = new Float32Array(103).fill(-20)
  for (const [index, value] of entries) values[index] = value
  return values
}

interface LoadedEar {
  readonly provider: ReturnType<typeof createProviderFromRecipe>
  readonly dir: string
  readonly assets: EarAssets
}

const loadedProvider = async (boot: ReturnType<typeof createFakeBoot>, options: Parameters<typeof makeEarAssets>[0] = {}): Promise<LoadedEar> => {
  const assets = await makeEarAssets(options)
  const provider = createProviderFromRecipe(recipe(), assets.assets, { boot })
  await provider.load({ assets: assets.assets, signal: signal() })
  return { provider, dir: assets.dir, assets }
}

const invokeWith = async (loaded: LoadedEar, input: Readonly<JsonObject>, resolve?: (candidate: string) => string) =>
  loaded.provider.invoke({ implementationId: 'identify-language', input, context: context(resolve) })

const shortTone = (): Float32Array => sine({ sampleRate: 16000, seconds: 1, hz: 220 })

const expectInvalidInput = async (promise: Promise<JsonObject>, field: string, pattern: RegExp) => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof Error)
    const cause = error.cause
    assert.ok(cause instanceof InvalidInput)
    assert.equal(cause.field, field)
    assert.match(cause.message, pattern)
    return true
  })
}

describe('ear/mel-v1', () => {
  it('pins the label arithmetic constants from the primary source', () => {
    assert.deepEqual({ ...EAR_LANGUAGE_ALIASES }, { tl: 'fil', nb: 'no', yue: 'zh' })
    assert.deepEqual([...EAR_CONFUSABLE_LANGUAGES], ['no', 'sv', 'da'])
    assert.equal(EAR_RELIABLE_MARGIN, 0.25)
    assert.equal(EAR_DEFAULT_WINDOWS, 3)
    assert.equal(EAR_LANGUAGE_CODES.length, 103)
  })

  it('produces exactly the tool output on one window', async () => {
    const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[0, 5], [1, 0]]) } })
    const loaded = await loadedProvider(boot)
    const audio = await wavFile(loaded.dir, shortTone())
    const output = await invokeWith(loaded, { audio_path: audio })

    assert.deepEqual(Object.keys(output).sort(), ['candidates', 'confidence', 'isReliable', 'language', 'windows'])
    assert.equal(output['language'], 'en')
    assert.equal(output['windows'], 1)
    assert.equal(output['isReliable'], true)
    const confidence = output['confidence']
    assert.ok(typeof confidence === 'number' && confidence > 0.9)
    const candidates = candidatesOf(output)
    assert.equal(candidates.length, 5)
    const first = candidates[0]
    assert.ok(first !== undefined)
    assert.equal(first.language, 'en')
    for (let index = 1; index < candidates.length; index += 1) {
      const previous = candidates[index - 1]
      const current = candidates[index]
      assert.ok(previous !== undefined && current !== undefined)
      assert.ok(current.probability <= previous.probability, 'candidates are descending')
    }

    const feed = boot.state.runFeeds[0]?.['mel']
    if (feed === undefined) throw new Error('the processor did not run the model')
    assert.deepEqual(feed.dims, [1, 80, 3000])
    assert.ok(feed.data instanceof Float32Array)
    assert.equal(feed.data.length, 80 * 3000)
    for (const value of feed.data) assert.ok(Number.isFinite(value))
  })

  it('folds yue into zh before ranking and averaging', async () => {
    const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[5, 3], [6, 3]]) } })
    const loaded = await loadedProvider(boot)
    const audio = await wavFile(loaded.dir, shortTone())
    const output = await invokeWith(loaded, { audio_path: audio })
    assert.equal(output['language'], 'zh')
    const confidence = output['confidence']
    assert.ok(typeof confidence === 'number' && confidence > 0.99, 'yue + zh mass reports as zh; got ' + String(confidence))
    const candidates = candidatesOf(output)
    assert.ok(candidates.every((candidate) => candidate.language !== 'yue'), 'yue is folded away')
  })

  it('marks a confusable top language unreliable even with a wide margin', async () => {
    const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[2, 8]]) } })
    const loaded = await loadedProvider(boot)
    const audio = await wavFile(loaded.dir, shortTone())
    const output = await invokeWith(loaded, { audio_path: audio })
    assert.equal(output['language'], 'no')
    assert.equal(output['isReliable'], false)
  })

  it('requires a 0.25 margin for reliability', async () => {
    const close = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[0, 0.5], [1, 0.4]]) } })
    const loaded = await loadedProvider(close)
    const audio = await wavFile(loaded.dir, shortTone())
    const output = await invokeWith(loaded, { audio_path: audio })
    assert.equal(output['language'], 'en')
    assert.equal(output['isReliable'], false)
  })

  it('averages probabilities across the requested windows', async () => {
    // 45 s gives two candidate windows (0 s and 10 s) because the step is window/3.
    const audioSamples = sine({ sampleRate: 16000, seconds: 45, hz: 180 })
    const boot = createFakeBoot({
      inputNames: ['mel'],
      runOutputs: (index) => ({ output_0: index === 0 ? logits([[0, 6]]) : logits([[1, 6]]) }),
    })
    const loaded = await loadedProvider(boot)
    const audio = await wavFile(loaded.dir, audioSamples)
    const output = await invokeWith(loaded, { audio_path: audio, windows: 2 })
    assert.equal(output['windows'], 2)
    assert.equal(output['isReliable'], false)
    const candidates = candidatesOf(output)
    assert.equal(candidates[0]?.language, 'en')
    assert.ok(Math.abs((candidates[0]?.probability ?? 0) - 0.5) < 0.01)
    assert.equal(candidates[1]?.language, 'fr')
    assert.ok(Math.abs((candidates[1]?.probability ?? 0) - 0.5) < 0.01)
    assert.equal(boot.state.runFeeds.length, 2)
  })

  describe('input validation', () => {
    it('refuses a missing audio_path', async () => {
      const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[0, 5]]) } })
      const loaded = await loadedProvider(boot)
      await expectInvalidInput(invokeWith(loaded, {}), 'audio_path', /audio_path/)
    })

    it('refuses unknown keys', async () => {
      const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[0, 5]]) } })
      const loaded = await loadedProvider(boot)
      const audio = await wavFile(loaded.dir, shortTone())
      await expectInvalidInput(invokeWith(loaded, { audio_path: audio, language: 'en' }), 'language', /only/)
    })

    it('refuses an out-of-range windows value', async () => {
      const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[0, 5]]) } })
      const loaded = await loadedProvider(boot)
      const audio = await wavFile(loaded.dir, shortTone())
      for (const windows of [0, -1, 17, 1.5, '3']) {
        await expectInvalidInput(invokeWith(loaded, { audio_path: audio, windows }), 'windows', /windows/)
      }
    })

    it('refuses an over-long audio path', async () => {
      const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[0, 5]]) } })
      const loaded = await loadedProvider(boot)
      await expectInvalidInput(invokeWith(loaded, { audio_path: 'x'.repeat(4097) }), 'audio_path', /4096/)
    })

    it('refuses a host-denied audio path', async () => {
      const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[0, 5]]) } })
      const loaded = await loadedProvider(boot)
      await expectInvalidInput(
        invokeWith(loaded, { audio_path: '/denied.wav' }, () => {
          throw new Error('denied by policy')
        }),
        'audio_path',
        /denied/,
      )
    })

    it('refuses non-WAV bytes and unsupported WAV encodings by name', async () => {
      const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[0, 5]]) } })
      const loaded = await loadedProvider(boot)
      const notWav = path.join(loaded.dir, 'audio.mp3')
      await writeFile(notWav, new TextEncoder().encode('ID3 not a wav'))
      await expectInvalidInput(invokeWith(loaded, { audio_path: notWav }), 'audio_path', /RIFF/)

      const bad = path.join(loaded.dir, 'audio24.wav')
      await writeFile(bad, encodeWav({ sampleRate: 16000, channels: 1, encoding: 'pcm16', samples: shortTone(), bitsPerSample: 24 }))
      await expectInvalidInput(invokeWith(loaded, { audio_path: bad }), 'audio_path', /24/)
    })
  })

  describe('asset and model failures', () => {
    it('reports a missing languages.json as RuntimeUnavailable', async () => {
      const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[0, 5]]) } })
      const loaded = await loadedProvider(boot, { omit: 'languages' })
      const audio = await wavFile(loaded.dir, shortTone())
      await assert.rejects(invokeWith(loaded, { audio_path: audio }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof RuntimeUnavailable)
        assert.match(error.cause.reason, /languages/)
        return true
      })
    })

    it('refuses meta geometry that does not match the pinned front end', async () => {
      const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[0, 5]]) } })
      const loaded = await loadedProvider(boot, { meta: earMetaJson({ n_mels: 40 }) })
      const audio = await wavFile(loaded.dir, shortTone())
      await assert.rejects(invokeWith(loaded, { audio_path: audio }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof RuntimeUnavailable)
        assert.match(error.cause.reason, /n_mels|40|80/)
        return true
      })
    })

    it('refuses a truncated mel filterbank', async () => {
      const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[0, 5]]) } })
      const loaded = await loadedProvider(boot, { filters: melFiltersBytes().slice(0, 100) })
      const audio = await wavFile(loaded.dir, shortTone())
      await assert.rejects(invokeWith(loaded, { audio_path: audio }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof RuntimeUnavailable)
        assert.match(error.cause.reason, /filter|mel/)
        return true
      })
    })

    it('reports a malformed logits vector as InferenceFailed phase post', async () => {
      const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: new Float32Array(102) } })
      const loaded = await loadedProvider(boot)
      const audio = await wavFile(loaded.dir, shortTone())
      await assert.rejects(invokeWith(loaded, { audio_path: audio }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof InferenceFailed)
        assert.equal(error.cause.phase, 'post')
        return true
      })
    })

    it('reports a non-finite logit as InferenceFailed phase post', async () => {
      const values = logits([[0, 5]])
      values[3] = Number.NaN
      const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: values } })
      const loaded = await loadedProvider(boot)
      const audio = await wavFile(loaded.dir, shortTone())
      await assert.rejects(invokeWith(loaded, { audio_path: audio }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof InferenceFailed)
        assert.equal(error.cause.phase, 'post')
        return true
      })
    })

    it('reports an engine failure as InferenceFailed phase run', async () => {
      const boot = createFakeBoot({ inputNames: ['mel'], runError: new Error('engine died') })
      const loaded = await loadedProvider(boot)
      const audio = await wavFile(loaded.dir, shortTone())
      await assert.rejects(invokeWith(loaded, { audio_path: audio }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof InferenceFailed)
        assert.equal(error.cause.phase, 'run')
        return true
      })
    })

    it('resamples a non-16k file before the front end', async () => {
      const boot = createFakeBoot({ inputNames: ['mel'], outputs: { output_0: logits([[0, 5]]) } })
      const loaded = await loadedProvider(boot)
      const audio = await wavFile(loaded.dir, sine({ sampleRate: 8000, seconds: 1, hz: 220 }), 'audio8k.wav', 8000)
      const output = await invokeWith(loaded, { audio_path: audio })
      assert.equal(output['windows'], 1)
    })
  })
})
