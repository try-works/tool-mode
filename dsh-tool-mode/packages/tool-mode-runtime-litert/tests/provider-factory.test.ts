/**
 * The declarative provider factory: TDD around a FAKE engine boot and a fake asset map.
 *
 * WHAT THESE TESTS PROVE: the SDK lifecycle (inspect/load/invoke/unload/dispose), that the
 * recipe's assetSet/fileName resolve the model bytes, that the shapes/points-v1 processor maps
 * the recipe's JSON contract (variable-length stroke to a resampled [1,128,2] tensor) and maps
 * the model's 13-class probabilities onto the shapes recipe's output schema, and that every
 * failure crosses the SDK boundary as a readable Error with a TYPED cause.
 *
 * WHAT THEY DO NOT PROVE: that the real shapes.tflite recognizes a real stroke. That is the
 * gated real-assets test's job.
 *
 * CLASS ORDER: measured on the real artifact, not taken from a JSON-Schema enum. A horizontal
 * line puts 0.9505 on index 1, an axis-aligned rectangle 0.9534 on index 3, a triangle on 5 and
 * a circle on 4, which confirms the model metadata order used by SHAPES_CLASSES.
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
  RuntimeUnavailable,
} from '@try-works/tool-mode-runtime-core'
import type { ModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'

import {
  SHAPES_CLASSES,
  SHAPES_POINT_COUNT,
  SHAPES_POINTS_PROCESSOR,
  createProviderFromRecipe,
} from '../src/index.ts'
import { createFakeBoot } from './fakes.ts'

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

interface RecipeOverrides {
  readonly processor?: string
  readonly format?: 'tflite' | 'onnx' | 'gguf'
  readonly maxInputBytes?: number
  readonly timeoutMs?: number
}

const recipe = (overrides: RecipeOverrides = {}): ModelRuntimeRecipe => ({
  kind: 'model-runtime',
  schemaVersion: 1,
  provider: {
    package: '@try-works/tool-mode-runtime-litert',
    export: 'createProviderFromRecipe',
    accelerators: ['cpu'],
  },
  model: { assetSet: 'shapes-litert', fileName: 'shapes.tflite', format: overrides.format ?? 'tflite' },
  processor: { id: overrides.processor ?? SHAPES_POINTS_PROCESSOR },
  limits: {
    maxInputBytes: overrides.maxInputBytes ?? 4_194_304,
    timeoutMs: overrides.timeoutMs ?? 120_000,
  },
  tool: {
    name: 'shape_recognize',
    description: 'Recognize one hand-drawn stroke.',
    inputSchema: './schemas/shape.input.json',
    outputSchema: './schemas/shape.output.json',
  },
})

const signal = (): AbortSignal => new AbortController().signal

/** Decode the SDK's JSON result for assertions; the factory guarantees this shape. */
const shapeOf = (output: JsonObject): string => {
  const value = output['shape']
  assert.ok(typeof value === 'string')
  return value
}

const confidenceOf = (output: JsonObject): number => {
  const value = output['confidence']
  assert.ok(typeof value === 'number')
  return value
}

const candidatesOf = (output: JsonObject): ReadonlyArray<{ shape: string; confidence: number }> => {
  const value = output['candidates']
  assert.ok(Array.isArray(value))
  return value.map((entry) => {
    assert.ok(typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    const shape = (entry as Record<string, unknown>)['shape']
    const confidence = (entry as Record<string, unknown>)['confidence']
    assert.ok(typeof shape === 'string')
    assert.ok(typeof confidence === 'number')
    return { shape, confidence }
  })
}

/** Read one tensor element; noUncheckedIndexedAccess makes the direct read optional. */
const at = (data: Float32Array | Int32Array, index: number): number => {
  const value = data[index]
  assert.ok(typeof value === 'number')
  return value
}

const context = (overrides: { readonly signal?: AbortSignal } = {}): InvocationContextV1 => ({
  invocationId: 'inv_test',
  signal: overrides.signal ?? signal(),
  limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 0, maxResultBytes: 4_194_304 },
  resolvePath: (candidate: string) => candidate,
})

