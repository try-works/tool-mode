/**
 * The HOST LANE for a `model-runtime` recipe (docs/runtime/PHASE2.md).
 *
 * WHAT IS PROVEN HERE: a declarative package with no extension entry can contribute a
 * working tool from JSON alone — the recipe parses under the rules, the provider factory is
 * imported FROM THE EXTENSION PACKAGE DIRECTORY, the tool advertises the recipe's input
 * schema, the full schema is enforced at call time, the provider is loaded once and invoked
 * with the package's implementation id, and the result is checked against the recipe's
 * output schema.
 *
 * WHAT IS NOT PROVEN HERE: that a model runs. The fixture's factory is deterministic. Real
 * inference is the Phase 2 gate's business, on prepared assets.
 *
 * Requirement links: PHASE2 host lane, AT-25 (host declares no engine), ARCH-02.
 */

import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { InvocationContextV1 } from '@try-works/tool-mode-extension-sdk'

import {
  importProviderFactory,
  isModelRuntimeRecipe,
  parseModelRuntimeRecipe,
  readModelRuntimeSchema,
} from '../src/model-runtime-recipe.ts'
import { createModelRuntimeTool } from '../src/model-runtime-lane.ts'
import { cleanup, tempDir } from './helpers.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/model-runtime-package', import.meta.url))
const RECIPE = JSON.parse(readFileSync(join(FIXTURE, 'recipes', 'shapes.json'), 'utf8')) as Record<string, unknown>

/** The verified-asset handle the host hands a provider; no filesystem is touched. */
function assets(ids: readonly string[] = ['shapes-litert']) {
  return {
    assetIds: ids,
    get: (assetId: string) =>
      ids.includes(assetId) ? { path: `/prepared/${assetId}`, digest: `sha256:${assetId}` } : undefined,
  }
}

/** A host-shaped invocation context. */
function invocation(signal: AbortSignal = new AbortController().signal): InvocationContextV1 {
  return {
    invocationId: 'inv-fixture',
    signal,
    limits: { maxInputBytes: 1_024, maxAudioSeconds: 0, maxResultBytes: 4_096 },
    resolvePath: candidate => candidate,
  }
}

/** A shallow copy of the fixture recipe with one field replaced, as a recipe author might write it. */
function recipeWith(mutate: (draft: Record<string, any>) => void): Record<string, unknown> {
  const draft = JSON.parse(JSON.stringify(RECIPE)) as Record<string, any>
  mutate(draft)
  return draft
}

/** Copy the fixture to a throwaway directory and overwrite one file. */
function fixtureVariant(relativePath: string, content: string): string {
  const dir = join(tempDir(), 'package')
  cpSync(FIXTURE, dir, { recursive: true })
  writeFileSync(join(dir, relativePath), content)
  return dir
}

