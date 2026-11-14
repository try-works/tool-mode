/**
 * Shared fixtures and helpers for the runtime-recipes tests.
 *
 * The raw recipe below is the Phase 2 example verbatim (docs/runtime/PHASE2.md). Every
 * test starts from it and changes exactly ONE thing, so a failure names the rule that was
 * broken instead of a document that drifted.
 *
 * Fixture provider packages are written into a fresh temp directory per test, because a
 * resolvable package needs a `node_modules` tree and a committed `node_modules` would not
 * survive the repository's ignore rules. Nothing here touches the real installation.
 *
 * @module tests/support
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseModelRuntimeRecipe, type ModelRuntimeRecipe } from '../src/index.ts'

/** A raw recipe document as it would arrive from `JSON.parse`. */
export interface RawRecipeDocument {
  readonly [key: string]: unknown
}

/** Per-section overrides, merged into the Phase 2 example. */
export interface RecipeOverrides {
  readonly topLevel?: Readonly<Record<string, unknown>>
  readonly provider?: Readonly<Record<string, unknown>>
  readonly model?: Readonly<Record<string, unknown>>
  readonly processor?: Readonly<Record<string, unknown>>
  readonly limits?: Readonly<Record<string, unknown>>
  readonly tool?: Readonly<Record<string, unknown>>
}

/**
 * Build the Phase 2 example recipe, with optional per-section overrides.
 *
 * @param overrides - sections to merge over the example
 * @returns a fresh document, safe to mutate in a test
 */
export function validRecipeDocument(overrides: RecipeOverrides = {}): RawRecipeDocument {
  const { topLevel = {}, provider = {}, model = {}, processor = {}, limits = {}, tool = {} } = overrides
  return {
    kind: 'model-runtime',
    schemaVersion: 1,
    provider: {
      package: '@try-works/tool-mode-runtime-litert',
      export: 'createProviderFromRecipe',
      accelerators: ['cpu'],
      ...provider,
    },
    model: {
      assetSet: 'shapes-litert',
      fileName: 'shapes.tflite',
      format: 'tflite',
      ...model,
    },
    processor: { id: 'shapes/points-v1', ...processor },
    limits: { maxInputBytes: 4_194_304, timeoutMs: 120_000, ...limits },
    tool: {
      name: 'shape_recognize',
      description: 'Recognize geometric shapes in an image.',
      inputSchema: './schemas/shape.input.json',
      outputSchema: './schemas/shape.output.json',
      ...tool,
    },
    ...topLevel,
  }
}

/**
 * Parse a document that is expected to be valid.
 *
 * @param raw - the document
 * @returns the parsed recipe
 */
export function mustParse(raw: unknown): ModelRuntimeRecipe {
  const result = parseModelRuntimeRecipe(raw)
  if (!result.ok) {
    assert.fail(`expected the recipe to parse, but it was refused: ${JSON.stringify(result.issues)}`)
  }
  return result.recipe
}

/**
 * Remove one nested field, so a test can model an ABSENT field rather than an empty one.
 *
 * @param document - the source document
 * @param section - the section key, e.g. `provider`
 * @param key - the field to remove
 * @returns a fresh document without that field
 */
export function removeKey(document: RawRecipeDocument, section: string, key: string): RawRecipeDocument {
  const clone = structuredClone(document)
  const target = clone[section]
  if (typeof target !== 'object' || target === null) {
    throw new Error(`the fixture section ${section} is not an object`)
  }
  // SAFETY: the clone is a JSON document built by validRecipeDocument, so every section is a
  // plain object; the check above establishes the same invariant at runtime.
  delete (target as Record<string, unknown>)[key]
  return clone
}

/**
 * Remove one top-level field.
 *
 * @param document - the source document
 * @param key - the field to remove
 * @returns a fresh document without that field
 */
export function removeTopLevelKey(document: RawRecipeDocument, key: string): RawRecipeDocument {
  // Spreading gives a mutable index signature; the fixture type only permits reading.
  const clone: Record<string, unknown> = { ...structuredClone(document) }
  delete clone[key]
  return clone
}

/**
 * Run a test body with a fresh temp directory that is always removed again.
 *
 * @param use - the body
 * @returns whatever the body returns
 */
export async function withTempDir<A>(use: (dir: string) => Promise<A>): Promise<A> {
  const dir = await mkdtemp(join(tmpdir(), 'tool-mode-runtime-recipes-'))
  try {
    return await use(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** A provider module that returns a marker identifying the extension that shipped it. */
export function fixtureProviderSource(marker: string): string {
  return [
    'export function createProviderFromRecipe(recipe, assets) {',
    `  return { marker: ${JSON.stringify(marker)}, assetIds: assets.assetIds, assetSet: recipe.model.assetSet }`,
    '}',
    '',
  ].join('\n')
}

/**
 * Install a fixture package into an extension-like directory.
 *
 * @param options - the extension root and the package to install
 * @returns the extension root, ready to pass to `loadProviderFactory`
 */
export async function installFixturePackage(options: {
  readonly root: string
  readonly name: string
  readonly source: string
  readonly version?: string
}): Promise<string> {
  const packageDir = join(options.root, 'node_modules', options.name)
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    join(options.root, 'package.json'),
    JSON.stringify({ name: 'fixture-extension', version: '0.1.0', type: 'module' }, null, 2),
    'utf8',
  )
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify(
      { name: options.name, version: options.version ?? '0.1.0', type: 'module', main: 'index.js' },
      null,
      2,
    ),
    'utf8',
  )
  await writeFile(join(packageDir, 'index.js'), options.source, 'utf8')
  return options.root
}
