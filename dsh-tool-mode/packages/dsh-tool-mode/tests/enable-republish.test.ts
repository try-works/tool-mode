/**
 * `enable` must RE-ACTIVATE an extension this process already owns (task-136).
 *
 * The live defect: after `prepare` or after installing a new version, a running host
 * reported the row active and never published the new tools; a disable→enable cycle was
 * the only workaround. `enable` skipped `lifecycle.activate` whenever the state said
 * "active under this pid", but the SDK documents re-activation as the way to reconcile
 * the surface and pick up newly recorded readiness.
 *
 * The fake activation records the call, so the regression is observable without a real
 * model: without the fix `activate` is never reached and the call list is empty.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import {
  createZipArchiveSource,
  type ExtensionActivation,
  type ExtensionState,
  stagedInstall,
} from '@try-works/tool-mode-extension-sdk'

import { ExtensionsService, ExtensionsServiceError } from '../src/extensions-service.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const FIXTURE_DIR = join(process.cwd(), 'fixtures', 'slice1-extension')
const EXTENSION_ID = '@try-works/fixture-slice1'
const MODEL_ID = 'fixture-echo-model'

/** Build the fixture archive the installer accepts. */
function packFixture(): { bytes: Uint8Array; sha512: string } {
  const zip = new AdmZip()
  for (const relative of ['package.json', 'tool-mode.extension.json', 'lib/index.js', 'schemas/input.json', 'schemas/output.json', 'models.lock.json']) {
    zip.addFile(relative, readFileSync(join(FIXTURE_DIR, relative)))
  }
  const bytes = new Uint8Array(zip.toBuffer())
  return { bytes, sha512: createHash('sha512').update(bytes).digest('hex') }
}

/** Install the fixture into a fresh store and return the store path. */
async function installedStore(): Promise<string> {
  const storeDir = tempDir()
  const fixture = packFixture()
  await stagedInstall({
    source: { kind: 'local', requested: FIXTURE_DIR },
    storeDir,
    expectedSha512: fixture.sha512,
    archive: createZipArchiveSource(() => fixture.bytes),
  })
  return storeDir
}

/** A state that says this process already owns the extension. */
function activeState(): ExtensionState {
  return {
    extensionId: EXTENSION_ID,
    installation: 'installed',
    desiredActivation: 'active',
    observedActivation: 'active',
    ownerPid: process.pid,
    export: 'not-exported',
    tools: [{ toolName: 'fixture_echo', enabled: true }],
    // Ready for its model: the activation preflight must not stop at "assets".
    readiness: { [MODEL_ID]: 'prepared-cold' },
  } as ExtensionState
}

/** A lifecycle whose activation is observable and whose state is fixed. */
function fakeLifecycle(options: { readonly fail?: Error } = {}): {
  lifecycle: ExtensionActivation
  activations: string[]
} {
  const activations: string[] = []
  const state = activeState()
  const lifecycle = {
    stateOf: () => state,
    async activate(extensionId: string, version: string) {
      activations.push(`${extensionId}@${version}`)
      if (options.fail !== undefined) throw options.fail
      return { extensionId, version, state, diagnostics: [], generation: 1 }
    },
  } as unknown as ExtensionActivation
  return { lifecycle, activations }
}

describe('enable re-publishes an already-active extension', () => {
  it('calls activate even when the state says this pid owns it', async () => {
    const storeDir = await installedStore()
    const { lifecycle, activations } = fakeLifecycle()
    const service = new ExtensionsService({ storeDir, lifecycle: () => lifecycle })
    const enabled = await service.enable(EXTENSION_ID)
    assert.equal(enabled.active, true)
    assert.equal(activations.length, 1, 'a no-op enable is the defect this pins')
    assert.match(activations[0] ?? '', /fixture-slice1@1\.0\.0/)
  })

  it('surfaces an activation failure with the service error code', async () => {
    const storeDir = await installedStore()
    const { lifecycle } = fakeLifecycle({ fail: new Error('the surface refused') })
    const service = new ExtensionsService({ storeDir, lifecycle: () => lifecycle })
    await assert.rejects(service.enable(EXTENSION_ID), (error: unknown) => {
      assert.ok(error instanceof ExtensionsServiceError)
      assert.equal(error.code, 'extension-activation-failed')
      assert.match(error.message, /surface refused/)
      return true
    })
  })
})

describe('a failed asset restore explains itself in the row', () => {
  it('names the cache problem instead of the generic preparation note', async () => {
    const storeDir = await installedStore()
    const { lifecycle } = fakeLifecycle()
    const service = new ExtensionsService({
      storeDir,
      lifecycle: () => lifecycle,
      // What the startup walk records when a cached file is missing or resized.
      assetRestoreDiagnostic: id => id === EXTENSION_ID
        ? 'cache/digest/blob is 100 bytes, expected 200'
        : undefined,
    })
    const described = await service.describe()
    const row = described.extensions.find(extension => extension.id === EXTENSION_ID)
    assert.ok(row, 'the installed fixture must appear in describe()')
    const unmet = (row.requirements ?? []).find(item => item.kind === 'assets' && item.satisfied === false)
    assert.ok(unmet, `an unmet assets requirement must explain the row: ${JSON.stringify(row.requirements)}`)
    assert.match(unmet.reason, /could not be restored from the cache/)
    assert.match(unmet.reason, /expected 200/)
    assert.equal(unmet.action, 'prepare')
  })
})
