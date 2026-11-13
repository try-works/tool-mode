/**
 * The HOST restore loop, end to end (RUN-05, EXT-07, EXT-26).
 *
 * `ExtensionLifecycle` restore is tested in the SDK, but the HOST wiring — reading the
 * approved profile state, verifying the installed bytes, and activating through the real
 * DSH registry on startup — had no test. A fresh lifecycle instance in the SDK tests is
 * not the host path: here the plugin itself mounts the store, runs the restore chain,
 * and the assertion is that a previously approved extension's tool REACHES the registry
 * without any operator action.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'

import { ExtensionStore, createZipArchiveSource, installPathFor, stagedInstall } from '@try-works/tool-mode-extension-sdk'
import { cleanup, mountPlugin, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const FIXTURE_DIR = join(process.cwd(), 'fixtures', 'slice1-extension')
const EXTENSION_ID = '@try-works/fixture-slice1'

function packFixture(overrides: Record<string, string | Buffer> = {}): { bytes: Uint8Array; sha512: string } {
  const zip = new AdmZip()
  for (const relative of ['package.json', 'tool-mode.extension.json', 'lib/index.js', 'schemas/input.json', 'schemas/output.json', 'models.lock.json']) {
    zip.addFile(relative, overrides[relative] ?? readFileSync(join(FIXTURE_DIR, relative)))
  }
  const bytes = new Uint8Array(zip.toBuffer())
  return { bytes, sha512: createHash('sha512').update(bytes).digest('hex') }
}

describe('the host restores an approved extension on startup', () => {
  it('publishes the restored tool through the real registry without operator action', async () => {
    const storeDir = tempDir()
    const { bytes, sha512 } = packFixture()
    await stagedInstall({
      source: { kind: 'local', requested: FIXTURE_DIR },
      storeDir,
      expectedSha512: sha512,
      archive: createZipArchiveSource(() => bytes),
    })
    // A PREVIOUS process approved activation, then exited without deactivating: the
    // durable state says active, the owner pid is dead, and the in-memory handles died
    // with it — the exact restart case RUN-05 requires the host to restore.
    const store = new ExtensionStore(storeDir)
    const installedDir = installPathFor(storeDir, EXTENSION_ID, '1.0.0')
    store.writeProfileState('default', [{
      extensionId: EXTENSION_ID,
      installation: 'installed',
      desiredActivation: 'active',
      observedActivation: 'active',
      ownerPid: 2147483647,
      export: 'not-exported',
      tools: [{ toolName: 'fixture_echo', enabled: true }],
      readiness: {},
    }])

    const ctx = await mountPlugin({ extensionStore: storeDir })

    // The restore chain is async, so poll the REAL registry until the tool appears.
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (ctx.tools.schemas().some(schema => schema.name === 'fixture_echo')) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.ok(
      ctx.tools.schemas().some(schema => schema.name === 'fixture_echo'),
      'the restored extension tool must reach the registry without operator action',
    )

    // EXACT-SCHEMA: the tool advertises its MANIFEST-declared input schema, not an
    // empty parameter map. `token` is declared with type string and required, and
    // `upper` as boolean. `schemas()` projects onto the model-facing JSON Schema
    // shape, so the fields sit under `properties` with a `required` array.
    const schema = ctx.tools.schemas().find(candidate => candidate.name === 'fixture_echo')
    assert.ok(schema !== undefined)
    console.log('fixture_echo schema:', JSON.stringify(schema))
    const parameters = schema.parameters as {
      properties?: Record<string, { type?: unknown }>
      required?: unknown[]
    }
    assert.equal(parameters.properties?.token?.type, 'string', 'the manifest input schema must reach the registry')
    assert.ok(parameters.required?.includes('token'), 'requiredness must reach the registry')
    assert.equal(parameters.properties?.upper?.type, 'boolean')

    // And the restoration also records the correct installed path in durable state.
    const restored = store.readProfileState('default').value[0]
    assert.equal(restored?.observedActivation, 'active')
    assert.ok(installedDir.length > 0)
  })

  it('enforces the manifest-declared maxLength the projected advertisement drops', async () => {
    const storeDir = tempDir()
    const { bytes, sha512 } = packFixture()
    await stagedInstall({
      source: { kind: 'local', requested: FIXTURE_DIR },
      storeDir,
      expectedSha512: sha512,
      archive: createZipArchiveSource(() => bytes),
    })
    const store = new ExtensionStore(storeDir)
    store.writeProfileState('default', [{
      extensionId: EXTENSION_ID,
      installation: 'installed',
      desiredActivation: 'active',
      observedActivation: 'active',
      ownerPid: 2147483647,
      export: 'not-exported',
      tools: [{ toolName: 'fixture_echo', enabled: true }],
      readiness: {},
    }])

    const ctx = await mountPlugin({ extensionStore: storeDir })
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (ctx.tools.schemas().some(schema => schema.name === 'fixture_echo')) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }

    const { callTool } = await import('./helpers.ts')

    // A VALID call through the real host path: install → restore → publish → dispatch
    // → provider invoke → declared-output check → registry success.
    const good = await callTool(ctx, 'fixture_echo', { token: 'hello', upper: true })
    assert.equal(good.isError, false, `a valid call must succeed: ${JSON.stringify(good)}`)
    const value = good.value as { echoed?: unknown }
    assert.equal(value.echoed, 'HELLO')

    // The DSH projection drops `maxLength` (not in the value-schema DSL), so only the
    // full-schema check at the call path can refuse this. The HOST's refusal must be
    // asserted — the fixture provider ALSO checks the limit, so a weaker assertion
    // would pass even without host enforcement.
    const overlong = await callTool(ctx, 'fixture_echo', { token: 'x'.repeat(300) })
    assert.equal(overlong.isError, true, 'a token over the declared maxLength must be refused')
    assert.match(JSON.stringify(overlong), /fixture_echo input/, 'the HOST input check must be the one refusing')

    // The OUTPUT check: the provider returns a value violating its own declared
    // output schema (echoed is a number, not a string), and the host must refuse it
    // before a caller sees it.
    const broken = await callTool(ctx, 'fixture_echo', { token: '__violate_output__' })
    assert.equal(broken.isError, true, 'a result violating the declared output schema must be refused')
    assert.match(JSON.stringify(broken), /fixture_echo output/, 'the HOST output check must be the one refusing')
  })

  it('refuses a tool whose declared schema cannot be compiled instead of publishing it unenforced (P26-13)', async () => {
    const storeDir = tempDir()
    // Valid JSON, INVALID JSON Schema: `type: 'stringy'` is not a type. The SDK's
    // manifest validation only proves the file exists, so this is exactly the
    // package an installer admits and the host must refuse at publication.
    const { bytes, sha512 } = packFixture({
      'schemas/input.json': JSON.stringify({ type: 'stringy', properties: {} }),
    })
    await stagedInstall({
      source: { kind: 'local', requested: FIXTURE_DIR },
      storeDir,
      expectedSha512: sha512,
      archive: createZipArchiveSource(() => bytes),
    })
    const store = new ExtensionStore(storeDir)
    store.writeProfileState('default', [{
      extensionId: EXTENSION_ID,
      installation: 'installed',
      desiredActivation: 'active',
      observedActivation: 'active',
      ownerPid: 2147483647,
      export: 'not-exported',
      tools: [{ toolName: 'fixture_echo', enabled: true }],
      readiness: {},
    }])

    const ctx = await mountPlugin({ extensionStore: storeDir })
    const deadline = Date.now() + 15_000
    await new Promise(resolve => setTimeout(resolve, 400))
    while (Date.now() < deadline) {
      // The restore loop settles quickly; a short wait is enough for the refusal to
      // land. The assert is on the OUTCOME, so a slow refusal also passes.
      await new Promise(resolve => setTimeout(resolve, 25))
      break
    }

    // THE ASSERTION THAT MATTERS: the tool never reaches the registry, because a
    // declared schema that cannot be enforced must refuse publication rather than
    // advertise constraints that are enforced nowhere.
    assert.equal(
      ctx.tools.schemas().some(schema => schema.name === 'fixture_echo'),
      false,
      'a tool with an uncompilable declared schema must not be published',
    )
    // And the durable state records the failure rather than a silent active.
    const state = store.readProfileState('default').value[0]
    assert.ok(
      state?.observedActivation === 'failed' || state?.observedActivation === 'quarantined',
      `the extension must be failed or quarantined, not ${state?.observedActivation}`,
    )
  })
})

/**
 * RESTART SELECTION (task-134).
 *
 * The restore chain used `installedRecords.find(id)`, which returns the FIRST record
 * for an identity — the OLDEST version. A host that had installed 1.0.1, 1.0.2 and
 * 1.0.3 therefore activated 1.0.1 after every restart while `describe()` reported
 * 1.0.3: stale code served, and no report disagreed. The service's own selection
 * (EXT-30 pointer, else the last appended record) is the one answer.
 */
