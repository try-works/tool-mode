/**
 * Manifest drift guard (docs/plans/recommendation-execution.md, Slice 6).
 *
 * A narrow, derivable slice of "derive the manifest": identity/version agreement with
 * package.json, tool/implementation id and name uniqueness, referenced schema paths that
 * actually exist, and implementations that name a contract the manifest (or the standard
 * contract registry) declares. It is NOT full manifest generation; that still needs SDK
 * authoring metadata and is recorded as remaining work.
 */
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'

import { checkExtensionManifests } from '../../../scripts/check-extension-manifests.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const packages = [
  'extension-declarative-recipes',
  'extension-desert-ant-tongue',
  'extension-desert-ant-voz',
  'extension-embeddinggemma',
  'extension-emo-recipe',
  'extension-laya',
  'extension-minilm-embed',
  'extension-minilm-rerank',
  'extension-mirage',
  'extension-moderator-recipe',
  'extension-needle',
  'extension-redact',
  'extension-shapes-recipe',
  'extension-uhm-recipe',
  'extension-clear-recipe',
  'extension-ear-recipe',
  'harness-vision',
  'tool-mode-harness-text',
] as const

const tempDirs: string[] = []
after(() => {
  for (const directory of tempDirs) rmSync(directory, { recursive: true, force: true })
})

test('every first-party extension manifest is internally consistent', () => {
  const result = checkExtensionManifests(ROOT)
  assert.deepEqual(result.violations, [], `manifest violations:\n${result.violations.join('\n')}`)
  assert.deepEqual(result.manifests.map(entry => entry.package).sort(), [...packages].sort())
})

test('a renamed schema path is reported, not silently accepted', () => {
  const root = mkdtempSync(join(tmpdir(), 'manifest-drift-'))
  tempDirs.push(root)
  const source = join(ROOT, 'packages', 'extension-laya')
  const target = join(root, 'packages', 'extension-laya')
  cpSync(source, target, { recursive: true, filter: path => !path.includes(`${join(source, 'lib')}`) })
  const schema = join(target, 'schema', 'decision-test.input.json')
  assert.match(readFileSync(schema, 'utf8'), /"/, 'the fixture schema must be real JSON')
  renameSync(schema, join(target, 'schema', 'renamed.input.json'))

  const result = checkExtensionManifests(root)
  assert.notDeepEqual(result.violations, [])
  assert.ok(
    result.violations.some(violation => violation.includes('decision-test.input.json')),
    `the missing schema must be named:\n${result.violations.join('\n')}`,
  )
})
