/**
 * RC1 regression: the source-directory install arm must reach the CONFIGURED
 * dependency-graph depth bound, not the SDK's 3-level fallback.
 *
 * The live symptom this pins down (web profile, plugin 0.3.6/0.4.7, Extensions
 * page):
 *
 *   [DEPENDENCY_UNSATISFIED] the dependency graph exceeds the 3-level depth
 *   bound at define-data-property
 *
 * `@try-works/extension-laya` declares `onnxruntime-node`, whose real npm tree is
 * rooted there and reaches depth 5. The service's directory arm
 * (`#dependencyGraph`) constructs the preinstalled host-tree graph; when it omits
 * `maxDepth`, the SDK's `installDependencyGraph` applies
 * `const maxDepth = graph.maxDepth ?? 3` and refuses at depth 4 — which is exactly
 * `define-data-property` in this chain. When the service forwards its configured
 * bound (12 by default) the same graph installs.
 *
 * The test uses the REAL SDK `installDependencyGraph` and the REAL staged
 * installer; only the HOST TREE is synthetic, laid out as npm flattens a
 * conflict-free install (`<root>/node_modules/<dep>` for every link). Nothing is
 * downloaded. The assertion is deliberately two-sided:
 *
 * - default configuration (bound 12) materializes all six packages, including
 *   `define-data-property` at depth 4 and `es-define-property` at depth 5;
 * - an explicitly lowered bound (3) reproduces the live message verbatim, which
 *   proves the message is driven by the forwarded bound rather than hardcoded.
 *
 * The REGISTRY arm forwards the same bound at `src/extensions-service.ts`
 * (`#installGraph`, maxDepth on both the registry and preinstalled branch) and is
 * covered by `tests/extension-registry-install.test.ts` ("dependency graphs:
 * depth bound and preinstalled regular dependencies").
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ExtensionStore } from '@try-works/tool-mode-extension-sdk'

import { createExtensionsService, ExtensionsServiceError, packageDirFor } from '../src/extensions-service.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const FIXTURE_DIR = join(process.cwd(), 'packages', 'dsh-tool-mode', 'tests', 'fixtures', 'extensions-service-extension')
const EXTENSION_ID = '@try-works/fixture-ext-service'

/**
 * The real package order that produced the live refusal, rooted at the
 * extension's own declared dependency (depth 0):
 *
 *   0 onnxruntime-node
 *   1 global-agent
 *   2 globalthis
 *   3 define-properties
 *   4 define-data-property   <- the first entry past a 3-level bound
 *   5 es-define-property     <- deepest entry of the real tree
 */
const ONNXRUNTIME_CHAIN = [
  'onnxruntime-node',
  'global-agent',
  'globalthis',
  'define-properties',
  'define-data-property',
  'es-define-property',
] as const

/** A synthetic host tree plus the patched extension checkout inside it. */
interface OnnxruntimeHostTree {
  readonly root: string
  readonly sourceDir: string
  readonly extensionDir: string
}

/** Read one package.json as data; the object shape is all this fixture writes. */
function readManifest(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    assert.fail(`${path} did not hold a JSON object`)
  }
  // SAFETY: JSON.parse returns only JSON values, and the guard above narrows the
  // value to a non-array object. Only the fixture's own known keys are rewritten.
  return parsed as Record<string, unknown>
}

/**
 * Build the onnxruntime-shaped host tree.
 *
 * Every package is hoisted into the root `node_modules`, exactly as npm flattens
 * this conflict-free chain. `onnxruntime-node` is the only dependency the
 * extension checkout declares; each link declares exactly the next one.
 * @returns the tree root, the source-directory root, and the extension checkout.
 */
