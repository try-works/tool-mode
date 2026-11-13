/**
 * OPTIONAL RUNTIMES on the source-directory install arm (task-117).
 *
 * An extension's `optionalDependencies` are the engine its tools `import()` at
 * call time (EmbeddingGemma's onnxruntime-node + @huggingface/transformers,
 * Tongue's runtime). The REGISTRY arm materialized them; the directory arm did
 * not, so a first-party install activated with the engine absent and every tool
 * reported `needs-preparation` naming a package that was never installed.
 *
 * These tests pin both halves of the contract: a present host-tree engine IS
 * materialized into the installed package, and an ABSENT one records an
 * unsatisfied runtime dependency WITHOUT failing the package install.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ExtensionStore, type InstalledRecord } from '@try-works/tool-mode-extension-sdk'

import { createExtensionsService, packageDirFor } from '../src/extensions-service.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const FIXTURE_DIR = join(process.cwd(), 'packages', 'dsh-tool-mode', 'tests', 'fixtures', 'extensions-service-extension')
const EXTENSION_ID = '@try-works/fixture-ext-service'

/**
 * Build a host tree plus a checkout whose extension declares one OPTIONAL engine.
 *
 * The engine lives in the host's root `node_modules` (the npm-hoisted layout the
 * real onnxruntime-node has), and the checkout declares it under
 * `optionalDependencies` with NO regular dependencies, so the install reaches the
 * package with nothing materialized by the regular graph.
 * @param options - the engine name, and whether the host tree actually holds it.
 * @returns the store/source directories and the host tree root.
 */
function optionalEngine(options: { name: string; present: boolean }): { root: string; sourceDir: string; storeDir: string } {
  const root = tempDir()
  if (options.present) {
    const engineDir = join(root, 'node_modules', ...options.name.split('/'))
    mkdirSync(engineDir, { recursive: true })
    // The engine declares a PLATFORM child as an optional dependency (the sharp →
    // @img/sharp-win32-x64 shape) plus one that the host does not have. The graph
    // must copy the resolvable optional child and skip the absent one.
    writeFileSync(join(engineDir, 'package.json'), `${JSON.stringify({
      name: options.name,
      version: '1.0.0',
      optionalDependencies: {
        '@fixture/native': '^1.0.0',
        '@fixture/absent-native': '^1.0.0',
      },
    }, null, 2)}\n`)
    writeFileSync(join(engineDir, 'index.js'), 'export const answer = 42\n')
    const nativeDir = join(root, 'node_modules', '@fixture', 'native')
    mkdirSync(nativeDir, { recursive: true })
    writeFileSync(join(nativeDir, 'package.json'), `${JSON.stringify({ name: '@fixture/native', version: '1.0.0' }, null, 2)}\n`)
    writeFileSync(join(nativeDir, 'index.js'), 'export const native = true\n')
  }
  const sourceDir = join(root, 'source-root')
  const extensionDir = join(sourceDir, packageDirFor(EXTENSION_ID))
  cpSync(FIXTURE_DIR, extensionDir, { recursive: true })
  const packageJsonPath = join(extensionDir, 'package.json')
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>
  pkg['dependencies'] = {}
  pkg['optionalDependencies'] = { [options.name]: '^1.0.0' }
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`)
  return { root, sourceDir, storeDir: tempDir() }
}

/** Read the single installed record, failing the test when absent. */
function installedRecord(storeDir: string): InstalledRecord {
  const record = new ExtensionStore(storeDir).listInstalled().value[0]
  assert.ok(record !== undefined, 'the install must leave a record')
  return record
}

describe('the source-directory arm materializes declared optional runtimes (task-117 regression)', () => {
  it('copies a SCOPED host-tree engine into the installed package and records it', async () => {
    // The scope @try-works ALREADY exists in the installed tree because the runtime
    // link creates node_modules/@try-works/tool-mode-extension-sdk. A merge keyed on
    // the scope directory would skip this package while still recording it
    // satisfied — so this name is the regression for that bug, not incidental.
    const tree = optionalEngine({ name: '@try-works/fixture-engine', present: true })
    const service = createExtensionsService({
      storeDir: tree.storeDir,
      sourceDir: tree.sourceDir,
      allowSourceDirectories: true,
      installSource: 'directory',
      // The production profile runs the preinstalled gate ON: the engine is
      // operator-completed content copied from the host tree, never downloaded.
      allowPreinstalledDependencies: true,
      preinstalledDependenciesRoot: tree.root,
    })
    await service.install(EXTENSION_ID)

    const record = installedRecord(tree.storeDir)
    const enginePackage = join(record.installPath, 'node_modules', '@try-works', 'fixture-engine', 'package.json')
    assert.ok(existsSync(enginePackage), 'the optional engine must be materialized into the installed package')
    assert.equal(JSON.parse(readFileSync(enginePackage, 'utf8')).name, '@try-works/fixture-engine')
    assert.ok(
      (record.dependencies ?? []).some(dependency => dependency.name === '@try-works/fixture-engine'),
      'the materialized engine must be recorded so the requirement model can see it',
    )
    // Transitive OPTIONAL children: resolved ones are copied (sharp's platform
    // binding), unresolvable ones are skipped instead of failing the install.
    assert.ok(
      existsSync(join(record.installPath, 'node_modules', '@fixture', 'native', 'package.json')),
      'the resolvable optional platform child must be materialized too',
    )
    assert.ok(
      !existsSync(join(record.installPath, 'node_modules', '@fixture', 'absent-native')),
      'an unresolvable optional child is skipped, never fabricated',
    )
  })

  it('keeps the package install when the optional engine is absent from the host tree', async () => {
    const tree = optionalEngine({ name: '@fixture/absent-engine', present: false })
    const service = createExtensionsService({
      storeDir: tree.storeDir,
      sourceDir: tree.sourceDir,
      allowSourceDirectories: true,
      installSource: 'directory',
    })
    // An optional dependency may be unresolved: that blocks ACTIVATION through the
    // requirement model, it never fails the package install.
    const installed = await service.install(EXTENSION_ID)
    assert.equal(installed.source, 'directory')
    const record = installedRecord(tree.storeDir)
    assert.ok(!existsSync(join(record.installPath, 'node_modules', '@fixture', 'absent-engine')))
  })
})
