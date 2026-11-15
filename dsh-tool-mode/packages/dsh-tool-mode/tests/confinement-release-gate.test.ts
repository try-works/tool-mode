/**
 * The release gate for CODE-09 evidence.
 *
 * A stale artifact once shipped for four months because publish never checked it. These
 * assertions pin the wiring so a version bump cannot publish evidence recorded for an
 * older build: npm publish runs prepublishOnly (build + check), and both root verification
 * scripts run the same check.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageDir = new URL('../', import.meta.url)
const repoRoot = new URL('../../../', import.meta.url)

function scriptsOf(url: URL): Record<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(url, 'utf8'))
  assert.ok(typeof parsed === 'object' && parsed !== null && 'scripts' in parsed)
  const scripts = (parsed as { scripts?: unknown }).scripts
  assert.ok(typeof scripts === 'object' && scripts !== null)
  return scripts as Record<string, string>
}

test('npm publish cannot ship stale confinement evidence', () => {
  const scripts = scriptsOf(new URL('package.json', packageDir))
  assert.match(scripts['prepublishOnly'] ?? '', /check:confinement/, 'prepublishOnly must run the evidence check')
  assert.match(scripts['prepublishOnly'] ?? '', /build/, 'prepublishOnly must build the artifact it validates')
  assert.match(scripts['release:evidence'] ?? '', /record-confinement-evidence/, 'release:evidence must record')
  assert.match(scripts['release:evidence'] ?? '', /check:confinement/, 'release:evidence must validate')
})

test('both root verification gates run the evidence check', () => {
  const scripts = scriptsOf(new URL('package.json', repoRoot))
  for (const gate of ['verify:static', 'verify:release']) {
    assert.match(scripts[gate] ?? '', /check-confinement-evidence\.mjs/, gate + ' must run the evidence check')
  }
})
