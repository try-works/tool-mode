/**
 * The unified Models list: one row per model across the catalog and the Tool
 * Mode extension model packages, with one lifecycle state and one action set.
 *
 * The builder is a PURE function of generated data + the host's describe()
 * rows, so it is the contract for the union, the lifecycle mapping and the
 * action selection. The bundle is loaded the way the web shell loads it, and
 * the assertions use the GENERATED catalog/extensions so the count is the real
 * shipped count.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const PACKAGE_DIR = join(process.cwd(), 'packages', 'dsh-tool-mode')
const BUNDLE = join(PACKAGE_DIR, 'client', 'index.js')
const TEMPLATE = join(PACKAGE_DIR, 'client', 'index.template.js')

/** One generated catalog entry, as the client bundle carries it. */
interface CatalogEntry {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly tool: string
  readonly contract: string | null
  readonly provider: { readonly extension: string; readonly modelId: string } | null
  readonly npmPackage: string | null
  readonly cliVerb: string | null
  readonly windowsSupport: string
  readonly verifiedRunnableOnWindows: boolean
  readonly appleOnly: boolean
  readonly closedBeta: boolean
  readonly runnable: boolean
  readonly reason?: string
}

/** One model of a generated extension entry. */
interface ExtensionModel {
  readonly id: string
  readonly tools: readonly string[]
  readonly contracts: readonly string[]
}

/** One generated extension entry. */
interface ExtensionEntry {
  readonly id: string
  readonly name: string
  readonly package: string
  readonly models: readonly ExtensionModel[]
  readonly tools: readonly string[]
  readonly contracts: readonly string[]
}

/** One requirement on a describe() row (the fields the page reads). */
interface RequirementRow {
  readonly kind: string
  readonly satisfied: boolean
  readonly action?: string
  readonly reason?: string
}

/** One describe() row, as the host reports it. */
interface StateRow {
  readonly id: string
  readonly installed?: boolean
  readonly active?: boolean
  readonly disabled?: boolean
  readonly reason?: string | null
  readonly requirements?: readonly RequirementRow[]
}

/** One unified row, as buildUnifiedModelRows returns it. */
interface UnifiedRow {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly providerLabel: string
  readonly tools: readonly string[]
  readonly lifecycle: string
  readonly reason: string | null
  readonly actions: { readonly install?: boolean; readonly prepare?: boolean; readonly toggle: 'enable' | 'disable' | null }
  readonly extensionId: string | null
}

/** The client bundle's require surface: only 'react' is requested. */
interface ReactStub {
  createElement: () => null
  useState: () => [null, () => void]
  useEffect: () => void
}

/** The internals this test needs. */
interface Internals {
  readonly CATALOG?: readonly CatalogEntry[]
  readonly EXTENSIONS?: readonly ExtensionEntry[]
  readonly buildUnifiedModelRows?: (
    catalog: readonly CatalogEntry[],
    extensions: readonly ExtensionEntry[],
    states: readonly StateRow[],
    excluded?: readonly string[],
  ) => readonly UnifiedRow[]
}

/** The bundle's exported module, typed only as far as this test reads it. */
interface BundleExports {
  readonly __internals: Internals
}

/** One registration the loader captures. */
interface Registration {
  factory: (request: (id: string) => ReactStub) => BundleExports
}

/** Load the generated bundle the way the web shell does. */
function loadInternals(): Internals {
  const source = readFileSync(BUNDLE, 'utf8')
  let registration: Registration | undefined
  const window = { __ModuleLoader__: { load(value: Registration) { registration = value } } }
  const react: ReactStub = { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {} }
  const request = (id: string): ReactStub => {
    assert.equal(id, 'react', 'the client bundle may require only "react"')
    return react
  }
  new Function('window', 'require', source)(window, request)
  assert.ok(registration !== undefined, 'the client bundle must register through __ModuleLoader__.load')
  return registration.factory(request).__internals
}

/** The generated catalog, with its presence checked. */
function catalogOf(internals: Internals): readonly CatalogEntry[] {
  const catalog = internals.CATALOG
  assert.ok(catalog !== undefined && catalog.length > 0, 'the bundle must carry the generated catalog')
  return catalog
}

