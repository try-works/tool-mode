/**
 * P2 of the agent tool-selection plan: extension-manifest skills reach the session
 * skill catalog.
 *
 * The defect this file prevents: the SDK lifecycle publishes a `kind: 'skill'`
 * contribution for every manifest skill whose `requiresTools` are visible, and the
 * host's contribution registrar accepts a `registerSkill` hook — but src/index.ts never
 * supplied it, so every extension's declared skill was silently DROPPED. Needle, Laya,
 * Mirage, MiniLM and EmbeddingGemma are exactly the models with no catalog skill, so
 * their guidance never reached the agent.
 *
 * Everything here goes through the REAL mounted plugin: the real extension service
 * installs a fixture package from a temp source directory, the real lifecycle publishes
 * the contributions, and the assertions read `ctx.skills` — the same surface the model
 * sees. No skill registration is mocked.
 *
 * @module tests/extension-skills
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type {} from '@deepseek-ai/dsh-skill'
import { stagedInstallFromDirectory, ExtensionStore } from '@try-works/tool-mode-extension-sdk'

import * as plugin from '../src/index.ts'
import { packageDirFor } from '../src/extensions-service.ts'
import { cleanup, mountPlugin, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const FIXTURE_DIR = join(process.cwd(), 'packages', 'dsh-tool-mode', 'tests', 'fixtures', 'extensions-service-extension')
const EXTENSION_ID = '@try-works/fixture-ext-service'
const SKILL_ID = 'fixture-skill'
const SKILL_NAME = 'fixture-skill-guidance'
const SKILL_DESCRIPTION = 'Fixture guidance: echo a token through the deterministic extension tool.'
const SKILL_PATH = './skills/fixture-skill-guidance/SKILL.md'
const SKILL_CONTENT = '# Fixture skill\n\nCall the fixture tool with the token you need echoed.\n\nIt performs no inference.\n'

/** One declared skill to write into the fixture manifest. */
interface SkillDeclaration {
  readonly requiresTools?: readonly string[]
}

/** The shape this test writes for one manifest skill. */
interface DeclaredSkill {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly path: string
  requiresTools?: readonly string[]
}

/** The result of an enable/disable request (the subset this test reads). */
interface ToggleResult {
  readonly id: string
  readonly active: boolean
  readonly disabled: boolean
}

/** The host service surface these tests drive (the Remote-facing service). */
interface ExtensionService {
  enable(id: string): Promise<ToggleResult>
  disable(id: string): Promise<ToggleResult>
}

/**
 * Copy the fixture package into a temp source root and add one declared skill.
 *
 * @param declaration - gating facts to declare on the skill
 * @param options - body: the bytes written to the declared path (default the fixture body)
 * @returns the package directory the installer reads
 */
function skillSource(declaration: SkillDeclaration = {}, options: { body?: string; writeFile?: boolean } = {}): string {
  const sourceRoot = tempDir()
  const packageDir = join(sourceRoot, packageDirFor(EXTENSION_ID))
  cpSync(FIXTURE_DIR, packageDir, { recursive: true })
  const manifestPath = join(packageDir, 'tool-mode.extension.json')
  // SAFETY: the fixture manifest is JSON this test just read from disk; the assertion
  // only names its top-level shape so the write below type-checks.
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { skills?: readonly DeclaredSkill[] }
  const declared: DeclaredSkill = {
    id: SKILL_ID,
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    path: SKILL_PATH,
  }
  if (declaration.requiresTools !== undefined) declared.requiresTools = [...declaration.requiresTools]
  manifest.skills = [declared]
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  if (options.writeFile !== false) {
    const skillFile = join(packageDir, SKILL_PATH)
    mkdirSync(dirname(skillFile), { recursive: true })
    writeFileSync(skillFile, options.body ?? SKILL_CONTENT)
  }
  return packageDir
}

/** Install the fixture into an isolated store and mount the real plugin over it. */
async function mountedWithFixture(
  declaration: SkillDeclaration = {},
  options: { body?: string; config?: Partial<plugin.Config> } = {},
): Promise<{ ctx: Awaited<ReturnType<typeof mountPlugin>>; service: ExtensionService; storeDir: string; installPath: string }> {
  const storeDir = tempDir()
  await stagedInstallFromDirectory({ sourceDir: skillSource(declaration, options), storeDir, allowSourceDirectories: true })
  const ctx = await mountPlugin({ extensionStore: storeDir, ...options.config })
  const record = new ExtensionStore(storeDir).listInstalled().value.find(candidate => candidate.extensionId === EXTENSION_ID)
  assert.ok(record !== undefined, 'the fixture must be installed before activation')
  // SAFETY: the mounted plugin provides the 'modelTools' service; the assertion only
  // names the two methods this test calls, and assert.ok fails when it is absent.
  const service = ctx.get('modelTools') as ExtensionService | undefined
  assert.ok(service !== undefined, 'the plugin must provide the extension service')
  return { ctx, service, storeDir, installPath: record.installPath }
}

