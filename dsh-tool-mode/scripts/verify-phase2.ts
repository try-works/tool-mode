/**
 * Phase 2 end-to-end: a CODE-FREE package's recipe registers a tool through the HOST lane,
 * and that tool runs the REAL shapes model through the factory named by the recipe.
 *
 * This is the Phase 2 gate's integration proof: manifest + recipe + schemas + lock only
 * (no extension entry), host-side recipe parsing and provider resolution, real LiteRT
 * inference on the pinned artifact. Run: npx tsx scripts/verify-phase2.ts
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createModelRuntimeTool } from '../packages/dsh-tool-mode/src/model-runtime-lane.ts'
import { parseModelRuntimeRecipe } from '../packages/dsh-tool-mode/src/model-runtime-recipe.ts'

const root = path.resolve(import.meta.dirname, '..')
const installPath = path.join(root, 'packages', 'extension-shapes-recipe')
const modelPath = path.join(root, '.assets', 'shapes', 'shapes.tflite')
const manifest = JSON.parse(readFileSync(path.join(installPath, 'tool-mode.extension.json'), 'utf8')) as {
  id: string
  models: Array<{ id: string }>
  implementations: Array<{ id: string; modelId?: string }>
}
const implementation = manifest.implementations[0]
if (implementation === undefined) throw new Error('the package declares no implementation')
const rawRecipe: unknown = JSON.parse(readFileSync(path.join(installPath, 'recipes', implementation.id + '.json'), 'utf8'))
const parsed = parseModelRuntimeRecipe(rawRecipe)
if (!parsed.ok) throw new Error('recipe refused: ' + parsed.code + ': ' + parsed.detail)

const digest = '8274742f91341e54ae64df4c561a19e5fb4cf591d6b305290d129068f56ef6b9'
// The host projects the GROUP id to its directory and each asset id to its file.
const assets = {
  assetIds: ['shapes-litert', 'shapes-tflite'],
  get: (id: string) =>
    id === 'shapes-litert'
      ? { path: path.dirname(modelPath), digest }
      : id === 'shapes-tflite'
        ? { path: modelPath, digest }
        : undefined,
}

const toolResult = createModelRuntimeTool({
  extensionId: manifest.id,
  implementationId: implementation.id,
  installPath,
  recipe: parsed.recipe,
  assets: () => assets,
  invocationContext: (exec) => ({
    invocationId: 'phase2-verify',
    signal: exec?.signal ?? new AbortController().signal,
    limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 0, maxResultBytes: 1_048_576 },
    resolvePath: (candidate: string) => candidate,
  }),
})
if (!toolResult.ok) throw new Error('lane refused: ' + toolResult.code + ': ' + toolResult.detail)
const tool = toolResult.tool
console.log('registered tool:', tool.name, '| parameters:', Object.keys(tool.parameters).join(','))

function linePoints(): number[][] {
  const points: number[][] = []
  for (let i = 0; i < 64; i += 1) points.push([i / 63, 0.5])
  return points
}
function rectanglePoints(): number[][] {
  const points: number[][] = []
  const n = 16
  for (let i = 0; i < n; i += 1) points.push([i / (n - 1), 0])
  for (let i = 0; i < n; i += 1) points.push([1, i / (n - 1)])
  for (let i = 0; i < n; i += 1) points.push([1 - i / (n - 1), 1])
  for (let i = 0; i < n; i += 1) points.push([0, 1 - i / (n - 1)])
  return points
}

const line = await tool.execute({ points: linePoints(), closed: false })
const rectangle = await tool.execute({ points: rectanglePoints(), closed: true })
console.log('line ->', JSON.stringify(line).slice(0, 300))
console.log('rectangle ->', JSON.stringify(rectangle).slice(0, 300))
await tool.dispose()

const lineShape = (line as { shape?: unknown }).shape
const rectangleShape = (rectangle as { shape?: unknown }).shape
if (lineShape !== 'line') throw new Error('expected the line stroke to score as line, got ' + String(lineShape))
if (rectangleShape !== 'rectangle') throw new Error('expected the rectangle stroke to score as rectangle, got ' + String(rectangleShape))
console.log('PHASE 2 E2E PASS — code-free package registered a tool and ran the real model')