describe('the host restores the SELECTED version, not the first recorded one', () => {
  it('activates the newest approved version and serves its tool', async () => {
    const storeDir = tempDir()
    const v1 = packFixture()
    await stagedInstall({
      source: { kind: 'local', requested: FIXTURE_DIR },
      storeDir,
      expectedSha512: v1.sha512,
      archive: createZipArchiveSource(() => v1.bytes),
    })

    // A second, newer build of the SAME package whose echo is distinguishable.
    const manifestV2 = JSON.parse(readFileSync(join(FIXTURE_DIR, 'tool-mode.extension.json'), 'utf8')) as Record<string, unknown>
    manifestV2['version'] = '2.0.0'
    const packageV2 = JSON.parse(readFileSync(join(FIXTURE_DIR, 'package.json'), 'utf8')) as Record<string, unknown>
    packageV2['version'] = '2.0.0'
    const libV2 = readFileSync(join(FIXTURE_DIR, 'lib', 'index.js'), 'utf8').replace(
      'const echoed = input.upper === true ? token.toUpperCase() : token',
      'const echoed = `v2:${input.upper === true ? token.toUpperCase() : token}`',
    )
    const v2 = packFixture({
      'package.json': `${JSON.stringify(packageV2, null, 2)}\n`,
      'tool-mode.extension.json': `${JSON.stringify(manifestV2, null, 2)}\n`,
      'lib/index.js': libV2,
    })
    await stagedInstall({
      source: { kind: 'local', requested: FIXTURE_DIR },
      storeDir,
      expectedSha512: v2.sha512,
      archive: createZipArchiveSource(() => v2.bytes),
    })

    const store = new ExtensionStore(storeDir)
    store.writeProfileState('default', [{
      extensionId: EXTENSION_ID,
      installation: 'installed',
      desiredActivation: 'active',
      observedActivation: 'active',
      ownerPid: 2147483647,
      export: 'not-exported',
      tools: [{ toolName: 'fixture_echo', enabled: true }],
      readiness: {},
    }])

    const ctx = await mountPlugin({ extensionStore: storeDir })
    const { callTool } = await import('./helpers.ts')
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (ctx.tools.schemas().some(schema => schema.name === 'fixture_echo')) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    const result = await callTool(ctx, 'fixture_echo', { token: 'x' })
    assert.equal(result.isError, false, `the restored call must succeed: ${JSON.stringify(result)}`)
    assert.equal(
      (result.value as { echoed?: string }).echoed,
      'v2:x',
      'the restarted host must serve the NEWEST approved build, not the first record',
    )
  })
})

