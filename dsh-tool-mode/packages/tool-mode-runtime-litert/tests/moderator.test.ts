/**
 * moderator/crops-v1 through createProviderFromRecipe, with a FAKE engine session.
 *
 * PROVENANCE (Desert-Ant-Labs/desert-ant-core @ main, fetched 2026-11-14):
 * - Sources/Moderator/Model.swift:24        head order nipples, genitals, buttocks, nude, sexAct
 * - Sources/Moderator/Model.swift:29-30     input "image" [1,384,384,3] float32 raw pixels, output "scores"
 * - Sources/Moderator/Model.swift:45-47     per-head max over crops
 * - Sources/Moderator/Preprocess.swift:9-10 side 384, zooms 0.85/0.70/0.55
 * - Sources/Moderator/Preprocess.swift:26-38 fast/balanced/accurate windows and mirrors
 * - Sources/Moderator/Moderator.swift:36-55 quality and policy enums
 * - Sources/Moderator/Moderator.swift:66-71 default threshold 0.5 / policy standard
 * - Sources/Moderator/Moderator.swift:96-101 score = max over counted heads
 * - Sources/Moderator/Moderator.swift:113-117 isNSFW = score >= threshold
 *
 * WHAT THESE PROVE: the JSON contract, the crop counts, the raw-pixel feed, per-head max,
 * policy and threshold arithmetic, PNG-only input, and typed failures. They prove NOTHING
 * about the real model; that is the gated real-assets test's job.
 */

import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  InvocationContextV1,
  JsonObject,
  PreparedAssetMapV1,
} from '@try-works/tool-mode-extension-sdk'
import {
  InferenceFailed,
  InvalidInput,
} from '@try-works/tool-mode-runtime-core'
import type { ModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'

import {
  MODERATOR_HEADS,
  MODERATOR_PROCESSOR,
  MODERATOR_SCORE_COUNT,
  createProviderFromRecipe,
} from '../src/index.ts'
import { createFakeBoot } from './fakes.ts'
import { encodePng, jpegBytes, solidRgb } from './png-fixtures.ts'

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'litert-moderator-'))
  tempDirs.push(dir)
  return dir
}

const recipe = (overrides: { readonly processor?: string; readonly maxInputBytes?: number } = {}): ModelRuntimeRecipe => ({
  kind: 'model-runtime',
  schemaVersion: 1,
  provider: {
    package: '@try-works/tool-mode-runtime-litert',
    export: 'createProviderFromRecipe',
    accelerators: ['cpu'],
  },
  model: { assetSet: 'moderator-litert', fileName: 'moderator.tflite', format: 'tflite' },
  processor: { id: overrides.processor ?? MODERATOR_PROCESSOR },
  limits: { maxInputBytes: overrides.maxInputBytes ?? 4_194_304, timeoutMs: 120_000 },
  tool: {
    name: 'classify_nsfw',
    description: 'Classify an image.',
    inputSchema: './schemas/moderator.input.json',
    outputSchema: './schemas/moderator.output.json',
  },
})

const signal = (): AbortSignal => new AbortController().signal

interface ContextOptions {
  readonly signal?: AbortSignal
  readonly resolve?: (candidate: string) => string
  readonly calls?: string[]
}

const context = (options: ContextOptions = {}): InvocationContextV1 => ({
  invocationId: 'inv_moderator',
  signal: options.signal ?? signal(),
  limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 0, maxResultBytes: 4_194_304 },
  resolvePath: (candidate: string) => {
    options.calls?.push(candidate)
    return options.resolve === undefined ? candidate : options.resolve(candidate)
  },
})

const assetsFor = async (dir: string): Promise<Readonly<PreparedAssetMapV1>> => {
  await writeFile(path.join(dir, 'moderator.tflite'), new Uint8Array([1, 2, 3]))
  return {
    assetIds: ['moderator-litert'],
    get: (id: string) => (id === 'moderator-litert' ? { path: dir, digest: 'sha256:test' } : undefined),
  }
}