/** The generated extensions, with their presence checked. */
function extensionsOf(internals: Internals): readonly ExtensionEntry[] {
  const extensions = internals.EXTENSIONS
  assert.ok(extensions !== undefined && extensions.length > 0, 'the bundle must carry the generated extensions')
  return extensions
}

/** The builder, with its presence checked. */
function builderOf(internals: Internals): NonNullable<Internals['buildUnifiedModelRows']> {
  const build = internals.buildUnifiedModelRows
  assert.ok(build !== undefined, 'the bundle must expose buildUnifiedModelRows')
  return build
}

/** A row by model id, or a failed assertion naming the id. */
function rowOf(rows: readonly UnifiedRow[], id: string): UnifiedRow {
  const row = rows.find(candidate => candidate.id === id)
  assert.ok(row !== undefined, 'missing unified row ' + id)
  return row
}

/** A catalog entry turned into a synthetic runnable vendor model (the catalog has none). */
function vendorFixture(entry: CatalogEntry): CatalogEntry {
  return {
    ...entry,
    id: 'vendor-x',
    name: 'Vendor X',
    tool: 'vendor_tool',
    provider: null,
    npmPackage: 'pkg-x',
    cliVerb: null,
    windowsSupport: 'native-node',
    verifiedRunnableOnWindows: true,
    appleOnly: false,
    closedBeta: false,
    runnable: true,
    reason: undefined,
  }
}

const EXTENSION_ONLY = ['embeddinggemma-2', 'laya', 'minilm-l6', 'minilm-rerank', 'needle3', 'mirage']

test('the generated catalog carries the unified-list fields', () => {
  const catalog = catalogOf(loadInternals())
  assert.equal(catalog.length, 18)
  const align = catalog.find(entry => entry.id === 'align')
  assert.ok(align !== undefined)
  assert.equal(align.tool, 'align_transcript')
  assert.equal(align.provider, null)
  assert.equal(align.npmPackage, '@desert-ant-labs/align')
  assert.equal(align.cliVerb, 'align')
  assert.equal(align.windowsSupport, 'browser-only')
  assert.equal(align.verifiedRunnableOnWindows, false)
  assert.equal(align.appleOnly, false)
  assert.equal(align.closedBeta, false)
  assert.equal(align.runnable, false)
  const ear = catalog.find(entry => entry.id === 'ear')
  assert.ok(ear !== undefined)
  assert.deepEqual(ear.provider, { extension: '@try-works/extension-ear-recipe', modelId: 'ear' })
  const tongue = catalog.find(entry => entry.id === 'tongue')
  assert.ok(tongue !== undefined)
  assert.equal(tongue.contract, 'text.language_detect')
  const eye = catalog.find(entry => entry.id === 'eye')
  assert.ok(eye !== undefined)
  assert.equal(eye.npmPackage, null)
  assert.equal(eye.cliVerb, null)
  assert.equal(eye.windowsSupport, 'no-sdk')
  assert.equal(eye.closedBeta, true)
  const title = catalog.find(entry => entry.id === 'title')
  assert.ok(title !== undefined)
  assert.equal(title.appleOnly, true)
})

test('extension models carry per-model tools and contracts, and declarative-recipes has none', () => {
  const extensions = extensionsOf(loadInternals())
  const laya = extensions.find(entry => entry.id === '@try-works/extension-laya')
  assert.ok(laya !== undefined)
  assert.equal(laya.models.length, 1)
  const model = laya.models[0]
  assert.ok(model !== undefined)
  assert.equal(model.id, 'laya')
  assert.ok(model.tools.includes('decision_choose'), JSON.stringify(model.tools))
  assert.ok(model.contracts.includes('decision.choose'), JSON.stringify(model.contracts))
  const declarative = extensions.find(entry => entry.id === '@try-works/extension-declarative-recipes')
  assert.ok(declarative !== undefined)
  assert.deepEqual(declarative.models, [])
})

test('the union has 24 unique rows and the six extension-only models', () => {
  const internals = loadInternals()
  const build = builderOf(internals)
  const rows = build(catalogOf(internals), extensionsOf(internals), [])
  assert.equal(rows.length, 24, '18 catalog models + 6 extension-only models')
  assert.equal(new Set(rows.map(row => row.id)).size, 24, 'no model may appear twice')
  const catalogIds = catalogOf(internals).map(entry => entry.id)
  for (const id of catalogIds) assert.ok(rows.some(row => row.id === id), 'missing catalog row ' + id)
  for (const id of EXTENSION_ONLY) {
    const row = rowOf(rows, id)
    assert.equal(row.extensionId !== null, true, id + ' must be provided by an extension')
  }
  assert.equal(rows.some(row => row.id === '@try-works/extension-declarative-recipes'), false, 'a tool provider is not a model row')
})

