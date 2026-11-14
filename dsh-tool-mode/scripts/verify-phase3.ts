/**
 * Phase 3 end-to-end: the code-free uhm package registers detect_fillers through the host lane
 * and runs the REAL ONNX artifact on a synthesized WAV.
 *
 * Run: npx tsx scripts/verify-phase3.ts
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createModelRuntimeTool } from '../packages/dsh-tool-mode/src/model-runtime-lane.ts'
import { parseModelRuntimeRecipe } from '../packages/dsh-tool-mode/src/model-runtime-recipe.ts'

const root = path.resolve(import.meta.dirname, '..')
const installPath = path.join(root, 'packages', 'extension-uhm-recipe')
const modelPath = path.join(root, '.assets', 'uhm', 'uhm.onnx')
const labelsPath = path.join(root, '.assets', 'uhm', 'labels.json')

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
  assetIds: ['uhm-onnx', 'uhm-onnx-model', 'uhm-labels'],
  get: (id: string) =>
    id === 'uhm-onnx'
      ? { path: path.dirname(modelPath), digest: 'fbd19765def76893841e0c70e498bf632d6c68175ceae5a2da8fe3bf7d9d0314' }
      : id === 'uhm-onnx-model'
        ? { path: modelPath, digest: 'fbd19765def76893841e0c70e498bf632d6c68175ceae5a2da8fe3bf7d9d0314' }
        : id === 'uhm-labels'
          ? { path: labelsPath, digest: '9b3a8579b0185771f137873e5cbcbdd67572c34fdbeeac778580170c9248f9a3' }
          : undefined,
}

const toolResult = createModelRuntimeTool({
  extensionId: manifest.id,
  implementationId: implementation.id,
  installPath,
  recipe: parsed.recipe,
  assets: () => assets,
  invocationContext: (exec) => ({
    invocationId: 'phase3-verify',
    signal: exec?.signal ?? new AbortController().signal,
    limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 300, maxResultBytes: 1_048_576 },
    resolvePath: (candidate: string) => candidate,
  }),
})
if (!toolResult.ok) throw new Error('lane refused: ' + toolResult.code + ': ' + toolResult.detail)
const tool = toolResult.tool
console.log('registered tool:', tool.name)

/** Deterministic 3 s 16 kHz mono PCM16 WAV: a 220 Hz tone with a gap. */
function makeWav(): string {
  const sampleRate = 16000
  const seconds = 3
  const samples = sampleRate * seconds
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate
    const amplitude = t < 1 || (t >= 1.6 && t < 2.2) ? 0 : 0.2
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * t) * amplitude * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'uhm-phase3-')), 'tone.wav')
  writeFileSync(file, Buffer.concat([header, data]))
  return file
}

const audio = makeWav()
const result = await tool.execute({ audio_path: audio })
console.log('result:', JSON.stringify(result).slice(0, 600))
await tool.dispose()

const coverage = (result as { coverage?: { processedSeconds?: number; totalSeconds?: number } }).coverage
if (coverage === undefined) throw new Error('no coverage in the result')
if (Math.abs((coverage.totalSeconds ?? 0) - 3) > 0.05) throw new Error('expected 3 s of audio, got ' + String(coverage.totalSeconds))
const fillers = (result as { fillers?: unknown[] }).fillers
if (!Array.isArray(fillers)) throw new Error('fillers is not an array')
console.log('PHASE 3 E2E PASS — code-free uhm package registered a tool and ran the real ONNX model; coverage', JSON.stringify(coverage))
