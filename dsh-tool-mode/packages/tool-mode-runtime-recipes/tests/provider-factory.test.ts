/**
 * Provider-factory loader tests (Phase 2 gate: factory import failure).
 *
 * The host must never declare an engine dependency: it resolves the factory out of the
 * EXTENSION's own package directory, at run time, by name. These tests prove the things
 * that can go wrong there are each a named refusal — the specifier is not a bare package
 * name, the package cannot be resolved, the module cannot be imported, or the named export
 * is missing or not a function — and that a good factory is handed exactly the parsed
 * recipe and the host-verified assets, without being called during loading.
 *
 * Fixture packages are written to a temp `node_modules` tree, so no test touches the real
 * installation and the resolution is a real `createRequire` resolution.
 *
 * @module tests/provider-factory
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  loadProviderFactory,
  parseModelRuntimeRecipe,
  type ModelRuntimeRecipe,
} from '../src/index.ts'
import {
  fixtureProviderSource,
  installFixturePackage,
  validRecipeDocument,
  withTempDir,
} from './support.ts'

/** The fixture package name every loader test installs. */
const FIXTURE_PACKAGE = '@fixture/model-runtime'

/** A host-verified asset set for the fixture model. */
const assets = {
  get: (assetId: string) =>
    assetId === 'shapes.tflite'
      ? { path: 'C:/assets/shapes-litert/shapes.tflite', digest: 'sha256:model-digest' }
      : undefined,
  assetIds: ['shapes.tflite'],
}

/** A parsed recipe whose provider is the fixture package. */
function fixtureRecipe(packageName = FIXTURE_PACKAGE): ModelRuntimeRecipe {
  const parsed = parseModelRuntimeRecipe(validRecipeDocument({ provider: { package: packageName } }))
  if (!parsed.ok) assert.fail(`the fixture recipe must parse: ${JSON.stringify(parsed.issues)}`)
  return parsed.recipe
}

