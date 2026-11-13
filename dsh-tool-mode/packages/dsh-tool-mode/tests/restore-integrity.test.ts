/** AT-75/AT-76 — a refused restore must not leave a ghost `active` capability. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExtensionStore } from '@try-works/tool-mode-extension-sdk'
import { recordRestoreIntegrityFailure } from '../src/extensions-service.ts'

const dirs: string[] = []
after(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('AT-75 — changed installed bytes fail the restore state truthfully', () => {
  it('turns an old active row into failed with no tools, leaving siblings untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'restore-integrity-'))
    dirs.push(dir)
    const store = new ExtensionStore(dir)
    store.writeProfileState('default', [
      {
        extensionId: '@author/tampered',
        installation: 'installed',
        desiredActivation: 'active',
        observedActivation: 'active',
        readiness: {},
        tools: [{ toolName: 'text_title', enabled: true }],
        export: 'not-exported',
        ownerPid: 999_999,
      },
      {
        extensionId: '@author/healthy',
        installation: 'installed',
        desiredActivation: 'active',
        observedActivation: 'active',
        readiness: {},
        tools: [{ toolName: 'author_add', enabled: true }],
        export: 'not-exported',
      },
    ])

    recordRestoreIntegrityFailure(store, '@author/tampered')

    const states = store.readProfileState('default').value
    const tampered = states.find(state => state.extensionId === '@author/tampered')
    assert.equal(tampered?.observedActivation, 'failed')
    assert.deepEqual(tampered?.tools, [])
    const healthy = states.find(state => state.extensionId === '@author/healthy')
    assert.equal(healthy?.observedActivation, 'active')
    assert.deepEqual(healthy?.tools, [{ toolName: 'author_add', enabled: true }])
  })
})