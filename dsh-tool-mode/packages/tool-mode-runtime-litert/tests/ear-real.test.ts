/**
 * The gated REAL ear run.
 *
 * Skips with a stated reason unless TOOL_MODE_REAL_ASSETS=1 AND .assets/ear/ear.tflite exists
 * at the repository root. Assets are never downloaded or committed here.
 *
 * PROVENANCE: HF desert-ant-labs/ear revision 1e2148c0cc46130174ecf564c406e44931fca386;
 * ear.tflite 10,671,552 B sha256 a19b43892abe53afba50122a861b10fd76f312a5027a5c659b0738081135feeb
 * (verified in this test); ear_meta.json, languages.json (103 codes) and mel_filters.f32
 * (uint32 80, 201 then float32 LE) are read from the same verified asset set. Front-end and
 * pipeline provenance: Sources/Ear/Frontend.swift, Model.swift, Ear.swift, Languages.swift at
 * desert-ant-core baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7.
 *
 * This asserts WIRING and SHAPE on a generated WAV: windows/candidates/confidence arithmetic,
 * finite probabilities, the reliability rule, and a language drawn from the model's own label
 * space. It is NOT an accuracy claim: that needs labelled recordings across languages.
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
  PreparedAssetMapV1,
} from '@try-works/tool-mode-extension-sdk'
import type { ModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'

import { EAR_CONFUSABLE_LANGUAGES, EAR_LANGUAGE_ALIASES, EAR_RELIABLE_MARGIN, createProviderFromRecipe } from '../src/index.ts'
import { burst, concatSegments, encodeWav } from './ear-fixtures.ts'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const assetDir = path.join(repoRoot, '.assets', 'ear')
const modelPath = path.join(assetDir, 'ear.tflite')
const PINNED_BYTES = 10_671_552
const PINNED_SHA256 = 'a19b43892abe53afba50122a861b10fd76f312a5027a5c659b0738081135feeb'

const skipReason =
  process.env['TOOL_MODE_REAL_ASSETS'] !== '1'
    ? 'TOOL_MODE_REAL_ASSETS is not 1; real ear inference not requested'
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
  model: { assetSet: 'ear-litert', fileName: 'ear.tflite', format: 'tflite' },
  processor: { id: 'ear/mel-v1' },
  limits: { maxInputBytes: 4_194_304, timeoutMs: 120_000 },
  tool: {
    name: 'identify_language',
    description: 'Identify the spoken language of a recording.',
    inputSchema: './schemas/ear.input.json',
    outputSchema: './schemas/ear.output.json',
  },
}

const assets: PreparedAssetMapV1 = {
  assetIds: ['ear-litert'],
  get: (id: string) => (id === 'ear-litert' ? { path: assetDir, digest: PINNED_SHA256 } : undefined),
}

const signal = (): AbortSignal => new AbortController().signal

const context = (): InvocationContextV1 => ({
  invocationId: 'inv_real_ear',
  signal: signal(),
  limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 0, maxResultBytes: 4_194_304 },
  resolvePath: (candidate: string) => candidate,
})

/** 70 s: silence, two syllabic bursts, then silence, so there are five candidate windows. */
const generatedAudio = (): Float32Array => {
  const oneSecond = 16000
  const silence = (seconds: number) => new Float32Array(oneSecond * seconds)
  const first = burst({ sampleRate: 16000, seconds: 10, hz: 300, onMs: 100, offMs: 100 })
  const second = burst({ sampleRate: 16000, seconds: 10, hz: 240, onMs: 120, offMs: 80 })
  return concatSegments([silence(5), first, silence(10), second, silence(35)])
}

const canonical = (code: string): string =>
  code === 'tl' ? EAR_LANGUAGE_ALIASES.tl : code === 'nb' ? EAR_LANGUAGE_ALIASES.nb : code === 'yue' ? EAR_LANGUAGE_ALIASES.yue : code

describe('the real ear model through createProviderFromRecipe', () => {
  it(
    'identifies a generated recording with the documented aggregation and reliability rules',
    { skip: skipReason },
    async () => {
      const bytes = await readFile(modelPath)
      assert.equal(bytes.length, PINNED_BYTES, 'the pinned ear.tflite size')
      assert.equal(createHash('sha256').update(bytes).digest('hex'), PINNED_SHA256, 'the pinned ear.tflite sha256')

      const filterBytes = await readFile(path.join(assetDir, 'mel_filters.f32'))
      const filterView = new DataView(filterBytes.buffer, filterBytes.byteOffset, filterBytes.byteLength)
      assert.equal(filterView.getUint32(0, true), 80, 'mel filterbank mels')
      assert.equal(filterView.getUint32(4, true), 201, 'mel filterbank bins')
      assert.equal(filterBytes.length, 8 + 80 * 201 * 4, 'mel filterbank size')

      const codes = JSON.parse(await readFile(path.join(assetDir, 'languages.json'), 'utf8')) as string[]
      assert.equal(codes.length, 103, 'the model emits 103 labels')
      const supported = new Set(codes.map(canonical))

      const dir = await mkdtemp(path.join(os.tmpdir(), 'litert-ear-real-'))
      try {
        const wav = path.join(dir, 'generated.wav')
        await writeFile(wav, encodeWav({ sampleRate: 16000, channels: 1, encoding: 'pcm16', samples: generatedAudio() }))

        const provider = createProviderFromRecipe(recipe, assets)
        await provider.load({ assets, signal: signal() })
        assert.equal((await provider.inspect(signal())).readiness, 'ready')

        const output = await provider.invoke({
          implementationId: 'identify-language',
          input: { audio_path: wav },
          context: context(),
        })
        assert.deepEqual(Object.keys(output).sort(), ['candidates', 'confidence', 'isReliable', 'language', 'windows'])
        assert.equal(output['windows'], 3, '70 s and the default of 3 windows')

        const candidatesValue = output['candidates']
        assert.ok(Array.isArray(candidatesValue))
        const candidates = candidatesValue.map((entry) => {
          assert.ok(typeof entry === 'object' && entry !== null && !Array.isArray(entry))
          const record = entry as Record<string, unknown>
          const language = record['language']
          const probability = record['probability']
          assert.ok(typeof language === 'string')
          assert.ok(typeof probability === 'number')
          return { language, probability }
        })
        assert.equal(candidates.length, 5)
        assert.ok(supported.has(candidates[0]?.language ?? ''), 'the language is in the model label space')
        for (let index = 0; index < candidates.length; index += 1) {
          const candidate = candidates[index]
          assert.ok(candidate !== undefined)
          assert.ok(typeof candidate.language === 'string' && candidate.language.length > 0)
          assert.ok(Number.isFinite(candidate.probability) && candidate.probability >= 0 && candidate.probability <= 1)
          if (index > 0) {
            const previous = candidates[index - 1]
            assert.ok(previous !== undefined && candidate.probability <= previous.probability, 'candidates are descending')
          }
        }
        assert.equal(output['language'], candidates[0]?.language)
        assert.equal(output['confidence'], candidates[0]?.probability)

        const expectedReliable =
          !EAR_CONFUSABLE_LANGUAGES.some((code) => code === candidates[0]?.language) &&
          (candidates[0]?.probability ?? 0) - (candidates[1]?.probability ?? 0) >= EAR_RELIABLE_MARGIN
        assert.equal(output['isReliable'], expectedReliable, 'the reliability rule matches the candidates')
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  )
})