describe('parseModelRuntimeRecipe — the rules are the trust boundary', () => {
  it('accepts the fixture recipe and exposes what the host needs', () => {
    const parsed = parseModelRuntimeRecipe(RECIPE)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.recipe.model.assetSet, 'shapes-litert')
    assert.equal(parsed.recipe.model.fileName, 'shapes.tflite')
    assert.equal(parsed.recipe.provider.export, 'createProviderFromRecipe')
    assert.equal(parsed.recipe.tool.name, 'shape_recognize')
  })

  it('reports a harness recipe as not-model-runtime so the caller keeps the legacy path', () => {
    assert.equal(isModelRuntimeRecipe({ id: 'text-title', tool: { name: 'text_title' } }), false)
    const parsed = parseModelRuntimeRecipe({ id: 'text-title' })
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.code, 'not-model-runtime')
  })

  it('refuses an unknown top-level key, naming it', () => {
    const parsed = parseModelRuntimeRecipe(recipeWith(draft => { draft['surprise'] = true }))
    assert.equal(parsed.ok, false)
    if (!parsed.ok) {
      assert.equal(parsed.code, 'unknown-key')
      assert.match(parsed.detail, /surprise/)
    }
  })

  it('refuses an unknown key INSIDE a section', () => {
    const parsed = parseModelRuntimeRecipe(recipeWith(draft => { draft['provider']['fallback'] = 'cpu' }))
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.code, 'unknown-key')
  })

  it('refuses a schema version other than 1', () => {
    const parsed = parseModelRuntimeRecipe(recipeWith(draft => { draft['schemaVersion'] = 2 }))
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.code, 'bad-schema-version')
  })

  it('refuses empty provider coordinates', () => {
    const parsed = parseModelRuntimeRecipe(recipeWith(draft => { draft['provider']['package'] = '' }))
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.code, 'bad-provider')
  })

  it('refuses a fileName that is not a bare file name', () => {
    for (const fileName of ['../shapes.tflite', 'nested/shapes.tflite', 'nested\\shapes.tflite']) {
      const parsed = parseModelRuntimeRecipe(recipeWith(draft => { draft['model']['fileName'] = fileName }))
      assert.equal(parsed.ok, false, `${fileName} must be refused`)
      if (!parsed.ok) assert.equal(parsed.code, 'bad-model')
    }
  })

  it('refuses a processor id outside the documented shape', () => {
    const parsed = parseModelRuntimeRecipe(recipeWith(draft => { draft['processor']['id'] = 'Shapes/Points V1' }))
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.code, 'bad-processor')
  })

  it('refuses non-positive limits', () => {
    for (const key of ['maxInputBytes', 'timeoutMs']) {
      const parsed = parseModelRuntimeRecipe(recipeWith(draft => { draft['limits'][key] = 0 }))
      assert.equal(parsed.ok, false, `${key} = 0 must be refused`)
      if (!parsed.ok) assert.equal(parsed.code, 'bad-limits')
    }
  })

  it('refuses a tool schema path that is not package-relative or escapes the package', () => {
    for (const candidate of ['schemas/shape.input.json', '../outside.json', '/etc/passwd', './../x.json']) {
      const parsed = parseModelRuntimeRecipe(recipeWith(draft => { draft['tool']['inputSchema'] = candidate }))
      assert.equal(parsed.ok, false, `${candidate} must be refused`)
      if (!parsed.ok) assert.equal(parsed.code, 'bad-tool')
    }
  })
})

describe('readModelRuntimeSchema — schema files stay inside the package', () => {
  it('reads the fixture input schema', () => {
    const read = readModelRuntimeSchema(FIXTURE, './schemas/shape.input.json')
    assert.equal(read.ok, true)
    if (read.ok) assert.equal(read.schema['type'], 'object')
  })

  it('refuses a missing schema file by name', () => {
    const read = readModelRuntimeSchema(FIXTURE, './schemas/absent.json')
    assert.equal(read.ok, false)
    if (!read.ok) {
      assert.equal(read.code, 'schema-unreadable')
      assert.match(read.detail, /absent\.json/)
    }
  })

  it('refuses an escape even when the file exists', () => {
    const read = readModelRuntimeSchema(FIXTURE, './../package.json')
    assert.equal(read.ok, false)
    if (!read.ok) assert.equal(read.code, 'bad-tool')
  })
})

describe('importProviderFactory — resolved from the EXTENSION directory', () => {
  it('imports the factory the recipe names from the package that ships it', async () => {
    const parsed = parseModelRuntimeRecipe(RECIPE)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const imported = await importProviderFactory({ installPath: FIXTURE, recipe: parsed.recipe })
    assert.equal(imported.ok, true)
    if (imported.ok) assert.equal(typeof imported.factory, 'function')
  })

  it('names the anchor it resolved from when the package cannot be found', async () => {
    const parsed = parseModelRuntimeRecipe(recipeWith(draft => { draft['provider']['package'] = './runtime/absent.mjs' }))
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const imported = await importProviderFactory({ installPath: FIXTURE, recipe: parsed.recipe })
    assert.equal(imported.ok, false)
    if (!imported.ok) {
      assert.equal(imported.code, 'factory-unresolved')
      assert.match(imported.detail, /absent\.mjs/)
      assert.match(imported.detail, /extension package/)
    }
  })

  it('refuses an export that is not a factory function', async () => {
    const parsed = parseModelRuntimeRecipe(recipeWith(draft => { draft['provider']['export'] = 'notAFactory' }))
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const imported = await importProviderFactory({ installPath: FIXTURE, recipe: parsed.recipe })
    assert.equal(imported.ok, false)
    if (!imported.ok) assert.equal(imported.code, 'factory-not-function')
  })
})

