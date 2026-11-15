/**
 * P1b: the composed description is the model-facing text on EVERY surface.
 *
 * The registry and the MCP catalogue are two doors to the same tool. If they
 * describe it differently, an agent choosing a tool sees one text and an MCP
 * client sees another. These tests activate real fixture extensions and compare
 * the two surfaces; they also pin the extension/recipe composer itself.
 */
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'

import { langDetect } from '@try-works/tool-mode-contracts'
import { stagedInstallFromDirectory } from '@try-works/tool-mode-extension-sdk'

import { createMcpHost } from '../src/mcp/host-binding.ts'
import {
  TOOL_DESCRIPTION_MAX_CHARS,
  contractToolDescription,
  extensionToolDescription,
} from '../src/tool-description.ts'
import { cleanup, mountPlugin, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const FIXTURES = join(process.cwd(), 'packages', 'dsh-tool-mode', 'tests', 'fixtures')
const MODULE_FIXTURE = { dir: 'extensions-service-extension', id: '@try-works/fixture-ext-service', tool: 'fixture_ext_tool' }
const MODULE_DESCRIPTION = 'Echo the supplied token back to prove a call reached this extension. '
  + 'It performs no inference and touches no file or network.'
const SKILL_NAME = 'fixture-skill-guidance'
const SKILL_DESCRIPTION = 'Use when a caller needs a deterministic echo through the fixture tool.'
const SKILL_PATH = './skills/fixture-skill-guidance/SKILL.md'
const RECIPE_FIXTURE = { dir: 'model-runtime-package', id: '@try-works/extension-model-runtime-fixture', tool: 'shape_recognize' }

/** One registry schema as these tests read it. */
interface ToolSchema {
  readonly name: string
  readonly description?: string
}

/** The MCP host surface the plugin provides. */
interface McpHostView {
  listTools(): readonly { readonly name: string; readonly description: string }[]
}

/** The extension service methods these tests drive. */
interface ExtensionService {
  enable(id: string): Promise<{ readonly id: string }>
}

/** A mounted plugin with one fixture extension activated. */
interface MountedFixture {
  readonly ctx: Awaited<ReturnType<typeof mountPlugin>>
  readonly mcpHost: McpHostView
  readonly tools: readonly ToolSchema[]
}

/** A skill declaration this test writes into the copied fixture manifest. */
interface SkillDeclaration {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly path: string
  requiresTools?: readonly string[]
}

/** The copied fixture manifest, narrowed to the one field this test replaces. */
interface FixtureManifest {
  skills?: SkillDeclaration[]
}

/**
 * A copy of the module fixture whose manifest declares one skill.
 *
 * The fixture's tool ID is `fixture-tool` while its caller-facing NAME is
 * `fixture_ext_tool`; requiresTools is written in the ID form real manifests use.
 */
function fixtureWithSkill(requiresTools: readonly string[] | undefined): string {
  const packageDir = join(tempDir(), 'extensions-service-extension')
  cpSync(join(FIXTURES, MODULE_FIXTURE.dir), packageDir, { recursive: true })
  const manifestPath = join(packageDir, 'tool-mode.extension.json')
  // SAFETY: the manifest was just copied from the repository fixture; only `skills` is replaced.
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as FixtureManifest
  const skill: SkillDeclaration = {
    id: 'fixture-skill',
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    path: SKILL_PATH,
  }
  if (requiresTools !== undefined) skill.requiresTools = requiresTools
  manifest.skills = [skill]
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  const skillFile = join(packageDir, SKILL_PATH)
  mkdirSync(dirname(skillFile), { recursive: true })
  writeFileSync(skillFile, '# Fixture skill\n')
  return packageDir
}

/** Install an explicit package directory into an isolated store, mount, and activate it. */
async function mountedPackage(sourceDir: string, extensionId: string): Promise<MountedFixture> {
  const storeDir = tempDir()
  await stagedInstallFromDirectory({ sourceDir, storeDir, allowSourceDirectories: true })
  const ctx = await mountPlugin({ extensionStore: storeDir })
  // SAFETY: the mounted plugin provides the extension service; assert.ok fails when it is absent.
  const service = ctx.get('modelTools') as ExtensionService | undefined
  assert.ok(service !== undefined, 'the plugin must provide the extension service')
  await service.enable(extensionId)
  // SAFETY: the plugin provides its MCP host for the status surface; only listTools is read.
  const mcpHost = ctx.get('model-tools.mcp-host') as McpHostView | undefined
  assert.ok(mcpHost !== undefined, 'the plugin must provide its MCP host')
  return { ctx, mcpHost, tools: ctx.tools.schemas() }
}

/** Install a fixture package from the repository fixtures directory. */
async function mountedFixture(dir: string, extensionId: string): Promise<MountedFixture> {
  return mountedPackage(join(FIXTURES, dir), extensionId)
}

/** The registry schema with this name, asserted present. */
function schemaNamed(tools: readonly ToolSchema[], name: string): ToolSchema {
  const schema = tools.find(candidate => candidate.name === name)
  assert.ok(schema !== undefined, 'missing registered tool ' + name)
  return schema
}

/** The MCP description for this tool, asserted present. */
function mcpDescription(mcpHost: McpHostView, name: string): string {
  const tool = mcpHost.listTools().find(candidate => candidate.name === name)
  assert.ok(tool !== undefined, 'missing MCP tool ' + name)
  return tool.description
}

describe('the extension/recipe composer', () => {
  it('composes from the declared text, uses the declared skill guidance and stays within the budget', () => {
    const text = extensionToolDescription({
      description: 'Echo the supplied token back to prove a call reached this extension.',
      fallback: 'Provided by an extension.',
      skill: { name: 'fixture-guidance', description: 'Use when a caller needs a deterministic echo.' },
    })
    assert.ok(text.startsWith('Echo the supplied token back'), text)
    assert.ok(text.includes('When to use:\n- Use when a caller needs a deterministic echo.'), text)
    assert.ok(text.includes('Skill: see the fixture-guidance skill for the full workflow.'), text)
    assert.ok(text.length <= TOOL_DESCRIPTION_MAX_CHARS)
  })

  it('falls back to the owner sentence when the declaration has no description', () => {
    const text = extensionToolDescription({ fallback: 'Provided by @acme/tool.' })
    assert.equal(text, 'Provided by @acme/tool.')
  })

  it('is absolute: a 2,000-character declaration never exceeds the budget', () => {
    const text = extensionToolDescription({
      description: 'x'.repeat(2000),
      fallback: 'Provided by an extension.',
      skill: { name: 'guidance', description: 'Use when '.repeat(300) },
    })
    assert.ok(text.length <= TOOL_DESCRIPTION_MAX_CHARS, 'length ' + text.length)
    assert.equal(text, extensionToolDescription({
      description: 'x'.repeat(2000),
      fallback: 'Provided by an extension.',
      skill: { name: 'guidance', description: 'Use when '.repeat(300) },
    }))
  })
})

describe('a module extension tool', () => {
  it('has the SAME composed description in the DSH registry and over MCP, within the budget', async () => {
    const { tools, mcpHost } = await mountedFixture(MODULE_FIXTURE.dir, MODULE_FIXTURE.id)
    const schema = schemaNamed(tools, MODULE_FIXTURE.tool)
    const expected = extensionToolDescription({
      description: MODULE_DESCRIPTION,
      fallback: `Provided by ${MODULE_FIXTURE.id}.`,
    })
    assert.equal(schema.description, expected, 'the registry must show the composed text')
    assert.equal(mcpDescription(mcpHost, MODULE_FIXTURE.tool), schema.description, 'MCP must show the SAME text')
    assert.ok((schema.description ?? '').length <= TOOL_DESCRIPTION_MAX_CHARS)
  })
})

describe('a declarative recipe tool', () => {
  it('is composed for the registry and MCP identically, within the budget', async () => {
    const { tools, mcpHost } = await mountedFixture(RECIPE_FIXTURE.dir, RECIPE_FIXTURE.id)
    const schema = schemaNamed(tools, RECIPE_FIXTURE.tool)
    const expected = extensionToolDescription({
      description: 'Recognise simple shapes in typed media through the package\'s own runtime factory.',
      fallback: `Provided by ${RECIPE_FIXTURE.id}.`,
    })
    assert.equal(schema.description, expected, 'the recipe description must be composed')
    assert.equal(mcpDescription(mcpHost, RECIPE_FIXTURE.tool), schema.description, 'MCP must show the SAME text')
    assert.ok((schema.description ?? '').length <= TOOL_DESCRIPTION_MAX_CHARS)
  })
})

describe('the MCP contract advertisement', () => {
  it('is the composed contract description, not the raw contract text', () => {
    const host = createMcpHost({
      serverInfo: { name: 'test', version: '1.0.0' },
      surface: { published: [{ toolName: 'lang_detect', contract: langDetect }] },
    })
    const composed = contractToolDescription(langDetect)
    assert.equal(host.listTools()[0]?.description, composed)
    assert.notEqual(host.listTools()[0]?.description, langDetect.description)
    assert.ok(composed.length <= TOOL_DESCRIPTION_MAX_CHARS)
  })
})

describe('skill guidance resolves manifest tool IDs (P1c)', () => {
  /** The composed text when the fixture skill's guidance applies. */
  const withGuidance = extensionToolDescription({
    description: MODULE_DESCRIPTION,
    fallback: `Provided by ${MODULE_FIXTURE.id}.`,
    skill: { name: SKILL_NAME, description: SKILL_DESCRIPTION },
  })

  it('includes ID-form requiresTools guidance in the registry AND MCP description', async () => {
    const { tools, mcpHost } = await mountedPackage(fixtureWithSkill(['fixture-tool']), MODULE_FIXTURE.id)
    const schema = schemaNamed(tools, MODULE_FIXTURE.tool)
    assert.equal(schema.description, withGuidance, 'the tool ID must resolve to the caller-facing name')
    assert.ok((schema.description ?? '').includes('When to use:\n- ' + SKILL_DESCRIPTION), String(schema.description))
    assert.ok((schema.description ?? '').includes('Skill: see the ' + SKILL_NAME + ' skill'), String(schema.description))
    assert.equal(mcpDescription(mcpHost, MODULE_FIXTURE.tool), schema.description)
    assert.ok((schema.description ?? '').length <= TOOL_DESCRIPTION_MAX_CHARS)
  })

  it('treats ABSENT requiresTools as no restriction', async () => {
    const { tools, mcpHost } = await mountedPackage(fixtureWithSkill(undefined), MODULE_FIXTURE.id)
    const schema = schemaNamed(tools, MODULE_FIXTURE.tool)
    assert.equal(schema.description, withGuidance)
    assert.equal(mcpDescription(mcpHost, MODULE_FIXTURE.tool), schema.description)
  })

  it('treats EMPTY requiresTools as no restriction', async () => {
    const { tools } = await mountedPackage(fixtureWithSkill([]), MODULE_FIXTURE.id)
    assert.equal(schemaNamed(tools, MODULE_FIXTURE.tool).description, withGuidance)
  })

  it('handles a multi-tool requirement: guidance applies to each listed tool only', async () => {
    const listed = await mountedPackage(fixtureWithSkill(['fixture-tool', 'another-tool-id']), MODULE_FIXTURE.id)
    assert.equal(schemaNamed(listed.tools, MODULE_FIXTURE.tool).description, withGuidance)
    const unrelated = await mountedPackage(fixtureWithSkill(['another-tool-id']), MODULE_FIXTURE.id)
    assert.equal(
      schemaNamed(unrelated.tools, MODULE_FIXTURE.tool).description,
      extensionToolDescription({ description: MODULE_DESCRIPTION, fallback: `Provided by ${MODULE_FIXTURE.id}.` }),
      'a skill that names only other tools must not add its guidance',
    )
  })
})