/** Write a solid PNG to a temp dir and return its path. */
const pngFile = async (dir: string, width = 6, height = 4, rgb: readonly [number, number, number] = [255, 255, 255]): Promise<string> => {
  const file = path.join(dir, 'image.png')
  await writeFile(file, encodePng(solidRgb(width, height, rgb[0], rgb[1], rgb[2])))
  return file
}

interface LoadedModerator {
  readonly provider: ReturnType<typeof createProviderFromRecipe>
  readonly dir: string
}

const loadedProvider = async (boot: ReturnType<typeof createFakeBoot>, options: { readonly recipe?: ModelRuntimeRecipe } = {}): Promise<LoadedModerator> => {
  const dir = await makeTempDir()
  const assets = await assetsFor(dir)
  const provider = createProviderFromRecipe(options.recipe ?? recipe(), assets, { boot })
  await provider.load({ assets, signal: signal() })
  return { provider, dir }
}

const scores = (...values: readonly number[]): Float32Array => Float32Array.from(values)

/** The model emits float32; compare against decimal expectations with float32 tolerance. */
const close = (actual: unknown, expected: number): boolean =>
  typeof actual === 'number' && Math.abs(actual - expected) <= 1e-6

const invokeWith = async (loaded: LoadedModerator, input: Readonly<JsonObject>, options: ContextOptions = {}) =>
  loaded.provider.invoke({ implementationId: 'classify-nsfw', input, context: context(options) })

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

