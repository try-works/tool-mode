/**
 * TASK-48 — the extension self-collision that aborted activation.
 *
 * Evidence (restore-failures.log): clear/ear/emo/moderator/shapes/uhm all failed with
 * "<implementation-id> is already published by <same extension>; cannot take the name
 * over". The recipe manifests declare an IMPLEMENTATION `enhance-speech` AND a usage
 * SKILL of the same label (and a tool `enhance_speech`). The registrar keyed ownership
 * by NAME alone, so the second KIND was refused and the lifecycle rolled the whole
 * activation back.
 *
 * This test goes through the REAL mounted plugin: the fixture manifest reuses one label
 * for its implementation and its skill, the real lifecycle publishes both, and the
 * assertions read the real registry and skill catalog. The registrar unit tests pin the
 * idempotent re-publish rule separately.
 *
 * @module tests/extension-self-collision
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type {} from '@deepseek-ai/dsh-skill'
import { stagedInstallFromDirectory, ExtensionStore } from '@try-works/tool-mode-extension-sdk'

import * as plugin from '../src/index.ts'
import { packageDirFor } from '../src/extensions-service.ts'
import { cleanup, mountPlugin, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const FIXTURE_DIR = join(process.cwd(), 'packages', 'dsh-tool-mode', 'tests', 'fixtures', 'extensions-service-extension')
const EXTENSION_ID = '@try-works/fixture-ext-service'
/** One label used by the implementation AND the skill, exactly like enhance-speech. */
const SHARED_LABEL = 'fixture-tool'
const TOOL_NAME = 'fixture_ext_tool'
const SKILL_CONTENT = '# Shared-label guidance\n\nUse the fixture tool with the token you need echoed.\n'

/** The result of an enable/disable request (the subset this test reads). */
interface ToggleResult {
  readonly id: string
  readonly active: boolean
  readonly disabled: boolean
}

/** The host service surface this test drives (the Remote-facing service). */
interface ExtensionService {
  enable(id: string): Promise<ToggleResult>
  disable(id: string): Promise<ToggleResult>
}

/** A mounted host whose fixture reuses one label for an implementation and a skill. */
interface Host {
  readonly ctx: Awaited<ReturnType<typeof mountPlugin>>
  readonly service: ExtensionService
  readonly storeDir: string
}

/**
 * Install the fixture with a skill whose name equals its implementation id.
 * @returns the mounted host and its service.
 */
async function mountSharedLabel(): Promise<Host> {
  const sourceRoot = tempDir()
  const packageDir = join(sourceRoot, packageDirFor(EXTENSION_ID))
  cpSync(FIXTURE_DIR, packageDir, { recursive: true })
  const manifestPath = join(packageDir, 'tool-mode.extension.json')
  // SAFETY: the fixture manifest is JSON this test just read from disk; the assertion
  // only names its top-level shape so the write below type-checks.
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { skills?: unknown[] }
  manifest.skills = [{
    id: SHARED_LABEL,
    name: SHARED_LABEL,
    description: 'Guidance for the tool whose implementation id shares this label.',
    path: './skills/fixture-tool/SKILL.md',
  }]
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  const skillFile = join(packageDir, 'skills', 'fixture-tool', 'SKILL.md')
  mkdirSync(dirname(skillFile), { recursive: true })
  writeFileSync(skillFile, SKILL_CONTENT)

  const storeDir = tempDir()
  await stagedInstallFromDirectory({ sourceDir: packageDir, storeDir, allowSourceDirectories: true })
  const ctx = await mountPlugin({ extensionStore: storeDir })
  // SAFETY: the mounted plugin provides the 'modelTools' service; the assertion only
  // names the two methods this test calls, and assert.ok fails when it is absent.
  const service = ctx.get('modelTools') as ExtensionService | undefined
  assert.ok(service !== undefined, 'the plugin must provide the extension service')
  return { ctx, service, storeDir }
}

/** The recorded activation state for the fixture. */
function activationState(storeDir: string) {
  return new ExtensionStore(storeDir).readProfileState('default').value
    .find(entry => entry.extensionId === EXTENSION_ID)
}

/** How many registrations the registry holds under one name. */
function registrations(ctx: Host['ctx'], name: string): number {
  return ctx.tools.schemas().filter(schema => schema.name === name).length
}

/** Whether the skill catalog advertises the shared label. */
async function skillPresent(ctx: Host['ctx']): Promise<boolean> {
  const skills = await ctx.skills.list({ cwd: process.cwd() })
  return skills.some(skill => skill.name === SHARED_LABEL)
}

describe('TASK-48 — one label may be used by different contribution kinds', () => {
  it('activates when an implementation and a skill share one label', async () => {
    const { ctx, service, storeDir } = await mountSharedLabel()
    const enabled = await service.enable(EXTENSION_ID)

    assert.equal(enabled.active, true, 'the extension must activate')
    const state = activationState(storeDir)
    assert.equal(state?.observedActivation, 'active')
    assert.equal(state?.activationError, undefined, 'no contribution refusal is recorded')
    // The tool is registered exactly once; the shared label did not abort it.
    assert.equal(registrations(ctx, TOOL_NAME), 1)
    // BOTH kinds own the label: the skill is advertised beside the implementation.
    assert.equal(await skillPresent(ctx), true)
  })

  it('treats a second enable as a reconcile no-op: one registration, no activationError', async () => {
    const { ctx, service, storeDir } = await mountSharedLabel()
    await service.enable(EXTENSION_ID)
    const second = await service.enable(EXTENSION_ID)

    assert.equal(second.active, true)
    assert.equal(registrations(ctx, TOOL_NAME), 1, 're-activation must not register the tool twice')
    assert.equal(await skillPresent(ctx), true)
    const state = activationState(storeDir)
    assert.equal(state?.observedActivation, 'active')
    assert.equal(state?.activationError, undefined)
  })

  it('re-registers both kinds after a disable/enable cycle', async () => {
    const { ctx, service, storeDir } = await mountSharedLabel()
    await service.enable(EXTENSION_ID)
    await service.disable(EXTENSION_ID)

    assert.equal(registrations(ctx, TOOL_NAME), 0, 'deactivation withdraws the tool')
    assert.equal(await skillPresent(ctx), false, 'deactivation withdraws the skill')

    await service.enable(EXTENSION_ID)
    assert.equal(registrations(ctx, TOOL_NAME), 1)
    assert.equal(await skillPresent(ctx), true)
    assert.equal(activationState(storeDir)?.observedActivation, 'active')
  })
})
