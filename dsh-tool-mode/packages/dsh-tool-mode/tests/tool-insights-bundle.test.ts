/**
 * Tool Insights bundle: the page source is INLINED into client/index.js (a
 * sibling chunk would 404, same reason the chat cards are inlined), the
 * generator's placeholder is consumed, and `gen-client-catalog --check` reports
 * the committed bundle as current.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const PACKAGE_DIR = join(process.cwd(), 'packages', 'dsh-tool-mode')
const BUNDLE = join(PACKAGE_DIR, 'client', 'index.js')
const TEMPLATE = join(PACKAGE_DIR, 'client', 'index.template.js')
const SOURCE = join(PACKAGE_DIR, 'client', 'tool-insights.js')

test('the authoring source exists and exposes the factory', () => {
  const source = readFileSync(SOURCE, 'utf8')
  assert.ok(source.includes('function createToolInsights(createElement'), 'the factory signature stays createToolInsights(h)')
  for (const label of ['Tool Insights', 'Tool Inventory', 'MCP', 'Settings', 'Tool performance', 'Model leaderboard', 'Calls per day', 'All calls']) {
    assert.ok(source.includes(label), `${label} must be authored in the page source`)
  }
})

test('unavailable model switches use a neutral disabled style', () => {
  const template = readFileSync(TEMPLATE, 'utf8')
  assert.ok(template.includes('.mtt-toggle:disabled'))
  assert.ok(template.includes('#E5E7EB'), 'disabled switches must have an explicit grey track')
  assert.ok(template.includes('#8B93A1'), 'disabled switches must have an explicit grey knob')
  assert.ok(template.includes('unavailable.map(entry => modelRow(entry, false, true, toggleModel))'),
    'unavailable models must render as disabled controls')
})

test('the template carries the placeholder and registers the page once', () => {
  const template = readFileSync(TEMPLATE, 'utf8')
  assert.ok(template.includes('/*__TOOL_INSIGHTS_SOURCE__*/'), 'the template must hold the inlining placeholder')
  assert.ok(template.includes('createToolInsights('), 'the template must build the page factory')
  assert.equal(template.split("name: 'main'").length - 1, 1, 'exactly one main registration')
  assert.equal(template.split("name: 'sidebar.panellist'").length - 1, 1, 'exactly one sidebar registration')
  assert.ok(template.includes("key: 'tool-insights'"))
  assert.ok(template.includes("id: 'tool-insights'"))
  assert.ok(template.includes('order: 15'))
})

test('the generated bundle inlines the page with no chunk fetch', () => {
  const bundle = readFileSync(BUNDLE, 'utf8')
  assert.ok(bundle.includes('function createToolInsights'), 'the page must be inlined')
  assert.ok(!bundle.includes('/*__TOOL_INSIGHTS_SOURCE__*/'), 'the placeholder must be replaced')
  assert.ok(!bundle.includes("require.async('./tool-insights.js')"), 'no async chunk fetch (404 would silently drop the page)')
  for (const label of ['Tool Insights', 'Tool Inventory', 'MCP']) {
    assert.ok(bundle.includes(label), `${label} must be in the served bundle`)
  }
  assert.ok(bundle.includes('Previous') && bundle.includes('Next'), 'pagination controls ship in the bundle')
})

test('gen-client-catalog --check reports the committed bundle current', () => {
  // `stdio: 'ignore'`: the DSH Windows sandbox refuses PIPE creation for child
  // processes, so the check is run with no captured streams and judged by exit code.
  const result = spawnSync(process.execPath, [join(PACKAGE_DIR, 'scripts', 'gen-client-catalog.mjs'), '--check'], {
    cwd: PACKAGE_DIR,
    stdio: 'ignore',
  })
  assert.equal(result.status, 0, 'client/index.js must be the generator’s current output')
  assert.equal(result.error, undefined, String(result.error ?? ''))
})
