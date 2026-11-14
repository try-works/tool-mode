/**
 * The emo package is CODE-FREE and declares exactly what it ships.
 *
 * PREPARATORY state: the model, its three pinned assets and the platform are declared and tested
 * now, while the tool/recipe/schemas wait for litert-provider to confirm `emo/text-v1`
 * (docs/runtime/PHASE4.md emo section is the specification).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  KNOWN_FEATURES,
  discoverExtension,
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
  // carries are fed to validateManifest, which refuses a mismatch.
  return parsed as PackageIdentity
}

/** The validated manifest, as the SDK sees it. */
function declaredManifest(): ExtensionManifest {
  const { name, version } = packageIdentity()
  const raw: unknown = JSON.parse(readFileSync(join(DIR, 'tool-mode.extension.json'), 'utf8'))
  return validateManifest(raw, { packageName: name, packageVersion: version, packageDir: DIR })
}

describe('manifest — code-free declarative package (preparatory)', () => {
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

  it('declares the emo model, its asset set and the verified platform', () => {
    const manifest = declaredManifest()
    assert.equal(manifest.models.length, 1)
    const model = manifest.models[0]
    assert.ok(model !== undefined)
    assert.equal(model.id, 'emo')
    assert.equal(model.assetSet, 'emo-litert')
    assert.equal(model.assetLock, './models.lock.json')
    assert.deepEqual(model.platforms, [{ os: 'win32', arch: 'x64', accelerator: 'cpu' }])
  })

  it('declares the confirmed tool, implementation and skill', () => {
    const manifest = declaredManifest()
    assert.deepEqual(manifest.tools.map(tool => tool.name), ['suggest_emojis'])
    const tool = manifest.tools[0]
    assert.ok(tool !== undefined)
    assert.equal(tool.id, 'suggest-emojis')
    assert.equal(tool.contractId, '@try-works/extension-emo-recipe/suggest_emojis')
    assert.equal(tool.contractVersion, '1.0.0')
    assert.equal(tool.inputSchema, './schemas/suggest-emojis.input.json')
    assert.equal(tool.outputSchema, './schemas/suggest-emojis.output.json')
    assert.equal(manifest.implementations.length, 1)
    assert.equal(manifest.implementations[0]?.id, 'suggest-emojis')
    assert.equal(manifest.implementations[0]?.contractId, tool.contractId)
    assert.equal(manifest.implementations[0]?.modelId, 'emo')
    assert.equal(manifest.implementations[0]?.recipeVersion, '1.0.0')
    assert.equal(manifest.skills.length, 1)
    assert.deepEqual(manifest.skills[0]?.requiresTools, ['suggest-emojis'])
    assert.equal(manifest.skills[0]?.path, './skills/suggest-emojis/SKILL.md')
  })

  it('names declared states that exist in the package', () => {
    const manifest = declaredManifest()
    for (const relative of [manifest.tools[0]?.inputSchema, manifest.tools[0]?.outputSchema, manifest.skills[0]?.path]) {
      assert.ok(relative !== undefined)
      assert.ok(existsSync(join(DIR, relative)), 'missing declared file ' + relative)
    }
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
    assert.equal(discovery.packageName, '@try-works/extension-emo-recipe')
    assert.equal(discovery.manifest.execution.kind, 'declarative')
    assert.equal(discovery.entryPath, undefined)
  })

  it('lists every shipped surface in package.json files', () => {
    const { files } = packageIdentity()
    for (const expected of ['tool-mode.extension.json', 'models.lock.json', 'recipes', 'schemas', 'skills']) {
      assert.ok(files.includes(expected), 'package.json files must include ' + expected)
    }
  })
})