/** The registered skill summary, or undefined when it is not advertised. */
async function skillNamed(ctx: Awaited<ReturnType<typeof mountPlugin>>, name: string) {
  const summaries = await ctx.skills.list({ cwd: process.cwd() })
  return summaries.find(summary => summary.name === name)
}

/** The recorded activation state for the fixture. */
function activationState(storeDir: string) {
  return new ExtensionStore(storeDir).readProfileState('default').value
    .find(entry => entry.extensionId === EXTENSION_ID)
}

describe('P2 — extension-manifest skills register with the host', () => {
  it('registers a declared skill with its description and installed body', async () => {
    const { ctx, service, installPath } = await mountedWithFixture()
    await service.enable(EXTENSION_ID)

    const summary = await skillNamed(ctx, SKILL_NAME)
    assert.ok(summary, 'the declared skill must appear in the session skill catalog')
    assert.equal(summary.description, SKILL_DESCRIPTION)
    // The source names where the body came from: an installed extension package.
    assert.equal(summary.source, 'extension')
    // The path is the DECLARED package-relative path resolved against the installed copy.
    assert.equal(summary.path, resolve(installPath, SKILL_PATH))

    const definition = await ctx.skills.get(SKILL_NAME, { cwd: process.cwd() })
    assert.ok(definition, 'the skill body must load by name')
    assert.equal(definition.content, SKILL_CONTENT)
  })

  it('keeps the lifecycle requiresTools gate: a skill for a withheld tool is not registered', async () => {
    const { ctx, service, storeDir } = await mountedWithFixture({ requiresTools: ['not-a-published-tool'] })
    await service.enable(EXTENSION_ID)

    // The activation itself succeeds; the SDK filters the contribution BEFORE the host
    // sees it, so guidance for unavailable tools is never advertised.
    assert.equal(await skillNamed(ctx, SKILL_NAME), undefined)
    assert.equal(activationState(storeDir)?.observedActivation, 'active', 'the extension still activates; only its guidance is withheld')
  })

  it('honours registerSkills:false', async () => {
    const { ctx, service } = await mountedWithFixture({}, { config: { registerSkills: false } })
    await service.enable(EXTENSION_ID)
    assert.equal(await skillNamed(ctx, SKILL_NAME), undefined, 'a deployment that disables skills must get none')
  })

  it('removes the skill again on deactivation', async () => {
    const { ctx, service } = await mountedWithFixture()
    await service.enable(EXTENSION_ID)
    assert.ok(await skillNamed(ctx, SKILL_NAME), 'precondition: the skill is registered while active')

    await service.disable(EXTENSION_ID)
    assert.equal(await skillNamed(ctx, SKILL_NAME), undefined, 'deactivation must withdraw the contribution')
    assert.equal(await ctx.skills.get(SKILL_NAME, { cwd: process.cwd() }), undefined)
  })

  it('fails safely when the body cannot be used: activation still succeeds', async () => {
    // The SDK validates at INSTALL time that every declared skill file exists (see the
    // next test), so a package that never shipped the body cannot be installed at all.
    // The reachable host-side refusal is a body the host will not load: the 512 KiB cap.
    const oversized = 'x'.repeat(513 * 1024)
    const { ctx, service, storeDir } = await mountedWithFixture({}, { body: oversized })
    await service.enable(EXTENSION_ID)

    // A skill the host refuses must never fail the activation that publishes the tools.
    assert.equal(await skillNamed(ctx, SKILL_NAME), undefined, 'an unloadable body cannot be advertised')
    assert.equal(activationState(storeDir)?.observedActivation, 'active', 'the extension itself stays active')
  })

  it('refuses to install a package whose declared skill body is absent', async () => {
    // This is the SDK guard that makes "declared but missing" unreachable through the
    // supported install route: the manifest validation names the file and refuses,
    // rather than installing a package whose skill can never be loaded.
    const storeDir = tempDir()
    await assert.rejects(
      stagedInstallFromDirectory({
        sourceDir: skillSource({}, { writeFile: false }),
        storeDir,
        allowSourceDirectories: true,
      }),
      /does not ship/,
    )
    assert.equal(new ExtensionStore(storeDir).listInstalled().value.length, 0, 'nothing may be recorded as installed')
  })
})
