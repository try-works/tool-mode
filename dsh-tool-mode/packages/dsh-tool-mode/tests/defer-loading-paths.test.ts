/**
 * P3b: deferral reaches the DECLARATIVE and MODEL-RUNTIME recipe registration paths.
 *
 * The verifier's P3 gap 1: the two recipe lanes in src/index.ts construct their own
 * `defineTool` calls, so the switch in the registrar/bindings never applied to them. These
 * fixture tests install a copied extension package from the repository fixtures, activate it
 * through the real extension service, and assert the REGISTERED schema carries
 * `deferLoading: true` when the switch is on and omits it when off. The tool name is rewritten
 * to one of the explicit ids so the test does not depend on a schema threshold.
 *
 * GAP 3 evidence: `ctx.tools.schemas()` is the model-facing schema surface the harness feeds
 * to providers. The DeepSeek serializer itself belongs to DSH (@deepseek-ai/dsh-llm-deepseek);
 * that package is NOT resolvable from this repo (checked: node_modules/@deepseek-ai/
 * dsh-llm-deepseek is absent), so this file proves the flag survives to schemas() and the
 * serializer emission (defer_loading on/off) is reported as DSH-owned.
 */

import assert from 'node:assert/strict'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import type { LlmProvider } from '@try-works/tool-mode-recipes'
import { stagedInstallFromDirectory } from '@try-works/tool-mode-extension-sdk'

import { cleanup, mountPlugin, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const FIXTURES = join(process.cwd(), 'packages', 'dsh-tool-mode', 'tests', 'fixtures')
const DECLARATIVE_PACKAGE = join(process.cwd(), 'packages', 'extension-declarative-recipes')
const DECLARATIVE_ID = '@try-works/extension-declarative-recipes'
const MODEL_RUNTIME_FIXTURE = join(FIXTURES, 'model-runtime-package')
const MODEL_RUNTIME_ID = '@try-works/extension-model-runtime-fixture'
const DEFERRED_TOOL_NAME = 'multimodal_embed'

interface SchemaWithDeferral {
  readonly name: string
  readonly description?: string
  readonly parameters?: unknown
  readonly deferLoading?: true
}

interface ExtensionService {
  enable(id: string): Promise<void>
}

/** A provider double: registration only needs an LlmProvider, no model is called. */
function stubProvider(): LlmProvider {
  return {
    id: 'stub-provider',
    generation: 1,
    destination: 'local',
    capabilities: () => ({ images: false, maxOutputTokens: 4096 }),
    async complete() {
      return { kind: 'text', text: '{}', usage: { inputTokens: 1, outputTokens: 1 } }
    },
  }
}

/** Copy a package/fixture directory into a throwaway directory. */
function copyPackage(sourceDir: string, label: string): string {
  const destination = join(tempDir(), label)
  cpSync(sourceDir, destination, { recursive: true })
  return destination
}

/** Rewrite the tool name in one copied recipe (the explicit-id selection the tests need). */
function renameRecipeTool(packageDir: string, recipeFile: string, toolName: string): void {
  const recipePath = join(packageDir, 'recipes', recipeFile)
  // SAFETY: the file was just copied from the repository fixture and is valid recipe JSON.
  const recipe = JSON.parse(readFileSync(recipePath, 'utf8')) as { tool: { name: string } }
  recipe.tool.name = toolName
  writeFileSync(recipePath, JSON.stringify(recipe, null, 2))
}

/** Install a copied package from a directory, mount, and activate it. */
async function mountActivated(
  sourceDir: string,
  extensionId: string,
  options: { readonly deferHeavySchemas?: boolean; readonly harnessProvider?: LlmProvider },
) {
  const storeDir = tempDir()
  await stagedInstallFromDirectory({ sourceDir, storeDir, allowSourceDirectories: true })
  const pluginConfig: Parameters<typeof mountPlugin>[0] = { extensionStore: storeDir }
  if (options.deferHeavySchemas === true) pluginConfig.deferHeavySchemas = true
  if (options.harnessProvider !== undefined) pluginConfig.harnessProvider = options.harnessProvider
  const ctx = await mountPlugin(pluginConfig)
  // SAFETY: the mounted plugin provides the extension service; assert.ok fails when absent.
  const service = ctx.get('modelTools') as ExtensionService | undefined
  assert.ok(service !== undefined, 'the plugin must provide the extension service')
  await service.enable(extensionId)
  return ctx.tools.schemas()
}

function schemaNamed(schemas: readonly SchemaWithDeferral[], name: string): SchemaWithDeferral {
  const schema = schemas.find(candidate => candidate.name === name)
  assert.ok(schema !== undefined, 'missing registered tool ' + name + '; saw: ' + schemas.map(entry => entry.name).join(', '))
  return schema
}

describe('the DECLARATIVE recipe lane carries the deferral decision', () => {
  it('defers the selected recipe tool when enabled and leaves the other recipe eager', async () => {
    const packageDir = copyPackage(DECLARATIVE_PACKAGE, 'declarative-deferred')
    renameRecipeTool(packageDir, 'text-title.json', DEFERRED_TOOL_NAME)
    const schemas = await mountActivated(packageDir, DECLARATIVE_ID, { deferHeavySchemas: true, harnessProvider: stubProvider() })
    const deferred = schemaNamed(schemas, DEFERRED_TOOL_NAME)
    assert.equal(deferred.deferLoading, true)
    // The untouched second recipe is below the threshold and is not explicit: it stays eager.
    const eager = schemaNamed(schemas, 'describe_image')
    assert.equal(eager.deferLoading, undefined)
    assert.ok((deferred.description ?? '').length > 0, 'the deferred schema still carries a description')
    assert.ok(deferred.parameters !== undefined, 'the deferred schema still carries parameters')
  })

  it('omits the marker on the same recipe when the switch is off', async () => {
    const packageDir = copyPackage(DECLARATIVE_PACKAGE, 'declarative-eager')
    renameRecipeTool(packageDir, 'text-title.json', DEFERRED_TOOL_NAME)
    const schemas = await mountActivated(packageDir, DECLARATIVE_ID, { harnessProvider: stubProvider() })
    assert.equal(schemaNamed(schemas, DEFERRED_TOOL_NAME).deferLoading, undefined)
  })
})

describe('the MODEL-RUNTIME recipe lane carries the deferral decision', () => {
  it('defers the selected lane tool when enabled', async () => {
    const packageDir = copyPackage(MODEL_RUNTIME_FIXTURE, 'model-runtime-deferred')
    renameRecipeTool(packageDir, 'shapes.json', DEFERRED_TOOL_NAME)
    const schemas = await mountActivated(packageDir, MODEL_RUNTIME_ID, { deferHeavySchemas: true })
    const deferred = schemaNamed(schemas, DEFERRED_TOOL_NAME)
    assert.equal(deferred.deferLoading, true)
    assert.ok((deferred.description ?? '').length > 0)
    assert.ok(deferred.parameters !== undefined)
  })

  it('omits the marker on the same lane tool when the switch is off', async () => {
    const packageDir = copyPackage(MODEL_RUNTIME_FIXTURE, 'model-runtime-eager')
    renameRecipeTool(packageDir, 'shapes.json', DEFERRED_TOOL_NAME)
    const schemas = await mountActivated(packageDir, MODEL_RUNTIME_ID, {})
    assert.equal(schemaNamed(schemas, DEFERRED_TOOL_NAME).deferLoading, undefined)
  })
})
