/**
 * The recipe is DATA the host lane parses, so the test parses it with the SAME parser the host
 * uses. A hand-rolled check here would pass on JSON the host refuses.
 *
 * The two halves that must agree are the recipe and the manifest: the recipe names the asset set
 * and the tool schemas; the manifest names the tool and the implementation. Nothing in the
 * repository compares them except this test, and a mismatch would install cleanly and register a
 * tool whose schema files were never declared.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * The parser the HOST LANE uses, resolved by its published package name (docs/runtime/PHASE2.md).
 *
 * Imported this way rather than from a sibling source path so the test exercises the same
 * resolution an installed deployment does: if this package cannot be imported by name, the
 * recipe format has no consumer and the test should fail.
 */
import {
  parseModelRuntimeRecipe,
  type ModelRuntimeRecipeIssue,
} from '@try-works/tool-mode-runtime-recipes'
import { validateManifest, type ExtensionManifest } from '@try-works/tool-mode-extension-sdk'

const DIR = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const RECIPE_PATH = join(DIR, 'recipes', 'shape-recognize.json')

/** The shipped recipe as text, so mutations are textual and stay obvious. */
function recipeText(): string {
  return readFileSync(RECIPE_PATH, 'utf8')
}

/** The package's validated manifest, for the identity comparisons. */
function declaredManifest(): ExtensionManifest {
  const pkg: unknown = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'))
  // SAFETY: this package's own package.json supplies the name and version validateManifest
  // compares against the manifest; a malformed file fails that comparison.
  const identity = pkg as { name: string; version: string }
  const raw: unknown = JSON.parse(readFileSync(join(DIR, 'tool-mode.extension.json'), 'utf8'))
  return validateManifest(raw, { packageName: identity.name, packageVersion: identity.version, packageDir: DIR })
}

/** Render parser issues for a failure message. */
function issueText(issues: readonly ModelRuntimeRecipeIssue[]): string {
  return issues.map(issue => (issue.path === '' ? issue.message : issue.path + ': ' + issue.message)).join('; ')
}

/** Replace one anchor in the shipped recipe text, returning the mutated JSON text. */
function mutatedRecipeText(anchor: string, replacement: string): string {
  const text = recipeText()
  assert.ok(text.includes(anchor), 'the recipe fixture no longer contains ' + JSON.stringify(anchor))
  return text.replace(anchor, replacement)
}

describe('recipes/shape-recognize.json — model-runtime recipe', () => {
  it('parses through the parser the host lane uses', () => {
    const shipped: unknown = JSON.parse(recipeText())
    const result = parseModelRuntimeRecipe(shipped)
    assert.equal(result.ok, true, result.ok ? '' : issueText(result.issues))
  })

  it('names the LiteRT factory, the shapes asset and the points processor', () => {
    const shipped: unknown = JSON.parse(recipeText())
    const result = parseModelRuntimeRecipe(shipped)
    if (!result.ok) {
      assert.fail(issueText(result.issues))
    }
    const recipe = result.recipe
    assert.equal(recipe.kind, 'model-runtime')
    assert.equal(recipe.schemaVersion, 1)
    assert.equal(recipe.provider.package, '@try-works/tool-mode-runtime-litert')
    assert.equal(recipe.provider.export, 'createProviderFromRecipe')
    assert.deepEqual(recipe.provider.accelerators, ['cpu'])
    assert.equal(recipe.model.assetSet, 'shapes-litert')
    assert.equal(recipe.model.fileName, 'shapes.tflite')
    assert.equal(recipe.model.format, 'tflite')
    assert.equal(recipe.processor.id, 'shapes/points-v1')
    assert.match(recipe.processor.id, /^[a-z0-9]+(?:\/[a-z0-9-]+)*$/)
  })

  it('sets positive, bounded limits', () => {
    const shipped: unknown = JSON.parse(recipeText())
    const result = parseModelRuntimeRecipe(shipped)
    if (!result.ok) {
      assert.fail(issueText(result.issues))
    }
    const { limits } = result.recipe
    assert.ok(Number.isInteger(limits.maxInputBytes) && limits.maxInputBytes > 0)
    assert.ok(Number.isInteger(limits.timeoutMs) && limits.timeoutMs > 0)
  })

  it('agrees with the manifest on the asset set and the tool name', () => {
    const shipped: unknown = JSON.parse(recipeText())
    const result = parseModelRuntimeRecipe(shipped)
    if (!result.ok) {
      assert.fail(issueText(result.issues))
    }
    const manifest = declaredManifest()
    assert.equal(result.recipe.model.assetSet, manifest.models[0]?.assetSet)
    assert.equal(result.recipe.tool.name, manifest.tools[0]?.name)
  })

  it('names schema files that exist inside the package', () => {
    const shipped: unknown = JSON.parse(recipeText())
    const result = parseModelRuntimeRecipe(shipped)
    if (!result.ok) {
      assert.fail(issueText(result.issues))
    }
    for (const relative of [result.recipe.tool.inputSchema, result.recipe.tool.outputSchema]) {
      assert.ok(relative.startsWith('./'), 'package-relative schema path: ' + relative)
      const path = join(DIR, relative)
      assert.ok(existsSync(path), 'missing schema ' + relative)
      assert.doesNotThrow(() => JSON.parse(readFileSync(path, 'utf8')))
    }
  })

  it('pins the model class order and the input contract in the schemas', () => {
    /**
     * The enum order is a CONTRACT with the classifier head, not decoration: index i in the
     * logits is classes[i]. It is easy to "tidy" this list alphabetically and silently relabel
     * every prediction, so the order is asserted here and recorded in the lock's qualification.
     */
    const outputRaw: unknown = JSON.parse(readFileSync(join(DIR, 'schemas', 'shape.output.json'), 'utf8'))
    // SAFETY: this package's own output schema; the enum and required fields are asserted below.
    const output = outputRaw as {
      properties: { [field: string]: { readonly enum?: readonly string[] } }
      required: readonly string[]
    }
    assert.deepEqual(output.properties['shape']?.enum, [
      'none',
      'line',
      'arrow',
      'rectangle',
      'ellipse',
      'triangle',
      'diamond',
      'pentagon',
      'hexagon',
      'star',
      'heart',
      'cloud',
      'scribble',
    ])
    assert.deepEqual(output.required, ['shape', 'confidence', 'candidates'])

    const inputRaw: unknown = JSON.parse(readFileSync(join(DIR, 'schemas', 'shape.input.json'), 'utf8'))
    // SAFETY: this package's own input schema; only the closed-object and required fields are read.
    const input = inputRaw as { additionalProperties: boolean; required: readonly string[] }
    assert.equal(input.additionalProperties, false, 'unknown input keys must be refused')
    assert.deepEqual(input.required, ['points'])
  })

  it('REFUSES a mutated recipe that escapes the package', () => {
    const mutated: unknown = JSON.parse(mutatedRecipeText('"fileName": "shapes.tflite"', '"fileName": "../shapes.tflite"'))
    const result = parseModelRuntimeRecipe(mutated)
    if (result.ok) {
      assert.fail('the parser must refuse a fileName that is not bare')
    }
    assert.match(issueText(result.issues), /fileName/i)
  })

  it('REFUSES an unknown top-level key', () => {
    const mutated: unknown = JSON.parse(mutatedRecipeText('"kind": "model-runtime"', '"kind": "model-runtime", "unexpected": true'))
    const result = parseModelRuntimeRecipe(mutated)
    if (result.ok) {
      assert.fail('the parser must refuse a key the format does not implement')
    }
    assert.match(issueText(result.issues), /unexpected/i)
  })
})
