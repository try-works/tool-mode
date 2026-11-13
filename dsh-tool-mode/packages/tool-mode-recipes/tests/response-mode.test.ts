/** RCP-04 — text and json response modes are explicit, strict mappings. */
import assert from 'node:assert/strict'
import test from 'node:test'

import { interpretRecipeResponse, type RecipeManifest } from '../src/recipe-format.ts'

const textRecipe = { response: { mode: 'text', field: 'answer' } } as unknown as RecipeManifest
const jsonRecipe = { response: { mode: 'json', field: 'payload' } } as unknown as RecipeManifest

test('text mode maps the whole reply into the named payload string field', () => {
  const mapped = interpretRecipeResponse(textRecipe, 'the whole reply\nwith newlines')
  assert.deepEqual(mapped, { ok: true, value: { answer: 'the whole reply\nwith newlines' } })
})

test('json mode accepts exactly one object carrying exactly the declared field', () => {
  const mapped = interpretRecipeResponse(jsonRecipe, '{"payload":{"title":"A","value":1}}')
  assert.deepEqual(mapped, { ok: true, value: { payload: { title: 'A', value: 1 } } })
})

test('json mode refuses prose, fences, non-objects, missing and extra fields', () => {
  for (const [text, pattern] of [
    ['Here you go: {"payload":1}', /single JSON object/],
    ['```json\n{"payload":1}\n```', /code fence/],
    ['[1,2]', /not a JSON object/],
    ['{"other":1}', /did not ask for/],
    ['{}', /does not carry the declared field/],
  ] as const) {
    const mapped = interpretRecipeResponse(jsonRecipe, text)
    assert.equal(mapped.ok, false, text)
    assert.match(mapped.ok ? '' : mapped.reason, pattern)
  }
})

test('a recipe with no declared response keeps the legacy raw string', () => {
  const mapped = interpretRecipeResponse({}, 'raw reply')
  assert.deepEqual(mapped, { ok: true, value: 'raw reply' })
})
