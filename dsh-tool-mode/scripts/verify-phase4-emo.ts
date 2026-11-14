/**
 * Phase 4 emo end-to-end: the code-free emo package registers suggest_emojis through the
 * host lane and the REAL emo.tflite model suggests emojis for a phrase.
 *
 * Run: npx tsx scripts/verify-phase4-emo.ts
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createModelRuntimeTool } from '../packages/dsh-tool-mode/src/model-runtime-lane.ts'
import { parseModelRuntimeRecipe } from '../packages/dsh-tool-mode/src/model-runtime-recipe.ts'

const root = path.resolve(import.meta.dirname, '..')
const installPath = path.join(root, 'packages', 'extension-emo-recipe')
const modelPath = path.join(root, '.assets', 'emo', 'emo.tflite')
const tokenizerPath = path.join(root, '.assets', 'emo', 'emo_tokenizer.bin')
const metaPath = path.join(root, '.assets', 'emo', 'emo_meta.json')
const sha = {
  tflite: '2c382e8da94bab64172c0694b0350abb96829bf89eb623008ed0085128621de2',
  tokenizer: 'f54462a7a2344f15c9430ed4e399c49444f890dd6094c745a0c5391690bf019d',
  meta: 'a3143258ac4099de65367cd4598073f1f5ce94f0eb505a30331762619967d3f6',
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
  assetIds: ['emo-litert', 'emo-tflite', 'emo-tokenizer', 'emo-meta'],
  get: (id: string) =>
    id === 'emo-litert'
      ? { path: path.dirname(modelPath), digest: sha.tflite }
      : id === 'emo-tflite'
        ? { path: modelPath, digest: sha.tflite }
        : id === 'emo-tokenizer'
          ? { path: tokenizerPath, digest: sha.tokenizer }
          : id === 'emo-meta'
            ? { path: metaPath, digest: sha.meta }
            : undefined,
}

const toolResult = createModelRuntimeTool({
  extensionId: manifest.id,
  implementationId: implementation.id,
  installPath,
  recipe: parsed.recipe,
  assets: () => assets,
  invocationContext: (exec) => ({
    invocationId: 'phase4-emo-verify',
    signal: exec?.signal ?? new AbortController().signal,
    limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 0, maxResultBytes: 8_388_608 },
    resolvePath: (candidate: string) => candidate,
  }),
})
if (!toolResult.ok) throw new Error('lane refused: ' + toolResult.code + ': ' + toolResult.detail)
const tool = toolResult.tool
console.log('registered tool:', tool.name)

const result = (await tool.execute({ text: 'pay my bills', limit: 5 })) as {
  suggestions?: Array<{ emoji: string; confidence: number }>
  labels?: number
}
await tool.dispose()

if (!Array.isArray(result.suggestions) || result.suggestions.length < 1 || result.suggestions.length > 5) throw new Error('suggestions is not 1..5 entries')
for (const suggestion of result.suggestions) {
  if (typeof suggestion.emoji !== 'string' || suggestion.emoji.length === 0) throw new Error('suggested emoji is not a non-empty string')
  if (typeof suggestion.confidence !== 'number' || !Number.isFinite(suggestion.confidence)) throw new Error('confidence is not finite')
}
if (result.labels !== 812) throw new Error('labels is not 812: ' + String(result.labels))
console.log('result:', JSON.stringify(result).slice(0, 400))
console.log('PHASE 4 EMO E2E PASS — code-free package registered suggest_emojis and ran the real model')
