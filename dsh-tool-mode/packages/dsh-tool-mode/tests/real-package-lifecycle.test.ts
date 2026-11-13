/**
 * NDL-08 — the REAL Needle and Laya packages traverse the generic host lifecycle.
 *
 * The SDK lifecycle is model-name free; this test proves it on the two first-party
 * packages rather than on a synthetic fixture: pack -> staged install -> activate ->
 * per-tool toggle -> deactivate -> uninstall. No model is loaded and no asset is
 * prepared; activation is manifest/identity/readiness work.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'
import AdmZip from 'adm-zip'

import {
  createZipArchiveSource,
  ExtensionLifecycle,
  ExtensionStore,
  stagedInstall,
  type Contribution,
  type ContributionRegistrar,
} from '@try-works/tool-mode-extension-sdk'

interface Installed {
  readonly extensionId: string
  readonly version: string
  readonly storeDir: string
  readonly installPath: string
}

function filesUnder(root: string, current = root): string[] {
  const out: string[] = []
  for (const name of readdirSync(current)) {
    if (name === 'src' || name === 'tests' || name === 'node_modules') continue
    const full = join(current, name)
    if (statSync(full).isDirectory()) out.push(...filesUnder(root, full))
    else out.push(relative(root, full).replace(/\\/g, '/'))
  }
  return out
}

async function installPackage(directory: string, extensionId: string): Promise<Installed> {
  const storeDir = mkdtempSync(join(tmpdir(), 'tmx-real-lifecycle-'))
  const dependencyRoot = mkdtempSync(join(tmpdir(), 'tmx-real-deps-'))
  const zip = new AdmZip()
  for (const entry of filesUnder(directory)) zip.addFile(entry, readFileSync(join(directory, entry)))
  const bytes = new Uint8Array(zip.toBuffer())
  const installed = await stagedInstall({
    source: { kind: 'local', requested: directory },
    storeDir,
    expectedSha512: createHash('sha512').update(bytes).digest('hex'),
    archive: createZipArchiveSource(async () => bytes),
    dependencies: {
      allowPreinstalled: true,
      preinstalledRoot: dependencyRoot,
      archive: createZipArchiveSource(async () => {
        throw new Error('the preinstalled arm must not fetch a registry archive')
      }),
      resolver: {
        async resolve(name: string) {
          const dir = join(dependencyRoot, 'node_modules', name.replace(/[^A-Za-z0-9._-]/g, '_'))
          mkdirSync(dir, { recursive: true })
          writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }))
          writeFileSync(join(dir, 'index.js'), 'export default {}\n')
          return { name, version: '1.0.0', dir, provenance: 'preinstalled' as const }
        },
      },
    },
  })
  const record = new ExtensionStore(storeDir).listInstalled().value.find(candidate => candidate.extensionId === extensionId)
  assert.ok(record !== undefined)
  return { extensionId, version: record.version, storeDir, installPath: record.installPath }
}

function registrar(): { registrar: ContributionRegistrar; published: Contribution[]; withdrawn: string[] } {
  const published: Contribution[] = []
  const withdrawn: string[] = []
  let next = 0
  return {
    published,
    withdrawn,
    registrar: {
      publish(contribution) {
        published.push(contribution)
        next += 1
        return `handle-${next}`
      },
      withdraw(handle) {
        withdrawn.push(handle)
      },
    },
  }
}

for (const [label, dirName, extensionId] of [
  ['Needle', 'extension-needle', '@try-works/extension-needle'],
  ['Laya', 'extension-laya', '@try-works/extension-laya'],
] as const) {
  test(`${label} installs, activates, toggles, deactivates and uninstalls through the generic lifecycle`, async () => {
    const directory = join(process.cwd(), 'packages', dirName)
    const installed = await installPackage(directory, extensionId)
    const surface = registrar()
    const lifecycle = new ExtensionLifecycle({
      store: new ExtensionStore(installed.storeDir),
      profile: 'default',
      registrar: surface.registrar,
    })
    try {
      const activation = await lifecycle.activate(installed.extensionId, installed.version)
      assert.equal(activation.state.observedActivation, 'active')
      // Readiness recording reconciles the published surface; the real packages
      // declare model deployments, so record host-inspected readiness (no model is
      // loaded here) and expect their tools to become publishable.
      const manifest = JSON.parse(readFileSync(join(directory, 'tool-mode.extension.json'), 'utf8')) as {
        models: readonly { id: string }[]
      }
      await lifecycle.recordReadiness(installed.extensionId, Object.fromEntries(
        manifest.models.map(model => [model.id, 'ready' as const]),
      ))
      const toolContributions = surface.published.filter(entry => entry.kind === 'tool')
      assert.ok(toolContributions.length > 0, `${label} must publish at least one real tool`)
      const toolName = toolContributions[0]!.name
      assert.equal(lifecycle.admits(installed.extensionId, toolName), true)

      await lifecycle.setToolEnabled(installed.extensionId, toolName, false)
      assert.equal(lifecycle.admits(installed.extensionId, toolName), false)
      await lifecycle.setToolEnabled(installed.extensionId, toolName, true)
      assert.equal(lifecycle.admits(installed.extensionId, toolName), true)

      const deactivation = await lifecycle.deactivate(installed.extensionId)
      assert.equal(deactivation.state.observedActivation, 'inactive')
      assert.equal(lifecycle.admits(installed.extensionId, toolName), false)

      await lifecycle.uninstall(installed.extensionId)
      assert.equal(new ExtensionStore(installed.storeDir).listInstalled().value.length, 0)
    } finally {
      rmSync(installed.storeDir, { recursive: true, force: true })
    }
  })
}
