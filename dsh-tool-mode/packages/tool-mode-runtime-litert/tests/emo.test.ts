/**
 * emo/text-v1 through createProviderFromRecipe, with a FAKE engine session.
 *
 * PROVENANCE (Desert-Ant-Labs/desert-ant-core @ baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7):
 * - Sources/Emo/Model.swift:33-79   the six input tensors and their fixed windows
 * - Sources/Emo/Model.swift:19-30   sort labels by probability, take the limit
 * - Sources/Emo/EmoMeta.swift       meta field names (n_hashes, n_buckets, n_importance,
 *                                   sem_pad_index, fmax, smax, labels)
 * - Sources/Emo/Emo.swift:109-120   trimmed input, empty text -> [] suggestions, limit semantics
 * - Sources/Emo/Tokenizer.swift     tokenizer and n-gram arithmetic, see emo-tokenizer.test.ts
 * - .assets/emo/emo_meta.json       labels 812, n_hashes 3, n_buckets 44000, n_importance 16000,
 *                                   sem_pad_index 48000, fmax 512, smax 64
 *
 * WHAT THESE PROVE: the JSON contract, the six-feed tensor packing (names, dtypes, shapes,
 * padding, count), the label/limit mapping, and typed refusals. They prove NOTHING about emoji
 * quality; the gated real test records the "pay my bills" top-5 as semantic sanity only.
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
import { InferenceFailed, InvalidInput, RuntimeUnavailable } from '@try-works/tool-mode-runtime-core'
import type { ModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'

import {
  EMO_FMAX,
  EMO_LABEL_COUNT,
  EMO_MAX_LIMIT,
  EMO_N_BUCKETS,
  EMO_N_HASHES,
  EMO_N_IMPORTANCE,
  EMO_PROCESSOR,
  EMO_SEM_PAD_INDEX,
  EMO_SMAX,
  createProviderFromRecipe,
} from '../src/index.ts'
import { EMO_GOLDEN, EMO_LABELS, EMO_VOCAB, emoMetaJson, encodeEmtTokenizer } from './emo-fixtures.ts'
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
  model: { assetSet: 'emo-litert', fileName: 'emo.tflite', format: 'tflite' },
  processor: { id: 'emo/text-v1' },
  limits: { maxInputBytes: 4_194_304, timeoutMs: 120_000 },
  tool: {
    name: 'suggest_emojis',
    description: 'Suggest emoji for a short phrase.',
    inputSchema: './schemas/emo.input.json',
    outputSchema: './schemas/emo.output.json',
  },
})

const signal = (): AbortSignal => new AbortController().signal

const context = (): InvocationContextV1 => ({
  invocationId: 'inv_emo',
  signal: signal(),
  limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 0, maxResultBytes: 4_194_304 },
  resolvePath: (candidate: string) => candidate,
})

const probabilities = (entries: readonly (readonly [number, number])[]): Float32Array => {
  const values = new Float32Array(EMO_LABEL_COUNT)
  for (const [index, value] of entries) values[index] = value
  return values
}

interface EmoAssets {
  readonly dir: string
  readonly assets: Readonly<PreparedAssetMapV1>
}

const makeAssets = async (options: {
  readonly meta?: string
  readonly tokenizer?: Uint8Array
  readonly omit?: 'meta' | 'tokenizer'
} = {}): Promise<EmoAssets> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'litert-emo-'))
  tempDirs.push(dir)
  await writeFile(path.join(dir, 'emo.tflite'), new Uint8Array([1, 2, 3]))
  if (options.omit !== 'meta') await writeFile(path.join(dir, 'emo_meta.json'), options.meta ?? emoMetaJson())
  if (options.omit !== 'tokenizer') {
    await writeFile(path.join(dir, 'emo_tokenizer.bin'), options.tokenizer ?? encodeEmtTokenizer({ pieces: EMO_VOCAB, unkID: 3 }))
  }
  return {
    dir,
    assets: {
      assetIds: ['emo-litert'],
      get: (id: string) => (id === 'emo-litert' ? { path: dir, digest: 'sha256:test' } : undefined),
    },
  }
}

const loadedProvider = async (boot: ReturnType<typeof createFakeBoot>, options: Parameters<typeof makeAssets>[0] = {}) => {
  const assets = await makeAssets(options)
  const provider = createProviderFromRecipe(recipe(), assets.assets, { boot })
  await provider.load({ assets: assets.assets, signal: signal() })
  return { provider, assets }
}

const invokeWith = async (
  loaded: Awaited<ReturnType<typeof loadedProvider>>,
  input: Readonly<JsonObject>,
) =>
  loaded.provider.invoke({ implementationId: 'suggest-emojis', input, context: context() })

const suggestionsOf = (output: JsonObject): readonly { emoji: string; confidence: number }[] => {
  const value = output['suggestions']
  assert.ok(Array.isArray(value))
  return value.map((entry) => {
    assert.ok(typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    const record = entry as Record<string, JsonValue>
    const emoji = record['emoji']
    const confidence = record['confidence']
    assert.ok(typeof emoji === 'string')
    assert.ok(typeof confidence === 'number')
    return { emoji, confidence }
  })
}

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

describe('emo/text-v1', () => {
  it('pins the meta constants from the pinned artifact', () => {
    assert.equal(EMO_PROCESSOR, 'emo/text-v1')
    assert.equal(EMO_LABEL_COUNT, 812)
    assert.equal(EMO_N_HASHES, 3)
    assert.equal(EMO_N_BUCKETS, 44000)
    assert.equal(EMO_N_IMPORTANCE, 16000)
    assert.equal(EMO_SEM_PAD_INDEX, 48000)
    assert.equal(EMO_FMAX, 512)
    assert.equal(EMO_SMAX, 64)
    assert.equal(EMO_MAX_LIMIT, 20)
    assert.equal(EMO_LABELS.length, 812)
  })

  it('packs the six fixed-window feeds and maps sorted labels to suggestions', async () => {
    const boot = createFakeBoot({
      outputs: { probabilities: probabilities([[0, 0.01], [5, 0.9], [7, 0.5]]) },
    })
    const loaded = await loadedProvider(boot)
    const output = await invokeWith(loaded, { text: 'pay my bills' })

    assert.deepEqual(Object.keys(output).sort(), ['labels', 'suggestions'])
    assert.equal(output['labels'], 812)
    const suggestions = suggestionsOf(output)
    assert.equal(suggestions.length, 5)
    assert.equal(suggestions[0]?.emoji, EMO_LABELS[5])
    assert.equal(suggestions[1]?.emoji, EMO_LABELS[7])
    assert.ok(Math.abs((suggestions[0]?.confidence ?? 0) - 0.9) < 1e-6)
    for (let index = 1; index < suggestions.length; index += 1) {
      const previous = suggestions[index - 1]
      const current = suggestions[index]
      assert.ok(previous !== undefined && current !== undefined)
      assert.ok(current.confidence <= previous.confidence, 'suggestions are descending')
    }

    const feeds = boot.state.runFeeds[0]
    if (feeds === undefined) throw new Error('the processor did not run the model')
    assert.deepEqual(Object.keys(feeds).sort(), [
      'ngram_buckets', 'ngram_count', 'ngram_importance', 'ngram_signs', 'sem_ids', 'sem_mask',
    ])

    const buckets = feeds['ngram_buckets']
    const signs = feeds['ngram_signs']
    const importance = feeds['ngram_importance']
    const count = feeds['ngram_count']
    const semIds = feeds['sem_ids']
    const semMask = feeds['sem_mask']
    assert.ok(buckets !== undefined && signs !== undefined && importance !== undefined)
    assert.ok(count !== undefined && semIds !== undefined && semMask !== undefined)

    assert.deepEqual(buckets.dims, [1, EMO_FMAX, EMO_N_HASHES])
    assert.ok(buckets.data instanceof Int32Array)
    assert.equal(buckets.data.length, EMO_FMAX * EMO_N_HASHES)
    assert.deepEqual(signs.dims, [1, EMO_FMAX, EMO_N_HASHES])
    assert.ok(signs.data instanceof Float32Array)
    assert.equal(signs.data.length, EMO_FMAX * EMO_N_HASHES)
    assert.deepEqual(importance.dims, [1, EMO_FMAX])
    assert.ok(importance.data instanceof Int32Array)
    assert.equal(importance.data.length, EMO_FMAX)
    assert.deepEqual(count.dims, [1, 1])
    assert.ok(count.data instanceof Float32Array)
    assert.equal(count.data[0], EMO_GOLDEN.features.length)
    assert.deepEqual(semIds.dims, [1, EMO_SMAX])
    assert.ok(semIds.data instanceof Int32Array)
    assert.equal(semIds.data.length, EMO_SMAX)
    assert.deepEqual(semMask.dims, [1, EMO_SMAX])
    assert.ok(semMask.data instanceof Float32Array)
    assert.equal(semMask.data.length, EMO_SMAX)

    // The first 24 feature slots are the independent Python goldens; the rest are zero.
    assert.deepEqual(Array.from(buckets.data.slice(0, EMO_GOLDEN.buckets.length)), [...EMO_GOLDEN.buckets])
    assert.deepEqual(Array.from(signs.data.slice(0, EMO_GOLDEN.signs.length)), [...EMO_GOLDEN.signs])
    assert.deepEqual(Array.from(importance.data.slice(0, EMO_GOLDEN.importance.length)), [...EMO_GOLDEN.importance])
    assert.deepEqual(Array.from(buckets.data.slice(EMO_GOLDEN.buckets.length, EMO_GOLDEN.buckets.length + 3)), [0, 0, 0])
    assert.deepEqual(Array.from(semIds.data.slice(0, 4)), [0, 1, 2, EMO_SEM_PAD_INDEX])
    assert.deepEqual(Array.from(semMask.data.slice(0, 4)), [1, 1, 1, 0])
  })

  it('honours the limit and defaults it to 5', async () => {
    const boot = createFakeBoot({
      outputs: { probabilities: probabilities([[1, 0.9], [2, 0.8], [3, 0.7], [4, 0.6], [6, 0.5], [8, 0.4]]) },
    })
    const loaded = await loadedProvider(boot)
    const three = await invokeWith(loaded, { text: 'pay my bills', limit: 3 })
    assert.equal(suggestionsOf(three).length, 3)
    const twenty = await invokeWith(loaded, { text: 'pay my bills', limit: 20 })
    assert.equal(suggestionsOf(twenty).length, 20)
  })

  it('refuses empty or whitespace-only text without running the model', async () => {
    const boot = createFakeBoot({ outputs: { probabilities: probabilities([[0, 1]]) } })
    const loaded = await loadedProvider(boot)
    for (const text of ['', '   ', '\t\n ']) {
      await expectInvalidInput(invokeWith(loaded, { text }), 'text', /empty|whitespace/)
    }
    assert.equal(boot.state.runFeeds.length, 0)
  })

  describe('input validation', () => {
    it('refuses a missing text', async () => {
      const boot = createFakeBoot({ outputs: { probabilities: probabilities([[0, 1]]) } })
      const loaded = await loadedProvider(boot)
      await expectInvalidInput(invokeWith(loaded, {}), 'text', /text/)
    })

    it('refuses unknown keys, non-string text and out-of-range limits', async () => {
      const boot = createFakeBoot({ outputs: { probabilities: probabilities([[0, 1]]) } })
      const loaded = await loadedProvider(boot)
      await expectInvalidInput(invokeWith(loaded, { text: 'hi', lang: 'en' }), 'lang', /only/)
      await expectInvalidInput(invokeWith(loaded, { text: 7 }), 'text', /string/)
      for (const limit of [0, 21, 1.5, '3']) {
        await expectInvalidInput(invokeWith(loaded, { text: 'hi', limit }), 'limit', /limit/)
      }
    })

    it('refuses text longer than the short-phrase ceiling', async () => {
      const boot = createFakeBoot({ outputs: { probabilities: probabilities([[0, 1]]) } })
      const loaded = await loadedProvider(boot)
      await expectInvalidInput(invokeWith(loaded, { text: 'x'.repeat(1025) }), 'text', /1024/)
    })
  })

  describe('asset and model failures', () => {
    it('reports a missing tokenizer as RuntimeUnavailable', async () => {
      const boot = createFakeBoot({ outputs: { probabilities: probabilities([[0, 1]]) } })
      const loaded = await loadedProvider(boot, { omit: 'tokenizer' })
      await assert.rejects(invokeWith(loaded, { text: 'hi' }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof RuntimeUnavailable)
        assert.match(error.cause.reason, /tokenizer/)
        return true
      })
    })

    it('reports a malformed tokenizer and a mismatched meta as RuntimeUnavailable', async () => {
      const boot = createFakeBoot({ outputs: { probabilities: probabilities([[0, 1]]) } })
      const badTokenizer = await loadedProvider(boot, { tokenizer: encodeEmtTokenizer({ pieces: EMO_VOCAB }).slice(0, 20) })
      await assert.rejects(invokeWith(badTokenizer, { text: 'hi' }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof RuntimeUnavailable)
        assert.match(error.cause.reason, /tokenizer/)
        return true
      })

      const wrongLabels = await loadedProvider(boot, { meta: emoMetaJson({ labels: EMO_LABELS.slice(0, 811) }) })
      await assert.rejects(invokeWith(wrongLabels, { text: 'hi' }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof RuntimeUnavailable)
        assert.match(error.cause.reason, /labels|812/)
        return true
      })

      const wrongHashes = await loadedProvider(boot, { meta: emoMetaJson({ nHashes: 2 }) })
      await assert.rejects(invokeWith(wrongHashes, { text: 'hi' }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof RuntimeUnavailable)
        assert.match(error.cause.reason, /n_hashes|nHashes/)
        return true
      })
    })

    it('reports a probability-count mismatch as RuntimeUnavailable and non-finite values as InferenceFailed post', async () => {
      const short = createFakeBoot({ outputs: { probabilities: new Float32Array(811) } })
      const loaded = await loadedProvider(short)
      await assert.rejects(invokeWith(loaded, { text: 'hi' }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof RuntimeUnavailable)
        assert.match(error.cause.reason, /811|812|probabilit/)
        return true
      })

      const values = probabilities([[0, 1]])
      values[3] = Number.NaN
      const nan = createFakeBoot({ outputs: { probabilities: values } })
      const loadedNan = await loadedProvider(nan)
      await assert.rejects(invokeWith(loadedNan, { text: 'hi' }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof InferenceFailed)
        assert.equal(error.cause.phase, 'post')
        return true
      })
    })

    it('reports an engine failure as InferenceFailed phase run', async () => {
      const boot = createFakeBoot({ runError: new Error('engine died') })
      const loaded = await loadedProvider(boot)
      await assert.rejects(invokeWith(loaded, { text: 'hi' }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof InferenceFailed)
        assert.equal(error.cause.phase, 'run')
        return true
      })
    })
  })
})
