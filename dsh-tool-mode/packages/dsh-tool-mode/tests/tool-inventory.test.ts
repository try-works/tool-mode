/**
 * S3 — the live tool inventory (plan §3.3).
 *
 * Inventory is a LIVE read, not a projection: every registered tool appears even when
 * it was never called, and installed-but-inactive extension tools appear with their
 * derived state. Attribution comes from the same resolver the report uses; an unknown
 * owner stays explicit. `model_tools` is always present and always MCP-withheld.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buildToolInventory, type InventoryExtension } from '../src/tool-inventory.ts'

/** The registry's model-facing projection, one entry per registered tool. */
const REGISTRY = [
  { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' } } } },
  { name: 'lang_detect', description: 'Detect a language', parameters: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'model_tools', description: 'Tool Mode management', parameters: { type: 'object', properties: {} } },
  { name: 'custom_tool', description: 'A plugin tool', parameters: { type: 'object', properties: { a: { type: 'string' } } } },
]

const EXTENSIONS: readonly InventoryExtension[] = [
  {
    id: '@try-works/extension-tongue',
    installed: true,
    active: true,
    tools: ['lang_detect'],
    requirements: [{ kind: 'assets', satisfied: true }],
  },
  {
    id: '@try-works/extension-embeddinggemma',
    installed: true,
    active: false,
    tools: ['multimodal_embed'],
    requirements: [{ kind: 'assets', satisfied: true }],
  },
  {
    id: '@try-works/extension-needle',
    installed: true,
    active: false,
    tools: ['structured_extract'],
    requirements: [{ kind: 'assets', satisfied: false }],
  },
  {
    id: '@try-works/extension-laya',
    installed: false,
    active: false,
    tools: ['decision_choose'],
    requirements: [],
  },
]

const USAGE = [
  { name: 'lang_detect', calls: 5, errors: 1, lastUsed: 1_700_000_000_000 },
]

describe('S3 inventory rows', () => {
  it('attributes a user-authored tool to its custom record', () => {
    const rows = buildToolInventory({
      registry: REGISTRY,
      extensions: EXTENSIONS,
      usage: USAGE,
      mcpExposed: [],
      customTools: [{ name: 'custom_tool', id: 'custom.a-tool', title: 'A tool' }],
    })
    const row = rows.find(candidate => candidate.name === 'custom_tool')
    assert.ok(row !== undefined)
    assert.equal(row.kind, 'custom')
    assert.equal(row.origin, 'custom')
    assert.equal(row.owner, 'custom.a-tool')
  })

  it('lists a registered tool that was never called', () => {
    const rows = buildToolInventory({ registry: REGISTRY, extensions: EXTENSIONS, usage: USAGE, mcpExposed: ['read', 'lang_detect'] })
    const read = rows.find(row => row.name === 'read')
    assert.ok(read !== undefined)
    assert.equal(read.calls, 0)
    assert.equal(read.success, 0)
    assert.equal(read.lastUsed, null)
    assert.equal(read.state, 'active')
    assert.equal(read.argumentCount, 2)
    assert.equal(read.owner, '@deepseek-ai/dsh-tool-fs')
    assert.equal(read.kind, 'built-in')
    assert.equal(read.origin, 'dsh-core')
  })

  it('joins extension usage and resolves the manifest owner', () => {
    const rows = buildToolInventory({ registry: REGISTRY, extensions: EXTENSIONS, usage: USAGE, mcpExposed: ['read', 'lang_detect'] })
    const lang = rows.find(row => row.name === 'lang_detect')
    assert.ok(lang !== undefined)
    assert.equal(lang.owner, '@try-works/extension-tongue')
    assert.equal(lang.kind, 'extension')
    assert.equal(lang.origin, 'extension')
    assert.equal(lang.state, 'active')
    assert.equal(lang.version, null, 'the structural extension input carries no version')
    assert.equal(lang.calls, 5)
    assert.equal(lang.success, 4)
    assert.equal(lang.lastUsed, 1_700_000_000_000)
  })

  it('keeps installed extension tools that are not registered, with truthful state', () => {
    const rows = buildToolInventory({ registry: REGISTRY, extensions: EXTENSIONS, usage: [], mcpExposed: [] })
    assert.equal(rows.find(row => row.name === 'multimodal_embed')?.state, 'prepared-cold')
    assert.equal(rows.find(row => row.name === 'structured_extract')?.state, 'failed')
    assert.equal(rows.find(row => row.name === 'decision_choose'), undefined, 'a not-installed extension is not an inventory row')
  })

  it('marks model_tools present but never exposed over MCP', () => {
    const rows = buildToolInventory({ registry: REGISTRY, extensions: EXTENSIONS, usage: [], mcpExposed: ['model_tools', 'read'] })
    const modelTools = rows.find(row => row.name === 'model_tools')
    assert.ok(modelTools !== undefined)
    assert.equal(modelTools.kind, 'tool-mode')
    assert.equal(modelTools.owner, '@try-works/dsh-tool-mode')
    assert.equal(modelTools.mcpExposed, false, 'model_tools is host-local even when the surface names it')
    assert.equal(rows.find(row => row.name === 'read')?.mcpExposed, true)
  })

  it('labels an unknown owner explicitly instead of guessing', () => {
    const rows = buildToolInventory({ registry: REGISTRY, extensions: EXTENSIONS, usage: [], mcpExposed: [] })
    const custom = rows.find(row => row.name === 'custom_tool')
    assert.ok(custom !== undefined)
    assert.equal(custom.owner, 'unattributed')
    assert.equal(custom.kind, 'unknown')
    assert.equal(custom.origin, 'unknown')
    assert.equal(custom.description, 'A plugin tool')
  })

  it('never carries a token, argument, result or file path in a row', () => {
    const rows = buildToolInventory({ registry: REGISTRY, extensions: EXTENSIONS, usage: USAGE, mcpExposed: ['read'] })
    const serialized = JSON.stringify(rows)
    for (const forbidden of ['token', 'arguments', 'results', 'C:\\\\', 'D:\\\\']) {
      assert.equal(serialized.includes(forbidden), false, `row JSON must not contain ${forbidden}`)
    }
    assert.deepEqual(
      Object.keys(rows[0] ?? {}).sort(),
      ['argumentCount', 'calls', 'contractVersion', 'description', 'extension', 'extensionVersion', 'kind', 'lastRegistered', 'lastUsed', 'mcpExposed', 'name', 'origin', 'owner', 'state', 'success', 'version'].sort(),
    )
  })

  it('is deterministic: rows are sorted by name and de-duplicated', () => {
    const rows = buildToolInventory({ registry: REGISTRY, extensions: EXTENSIONS, usage: [], mcpExposed: [] })
    const names = rows.map(row => row.name)
    assert.deepEqual(names, [...names].sort((left, right) => left.localeCompare(right)))
    assert.equal(new Set(names).size, names.length)
  })
})
