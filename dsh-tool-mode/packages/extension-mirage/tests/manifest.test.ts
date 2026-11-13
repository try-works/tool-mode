/**
 * Discover the real Mirage package through the SDK, not a hand-built fixture.
 * This catches a manifest/schema/lock shape a pure unit test cannot.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { discoverExtension } from '@try-works/tool-mode-extension-sdk'
import extension from '../src/index.ts'

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('Cactus Mirage extension discovery', () => {
  it('declares exactly the four bounded tools and one pinned model', () => {
    const discovered = discoverExtension(packageDir)
    assert.equal(discovered.manifest.id, '@try-works/extension-mirage')
    assert.deepEqual(discovered.manifest.tools.map(tool => tool.name).sort(), [
      'mirage_describe', 'mirage_detect', 'mirage_extract', 'mirage_ocr',
    ])
    assert.deepEqual(discovered.manifest.models.map(model => model.id), ['mirage'])
  })

  it('reports needs-preparation with no fake features when nothing is prepared', async () => {
    const context = {
      extensionId: '@try-works/extension-mirage',
      extensionVersion: '0.1.0',
      activationGeneration: 1,
      storage: { read: async () => undefined, write: async () => {}, directory: '' },
      logger: { log: () => {} },
      signal: new AbortController().signal,
      configuration: {},
    }
    const instance = await extension.create(context as never)
    const provider = await instance.createProvider({ modelId: 'mirage' } as never)
    const inspection = await provider.inspect(context.signal)
    assert.equal(inspection.readiness, 'needs-preparation')
    assert.deepEqual(inspection.features, [])
    assert.equal(inspection.missing.length, 3)
  })
})