describe('loadProviderFactory', () => {
  it('resolves and imports the factory from the extension package directory', async () => {
    await withTempDir(async (dir) => {
      await installFixturePackage({ root: dir, name: FIXTURE_PACKAGE, source: fixtureProviderSource('a') })
      const recipe = fixtureRecipe()

      const loaded = await loadProviderFactory({ packageDir: dir, recipe })
      if (!loaded.ok) assert.fail(`expected the factory to load: ${loaded.reason}: ${loaded.detail}`)
      assert.match(loaded.moduleUrl, /^file:/)
      assert.match(loaded.moduleUrl, /index\.js$/)

      const provider: unknown = loaded.factory(recipe, assets)
      assert.deepEqual(provider, {
        marker: 'a',
        assetIds: ['shapes.tflite'],
        assetSet: 'shapes-litert',
      })
    })
  })

  it('resolves relative to the given package directory, not the host installation', async () => {
    await withTempDir(async (first) => {
      await withTempDir(async (second) => {
        await installFixturePackage({ root: first, name: FIXTURE_PACKAGE, source: fixtureProviderSource('first') })
        await installFixturePackage({ root: second, name: FIXTURE_PACKAGE, source: fixtureProviderSource('second') })
        const recipe = fixtureRecipe()

        const firstLoad = await loadProviderFactory({ packageDir: first, recipe })
        const secondLoad = await loadProviderFactory({ packageDir: second, recipe })
        if (!firstLoad.ok) assert.fail(`expected the first factory to load: ${firstLoad.detail}`)
        if (!secondLoad.ok) assert.fail(`expected the second factory to load: ${secondLoad.detail}`)

        const firstProvider: unknown = firstLoad.factory(recipe, assets)
        const secondProvider: unknown = secondLoad.factory(recipe, assets)
        assert.deepEqual(firstProvider, { marker: 'first', assetIds: ['shapes.tflite'], assetSet: 'shapes-litert' })
        assert.deepEqual(secondProvider, { marker: 'second', assetIds: ['shapes.tflite'], assetSet: 'shapes-litert' })
      })
    })
  })

  it('lets a test inject the importer, which receives the resolved module URL', async () => {
    await withTempDir(async (dir) => {
      await installFixturePackage({ root: dir, name: FIXTURE_PACKAGE, source: fixtureProviderSource('unused') })
      const recipe = fixtureRecipe()
      const injected = (): unknown => ({ marker: 'injected' })
      const seen: string[] = []

      const loaded = await loadProviderFactory({
        packageDir: dir,
        recipe,
        import: async (moduleUrl) => {
          seen.push(moduleUrl)
          return { createProviderFromRecipe: injected }
        },
      })

      if (!loaded.ok) assert.fail(`expected the injected factory to load: ${loaded.detail}`)
      assert.equal(seen.length, 1)
      assert.match(seen[0] ?? '', /^file:/)
      assert.equal(loaded.factory, injected)
    })
  })

  it('never calls the factory itself: loading a provider stays lightweight', async () => {
    await withTempDir(async (dir) => {
      await installFixturePackage({ root: dir, name: FIXTURE_PACKAGE, source: fixtureProviderSource('a') })
      let calls = 0
      const factory = (): unknown => {
        calls += 1
        return { marker: 'called' }
      }

      const loaded = await loadProviderFactory({
        packageDir: dir,
        recipe: fixtureRecipe(),
        import: async () => ({ createProviderFromRecipe: factory }),
      })
      if (!loaded.ok) assert.fail(`expected the factory to load: ${loaded.detail}`)
      assert.equal(calls, 0)
    })
  })

  it('hands the factory the parsed recipe and the host-verified assets unchanged', async () => {
    await withTempDir(async (dir) => {
      await installFixturePackage({ root: dir, name: FIXTURE_PACKAGE, source: fixtureProviderSource('a') })
      const recipe = fixtureRecipe()
      const supplies: unknown[][] = []
      const factory = (...args: unknown[]): unknown => {
        supplies.push(args)
        return { marker: 'called' }
      }

      const loaded = await loadProviderFactory({
        packageDir: dir,
        recipe,
        import: async () => ({ createProviderFromRecipe: factory }),
      })
      if (!loaded.ok) assert.fail(`expected the factory to load: ${loaded.detail}`)
      loaded.factory(recipe, assets)
      assert.equal(supplies.length, 1)
      assert.equal(supplies[0]?.[0], recipe)
      assert.equal(supplies[0]?.[1], assets)
    })
  })

  it('refuses a missing named export, naming the export and the package', async () => {
    await withTempDir(async (dir) => {
      await installFixturePackage({ root: dir, name: FIXTURE_PACKAGE, source: fixtureProviderSource('a') })
      const loaded = await loadProviderFactory({
        packageDir: dir,
        recipe: fixtureRecipe(),
        import: async () => ({ somethingElse: () => ({}) }),
      })
      if (loaded.ok) assert.fail('expected the load to be refused')
      assert.equal(loaded.reason, 'export')
      assert.match(loaded.detail, /createProviderFromRecipe/)
      assert.match(loaded.detail, /@fixture\/model-runtime/)
    })
  })

  it('refuses an export that is not a function', async () => {
    await withTempDir(async (dir) => {
      await installFixturePackage({ root: dir, name: FIXTURE_PACKAGE, source: fixtureProviderSource('a') })
      const loaded = await loadProviderFactory({
        packageDir: dir,
        recipe: fixtureRecipe(),
        import: async () => ({ createProviderFromRecipe: 42 }),
      })
      if (loaded.ok) assert.fail('expected the load to be refused')
      assert.equal(loaded.reason, 'export')
      assert.match(loaded.detail, /not a function/)
    })
  })

  it('refuses a missing package by naming it', async () => {
    await withTempDir(async (dir) => {
      const recipe = fixtureRecipe('@fixture/absent')
      const loaded = await loadProviderFactory({ packageDir: dir, recipe })
      if (loaded.ok) assert.fail('expected the load to be refused')
      assert.equal(loaded.reason, 'resolve')
      assert.match(loaded.detail, /@fixture\/absent/)
    })
  })

  it('refuses a module that throws while importing, instead of leaking the throw', async () => {
    await withTempDir(async (dir) => {
      await installFixturePackage({ root: dir, name: FIXTURE_PACKAGE, source: fixtureProviderSource('a') })
      const loaded = await loadProviderFactory({
        packageDir: dir,
        recipe: fixtureRecipe(),
        import: async () => {
          throw new Error('module exploded')
        },
      })
      if (loaded.ok) assert.fail('expected the load to be refused')
      assert.equal(loaded.reason, 'import')
      assert.match(loaded.detail, /module exploded/)
    })
  })

  it('refuses a specifier that is not a bare package name, before touching the filesystem', async () => {
    await withTempDir(async (dir) => {
      let imported = 0
      for (const specifier of ['../evil', './evil', 'pkg/sub', '/absolute/path', 'C:\\evil', 'pkg\\sub']) {
        const recipe = fixtureRecipe(specifier)
        const loaded = await loadProviderFactory({
          packageDir: dir,
          recipe,
          import: async () => {
            imported += 1
            return {}
          },
        })
        if (loaded.ok) assert.fail(`expected ${specifier} to be refused`)
        assert.equal(loaded.reason, 'specifier')
        assert.match(loaded.detail, /bare package name/)
      }
      assert.equal(imported, 0)
    })
  })
})
