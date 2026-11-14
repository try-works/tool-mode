/**
 * First-party extension auto-provisioning (task-33).
 *
 * The planner is pure and the executor is sequential, error-isolating and truthful: this test
 * file drives both with fakes and asserts the exact action order, the re-describe skip rules,
 * error isolation and the summary counts. The coverage test scans the real packages tree, so a
 * new first-party extension package fails this suite until it is added to the constant.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  FIRST_PARTY_EXTENSIONS,
  planProvisioning,
  provisioningShippedIds,
  runProvisioning,
  type ProvisioningExtensionState,
  type ProvisioningPlanEntry,
  type ProvisioningRequirement,
} from '../src/first-party-provisioning.ts'

const assetGap: readonly ProvisioningRequirement[] = [{ kind: 'assets', satisfied: false }]
const executableGap: readonly ProvisioningRequirement[] = [{ kind: 'executable', satisfied: false }]
const satisfied: readonly ProvisioningRequirement[] = [{ kind: 'assets', satisfied: true }]

const row = (overrides: Partial<ProvisioningExtensionState> & { readonly id: string }): ProvisioningExtensionState => ({
  installed: true,
  active: false,
  disabled: false,
  requirements: [],
  reason: null,
  ...overrides,
})

const plan = (overrides: Partial<Parameters<typeof planProvisioning>[0]> = {}) =>
  planProvisioning({
    extensions: [],
    shipped: ['@acme/a', '@acme/b'],
    autoProvision: true,
    ...overrides,
  })

const actionsOf = (entries: readonly ProvisioningPlanEntry[]): readonly (readonly [string, readonly string[]])[] =>
  entries.map((entry) => [entry.id, entry.actions] as const)

describe('FIRST_PARTY_EXTENSIONS', () => {
  it('lists exactly the ids the packages tree ships', () => {
    const packagesDir = resolve(import.meta.dirname, '../../../packages')
    const manifests = readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('extension-'))
      .map((entry) => {
        const manifestPath = resolve(packagesDir, entry.name, 'tool-mode.extension.json')
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        assert.equal(typeof manifest.id, 'string', entry.name + ' must declare a manifest id')
        return manifest.id
      })
      .sort()

    assert.equal(FIRST_PARTY_EXTENSIONS.length, 16, 'all first-party extension packages are listed')
    assert.deepEqual([...FIRST_PARTY_EXTENSIONS], manifests, 'the constant must name every packages/extension-* manifest exactly once')
  })
})

describe('planProvisioning', () => {
  it('plans install, then prepare, then enable for a fresh host', () => {
    const entries = plan({
      shipped: ['@acme/a'],
      extensions: [row({ id: '@acme/a', installed: false, requirements: assetGap })],
    })
    assert.deepEqual(actionsOf(entries), [['@acme/a', ['install', 'prepare', 'enable']]])
  })

  it('plans prepare then enable for an installed, inactive, unprepared extension', () => {
    const entries = plan({
      extensions: [
        row({ id: '@acme/a', requirements: executableGap }),
        row({ id: '@acme/b', requirements: [] }),
      ],
    })
    assert.deepEqual(actionsOf(entries), [
      ['@acme/a', ['prepare', 'enable']],
      ['@acme/b', ['enable']],
    ])
  })

  it('does not plan prepare when the only requirements are satisfied', () => {
    const entries = plan({ shipped: ['@acme/a'], extensions: [row({ id: '@acme/a', requirements: satisfied })] })
    assert.deepEqual(actionsOf(entries), [['@acme/a', ['enable']]])
  })

  it('plans nothing for an active extension', () => {
    const entries = plan({
      shipped: ['@acme/a'],
      extensions: [row({ id: '@acme/a', active: true, requirements: assetGap })],
    })
    assert.deepEqual(entries, [])
  })

  it('skips a disabled extension even when it is not installed', () => {
    const entries = plan({
      shipped: ['@acme/a'],
      extensions: [row({ id: '@acme/a', installed: false, disabled: true, requirements: assetGap })],
    })
    assert.deepEqual(entries, [])
  })

  it('plans nothing at all when autoProvision is false', () => {
    const entries = plan({
      autoProvision: false,
      extensions: [row({ id: '@acme/a', installed: false, requirements: assetGap })],
    })
    assert.deepEqual(entries, [])
  })

  it('ignores extensions that are not in the shipped set', () => {
    const entries = plan({
      extensions: [
        row({ id: '@acme/a', installed: false }),
        row({ id: '@acme/private', installed: false, requirements: assetGap }),
      ],
      shipped: ['@acme/a'],
    })
    assert.deepEqual(actionsOf(entries), [['@acme/a', ['install', 'enable']]])
  })

  it('is deterministic: sorted ids and at most one action of each kind', () => {
    const entries = plan({
      shipped: ['@acme/c', '@acme/a', '@acme/b', '@acme/a'],
      extensions: [
        row({ id: '@acme/c', installed: false, requirements: assetGap }),
        row({ id: '@acme/a', installed: false, requirements: assetGap }),
        row({ id: '@acme/b', installed: false, requirements: assetGap }),
      ],
    })
    assert.deepEqual(entries.map((entry) => entry.id), ['@acme/a', '@acme/b', '@acme/c'])
    for (const entry of entries) {
      assert.deepEqual([...entry.actions].sort(), ['enable', 'install', 'prepare'])
      assert.equal(new Set(entry.actions).size, entry.actions.length)
    }
  })

  it('treats a shipped id with no row as a fresh installation', () => {
    const entries = plan({ extensions: [], shipped: ['@acme/a'] })
    assert.deepEqual(actionsOf(entries), [['@acme/a', ['install', 'enable']]])
  })
})

interface Harness {
  readonly calls: string[]
  readonly logs: string[]
  readonly rows: ProvisioningExtensionState[]
  mutate: (id: string, change: Partial<ProvisioningExtensionState>) => void
}

const harnessFor = (
  rows: readonly ProvisioningExtensionState[],
  planEntries: readonly ProvisioningPlanEntry[],
  behaviour: {
    readonly install?: (id: string, harness: Harness) => Promise<void>
    readonly prepare?: (id: string, harness: Harness) => Promise<void>
    readonly enable?: (id: string, harness: Harness) => Promise<void>
  } = {},
): { readonly harness: Harness; readonly run: () => ReturnType<typeof runProvisioning> } => {
  const calls: string[] = []
  const logs: string[] = []
  const state = [...rows.map((entry) => ({ ...entry, requirements: [...entry.requirements] }))]
  const harness: Harness = {
    calls,
    logs,
    rows: state,
    mutate: (id, change) => {
      const index = state.findIndex((entry) => entry.id === id)
      if (index >= 0) state[index] = { ...state[index], ...change } as ProvisioningExtensionState
    },
  }
  const run = () =>
    runProvisioning({
      plan: planEntries,
      describe: async () => state.map((entry) => ({ ...entry })),
      install: async (id) => {
        calls.push('install:' + id)
        if (behaviour.install !== undefined) await behaviour.install(id, harness)
      },
      prepare: async (id) => {
        calls.push('prepare:' + id)
        if (behaviour.prepare !== undefined) await behaviour.prepare(id, harness)
      },
      enable: async (id) => {
        calls.push('enable:' + id)
        if (behaviour.enable !== undefined) await behaviour.enable(id, harness)
      },
      log: (message) => logs.push(message),
    })
  return { harness, run }
}

describe('runProvisioning', () => {
  it('executes install, prepare and enable in order and re-describes between phases', async () => {
    const fresh = row({ id: '@acme/a', installed: false, requirements: assetGap })
    const { harness, run } = harnessFor([fresh], [{ id: '@acme/a', actions: ['install', 'prepare', 'enable'] }], {
      install: async (id, h) => h.mutate(id, { installed: true }),
      prepare: async (id, h) => h.mutate(id, { requirements: satisfied }),
      enable: async (id, h) => h.mutate(id, { active: true }),
    })
    const summary = await run()
    assert.deepEqual(harness.calls, ['install:@acme/a', 'prepare:@acme/a', 'enable:@acme/a'])
    assert.deepEqual(summary, { installed: 1, prepared: 1, enabled: 1, skipped: 0, failed: [] })
  })

  it('skips steps the fresh row already satisfies', async () => {
    const fresh = row({ id: '@acme/a', installed: false, requirements: assetGap })
    const { harness, run } = harnessFor([fresh], [{ id: '@acme/a', actions: ['install', 'prepare', 'enable'] }], {
      // The install itself satisfies every requirement and activates nothing.
      install: async (id, h) => h.mutate(id, { installed: true, requirements: satisfied }),
      prepare: async () => assert.fail('prepare must be skipped when the fresh row says it is satisfied'),
      enable: async (id, h) => h.mutate(id, { active: true }),
    })
    const summary = await run()
    assert.deepEqual(harness.calls, ['install:@acme/a', 'enable:@acme/a'])
    assert.deepEqual(summary, { installed: 1, prepared: 0, enabled: 1, skipped: 1, failed: [] })
  })

  it('skips install and enable when the described state already has them', async () => {
    const done = row({ id: '@acme/a', installed: true, active: true })
    const { harness, run } = harnessFor([done], [{ id: '@acme/a', actions: ['install', 'prepare', 'enable'] }])
    const summary = await run()
    assert.deepEqual(harness.calls, [])
    // All three planned actions are already satisfied (installed, nothing to prepare, active).
    assert.deepEqual(summary, { installed: 0, prepared: 0, enabled: 0, skipped: 3, failed: [] })
  })

  it('isolates an error, logs it, and continues with the other ids', async () => {
    const a = row({ id: '@acme/a', installed: false, requirements: assetGap })
    const b = row({ id: '@acme/b', installed: false, requirements: assetGap })
    const { harness, run } = harnessFor([a, b], [
      { id: '@acme/a', actions: ['install', 'prepare', 'enable'] },
      { id: '@acme/b', actions: ['install', 'prepare', 'enable'] },
    ], {
      install: async (id, h) => {
        if (id === '@acme/a') throw new Error('install exploded')
        h.mutate(id, { installed: true })
      },
      prepare: async (id, h) => h.mutate(id, { requirements: satisfied }),
      enable: async (id, h) => h.mutate(id, { active: true }),
    })
    const summary = await run()
    // A failed install does not stop the phases of the other id.
    assert.deepEqual(harness.calls, [
      'install:@acme/a', 'prepare:@acme/a', 'enable:@acme/a',
      'install:@acme/b', 'prepare:@acme/b', 'enable:@acme/b',
    ])
    assert.equal(summary.failed.length, 1)
    assert.deepEqual(summary.failed[0]?.id, '@acme/a')
    assert.equal(summary.failed[0]?.phase, 'install')
    assert.match(String(summary.failed[0]?.reason), /install exploded/)
    assert.equal(summary.installed, 1)
    assert.ok(harness.logs.some((message) => message.includes('@acme/a') && message.includes('install')))
  })

  it('counts a failed prepare and still attempts the planned enable', async () => {
    const a = row({ id: '@acme/a', requirements: assetGap })
    const { harness, run } = harnessFor([a], [{ id: '@acme/a', actions: ['prepare', 'enable'] }], {
      prepare: async () => {
        throw new Error('download refused')
      },
      enable: async (id, h) => h.mutate(id, { active: true }),
    })
    const summary = await run()
    assert.deepEqual(harness.calls, ['prepare:@acme/a', 'enable:@acme/a'])
    assert.deepEqual(summary, {
      installed: 0,
      prepared: 0,
      enabled: 1,
      skipped: 0,
      failed: [{ id: '@acme/a', phase: 'prepare', reason: 'download refused' }],
    })
  })

  it('never calls enable merely because install returned', async () => {
    const fresh = row({ id: '@acme/a', installed: false })
    const { harness, run } = harnessFor([fresh], [{ id: '@acme/a', actions: ['install'] }], {
      install: async (id, h) => h.mutate(id, { installed: true }),
      enable: async () => assert.fail('install is not activation'),
    })
    const summary = await run()
    assert.deepEqual(harness.calls, ['install:@acme/a'])
    assert.deepEqual(summary, { installed: 1, prepared: 0, enabled: 0, skipped: 0, failed: [] })
  })

  it('treats a disabled row as nothing to do even if the plan says so', async () => {
    const disabled = row({ id: '@acme/a', installed: false, disabled: true, requirements: assetGap })
    const { harness, run } = harnessFor([disabled], [{ id: '@acme/a', actions: ['install', 'prepare', 'enable'] }])
    const summary = await run()
    assert.deepEqual(harness.calls, [])
    assert.equal(summary.skipped, 3)
    assert.deepEqual(summary.failed, [])
  })
  it('provisions only ids the host can reach without the registry', () => {
    const shipped = ['@acme/installed', '@acme/source', '@acme/absent', '@acme/offline-installed']
    const eligible = provisioningShippedIds(
      shipped,
      ['@acme/source', '@acme/not-shipped'],
      ['@acme/installed', '@acme/offline-installed'],
    )
    assert.deepEqual(eligible, ['@acme/installed', '@acme/source', '@acme/offline-installed'])
  })

  it('returns nothing when no id is installed or present in the source directory', () => {
    assert.deepEqual(provisioningShippedIds(['@acme/a', '@acme/b'], [], []), [])
  })
})