describe('createModelRuntimeTool — from recipe to a callable tool', () => {
  it('advertises the recipe tool and projects its input schema', async () => {
    const parsed = parseModelRuntimeRecipe(RECIPE)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const created = await createModelRuntimeTool({
      extensionId: '@try-works/extension-model-runtime-fixture',
      implementationId: 'shapes',
      installPath: FIXTURE,
      recipe: parsed.recipe,
      assets: () => assets(),
      invocationContext: () => invocation(),
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    assert.equal(created.tool.name, 'shape_recognize')
    assert.match(created.tool.description, /Recognise simple shapes/)
    const parameters = created.tool.parameters as Record<string, unknown>
    assert.deepEqual(Object.keys(parameters).sort(), ['shape', 'text'])
    await created.tool.dispose()
  })

  it('loads the provider ONCE, invokes with the implementation id, and returns the payload', async () => {
    const parsed = parseModelRuntimeRecipe(RECIPE)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const created = await createModelRuntimeTool({
      extensionId: '@try-works/extension-model-runtime-fixture',
      implementationId: 'shapes',
      installPath: FIXTURE,
      recipe: parsed.recipe,
      assets: () => assets(),
      invocationContext: () => invocation(),
    })
    assert.equal(created.ok, true)
    if (!created.ok) return

    const first = await created.tool.execute({ text: 'a circle' })
    const second = await created.tool.execute({ text: 'a circle', shape: 'square' })
    assert.deepEqual(first, { shapes: ['circle'], score: 0.91 })
    assert.deepEqual(second, { shapes: ['circle'], score: 0.5 })
    await created.tool.dispose()
  })

  it('refuses an input that violates the recipe schema before the provider runs', async () => {
    const parsed = parseModelRuntimeRecipe(RECIPE)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const created = await createModelRuntimeTool({
      extensionId: '@try-works/extension-model-runtime-fixture',
      implementationId: 'shapes',
      installPath: FIXTURE,
      recipe: parsed.recipe,
      assets: () => assets(),
      invocationContext: () => invocation(),
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    await assert.rejects(created.tool.execute({ text: '' }), /shape_recognize input/)
    await assert.rejects(created.tool.execute({ text: 'ok', shape: 'hexagon' }), /shape_recognize input/)
    await created.tool.dispose()
  })

  it('refuses an output that violates the recipe output schema', async () => {
    const dir = fixtureVariant('runtime/fake-provider.mjs', `export function createProviderFromRecipe() {
  return {
    async inspect() { return { readiness: 'prepared-cold', features: [], missing: [] } },
    async load() {},
    async invoke() { return { shapes: 'not-an-array', score: 1 } },
    async unload() {},
    async dispose() {},
  }
}
`)
    const parsed = parseModelRuntimeRecipe(RECIPE)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const created = await createModelRuntimeTool({
      extensionId: '@try-works/extension-model-runtime-fixture',
      implementationId: 'shapes',
      installPath: dir,
      recipe: parsed.recipe,
      assets: () => assets(),
      invocationContext: () => invocation(),
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    await assert.rejects(created.tool.execute({ text: 'a circle' }), /shape_recognize output/)
    await created.tool.dispose()
  })

  it('creates nothing when the factory cannot be imported', async () => {
    const parsed = parseModelRuntimeRecipe(recipeWith(draft => { draft['provider']['package'] = './runtime/absent.mjs' }))
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const created = await createModelRuntimeTool({
      extensionId: '@try-works/extension-model-runtime-fixture',
      implementationId: 'shapes',
      installPath: FIXTURE,
      recipe: parsed.recipe,
      assets: () => assets(),
      invocationContext: () => invocation(),
    })
    assert.equal(created.ok, false)
    if (!created.ok) assert.equal(created.code, 'factory-unresolved')
  })

  it('dispose is idempotent', async () => {
    const parsed = parseModelRuntimeRecipe(RECIPE)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const created = await createModelRuntimeTool({
      extensionId: '@try-works/extension-model-runtime-fixture',
      implementationId: 'shapes',
      installPath: FIXTURE,
      recipe: parsed.recipe,
      assets: () => assets(),
      invocationContext: () => invocation(),
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    await created.tool.execute({ text: 'a circle' })
    await created.tool.dispose()
    await created.tool.dispose()
  })
})

// The temp directories this suite creates are removed with the rest of the harness.
process.once('exit', () => { void cleanup() })