test('the lifecycle mapping follows the host state and the catalog verdict', () => {
  const internals = loadInternals()
  const build = builderOf(internals)
  const states: StateRow[] = [
    { id: '@try-works/extension-ear-recipe', installed: true, active: true },
    { id: '@try-works/extension-emo-recipe', installed: true, active: false },
    { id: '@try-works/extension-clear-recipe', installed: true, active: false, requirements: [{ kind: 'assets', satisfied: false, action: 'prepare', reason: 'model assets are not prepared' }] },
  ]
  const rows = build(catalogOf(internals), extensionsOf(internals), states)
  assert.equal(rowOf(rows, 'ear').lifecycle, 'active')
  assert.equal(rowOf(rows, 'emo').lifecycle, 'installed')
  assert.equal(rowOf(rows, 'clear').lifecycle, 'needs-preparation')
  assert.equal(rowOf(rows, 'laya').lifecycle, 'not-installed')
  assert.equal(rowOf(rows, 'gist').lifecycle, 'unavailable')
  assert.ok((rowOf(rows, 'gist').reason ?? '').length > 0, 'unavailable rows explain why')
})

test('the action set follows the lifecycle', () => {
  const internals = loadInternals()
  const build = builderOf(internals)
  const states: StateRow[] = [
    { id: '@try-works/extension-ear-recipe', installed: true, active: true },
    { id: '@try-works/extension-emo-recipe', installed: true, active: false },
    { id: '@try-works/extension-clear-recipe', installed: true, active: false, requirements: [{ kind: 'executable', satisfied: false, action: 'prepare' }] },
  ]
  const rows = build(catalogOf(internals), extensionsOf(internals), states)
  assert.deepEqual(rowOf(rows, 'ear').actions, { toggle: 'disable' })
  assert.deepEqual(rowOf(rows, 'emo').actions, { toggle: 'enable' })
  assert.deepEqual(rowOf(rows, 'clear').actions, { prepare: true, toggle: 'enable' })
  assert.deepEqual(rowOf(rows, 'laya').actions, { install: true, toggle: null })
  assert.deepEqual(rowOf(rows, 'gist').actions, { toggle: null })
})

test('a vendor model toggles the allowlist; an extension model toggles its package', () => {
  const internals = loadInternals()
  const build = builderOf(internals)
  const base = catalogOf(internals)[0]
  assert.ok(base !== undefined)
  const vendor = vendorFixture(base)
  const catalog = [...catalogOf(internals), vendor]
  const extensions = extensionsOf(internals)
  const enabledRow = rowOf(build(catalog, extensions, []), 'vendor-x')
  assert.equal(enabledRow.lifecycle, 'active')
  assert.deepEqual(enabledRow.actions, { toggle: 'disable' })
  assert.equal(enabledRow.extensionId, null)
  const disabledRow = rowOf(build(catalog, extensions, [], ['vendor-x']), 'vendor-x')
  assert.equal(disabledRow.lifecycle, 'installed')
  assert.deepEqual(disabledRow.actions, { toggle: 'enable' })
  const extensionRow = rowOf(build(catalog, extensions, []), 'laya')
  assert.equal(extensionRow.extensionId, '@try-works/extension-laya')
  assert.deepEqual(extensionRow.actions, { install: true, toggle: null })
})

test('only extensions with no model are tool providers', () => {
  const extensions = extensionsOf(loadInternals())
  const providers = extensions.filter(entry => entry.models.length === 0).map(entry => entry.id)
  assert.deepEqual(providers, ['@try-works/extension-declarative-recipes'])
})

test('the template defines the builder and the bundle carries it', () => {
  const template = readFileSync(TEMPLATE, 'utf8')
  assert.ok(template.includes('function buildUnifiedModelRows'), 'the template must carry the builder')
  const bundle = readFileSync(BUNDLE, 'utf8')
  assert.ok(bundle.includes('function buildUnifiedModelRows'), 'the bundle must carry the builder inline')
})
