/**
 * The recipe is DATA the host lane parses, so the test parses it with the SAME parser the host
 * uses. The manifest, the recipe and the lock must agree; the schemas are the contract the host
 * lane asserts, so their shapes are pinned field by field.
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
const RECIPE_PATH = join(DIR, 'recipes', 'identify-language.json')

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

/** Parse the shipped recipe or fail with the parser's own message. */
function shippedRecipe(): NonNullable<ReturnType<typeof parseModelRuntimeRecipe>['ok'] extends true ? never : never> {
  const result = parseModelRuntimeRecipe(JSON.parse(recipeText()))
  if (!result.ok) {
    assert.fail(issueText(result.issues))
  }
  return result.recipe
}

/** Replace one anchor in the shipped recipe text, returning the mutated JSON text. */
function mutatedRecipeText(anchor: string, replacement: string): string {
  const text = recipeText()
  assert.ok(text.includes(anchor), 'the recipe fixture no longer contains ' + JSON.stringify(anchor))
  return text.replace(anchor, replacement)
}

describe('recipes/identify-language.json — model-runtime recipe', () => {
  it('parses through the parser the host lane uses', () => {
    const result = parseModelRuntimeRecipe(JSON.parse(recipeText()))
    assert.equal(result.ok, true, result.ok ? '' : issueText(result.issues))
  })

  it('names the LiteRT factory, the ear asset and the mel processor', () => {
    const recipe = shippedRecipe()
    assert.equal(recipe.kind, 'model-runtime')
    assert.equal(recipe.schemaVersion, 1)
    assert.equal(recipe.provider.package, '@try-works/tool-mode-runtime-litert')
    assert.equal(recipe.provider.export, 'createProviderFromRecipe')
    assert.deepEqual(recipe.provider.accelerators, ['cpu'])
    assert.equal(recipe.model.assetSet, 'ear-litert')
    assert.equal(recipe.model.fileName, 'ear.tflite')
    assert.equal(recipe.model.format, 'tflite')
    assert.equal(recipe.processor.id, 'ear/mel-v1')
    assert.match(recipe.processor.id, /^[a-z0-9]+(?:\/[a-z0-9-]+)*$/)
  })

  it('sets positive, bounded limits', () => {
    const recipe = shippedRecipe()
    assert.equal(recipe.limits.maxInputBytes, 4194304)
    assert.equal(recipe.limits.timeoutMs, 300000)
    assert.ok(Number.isInteger(recipe.limits.maxInputBytes) && recipe.limits.maxInputBytes > 0)
    assert.ok(Number.isInteger(recipe.limits.timeoutMs) && recipe.limits.timeoutMs > 0)
  })

  it('agrees with the manifest on the asset set and the tool name', () => {
    const recipe = shippedRecipe()
    const manifest = declaredManifest()
    assert.equal(recipe.model.assetSet, manifest.models[0]?.assetSet)
    assert.equal(recipe.tool.name, manifest.tools[0]?.name)
  })

  it('names a file the lock actually pins', () => {
    const recipe = shippedRecipe()
    const lockRaw: unknown = JSON.parse(readFileSync(join(DIR, 'models.lock.json'), 'utf8'))
    // SAFETY: this package's own lock file; only the declared asset set's file names are read,
    // and the lock test asserts their digests and sizes.
    const lock = lockRaw as { assetSets: Record<string, { assets: readonly { fileName: string }[] }> }
    const pinned = lock.assetSets[recipe.model.assetSet]?.assets ?? []
    assert.ok(
      pinned.some(asset => asset.fileName === recipe.model.fileName),
      'the recipe names ' + recipe.model.fileName + ' but the lock pins ' + pinned.map(asset => asset.fileName).join(', '),
    )
  })

  it('names schema files that exist inside the package', () => {
    const recipe = shippedRecipe()
    for (const relative of [recipe.tool.inputSchema, recipe.tool.outputSchema]) {
      assert.ok(relative.startsWith('./'), 'package-relative schema path: ' + relative)
      const path = join(DIR, relative)
      assert.ok(existsSync(path), 'missing schema ' + relative)
      assert.doesNotThrow(() => JSON.parse(readFileSync(path, 'utf8')))
    }
  })

  it('pins the WAV-only descriptor and the windows bounds in the input schema', () => {
    interface InputSchema {
      readonly additionalProperties: boolean
      readonly required: readonly string[]
      readonly properties: {
        readonly audio_path: { readonly type: string; readonly minLength?: number; readonly maxLength?: number }
        readonly windows: { readonly type: string; readonly minimum?: number; readonly maximum?: number; readonly default?: number }
      }
    }
    const inputRaw: unknown = JSON.parse(readFileSync(join(DIR, 'schemas', 'identify-language.input.json'), 'utf8'))
    // SAFETY: this package's own input schema; every field the test reads is asserted below.
    const input = inputRaw as InputSchema
    assert.equal(input.additionalProperties, false, 'unknown input keys must be refused')
    assert.deepEqual(input.required, ['audio_path'])
    assert.deepEqual(Object.keys(input.properties).sort(), ['audio_path', 'windows'])
    assert.equal(input.properties.audio_path.type, 'string')
    assert.equal(input.properties.audio_path.maxLength, 4096)
    assert.equal(input.properties.windows.type, 'integer')
    assert.equal(input.properties.windows.minimum, 1)
    assert.equal(input.properties.windows.maximum, 16)
    assert.equal(input.properties.windows.default, 3)
  })

  it('pins the five-key output contract, the candidate objects and the window count', () => {
    interface Candidate {
      readonly type: string
      readonly additionalProperties: boolean
      readonly required: readonly string[]
      readonly properties: { readonly language: { readonly type: string }; readonly probability: { readonly minimum?: number; readonly maximum?: number } }
    }
    interface OutputSchema {
      readonly additionalProperties: boolean
      readonly required: readonly string[]
      readonly properties: {
        readonly language: { readonly type: string }
        readonly confidence: { readonly minimum?: number; readonly maximum?: number }
        readonly isReliable: { readonly type: string }
        readonly candidates: { readonly type: string; readonly minItems?: number; readonly maxItems?: number; readonly items: Candidate }
        readonly windows: { readonly type: string; readonly minimum?: number; readonly maximum?: number }
      }
    }
    const outputRaw: unknown = JSON.parse(readFileSync(join(DIR, 'schemas', 'identify-language.output.json'), 'utf8'))
    // SAFETY: this package's own output schema; every field the test reads is asserted below.
    const output = outputRaw as OutputSchema
    assert.equal(output.additionalProperties, false)
    assert.deepEqual(output.required, ['language', 'confidence', 'isReliable', 'candidates', 'windows'])
    assert.deepEqual(Object.keys(output.properties).sort(), ['candidates', 'confidence', 'isReliable', 'language', 'windows'])
    assert.equal(output.properties.language.type, 'string')
    assert.equal(output.properties.confidence.minimum, 0)
    assert.equal(output.properties.confidence.maximum, 1)
    assert.equal(output.properties.isReliable.type, 'boolean')
    assert.equal(output.properties.candidates.type, 'array')
    assert.equal(output.properties.candidates.minItems, 1)
    assert.equal(output.properties.candidates.maxItems, 5)
    assert.equal(output.properties.candidates.items.additionalProperties, false, 'a candidate must be a closed object')
    assert.deepEqual(output.properties.candidates.items.required, ['language', 'probability'])
    assert.equal(output.properties.candidates.items.properties.language.type, 'string')
    assert.equal(output.properties.candidates.items.properties.probability.minimum, 0)
    assert.equal(output.properties.candidates.items.properties.probability.maximum, 1)
    assert.equal(output.properties.windows.type, 'integer', 'windows is the integer count listened to, not a descriptor array')
    assert.equal(output.properties.windows.minimum, 1)
    assert.equal(output.properties.windows.maximum, 16)
  })

  it('REFUSES a mutated recipe that escapes the package', () => {
    const mutated: unknown = JSON.parse(mutatedRecipeText('"fileName": "ear.tflite"', '"fileName": "../ear.tflite"'))
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
