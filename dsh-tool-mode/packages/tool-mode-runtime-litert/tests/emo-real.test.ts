/**
 * The gated REAL emo run.
 *
 * Skips with a stated reason unless TOOL_MODE_REAL_ASSETS=1 AND the .assets/emo files exist.
 *
 * PROVENANCE: HF desert-ant-labs/emo revision 7c2e137cb0300ecf8e31b7deab4c4e9734d06b74;
 * emo.tflite 10,222,736 B sha256 2c382e8d...de2; emo_tokenizer.bin 733,197 B f54462a7...19d;
 * emo_meta.json 6,280 B a3143258...3f6 (all three re-verified in-test). Tokenizer/featurizer
 * provenance: Sources/Emo/Tokenizer.swift + Model.swift at desert-ant-core baf4e6e3.
 *
 * The "pay my bills" top-5 is RECORDED as semantic sanity, per PHASE4: it is NOT asserted as
 * accuracy, and the skill must say emoji relevance is a suggestion, not a promise.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { PreparedAssetMapV1 } from '@try-works/tool-mode-extension-sdk'
import type { ModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'

import { createProviderFromRecipe } from '../src/index.ts'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const assetDir = path.join(repoRoot, '.assets', 'emo')
const modelPath = path.join(assetDir, 'emo.tflite')

const PINNED = {
  'emo.tflite': { bytes: 10_222_736, sha256: '2c382e8da94bab64172c0694b0350abb96829bf89eb623008ed0085128621de2' },
  'emo_tokenizer.bin': { bytes: 733_197, sha256: 'f54462a7a2344f15c9430ed4e399c49444f890dd6094c745a0c5391690bf019d' },
  'emo_meta.json': { bytes: 6_280, sha256: 'a3143258ac4099de65367cd4598073f1f5ce94f0eb505a30331762619967d3f6' },
} as const

const skipReason =
  process.env['TOOL_MODE_REAL_ASSETS'] !== '1'
    ? 'TOOL_MODE_REAL_ASSETS is not 1; real emo inference not requested'
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
  model: { assetSet: 'emo-litert', fileName: 'emo.tflite', format: 'tflite' },
  processor: { id: 'emo/text-v1' },
  limits: { maxInputBytes: 4_194_304, timeoutMs: 120_000 },
  tool: {
    name: 'suggest_emojis',
    description: 'Suggest emoji for a short phrase.',
    inputSchema: './schemas/emo.input.json',
    outputSchema: './schemas/emo.output.json',
  },
}

const assets: PreparedAssetMapV1 = {
  assetIds: ['emo-litert'],
  get: (id: string) => (id === 'emo-litert' ? { path: assetDir, digest: PINNED['emo.tflite'].sha256 } : undefined),
}

const signal = (): AbortSignal => new AbortController().signal

const context = () => ({
  invocationId: 'inv_real_emo',
  signal: signal(),
  limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 0, maxResultBytes: 4_194_304 },
  resolvePath: (candidate: string) => candidate,
})

interface Suggestion {
  readonly emoji: string
  readonly confidence: number
}

const suggestionsOf = (output: Record<string, unknown>): readonly Suggestion[] => {
  const value = output['suggestions']
  assert.ok(Array.isArray(value))
  return value.map((entry) => {
    assert.ok(typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    const record = entry as Record<string, unknown>
    const emoji = record['emoji']
    const confidence = record['confidence']
    assert.ok(typeof emoji === 'string')
    assert.ok(typeof confidence === 'number')
    return { emoji, confidence }
  })
}

describe('the real emo model through createProviderFromRecipe', () => {
  it(
    'suggests emoji for "pay my bills", records the top-5 and is deterministic',
    { skip: skipReason },
    async () => {
      for (const [name, pinned] of Object.entries(PINNED)) {
        const bytes = await readFile(path.join(assetDir, name))
        assert.equal(bytes.length, pinned.bytes, 'the pinned ' + name + ' size')
        assert.equal(createHash('sha256').update(bytes).digest('hex'), pinned.sha256, 'the pinned ' + name + ' sha256')
      }

      const provider = createProviderFromRecipe(recipe, assets)
      await provider.load({ assets, signal: signal() })
      assert.equal((await provider.inspect(signal())).readiness, 'ready')

      const first = await provider.invoke({
        implementationId: 'suggest-emojis',
        input: { text: 'pay my bills' },
        context: context(),
      })
      assert.deepEqual(Object.keys(first).sort(), ['labels', 'suggestions'])
      assert.equal(first['labels'], 812)
      const suggestions = suggestionsOf(first as Record<string, unknown>)
      assert.equal(suggestions.length, 5)
      for (let index = 0; index < suggestions.length; index += 1) {
        const suggestion = suggestions[index]
        assert.ok(suggestion !== undefined)
        assert.ok(suggestion.emoji.length > 0)
        assert.ok(Number.isFinite(suggestion.confidence) && suggestion.confidence >= 0 && suggestion.confidence <= 1)
        if (index > 0) {
          const previous = suggestions[index - 1]
          assert.ok(previous !== undefined && suggestion.confidence <= previous.confidence, 'suggestions are descending')
        }
      }

      console.log('emo "pay my bills" top-5:', suggestions.map((s) => s.emoji + ' ' + s.confidence.toFixed(4)).join(' | '))

      const second = await provider.invoke({
        implementationId: 'suggest-emojis',
        input: { text: 'pay my bills' },
        context: context(),
      })
      assert.deepEqual(second, first, 'the real inference is deterministic')
    },
  )
})