describe('moderator/crops-v1', () => {
  it('pins the primary-source head order and count', () => {
    assert.deepEqual([...MODERATOR_HEADS], ['nipples', 'genitals', 'buttocks', 'nude', 'sexAct'])
    assert.equal(MODERATOR_SCORE_COUNT, 5)
    assert.equal(MODERATOR_PROCESSOR, 'moderator/crops-v1')
  })

  it('fast scores one crop and returns exactly the tool output shape', async () => {
    const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0.2, 0.1, 0.05, 0.3, 0.4) } })
    const loaded = await loadedProvider(boot)
    const png = await pngFile(loaded.dir, 6, 4, [255, 255, 255])
    const output = await invokeWith(loaded, { image_path: png, quality: 'fast' })

    assert.deepEqual(Object.keys(output).sort(), ['crops', 'isNSFW', 'policy', 'quality', 'regions', 'score', 'threshold'])
    assert.equal(output['isNSFW'], false)
    assert.ok(close(output['score'], 0.4), 'score is the head max')
    assert.equal(output['threshold'], 0.5)
    assert.equal(output['policy'], 'standard')
    assert.equal(output['quality'], 'fast')
    assert.equal(output['crops'], 1)
    const regions = output['regions']
    assert.ok(typeof regions === 'object' && regions !== null && !Array.isArray(regions))
    assert.deepEqual(Object.keys(regions).sort(), ['buttocks', 'genitals', 'nipples', 'nude', 'sexAct'])
    assert.ok(close(regions['nipples'], 0.2), 'nipples score')
    assert.ok(close(regions['sexAct'], 0.4), 'sexAct score')
    assert.equal(boot.state.runFeeds.length, 1)

    const feed = boot.state.runFeeds[0]?.['image']
    if (feed === undefined) throw new Error('the processor did not run the model')
    assert.deepEqual(feed.dims, [1, 384, 384, 3])
    assert.ok(feed.data instanceof Float32Array)
    assert.equal(feed.data.length, 384 * 384 * 3)
    assert.deepEqual([feed.data[0] ?? -1, feed.data[1] ?? -1, feed.data[2] ?? -1], [255, 255, 255])
  })

  it('defaults to balanced (4 crops) and reports it', async () => {
    const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0.1, 0.1, 0.1, 0.1, 0.1) } })
    const loaded = await loadedProvider(boot)
    const png = await pngFile(loaded.dir)
    const output = await invokeWith(loaded, { image_path: png })
    assert.equal(output['quality'], 'balanced')
    assert.equal(output['crops'], 4)
    assert.equal(boot.state.runFeeds.length, 4)
  })

  it('accurate runs the four tiles and their mirrors (8 crops)', async () => {
    const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0, 0, 0, 0, 0) } })
    const loaded = await loadedProvider(boot)
    const png = await pngFile(loaded.dir)
    const output = await invokeWith(loaded, { image_path: png, quality: 'accurate' })
    assert.equal(output['quality'], 'accurate')
    assert.equal(output['crops'], 8)
    assert.equal(boot.state.runFeeds.length, 8)
  })

  it('keeps the per-head max over crops (Model.swift:45-47)', async () => {
    const rows = [
      scores(0.1, 0.5, 0.2, 0.9, 0.3),
      scores(0.7, 0.4, 0.6, 0.2, 0.9),
      scores(0.2, 0.2, 0.8, 0.4, 0.1),
      scores(0.3, 0.9, 0.1, 0.5, 0.2),
    ]
    const boot = createFakeBoot({
      inputNames: ['image'],
      runOutputs: (index) => ({ scores: rows[index] ?? scores(0, 0, 0, 0, 0) }),
    })
    const loaded = await loadedProvider(boot)
    const png = await pngFile(loaded.dir)
    const output = await invokeWith(loaded, { image_path: png })
    const regions = output['regions'] as Record<string, number>
    const expected = { nipples: 0.7, genitals: 0.9, buttocks: 0.8, nude: 0.9, sexAct: 0.9 }
    assert.deepEqual(Object.keys(regions).sort(), Object.keys(expected).sort())
    for (const head of Object.keys(expected) as (keyof typeof expected)[]) {
      assert.ok(close(regions[head], expected[head]), head + ' is the per-head max; got ' + String(regions[head]))
    }
    assert.ok(close(output['score'], 0.9), 'score is the overall max')
    assert.equal(output['isNSFW'], true)
  })

  it('applies standard vs allowTopless policies (Moderator.swift:49-55, :96-101)', async () => {
    const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0.9, 0.1, 0.2, 0.3, 0.4) } })
    const loaded = await loadedProvider(boot)
    const png = await pngFile(loaded.dir)

    const standard = await invokeWith(loaded, { image_path: png, quality: 'fast' })
    assert.ok(close(standard['score'], 0.9), 'standard score counts nipples')
    assert.equal(standard['isNSFW'], true)

    const topless = await invokeWith(loaded, { image_path: png, quality: 'fast', policy: 'allowTopless' })
    assert.equal(topless['policy'], 'allowTopless')
    assert.ok(close(topless['score'], 0.4), 'allowTopless score excludes nipples')
    assert.equal(topless['isNSFW'], false)
  })

  it('echoes the effective threshold and compares score >= threshold', async () => {
    const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0.4, 0.5, 0.6, 0.7, 0.8) } })
    const loaded = await loadedProvider(boot)
    const png = await pngFile(loaded.dir)

    const below = await invokeWith(loaded, { image_path: png, quality: 'fast', threshold: 0.95 })
    assert.equal(below['threshold'], 0.95)
    assert.equal(below['isNSFW'], false)

    const equal = await invokeWith(loaded, { image_path: png, quality: 'fast', threshold: 0.8 })
    assert.equal(equal['isNSFW'], true)

    const zero = await invokeWith(loaded, { image_path: png, quality: 'fast', threshold: 0 })
    assert.equal(zero['isNSFW'], true)
  })

  it('resolves the image path through the host authority', async () => {
    const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0, 0, 0, 0, 0) } })
    const loaded = await loadedProvider(boot)
    const png = await pngFile(loaded.dir)
    const calls: string[] = []
    const canonical = path.resolve(png)
    await invokeWith(loaded, { image_path: '/caller/relative.png', quality: 'fast' }, { resolve: () => canonical, calls })
    assert.deepEqual(calls, ['/caller/relative.png'])
    assert.equal(boot.state.runFeeds.length, 1)
  })

  describe('input validation', () => {
    it('refuses a missing image_path', async () => {
      const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0, 0, 0, 0, 0) } })
      const loaded = await loadedProvider(boot)
      await expectInvalidInput(invokeWith(loaded, { quality: 'fast' }), 'image_path', /image_path/)
    })

    it('refuses unknown keys', async () => {
      const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0, 0, 0, 0, 0) } })
      const loaded = await loadedProvider(boot)
      const png = await pngFile(loaded.dir)
      await expectInvalidInput(invokeWith(loaded, { image_path: png, blur: true }), 'blur', /only/)
    })

    it('refuses an unknown quality or policy', async () => {
      const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0, 0, 0, 0, 0) } })
      const loaded = await loadedProvider(boot)
      const png = await pngFile(loaded.dir)
      await expectInvalidInput(invokeWith(loaded, { image_path: png, quality: 'ultra' }), 'quality', /quality/)
      await expectInvalidInput(invokeWith(loaded, { image_path: png, policy: 'strict' }), 'policy', /policy/)
    })

    it('refuses an out-of-range or non-numeric threshold', async () => {
      const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0, 0, 0, 0, 0) } })
      const loaded = await loadedProvider(boot)
      const png = await pngFile(loaded.dir)
      await expectInvalidInput(invokeWith(loaded, { image_path: png, threshold: 1.5 }), 'threshold', /0 and 1/)
      await expectInvalidInput(invokeWith(loaded, { image_path: png, threshold: -0.1 }), 'threshold', /0 and 1/)
      await expectInvalidInput(invokeWith(loaded, { image_path: png, threshold: 'high' }), 'threshold', /threshold/)
    })

    it('refuses an over-long image path', async () => {
      const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0, 0, 0, 0, 0) } })
      const loaded = await loadedProvider(boot)
      await expectInvalidInput(
        invokeWith(loaded, { image_path: 'x'.repeat(4097), quality: 'fast' }),
        'image_path',
        /4096/,
      )
    })

    it('refuses a host-denied image path', async () => {
      const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0, 0, 0, 0, 0) } })
      const loaded = await loadedProvider(boot)
      await expectInvalidInput(
        invokeWith(loaded, { image_path: '/denied.png', quality: 'fast' }, {
          resolve: () => {
            throw new Error('denied by policy')
          },
        }),
        'image_path',
        /denied/,
      )
    })

    it('refuses JPEG by name', async () => {
      const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0, 0, 0, 0, 0) } })
      const loaded = await loadedProvider(boot)
      const jpeg = path.join(loaded.dir, 'photo.jpg')
      await writeFile(jpeg, jpegBytes())
      await expectInvalidInput(invokeWith(loaded, { image_path: jpeg, quality: 'fast' }), 'image_path', /JPEG/)
    })

    it('refuses non-PNG bytes', async () => {
      const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0, 0, 0, 0, 0) } })
      const loaded = await loadedProvider(boot)
      const other = path.join(loaded.dir, 'image.bmp')
      await writeFile(other, new TextEncoder().encode('BM not a png'))
      await expectInvalidInput(invokeWith(loaded, { image_path: other, quality: 'fast' }), 'image_path', /PNG/)
    })
  })

  describe('typed failures', () => {
    it('reports a malformed score vector as InferenceFailed phase post', async () => {
      const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0.1, 0.2, 0.3, 0.4) } })
      const loaded = await loadedProvider(boot)
      const png = await pngFile(loaded.dir)
      await assert.rejects(invokeWith(loaded, { image_path: png, quality: 'fast' }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof InferenceFailed)
        assert.equal(error.cause.phase, 'post')
        return true
      })
    })

    it('reports a non-finite score as InferenceFailed phase post', async () => {
      const boot = createFakeBoot({ inputNames: ['image'], outputs: { scores: scores(0.1, Number.NaN, 0.3, 0.4, 0.5) } })
      const loaded = await loadedProvider(boot)
      const png = await pngFile(loaded.dir)
      await assert.rejects(invokeWith(loaded, { image_path: png, quality: 'fast' }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof InferenceFailed)
        assert.equal(error.cause.phase, 'post')
        return true
      })
    })

    it('reports a run failure as InferenceFailed phase run', async () => {
      const boot = createFakeBoot({ inputNames: ['image'], runError: new Error('engine died') })
      const loaded = await loadedProvider(boot)
      const png = await pngFile(loaded.dir)
      await assert.rejects(invokeWith(loaded, { image_path: png, quality: 'fast' }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.cause instanceof InferenceFailed)
        assert.equal(error.cause.phase, 'run')
        assert.match(error.cause.message, /engine died/)
        return true
      })
    })
  })
})
