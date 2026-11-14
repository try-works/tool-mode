/**
 * Phase 3 clear end-to-end: the code-free clear package registers enhance_speech through the
 * host lane and the REAL clear-studio.onnx model enhances a synthesized WAV.
 *
 * Run: npx tsx scripts/verify-phase3-clear.ts
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createModelRuntimeTool } from '../packages/dsh-tool-mode/src/model-runtime-lane.ts'
import { parseModelRuntimeRecipe } from '../packages/dsh-tool-mode/src/model-runtime-recipe.ts'

const root = path.resolve(import.meta.dirname, '..')
const installPath = path.join(root, 'packages', 'extension-clear-recipe')
const modelPath = path.join(root, '.assets', 'clear', 'clear-studio.onnx')
const digest = '4176990296374e972f0c347ddcc7988d216829cafc58e4d54a98dccd715107d9'

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
  assetIds: ['clear-onnx', 'clear-onnx-model'],
  get: (id: string) =>
    id === 'clear-onnx' ? { path: path.dirname(modelPath), digest } : id === 'clear-onnx-model' ? { path: modelPath, digest } : undefined,
}

const toolResult = createModelRuntimeTool({
  extensionId: manifest.id,
  implementationId: implementation.id,
  installPath,
  recipe: parsed.recipe,
  assets: () => assets,
  invocationContext: (exec) => ({
    invocationId: 'phase3-clear-verify',
    signal: exec?.signal ?? new AbortController().signal,
    limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 300, maxResultBytes: 8_388_608 },
    resolvePath: (candidate: string) => candidate,
  }),
})
if (!toolResult.ok) throw new Error('lane refused: ' + toolResult.code + ': ' + toolResult.detail)
const tool = toolResult.tool
console.log('registered tool:', tool.name)

/** 1 s, 48 kHz mono PCM16 WAV: speech-like tone plus broadband noise. */
function makeWav(): string {
  const sampleRate = 48000
  const samples = sampleRate
  const data = Buffer.alloc(samples * 2)
  let seed = 1234567
  for (let i = 0; i < samples; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const noise = (seed / 0x7fffffff - 0.5) * 0.1
    const t = i / sampleRate
    const tone = Math.sin(2 * Math.PI * 180 * t) * 0.2
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, tone + noise)) * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'clear-phase3-')), 'noisy.wav')
  writeFileSync(file, Buffer.concat([header, data]))
  return file
}

const result = (await tool.execute({ audio_path: makeWav() })) as {
  audio_base64?: string
  sampleRate?: number
  durationSeconds?: number
  coverage?: { complete?: boolean; processedSeconds?: number; totalSeconds?: number }
}
await tool.dispose()

if (typeof result.audio_base64 !== 'string' || result.audio_base64.length === 0) throw new Error('no audio_base64 in the result')
if (result.sampleRate !== 48000) throw new Error('expected 48 kHz output, got ' + String(result.sampleRate))
const bytes = Buffer.from(result.audio_base64, 'base64')
if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('audio_base64 is not a WAV')
if (result.coverage === undefined || typeof result.coverage.totalSeconds !== 'number') throw new Error('no coverage')
console.log('output WAV bytes:', bytes.length, '| duration:', result.durationSeconds, '| coverage:', JSON.stringify(result.coverage))
console.log('PHASE 3 CLEAR E2E PASS — code-free clear package registered a tool and ran the real ONNX model')
