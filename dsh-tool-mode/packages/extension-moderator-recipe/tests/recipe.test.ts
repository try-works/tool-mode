/**
 * The recipe is DATA the host lane parses, so the test parses it with the SAME parser the host
 * uses. A hand-rolled check here would pass on JSON the host refuses.
 *
 * The manifest and the recipe must agree on the asset set and the tool name; the recipe and the
 * lock must agree on the artifact; and the schemas are the contract the host lane asserts, so the
 * shapes below are pinned field by field.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseModelRuntimeRecipe,
  type ModelRuntimeRecipeIssue,
} from '@try-works/tool-mode-runtime-recipes'
import { validateManifest, type ExtensionManifest } from '@try-works/tool-mode-extension-sdk'

const DIR = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const RECIPE_PATH = join(DIR, 'recipes', 'classify-nsfw.json')

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

describe('recipes/classify-nsfw.json — model-runtime recipe', () => {
  it('parses through the parser the host lane uses', () => {
    const shipped: unknown = JSON.parse(recipeText())
    const result = parseModelRuntimeRecipe(shipped)
    assert.equal(result.ok, true, result.ok ? '' : issueText(result.issues))
  })

  it('names the LiteRT factory, the moderator asset and the crops processor', () => {
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
    assert.equal(recipe.model.assetSet, 'moderator-litert')
    assert.equal(recipe.model.fileName, 'moderator.tflite')
    assert.equal(recipe.model.format, 'tflite')
    assert.equal(recipe.processor.id, 'moderator/crops-v1')
    assert.match(recipe.processor.id, /^[a-z0-9]+(?:\/[a-z0-9-]+)*$/)
  })

  it('sets positive, bounded limits', () => {
    const shipped: unknown = JSON.parse(recipeText())
    const result = parseModelRuntimeRecipe(shipped)
    if (!result.ok) {
      assert.fail(issueText(result.issues))
    }
    const { limits } = result.recipe
    assert.equal(limits.maxInputBytes, 4194304)
    assert.equal(limits.timeoutMs, 120000)
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

  it('names a file the lock actually pins', () => {
    const shipped: unknown = JSON.parse(recipeText())
    const result = parseModelRuntimeRecipe(shipped)
    if (!result.ok) {
      assert.fail(issueText(result.issues))
    }
    const lockRaw: unknown = JSON.parse(readFileSync(join(DIR, 'models.lock.json'), 'utf8'))
    // SAFETY: this package's own lock file; only the declared asset set's file names are read,
    // and the lock test asserts their digests and sizes.
    const lock = lockRaw as { assetSets: Record<string, { assets: readonly { fileName: string }[] }> }
    const pinned = lock.assetSets[result.recipe.model.assetSet]?.assets ?? []
    assert.ok(
      pinned.some(asset => asset.fileName === result.recipe.model.fileName),
      'the recipe names ' + result.recipe.model.fileName + ' but the lock pins ' + pinned.map(asset => asset.fileName).join(', '),
    )
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

  it('pins the PNG-only descriptor in the input schema', () => {
    const inputRaw: unknown = JSON.parse(readFileSync(join(DIR, 'schemas', 'classify-nsfw.input.json'), 'utf8'))
    // SAFETY: this package's own input schema; the closed-object, required and property fields
    // are asserted below.
    const input = inputRaw as {
      additionalProperties: boolean
      required: readonly string[]
      properties: {
        image_path: { readonly type: string; readonly maxLength?: number }
        quality: { readonly enum: readonly string[]; readonly default?: string }
        threshold: { readonly minimum?: number; readonly maximum?: number; readonly default?: number }
        policy: { readonly enum: readonly string[]; readonly default?: string }
      }
    }
    assert.equal(input.additionalProperties, false, 'unknown input keys must be refused')
    assert.deepEqual(input.required, ['image_path'])
    assert.deepEqual(Object.keys(input.properties).sort(), ['image_path', 'policy', 'quality', 'threshold'])
    assert.equal(input.properties.image_path.type, 'string')
    assert.equal(input.properties.image_path.maxLength, 4096)
    assert.deepEqual(input.properties.quality.enum, ['fast', 'balanced', 'accurate'])
    assert.equal(input.properties.quality.default, 'balanced')
    assert.equal(input.properties.threshold.minimum, 0)
    assert.equal(input.properties.threshold.maximum, 1)
    assert.equal(input.properties.threshold.default, 0.5)
    assert.deepEqual(input.properties.policy.enum, ['standard', 'allowTopless'])
    assert.equal(input.properties.policy.default, 'standard')
  })

  it('pins the seven-key output contract and the closed regions object', () => {
    interface RegionSchema { readonly type?: string; readonly minimum?: number; readonly maximum?: number }
    const outputRaw: unknown = JSON.parse(readFileSync(join(DIR, 'schemas', 'classify-nsfw.output.json'), 'utf8'))
    // SAFETY: this package's own output schema; the required fields, enumerations and regions
    // shape are asserted below.
    const output = outputRaw as {
      additionalProperties: boolean
      required: readonly string[]
      properties: {
        isNSFW: { readonly type: string }
        score: { readonly minimum?: number; readonly maximum?: number }
        threshold: { readonly minimum?: number; readonly maximum?: number }
        policy: { readonly enum: readonly string[] }
        quality: { readonly enum: readonly string[] }
        regions: {
          readonly additionalProperties: boolean
          readonly required: readonly string[]
          readonly properties: Record<string, RegionSchema>
        }
        crops: { readonly type: string; readonly enum: readonly number[] }
      }
    }
    assert.equal(output.additionalProperties, false)
    assert.deepEqual(output.required, ['isNSFW', 'score', 'threshold', 'policy', 'quality', 'regions', 'crops'])
    assert.deepEqual(Object.keys(output.properties).sort(), ['crops', 'isNSFW', 'policy', 'quality', 'regions', 'score', 'threshold'])
    assert.equal(output.properties.isNSFW.type, 'boolean')
    assert.equal(output.properties.score.minimum, 0)
    assert.equal(output.properties.score.maximum, 1)
    assert.equal(output.properties.threshold.minimum, 0)
    assert.equal(output.properties.threshold.maximum, 1)
    assert.deepEqual(output.properties.policy.enum, ['standard', 'allowTopless'])
    assert.deepEqual(output.properties.quality.enum, ['fast', 'balanced', 'accurate'])
    assert.equal(output.properties.regions.additionalProperties, false, 'regions must be a closed object')
    assert.deepEqual(output.properties.regions.required, ['nipples', 'genitals', 'buttocks', 'nude', 'sexAct'])
    assert.deepEqual(Object.keys(output.properties.regions.properties).sort(), ['buttocks', 'genitals', 'nipples', 'nude', 'sexAct'])
    for (const [name, property] of Object.entries(output.properties.regions.properties)) {
      assert.equal(property.type, 'number', 'region ' + name + ' must be a score number')
      assert.equal(property.minimum, 0)
      assert.equal(property.maximum, 1)
    }
    assert.equal(output.properties.crops.type, 'integer')
    assert.deepEqual(output.properties.crops.enum, [1, 4, 8])
  })

  it('REFUSES a mutated recipe that escapes the package', () => {
    const mutated: unknown = JSON.parse(mutatedRecipeText('"fileName": "moderator.tflite"', '"fileName": "../moderator.tflite"'))
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
