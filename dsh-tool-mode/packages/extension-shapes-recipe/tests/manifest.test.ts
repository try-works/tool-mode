/**
 * The shapes package is CODE-FREE and declares exactly what it ships.
 *
 * Two properties are load-bearing and neither is visible from the manifest alone:
 *
 * 1. **No module exists.** The package must contain no src/, lib/, dist/ or entry file, because
 *    its whole claim is that the host can run it from JSON alone. A stray lib/ would make the
 *    declaration false while every schema check still passed.
 * 2. **The declaration and the artefact agree.** The manifest names an implementation id;
 *    the SDK's convention says that id is the recipe file name; the test resolves both and
 *    compares them, so the package cannot advertise a tool its recipe does not serve.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  KNOWN_FEATURES,
  discoverExtension,
  resolveDeclarativeImplementations,
  validateManifest,
  type ExtensionManifest,
} from '@try-works/tool-mode-extension-sdk'

const DIR = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** The package fields the SDK compares against the manifest. */
interface PackageIdentity {
  readonly name: string
  readonly version: string
  readonly files: readonly string[]
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly exports?: unknown
}

/** Read this package's own package.json. */
function packageIdentity(): PackageIdentity {
  const parsed: unknown = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'))
  // SAFETY: this package's own package.json is a repository artifact; the name and version it
  // carries are fed to validateManifest, which refuses a mismatch, and the files list is only
  // asserted for membership below.
  return parsed as PackageIdentity
}

/** The validated manifest, as the SDK sees it. */
function declaredManifest(): ExtensionManifest {
  const { name, version } = packageIdentity()
  const raw: unknown = JSON.parse(readFileSync(join(DIR, 'tool-mode.extension.json'), 'utf8'))
  return validateManifest(raw, { packageName: name, packageVersion: version, packageDir: DIR })
}

describe('manifest — code-free declarative package', () => {
  it('validates against the pinned manifest schema', () => {
    const manifest = declaredManifest()
    assert.equal(manifest.execution.kind, 'declarative')
    assert.equal(manifest.execution.entry, undefined, 'a declarative package must not declare a module entry')
  })

  it('declares only features the host actually provides', () => {
    const manifest = declaredManifest()
    for (const feature of manifest.compatibility.requiredFeatures) {
      assert.ok(KNOWN_FEATURES.includes(feature), 'unknown required feature ' + feature)
    }
    assert.ok(manifest.compatibility.requiredFeatures.includes('declarative-recipes-v1'))
  })

  it('declares the shapes model, its asset set and the verified platform', () => {
    const manifest = declaredManifest()
    assert.equal(manifest.models.length, 1)
    const model = manifest.models[0]
    assert.ok(model !== undefined)
    assert.equal(model.id, 'shapes')
    assert.equal(model.assetSet, 'shapes-litert')
    assert.equal(model.assetLock, './models.lock.json')
    assert.deepEqual(model.platforms, [{ os: 'win32', arch: 'x64', accelerator: 'cpu' }])
  })

  it('declares one tool whose schemas exist inside the package', () => {
    const manifest = declaredManifest()
    assert.equal(manifest.tools.length, 1)
    const tool = manifest.tools[0]
    assert.ok(tool !== undefined)
    assert.equal(tool.name, 'shape_recognize')
    for (const relative of [tool.inputSchema, tool.outputSchema]) {
      assert.ok(relative.startsWith('./'), 'schema paths are package-relative: ' + relative)
      const path = join(DIR, relative)
      assert.ok(existsSync(path), 'missing schema ' + relative)
      assert.doesNotThrow(() => JSON.parse(readFileSync(path, 'utf8')), 'schema is not JSON: ' + relative)
    }
  })

  it('binds its implementation to the declared tool contract and model', () => {
    const manifest = declaredManifest()
    assert.equal(manifest.implementations.length, 1)
    const implementation = manifest.implementations[0]
    const tool = manifest.tools[0]
    assert.ok(implementation !== undefined && tool !== undefined)
    assert.equal(implementation.id, 'shape-recognize')
    assert.equal(implementation.contractId, tool.contractId)
    assert.equal(implementation.contractVersion, tool.contractVersion)
    assert.equal(implementation.modelId, 'shapes')
    assert.equal(implementation.recipeVersion, '1.0.0')
    assert.ok(existsSync(join(DIR, 'recipes', implementation.id + '.json')), 'the implementation id names its recipe file')
  })

  it('declares a skill that points at a real file and its tool', () => {
    const manifest = declaredManifest()
    assert.equal(manifest.skills.length, 1)
    const skill = manifest.skills[0]
    assert.ok(skill !== undefined)
    assert.ok(existsSync(join(DIR, skill.path)), 'missing skill file ' + skill.path)
    assert.deepEqual(skill.requiresTools, ['shape-recognize'])
  })

  it('SHIPS NO CODE — asserted against the filesystem, not the declaration', () => {
    const entries = readdirSync(DIR, { withFileTypes: true }).map(entry => entry.name)
    for (const forbidden of ['src', 'lib', 'dist', 'index.js', 'index.ts']) {
      assert.equal(entries.includes(forbidden), false, 'a code-free package must not ship ' + forbidden)
    }
    const pkg = packageIdentity()
    assert.equal(pkg.dependencies, undefined, 'the package must not depend on a runtime')
    assert.equal(pkg.devDependencies, undefined, 'the package ships no code to compile')
    assert.equal(pkg.exports, undefined, 'a declarative package has no module entry to export')
  })

  it('discovers as declarative with no module entry', () => {
    const discovery = discoverExtension(DIR)
    assert.equal(discovery.packageName, '@try-works/extension-shapes-recipe')
    assert.equal(discovery.manifest.execution.kind, 'declarative')
    assert.equal(discovery.entryPath, undefined)
  })

  it('resolves its declared recipe by the SDK convention', () => {
    const manifest = declaredManifest()
    const outcome = resolveDeclarativeImplementations(DIR, manifest.implementations)
    assert.equal(outcome.ok, true, outcome.ok ? '' : 'unresolved: ' + outcome.id + ' — ' + outcome.detail)
    if (!outcome.ok) return
    assert.equal(outcome.resolved.length, 1)
    const [resolved] = outcome.resolved
    assert.ok(resolved !== undefined)
    assert.equal(resolved.id, 'shape-recognize')
    assert.equal(resolved.contractId, manifest.tools[0]?.contractId)
    // SAFETY: the resolver JSON-parses the file without a schema, so its recipe is unknown;
    // this test reads only kind, and the parser test validates the full document.
    const recipe = resolved.recipe as { kind?: string }
    assert.equal(recipe.kind, 'model-runtime')
  })

  it('lists every shipped surface in package.json files', () => {
    const { files } = packageIdentity()
    for (const expected of ['tool-mode.extension.json', 'models.lock.json', 'recipes', 'schemas', 'skills']) {
      assert.ok(files.includes(expected), 'package.json files must include ' + expected)
    }
  })
})