function onnxruntimeHostTree(): OnnxruntimeHostTree {
  const root = tempDir()
  for (const [index, name] of ONNXRUNTIME_CHAIN.entries()) {
    const directory = join(root, 'node_modules', name)
    mkdirSync(directory, { recursive: true })
    const next = ONNXRUNTIME_CHAIN[index + 1]
    writeFileSync(join(directory, 'package.json'), `${JSON.stringify({
      name,
      version: '1.0.0',
      ...next === undefined ? {} : { dependencies: { [next]: '^1.0.0' } },
    }, null, 2)}\n`)
    writeFileSync(join(directory, 'index.js'), `module.exports = ${JSON.stringify(name)}\n`)
  }

  const sourceDir = join(root, 'source-root')
  const extensionDir = join(sourceDir, packageDirFor(EXTENSION_ID))
  cpSync(FIXTURE_DIR, extensionDir, { recursive: true })
  const manifestPath = join(extensionDir, 'package.json')
  const manifest = readManifest(manifestPath)
  manifest['dependencies'] = { [ONNXRUNTIME_CHAIN[0]]: '^1.0.0' }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { root, sourceDir, extensionDir }
}

/** Assert a promise rejects with the service's dependency refusal code. */
async function rejectsDependency(promise: Promise<unknown>, pattern: RegExp): Promise<ExtensionsServiceError> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof ExtensionsServiceError, `expected ExtensionsServiceError, got ${String(error)}`)
    assert.equal(error.code, 'extension-dependency-unsatisfied')
    assert.match(error.message, pattern)
    return error
  }
  assert.fail(`expected an extension-dependency-unsatisfied refusal matching ${pattern}`)
}

describe('RC1: the live onnxruntime-node tree is bounded by the configured depth, not 3', () => {
  it('materializes all six packages (define-data-property at depth 4) with the default bound 12', async () => {
    const tree = onnxruntimeHostTree()
    const storeDir = tempDir()
    // No registryDependencyDepth: the DEFAULT (12) must reach the directory arm's
    // graph. Before the fix this install refused at depth 4, exactly like the live
    // Extensions-page failure, because the SDK fell back to `graph.maxDepth ?? 3`.
    const service = createExtensionsService({
      storeDir,
      sourceDir: tree.sourceDir,
      allowSourceDirectories: true,
      allowPreinstalledDependencies: true,
      preinstalledDependenciesRoot: tree.root,
      installSource: 'directory',
    })
    const installed = await service.install(EXTENSION_ID)
    assert.equal(installed.source, 'directory', 'the live arm is the source-directory arm')
    assert.equal(installed.version, '1.0.0')

    const record = new ExtensionStore(storeDir).listInstalled().value.find(candidate => candidate.extensionId === EXTENSION_ID)
    assert.ok(record !== undefined, 'the install must be recorded')
    assert.deepEqual(
      record.dependencies?.map(dependency => dependency.name),
      [...ONNXRUNTIME_CHAIN],
      'the graph walked past depth 3 and materialized the whole onnxruntime-shaped chain',
    )
    assert.deepEqual(
      [...new Set((record.dependencies ?? []).map(dependency => dependency.provenance))],
      ['preinstalled'],
      'the host-tree arm copies operator-completed content with preinstalled provenance',
    )
    // The deepest link really is on disk inside the extension's own node_modules.
    for (const name of ['define-data-property', 'es-define-property']) {
      const materialized = join(record.installPath, 'node_modules', name, 'package.json')
      assert.equal(existsSync(materialized), true, `${name} must be materialized inside the extension`)
    }
  })

  it('reproduces the live refusal verbatim when the bound is lowered to 3 (message is bound-driven, not hardcoded)', async () => {
    const tree = onnxruntimeHostTree()
    const storeDir = tempDir()
    const service = createExtensionsService({
      storeDir,
      sourceDir: tree.sourceDir,
      allowSourceDirectories: true,
      allowPreinstalledDependencies: true,
      preinstalledDependenciesRoot: tree.root,
      installSource: 'directory',
      // The SDK's own fallback is 3; setting it explicitly proves the refusal is
      // the SDK honoring the FORWARDED bound (the live message names this level).
      registryDependencyDepth: 3,
    })
    // chain depths 0..3 fit; define-data-property sits at depth 4 and is refused.
    const error = await rejectsDependency(service.install(EXTENSION_ID), /exceeds the 3-level depth bound at define-data-property/)
    assert.match(error.message, /^\[DEPENDENCY_UNSATISFIED\]/, 'the live refusal code is preserved')
    assert.deepEqual(
      [...new ExtensionStore(storeDir).listInstalled().value],
      [],
      'the refused install must leave no record',
    )
  })
})
