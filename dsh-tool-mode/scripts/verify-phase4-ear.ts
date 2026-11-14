/**
 * Phase 4 ear end-to-end: the code-free ear package registers identify_language through the
 * host lane and the REAL ear.tflite model identifies a language on a synthesized WAV.
 *
 * Run: npx tsx scripts/verify-phase4-ear.ts
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createModelRuntimeTool } from '../packages/dsh-tool-mode/src/model-runtime-lane.ts'
import { parseModelRuntimeRecipe } from '../packages/dsh-tool-mode/src/model-runtime-recipe.ts'

const root = path.resolve(import.meta.dirname, '..')
const installPath = path.join(root, 'packages', 'extension-ear-recipe')
const modelPath = path.join(root, '.assets', 'ear', 'ear.tflite')
const metaPath = path.join(root, '.assets', 'ear', 'ear_meta.json')
const languagesPath = path.join(root, '.assets', 'ear', 'languages.json')
const filtersPath = path.join(root, '.assets', 'ear', 'mel_filters.f32')
const sha = {
  tflite: 'a19b43892abe53afba50122a861b10fd76f312a5027a5c659b0738081135feeb',
  meta: '538d66c747024d4ef2ae33aef273817c7baea21171430fef0c2713a66bb6af18',
  languages: '0a08f30dec26ad25730a1fa9375a5d693f5a159032d0cd7818007b7dbc3eae18',
  filters: 'a3099fcba1a7f30f229b230011146ea0140db8de4f467b44aaa5de70bcc0f325',
}

const manifest = JSON.parse(readFileSync(path.join(installPath, 'tool-mode.extension.json'), 'utf8')) as {
  id: string
  implementations: Array<{ id: string }>
}
const implementation = manifest.implementations[0]
if (implementation === undefined) throw new Error('no implementation')
const rawRecipe: unknown = JSON.parse(readFileSync(path.join(installPath, 'recipes', implementation.id + '.json'), 'utf8'))
const parsed = parseModelRuntimeRecipe(rawRecipe)
if (!parsed.ok) throw new Error('recipe refused: ' + parsed.code + ': ' + parsed.detail)

const assets = {
  assetIds: ['ear-litert', 'ear-tflite', 'ear-meta', 'ear-languages', 'ear-mel-filters'],
  get: (id: string) => {
    const directory = path.dirname(modelPath)
    if (id === 'ear-litert') return { path: directory, digest: sha.tflite }
    if (id === 'ear-tflite') return { path: modelPath, digest: sha.tflite }
    if (id === 'ear-meta') return { path: metaPath, digest: sha.meta }
    if (id === 'ear-languages') return { path: languagesPath, digest: sha.languages }
    if (id === 'ear-mel-filters') return { path: filtersPath, digest: sha.filters }
    return undefined
  },
}

const toolResult = createModelRuntimeTool({
  extensionId: manifest.id,
  implementationId: implementation.id,
  installPath,
  recipe: parsed.recipe,
  assets: () => assets,
  invocationContext: (exec) => ({
    invocationId: 'phase4-ear-verify',
    signal: exec?.signal ?? new AbortController().signal,
    limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 300, maxResultBytes: 8_388_608 },
    resolvePath: (candidate: string) => candidate,
  }),
})
if (!toolResult.ok) throw new Error('lane refused: ' + toolResult.code + ': ' + toolResult.detail)
const tool = toolResult.tool
console.log('registered tool:', tool.name)

/** 3 s, 16 kHz mono PCM16 WAV: a voiced 140 Hz tone with speech-like amplitude modulation. */
function makeWav(): string {
  const sampleRate = 16000
  const samples = sampleRate * 3
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate
    const envelope = Math.max(0, Math.sin(2 * Math.PI * 1.6 * t)) * 0.2
    const value = Math.sin(2 * Math.PI * 140 * t) * envelope
    data.writeInt16LE(Math.round(value * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'ear-phase4-')), 'voice.wav')
  writeFileSync(file, Buffer.concat([header, data]))
  return file
}

const result = (await tool.execute({ audio_path: makeWav() })) as {
  language?: string
  confidence?: number
  isReliable?: boolean
  candidates?: Array<{ language: string; probability: number }>
  windows?: number
}
await tool.dispose()

const languages = JSON.parse(readFileSync(languagesPath, 'utf8')) as string[]
const canonical = languages.map((code) => (code === 'yue' ? 'zh' : code))
if (typeof result.language !== 'string' || !canonical.includes(result.language)) throw new Error('language not in the model label space: ' + String(result.language))
if (typeof result.confidence !== 'number' || !Number.isFinite(result.confidence)) throw new Error('confidence is not finite')
if (typeof result.isReliable !== 'boolean') throw new Error('isReliable is not a boolean')
if (!Array.isArray(result.candidates) || result.candidates.length === 0 || result.candidates.length > 5) throw new Error('candidates is not 1..5 entries')
if (typeof result.windows !== 'number' || !Number.isInteger(result.windows) || result.windows < 1) throw new Error('windows is not a positive integer')
console.log('result:', JSON.stringify(result).slice(0, 400))
console.log('PHASE 4 EAR E2E PASS — code-free package registered identify_language and ran the real model')