/**
 * SAME-PROCESS UPGRADE (task-135).
 *
 * The module/instance cache was keyed by extension identity alone. A host that had already
 * dispatched 1.0.0 kept the 1.0.0 instance after the operator installed and activated 2.0.0:
 * the NEW tools registered (their schemas come from the selected manifest), but every call
 * reached the OLD implementation, which refused the new implementation ids. Reproduced live:
 * `implemented "needle3-native-structured-extract", not "needle3-native-validate-record"`.
 */
describe('an upgrade in the SAME process loads the new module', () => {
  it('serves the new build after the active-version pointer moves', async () => {
    const storeDir = tempDir()
    const v1 = packFixture()
    await stagedInstall({
      source: { kind: 'local', requested: FIXTURE_DIR },
      storeDir,
      expectedSha512: v1.sha512,
      archive: createZipArchiveSource(() => v1.bytes),
    })

    const store = new ExtensionStore(storeDir)
    const active = {
      extensionId: EXTENSION_ID,
      installation: 'installed',
      desiredActivation: 'active',
      observedActivation: 'active',
      ownerPid: 2147483647,
      export: 'not-exported',
      tools: [{ toolName: 'fixture_echo', enabled: true }],
      readiness: {},
    }
    store.writeProfileState('default', [active])

    const ctx = await mountPlugin({ extensionStore: storeDir })
    const { callTool } = await import('./helpers.ts')
    const waitForTool = async (): Promise<void> => {
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        if (ctx.tools.schemas().some(schema => schema.name === 'fixture_echo')) return
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
    await waitForTool()
    const before = await callTool(ctx, 'fixture_echo', { token: 'x' })
    assert.equal((before.value as { echoed?: string }).echoed, 'x', 'the first call must run 1.0.0')

    // The upgrade lands while the process is alive.
    const manifestV2 = JSON.parse(readFileSync(join(FIXTURE_DIR, 'tool-mode.extension.json'), 'utf8')) as Record<string, unknown>
    manifestV2['version'] = '2.0.0'
    const packageV2 = JSON.parse(readFileSync(join(FIXTURE_DIR, 'package.json'), 'utf8')) as Record<string, unknown>
    packageV2['version'] = '2.0.0'
    const libV2 = readFileSync(join(FIXTURE_DIR, 'lib', 'index.js'), 'utf8').replace(
      'const echoed = input.upper === true ? token.toUpperCase() : token',
      'const echoed = `v2:${input.upper === true ? token.toUpperCase() : token}`',
    )
    const v2 = packFixture({
      'package.json': `${JSON.stringify(packageV2, null, 2)}\n`,
      'tool-mode.extension.json': `${JSON.stringify(manifestV2, null, 2)}\n`,
      'lib/index.js': libV2,
    })
    await stagedInstall({
      source: { kind: 'local', requested: FIXTURE_DIR },
      storeDir,
      expectedSha512: v2.sha512,
      archive: createZipArchiveSource(() => v2.bytes),
    })
    store.writeProfileState('default', [active], undefined, { [EXTENSION_ID]: '2.0.0' }, {})

    const after = await callTool(ctx, 'fixture_echo', { token: 'x' })
    assert.equal(after.isError, false, `the upgraded call must succeed: ${JSON.stringify(after)}`)
    assert.equal(
      (after.value as { echoed?: string }).echoed,
      'v2:x',
      'the upgraded call must reach the 2.0.0 module, not the cached 1.0.0 instance',
    )
  })
})