interface FakeAssets {
  readonly assets: Readonly<PreparedAssetMapV1>
  readonly dir: string
}

const makeAssets = async (options: {
  readonly assetSet?: string
  readonly fileName?: string
  readonly withFile?: boolean
  readonly bytes?: Uint8Array
} = {}): Promise<FakeAssets> => {
  const assetSet = options.assetSet ?? 'shapes-litert'
  const dir = await mkdtemp(path.join(os.tmpdir(), 'litert-recipe-'))
  tempDirs.push(dir)
  if (options.withFile !== false) {
    await writeFile(path.join(dir, options.fileName ?? 'shapes.tflite'), options.bytes ?? new Uint8Array([1, 2, 3]))
  }
  return {
    dir,
    assets: {
      assetIds: [assetSet],
      get: (id: string) => (id === assetSet ? { path: dir, digest: 'sha256:test' } : undefined),
    },
  }
}

/** A deterministic 128-point diagonal stroke in canvas coordinates. */
const diagonalPoints = (): number[][] =>
  Array.from({ length: SHAPES_POINT_COUNT }, (_, index) => [index, index])

const probabilities = (entries: readonly (readonly [number, number])[]): Float32Array => {
  const values = new Float32Array(13).fill(0.001)
  for (const [index, value] of entries) values[index] = value
  return values
}

const head = (): Float32Array => new Float32Array(128).fill(0.5)

const loadedProvider = async (options: {
  readonly boot: ReturnType<typeof createFakeBoot>
  readonly recipe?: ModelRuntimeRecipe
  readonly assets?: FakeAssets
}) => {
  const assets = options.assets ?? (await makeAssets())
  const provider = createProviderFromRecipe(options.recipe ?? recipe(), assets.assets, {
    boot: options.boot,
  })
  await provider.load({ assets: assets.assets, signal: signal() })
  return { provider, assets }
}

const invocation = (input: Readonly<JsonObject>, overrides: { readonly signal?: AbortSignal } = {}) => ({
  implementationId: 'shape-recognize',
  input,
  context: context(overrides),
})

