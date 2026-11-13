/** AT-53/55 — the REAL Laya standard and local choose paths. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { activateExtension, type ExtensionContextV1, type InvocationContextV1, type ToolModeExtensionV1 } from '@try-works/tool-mode-extension-sdk'
import extension from '../src/index.ts'

const MODEL_DIR = process.env.LAYA_MODEL_DIR
  ?? 'E:\\dsh-asset-cache\\groups\\@try-works__extension-laya\\laya\\text-backbone'
const SKIP = existsSync(join(MODEL_DIR, 'encoder.onnx')) && existsSync(join(MODEL_DIR, 'head.onnx'))
  ? undefined
  : `the Laya checkpoint is not at ${MODEL_DIR}; set LAYA_MODEL_DIR`

function context(): ExtensionContextV1 {
  return {
    extensionId: '@try-works/extension-laya',
    extensionVersion: '1.0.3',
    activationGeneration: 1,
    storage: { directory: '', async read() { return undefined }, async write() { /* no-op */ } },
    logger: { log: () => { /* silent */ } },
    signal: new AbortController().signal,
    configuration: {},
  }
}

function invocation(): InvocationContextV1 {
  return {
    invocationId: 'laya-real-test',
    signal: new AbortController().signal,
    limits: { maxInputBytes: 8 * 1024 * 1024, maxAudioSeconds: 300, maxResultBytes: 4 * 1024 * 1024 },
    resolvePath: candidate => candidate,
  }
}

const assets = {
  get: (assetId: string) => (
    assetId === 'text-backbone' ? { path: MODEL_DIR, digest: 'sha256:real' } : undefined
  ),
  assetIds: ['text-backbone'],
}

after(async () => { /* instance disposed per test */ })

describe('AT-53/55 — REAL Laya choice semantics', { skip: SKIP }, () => {
  it('the standard decision.choose path returns an option index plus a confidence bucket', async () => {
    const instance = await activateExtension(extension as unknown as ToolModeExtensionV1, context())
    try {
      const provider = await instance.createProvider({ modelId: 'laya', configuration: {} })
      await provider.load({ assets, signal: new AbortController().signal })
      const options = ['apple', 'car', 'banana']
      const output = await provider.invoke({
        implementationId: 'laya-onnx-decision-choose-standard',
        input: { decision: 'Which of these is a fruit?', options },
        context: invocation(),
      }) as Record<string, unknown>
      assert.ok(Number.isInteger(output.chosen), `chosen must be an index: ${JSON.stringify(output)}`)
      assert.ok((output.chosen as number) >= 0 && (output.chosen as number) < options.length)
      assert.ok(['confident', 'likely', 'tentative'].includes(String(output.confidence)))
      assert.match(String(output.reason), new RegExp(options[output.chosen as number]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    } finally {
      await instance.dispose('shutdown')
    }
  })

  it('the local choose path preserves option labels and probabilities', async () => {
    const instance = await activateExtension(extension as unknown as ToolModeExtensionV1, context())
    try {
      const provider = await instance.createProvider({ modelId: 'laya', configuration: {} })
      await provider.load({ assets, signal: new AbortController().signal })
      const options = ['apple', 'car', 'banana']
      const output = await provider.invoke({
        implementationId: 'laya-onnx-decision-choose',
        input: { prompt: 'Which of these is a fruit?', options },
        context: invocation(),
      }) as Record<string, unknown>
      assert.equal(output.calibrated, false)
      assert.ok(options.includes(String(output.chosen)) || output.chosen === null)
      const probabilities = output.probabilities as Record<string, number>
      assert.deepEqual(Object.keys(probabilities).sort(), [...options].sort())
    } finally {
      await instance.dispose('shutdown')
    }
  })
})
