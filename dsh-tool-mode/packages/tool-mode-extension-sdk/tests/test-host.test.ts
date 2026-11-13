/** The reference test host loads and activates a real extension entry (EXT-17). */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createAuthorTestHost } from '../src/index.ts'

test('loads an extension entry and returns an activated instance outside DSH', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'author-test-host-'))
  const entry = join(dir, 'index.mjs')
  writeFileSync(entry, [
    'let disposed = false',
    'export default {',
    '  apiVersion: 1,',
    '  create(context) {',
    '    return {',
    '      async createProvider() {',
    '        return {',
    '          id: `provider-${context.extensionId}`,',
    '          async dispose() { disposed = true },',
    '        }',
    '      },',
    '      async dispose(reason) { disposed = reason === "author test complete" },',
    '    }',
    '  },',
    '}',
    '',
  ].join('\n'))
  try {
    const host = await createAuthorTestHost({ entryPath: entry })
    const provider = await host.instance.createProvider({ modelId: 'demo', configuration: {} }) as { id: string }
    assert.equal(provider.id, 'provider-author-test-host')
    await host.dispose()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a malformed entry is refused with the SDK management vocabulary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'author-test-host-bad-'))
  const entry = join(dir, 'index.mjs')
  writeFileSync(entry, 'export default { apiVersion: 1 }\n')
  try {
    await assert.rejects(
      createAuthorTestHost({ entryPath: entry }),
      (error: unknown) => error instanceof Error && /create\(context\)/.test(error.message),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