describe('createProviderFromRecipe', () => {
  it('is lightweight until load: inspect reports prepared-cold and reads nothing', async () => {
    const boot = createFakeBoot()
    const assets = await makeAssets({ withFile: false })
    const provider = createProviderFromRecipe(recipe(), assets.assets, { boot })
    const inspection = await provider.inspect(signal())
    assert.equal(inspection.readiness, 'prepared-cold')
    assert.deepEqual(inspection.features, [SHAPES_POINTS_PROCESSOR])
    assert.match(inspection.reason ?? '', /load\(\)/)
    assert.equal(boot.state.loads, 0)
  })

  it('loads the model bytes named by the recipe assetSet/fileName', async () => {
    const boot = createFakeBoot()
    const assets = await makeAssets({ bytes: new Uint8Array([9, 8, 7]) })
    const provider = createProviderFromRecipe(recipe(), assets.assets, { boot })
    await provider.load({ assets: assets.assets, signal: signal() })
    const inspection = await provider.inspect(signal())
    assert.equal(inspection.readiness, 'ready')
    assert.equal(boot.state.loads, 1)
    const seen = boot.state.modelBytesSeen[0]
    assert.ok(seen !== undefined)
    assert.deepEqual(Array.from(seen), [9, 8, 7])
  })

  it('prefers the load() asset map, so a factory created before preparation still works', async () => {
    const boot = createFakeBoot()
    const prepared = await makeAssets()
    const empty: PreparedAssetMapV1 = { assetIds: [], get: () => undefined }
    const provider = createProviderFromRecipe(recipe(), empty, { boot })
    await provider.load({ assets: prepared.assets, signal: signal() })
    assert.equal((await provider.inspect(signal())).readiness, 'ready')
  })

  it('invokes the processor and returns exactly the shapes recipe output keys', async () => {
    const boot = createFakeBoot({
      outputs: {
        probs: probabilities([[1, 0.5], [3, 0.3], [5, 0.2]]),
        head: head(),
      },
    })
    const { provider } = await loadedProvider({ boot })
    const output = await provider.invoke(invocation({ points: diagonalPoints() }))
    assert.deepEqual(Object.keys(output).sort(), ['candidates', 'confidence', 'rejected', 'shape'])
    assert.equal(shapeOf(output), 'line')
    assert.equal(confidenceOf(output), 0.5)
    assert.equal(output['rejected'], false)
    const candidates = candidatesOf(output)
    assert.equal(candidates.length, 12)
    const first = candidates[0]
    assert.ok(first !== undefined)
    assert.equal(first.shape, 'rectangle')
    assert.ok(Math.abs(first.confidence - 0.3) < 1e-6)
  })

  it('feeds a resampled, centred, unit-scaled [1,128,2] float32 tensor', async () => {
    const boot = createFakeBoot({ outputs: { probs: probabilities([[1, 1]]), head: head() } })
    const { provider } = await loadedProvider({ boot })
    await provider.invoke(invocation({ points: diagonalPoints() }))
    const feed = boot.state.runFeeds[0]?.['points']
    if (feed === undefined) throw new Error('the factory did not run the model')
    assert.deepEqual(feed.dims, [1, 128, 2])
    assert.ok(feed.data instanceof Float32Array)
    assert.equal(feed.data.length, 256)
    assert.ok(Math.abs(at(feed.data, 0) - -0.5) < 1e-6)
    assert.ok(Math.abs(at(feed.data, 1) - -0.5) < 1e-6)
    assert.ok(Math.abs(at(feed.data, 254) - 0.5) < 1e-6)
    assert.ok(Math.abs(at(feed.data, 255) - 0.5) < 1e-6)
  })

  it('appends the closing segment when the stroke is marked closed', async () => {
    const boot = createFakeBoot({ outputs: { probs: probabilities([[1, 1]]), head: head() } })
    const { provider } = await loadedProvider({ boot })
    const points = [[0, 0], [10, 0]]
    await provider.invoke(invocation({ points, closed: true }))
    const feed = boot.state.runFeeds[0]?.['points']
    if (feed === undefined) throw new Error('the factory did not run the model')
    assert.ok(Math.abs(at(feed.data, 0) - at(feed.data, 254)) < 1e-6)
    assert.ok(Math.abs(at(feed.data, 1) - at(feed.data, 255)) < 1e-6)
  })

  it('maps the reject classes to rejected: true', async () => {
    const none = createFakeBoot({ outputs: { probs: probabilities([[0, 0.9]]), head: head() } })
    const first = await loadedProvider({ boot: none })
    const noneOutput = await first.provider.invoke(invocation({ points: diagonalPoints() }))
    assert.equal(shapeOf(noneOutput), 'none')
    assert.equal(noneOutput['rejected'], true)

    const scribble = createFakeBoot({ outputs: { probs: probabilities([[12, 0.8]]), head: head() } })
    const second = await loadedProvider({ boot: scribble })
    const scribbleOutput = await second.provider.invoke(invocation({ points: diagonalPoints() }))
    assert.equal(shapeOf(scribbleOutput), 'scribble')
    assert.equal(scribbleOutput['rejected'], true)
  })

  it('exposes the measured model class order used to name probabilities', () => {
    assert.deepEqual([...SHAPES_CLASSES], [
      'none',
      'line',
      'arrow',
      'rectangle',
      'ellipse',
      'triangle',
      'diamond',
      'pentagon',
      'hexagon',
      'star',
      'heart',
      'cloud',
      'scribble',
    ])
  })

  describe('input validation', () => {
    const rejectsWithInvalidInput = async (input: Readonly<JsonObject>, pattern: RegExp) => {
      const boot = createFakeBoot({ outputs: { probs: probabilities([[1, 1]]), head: head() } })
      const { provider } = await loadedProvider({ boot })
      await assert.rejects(
        () => provider.invoke(invocation(input)),
        (error: unknown) => {
          assert.ok(error instanceof Error)
          const cause = error.cause
          assert.ok(cause instanceof InvalidInput)
          assert.match(cause.message, pattern)
          return true
        },
      )
    }

    it('refuses a missing points array', async () => {
      await rejectsWithInvalidInput({}, /points/)
    })

    it('refuses a stroke with fewer than two points', async () => {
      await rejectsWithInvalidInput({ points: [[0, 0]] }, /at least two/)
    })

    it('refuses a point that is not an [x, y] pair', async () => {
      await rejectsWithInvalidInput({ points: [[0, 0], [1, 2, 3]] }, /points/)
    })

    it('refuses unknown input keys', async () => {
      await rejectsWithInvalidInput({ points: diagonalPoints(), stroke: 'x' }, /stroke/)
    })

    it('refuses a non-boolean closed flag', async () => {
      await rejectsWithInvalidInput({ points: diagonalPoints(), closed: 'yes' }, /closed/)
    })

    it('refuses a degenerate stroke with no extent', async () => {
      const points = Array.from({ length: 10 }, () => [3, 4])
      await rejectsWithInvalidInput({ points }, /degenerate/)
    })

    it('refuses an input over the recipe byte ceiling', async () => {
      const boot = createFakeBoot({ outputs: { probs: probabilities([[1, 1]]), head: head() } })
      const { provider } = await loadedProvider({ boot, recipe: recipe({ maxInputBytes: 100 }) })
      await assert.rejects(
        () => provider.invoke(invocation({ points: diagonalPoints() })),
        (error: unknown) => {
          assert.ok(error instanceof Error)
          assert.ok(error.cause instanceof InvalidInput)
          assert.match(error.cause.message, /100-byte/)
          return true
        },
      )
    })
  })

  describe('typed failures at the SDK boundary', () => {
    it('reports a run failure as InferenceFailed phase run', async () => {
      const boot = createFakeBoot({ runError: new Error('kernel panic') })
      const { provider } = await loadedProvider({ boot })
      await assert.rejects(
        () => provider.invoke(invocation({ points: diagonalPoints() })),
        (error: unknown) => {
          assert.ok(error instanceof Error)
          const cause = error.cause
          assert.ok(cause instanceof InferenceFailed)
          assert.equal(cause.phase, 'run')
          assert.match(cause.message, /kernel panic/)
          return true
        },
      )
    })

    it('reports a malformed output as InferenceFailed phase post', async () => {
      const boot = createFakeBoot({ outputs: { probs: new Float32Array(5), head: head() } })
      const { provider } = await loadedProvider({ boot })
      await assert.rejects(
        () => provider.invoke(invocation({ points: diagonalPoints() })),
        (error: unknown) => {
          assert.ok(error instanceof Error)
          assert.ok(error.cause instanceof InferenceFailed)
          assert.equal(error.cause.phase, 'post')
          return true
        },
      )
    })

    it('reports a missing head tensor as InferenceFailed phase post', async () => {
      const boot = createFakeBoot({ outputs: { probs: probabilities([[1, 1]]) } })
      const { provider } = await loadedProvider({ boot })
      await assert.rejects(
        () => provider.invoke(invocation({ points: diagonalPoints() })),
        (error: unknown) => {
          assert.ok(error instanceof Error)
          assert.ok(error.cause instanceof InferenceFailed)
          assert.equal(error.cause.phase, 'post')
          return true
        },
      )
    })

    it('reports a missing asset set as RuntimeUnavailable and fails inspection', async () => {
      const boot = createFakeBoot()
      const assets = await makeAssets({ assetSet: 'some-other-set' })
      const provider = createProviderFromRecipe(recipe(), assets.assets, { boot })
      await assert.rejects(
        () => provider.load({ assets: assets.assets, signal: signal() }),
        (error: unknown) => {
          assert.ok(error instanceof Error)
          assert.ok(error.cause instanceof RuntimeUnavailable)
          assert.match(error.cause.reason, /shapes-litert/)
          return true
        },
      )
      const inspection = await provider.inspect(signal())
      assert.equal(inspection.readiness, 'failed')
    })

    it('reports a missing artifact file as RuntimeUnavailable', async () => {
      const boot = createFakeBoot()
      const assets = await makeAssets({ withFile: false })
      const provider = createProviderFromRecipe(recipe(), assets.assets, { boot })
      await assert.rejects(
        () => provider.load({ assets: assets.assets, signal: signal() }),
        (error: unknown) => {
          assert.ok(error instanceof Error)
          assert.ok(error.cause instanceof RuntimeUnavailable)
          assert.match(error.cause.reason, /cannot be read/)
          return true
        },
      )
    })

    it('reports an engine load failure as RuntimeUnavailable', async () => {
      const boot = createFakeBoot({ loadError: new Error('bad wasm') })
      const assets = await makeAssets()
      const provider = createProviderFromRecipe(recipe(), assets.assets, { boot })
      await assert.rejects(
        () => provider.load({ assets: assets.assets, signal: signal() }),
        (error: unknown) => {
          assert.ok(error instanceof Error)
          assert.ok(error.cause instanceof RuntimeUnavailable)
          assert.match(error.cause.reason, /bad wasm/)
          return true
        },
      )
    })

    it('times out an invocation after the recipe timeoutMs', async () => {
      const boot = createFakeBoot({
        runDelayMs: 100,
        outputs: { probs: probabilities([[1, 1]]), head: head() },
      })
      const { provider } = await loadedProvider({ boot, recipe: recipe({ timeoutMs: 10 }) })
      await assert.rejects(
        () => provider.invoke(invocation({ points: diagonalPoints() })),
        (error: unknown) => {
          assert.ok(error instanceof Error)
          assert.ok(error.cause instanceof InferenceFailed)
          assert.equal(error.cause.phase, 'run')
          assert.match(error.cause.message, /timed out after 10ms/)
          return true
        },
      )
    })

    it('rejects an invocation aborted before it starts', async () => {
      const boot = createFakeBoot({ outputs: { probs: probabilities([[1, 1]]), head: head() } })
      const { provider } = await loadedProvider({ boot })
      const controller = new AbortController()
      controller.abort()
      await assert.rejects(
        () => provider.invoke(invocation({ points: diagonalPoints() }, { signal: controller.signal })),
        /aborted/,
      )
    })
  })

  describe('lifecycle', () => {
    it('goes cold on unload, releases the model, and can load again', async () => {
      const boot = createFakeBoot({ outputs: { probs: probabilities([[1, 1]]), head: head() } })
      const { provider } = await loadedProvider({ boot })
      await provider.unload(signal())
      assert.equal((await provider.inspect(signal())).readiness, 'prepared-cold')
      await provider.load({ assets: { assetIds: [], get: () => undefined }, signal: signal() })
      assert.equal((await provider.inspect(signal())).readiness, 'ready')
    })

    it('dispose is idempotent and refuses later calls', async () => {
      const boot = createFakeBoot({ outputs: { probs: probabilities([[1, 1]]), head: head() } })
      const { provider } = await loadedProvider({ boot })
      await provider.dispose()
      await provider.dispose()
      assert.equal((await provider.inspect(signal())).readiness, 'unavailable')
      await assert.rejects(
        () => provider.load({ assets: { assetIds: [], get: () => undefined }, signal: signal() }),
        /disposed/,
      )
      await assert.rejects(
        () => provider.invoke(invocation({ points: diagonalPoints() })),
        /disposed/,
      )
    })

    it('refuses an inspection whose signal is already aborted', async () => {
      const provider = createProviderFromRecipe(recipe(), { assetIds: [], get: () => undefined })
      const controller = new AbortController()
      controller.abort()
      await assert.rejects(() => provider.inspect(controller.signal), /aborted/)
    })
  })

  describe('factory refusals', () => {
    it('refuses a recipe that names another processor', () => {
      assert.throws(
        () => createProviderFromRecipe(recipe({ processor: 'redact/tokens-v1' }), { assetIds: [], get: () => undefined }),
        /shapes\/points-v1/,
      )
    })

    it('refuses a non-tflite artifact format', () => {
      assert.throws(
        () => createProviderFromRecipe(recipe({ format: 'onnx' }), { assetIds: [], get: () => undefined }),
        /tflite/,
      )
    })
  })
})
