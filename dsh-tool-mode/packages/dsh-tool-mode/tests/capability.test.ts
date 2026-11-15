/**
 * Capability resolution for PROVIDER-BOUND models (task-49).
 *
 * THE DEFECT THESE TESTS PIN: the provider branch decided runnability by resolving
 * `<extension>/package.json` from the PLUGIN's module context. A store-installed extension
 * lives under the profile's extension store and is NEVER resolvable there, so a model whose
 * extension was installed and running still reported `runnable: false` — the host said
 * "not installed" about a package it had just installed.
 *
 * The fix threads the store's installed-id set in. An installed provider extension is
 * runnable; the extension service owns the real readiness checks from there.
 *
 * @module tests/capability
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { resolveCapability, resolveCatalog } from '../src/capability.ts'
import type { ModelCatalogEntry } from '../src/types.ts'

/**
 * Build a catalog-entry fixture from the fields capability reads.
 *
 * SAFETY: capability resolution consults only provider, closedBeta, appleOnly, npmPackage,
 * npmSubpath, cliVerb and the runtime lists; the fixture supplies every one of them, so one
 * assertion supplies the remaining catalog fields the module never looks at.
 * @param fields - the fields under test.
 * @returns a catalog entry.
 */
function asCatalogEntry(fields: Partial<ModelCatalogEntry>): ModelCatalogEntry {
  // SAFETY: the caller supplies every field capability resolution reads (see the doc above);
  // the remaining catalog fields are inert for this module.
  return fields as ModelCatalogEntry
}

/** A provider-bound catalog entry implemented by a Tool Mode extension. */
const bound: ModelCatalogEntry = asCatalogEntry({
  id: 'example',
  name: 'Example',
  provider: { extension: '@try-works/extension-example', modelId: 'example' },
  closedBeta: false,
  appleOnly: false,
  npmPackage: null,
  npmSubpath: null,
  cliVerb: null,
})

/** Resolution overrides that simulate "nothing resolves from the plugin". */
const noResolve = { resolve: () => false, platform: 'win32' as const, allowNpm: false }

describe('resolveCapability — an INSTALLED provider extension is runnable', () => {
  it('is runnable when the store reports the extension installed, even though nothing resolves', () => {
    const verdict = resolveCapability(bound, {
      ...noResolve,
      providerInstalled: extensionId => extensionId === '@try-works/extension-example',
    })
    assert.equal(verdict.runnable, true)
    assert.equal(verdict.route, 'extension')
    assert.match(verdict.reason, /installed in this profile's extension store/)
  })

  it('stays not-runnable when the store does not report it, and the reason names the install action', () => {
    const verdict = resolveCapability(bound, { ...noResolve, providerInstalled: () => false })
    assert.equal(verdict.runnable, false)
    assert.equal(verdict.route, 'unavailable')
    assert.match(verdict.reason, /not installed or not resolvable/)
  })

  it('treats an ABSENT store (no callback) as not installed, not as an error', () => {
    const verdict = resolveCapability(bound, noResolve)
    assert.equal(verdict.runnable, false)
    assert.equal(verdict.route, 'unavailable')
  })

  it('keeps the module-resolution route when the package does resolve', () => {
    const verdict = resolveCapability(bound, { ...noResolve, resolve: () => true })
    assert.equal(verdict.runnable, true)
    assert.equal(verdict.route, 'extension')
    assert.match(verdict.reason, /provider readiness is checked through that extension/)
  })

  it('threads the installed set through resolveCatalog', () => {
    const resolved = resolveCatalog([bound], {
      ...noResolve,
      providerInstalled: () => true,
    })
    assert.equal(resolved.length, 1)
    assert.equal(resolved[0]!.verdict.runnable, true)
  })

  it('does not treat a closed-beta provider model as installed-runnable', () => {
    const closed = asCatalogEntry({ ...bound, closedBeta: true })
    const verdict = resolveCapability(closed, { ...noResolve, providerInstalled: () => true })
    assert.equal(verdict.runnable, false)
  })
})
