/**
 * Model-runtime recipe parser tests (Phase 2 gate: unknown keys, path escape, bad limits).
 *
 * The parser is the ONLY thing standing between a package's JSON and the host resolving a
 * provider module, so each test states the refusal it proves. A recipe that parses is a
 * recipe the host may act on; everything here is about making that sentence true.
 *
 * @module tests/model-runtime-recipe
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MODEL_RUNTIME_ACCELERATORS,
  MODEL_RUNTIME_FORMATS,
  MODEL_RUNTIME_KIND,
  MODEL_RUNTIME_SCHEMA_VERSION,
  parseModelRuntimeRecipe,
  type ModelRuntimeRecipeIssue,
} from '../src/index.ts'
import { mustParse, removeKey, removeTopLevelKey, validRecipeDocument } from './support.ts'

/** Parse a document and return the issues it produced, asserting it was refused. */
function issuesOf(raw: unknown): readonly ModelRuntimeRecipeIssue[] {
  const result = parseModelRuntimeRecipe(raw)
  if (result.ok) {
    assert.fail(`expected the recipe to be refused, but it parsed: ${JSON.stringify(result.recipe)}`)
  }
  return result.issues
}

/** Assert that a refusal names exactly one path. */
function refusedAt(raw: unknown, path: string): void {
  const issues = issuesOf(raw)
  assert.ok(
    issues.some((issue) => issue.path === path),
    `expected an issue at ${JSON.stringify(path)}, got ${JSON.stringify(issues)}`,
  )
  for (const issue of issues) {
    assert.ok(issue.message.length > 0, 'every issue carries a non-empty message')
  }
}

describe('parseModelRuntimeRecipe', () => {
  describe('the valid recipe', () => {
    it('accepts the Phase 2 example and returns every declared field', () => {
      const recipe = mustParse(validRecipeDocument())
      assert.deepEqual(recipe, {
        kind: 'model-runtime',
        schemaVersion: 1,
        provider: {
          package: '@try-works/tool-mode-runtime-litert',
          export: 'createProviderFromRecipe',
          accelerators: ['cpu'],
        },
        model: { assetSet: 'shapes-litert', fileName: 'shapes.tflite', format: 'tflite' },
        processor: { id: 'shapes/points-v1' },
        limits: { maxInputBytes: 4_194_304, timeoutMs: 120_000 },
        tool: {
          name: 'shape_recognize',
          description: 'Recognize geometric shapes in an image.',
          inputSchema: './schemas/shape.input.json',
          outputSchema: './schemas/shape.output.json',
        },
      })
    })

    it('accepts every declared accelerator lane and artifact format', () => {
      for (const accelerator of MODEL_RUNTIME_ACCELERATORS) {
        mustParse(validRecipeDocument({ provider: { accelerators: [accelerator] } }))
      }
      for (const format of MODEL_RUNTIME_FORMATS) {
        mustParse(validRecipeDocument({ model: { format } }))
      }
      mustParse(validRecipeDocument({ provider: { accelerators: ['cpu', 'dml', 'webgpu'] } }))
    })

    it('freezes the parsed recipe so a holder cannot widen it after validation', () => {
      const recipe = mustParse(validRecipeDocument())
      assert.ok(Object.isFrozen(recipe))
      assert.ok(Object.isFrozen(recipe.provider))
      assert.ok(Object.isFrozen(recipe.provider.accelerators))
      assert.ok(Object.isFrozen(recipe.model))
      assert.ok(Object.isFrozen(recipe.processor))
      assert.ok(Object.isFrozen(recipe.limits))
      assert.ok(Object.isFrozen(recipe.tool))
    })

    it('is idempotent: its own output parses again unchanged', () => {
      const first = mustParse(validRecipeDocument())
      const second = mustParse(first)
      assert.deepEqual(second, first)
    })

    it('does not mutate the document it was given', () => {
      const document = validRecipeDocument()
      const before = JSON.stringify(document)
      mustParse(document)
      assert.equal(JSON.stringify(document), before)
    })
  })

  describe('document shape', () => {
    for (const [label, value] of [
      ['null', null],
      ['an array', []],
      ['a string', 'kind: model-runtime'],
      ['a number', 1],
      ['undefined', undefined],
    ] as const) {
      it(`refuses ${label}: a recipe is a JSON object`, () => {
        const issues = issuesOf(value)
        assert.equal(issues.length, 1)
        assert.equal(issues[0]?.path, '')
      })
    }
  })

  describe('closed keys', () => {
    it('refuses an unknown top-level key by name', () => {
      refusedAt(validRecipeDocument({ topLevel: { extra: true } }), 'extra')
    })

    for (const [section, key] of [
      ['provider', 'packageName'],
      ['model', 'quantization'],
      ['processor', 'kind'],
      ['limits', 'maxAudioSeconds'],
      ['tool', 'contractId'],
    ] as const) {
      it(`refuses an unknown key inside ${section}`, () => {
        refusedAt(validRecipeDocument({ [section]: { [key]: 'x' } }), `${section}.${key}`)
      })
    }

    it('reports every problem at once instead of stopping at the first', () => {
      const issues = issuesOf(
        validRecipeDocument({
          provider: { package: '' },
          limits: { timeoutMs: 0 },
          tool: { inputSchema: '/etc/passwd' },
        }),
      )
      const paths = issues.map((issue) => issue.path)
      assert.ok(paths.includes('provider.package'))
      assert.ok(paths.includes('limits.timeoutMs'))
      assert.ok(paths.includes('tool.inputSchema'))
      assert.ok(issues.length >= 3)
    })
  })

  describe('kind and schemaVersion', () => {
    it('refuses a missing kind', () => {
      refusedAt(removeTopLevelKey(validRecipeDocument(), 'kind'), 'kind')
    })

    it('refuses a different recipe kind', () => {
      refusedAt(validRecipeDocument({ topLevel: { kind: 'harness-model' } }), 'kind')
    })

    it(`accepts schemaVersion ${MODEL_RUNTIME_SCHEMA_VERSION} and refuses every other value`, () => {
      assert.equal(MODEL_RUNTIME_SCHEMA_VERSION, 1)
      for (const version of [2, 0, '1', 1.5, null]) {
        refusedAt(validRecipeDocument({ topLevel: { schemaVersion: version } }), 'schemaVersion')
      }
    })
  })

  describe('provider', () => {
    it('refuses a missing or empty package', () => {
      refusedAt(removeKey(validRecipeDocument(), 'provider', 'package'), 'provider.package')
      refusedAt(validRecipeDocument({ provider: { package: '' } }), 'provider.package')
      refusedAt(validRecipeDocument({ provider: { package: 7 } }), 'provider.package')
    })

    it('refuses a missing, empty or non-identifier export', () => {
      refusedAt(removeKey(validRecipeDocument(), 'provider', 'export'), 'provider.export')
      refusedAt(validRecipeDocument({ provider: { export: '' } }), 'provider.export')
      refusedAt(validRecipeDocument({ provider: { export: 'create provider' } }), 'provider.export')
      refusedAt(validRecipeDocument({ provider: { export: 'create-provider' } }), 'provider.export')
    })

    it('refuses a reserved name that would reach Object.prototype rather than a module export', () => {
      for (const reserved of ['__proto__', 'constructor', 'prototype']) {
        refusedAt(validRecipeDocument({ provider: { export: reserved } }), 'provider.export')
      }
    })

    it('refuses missing, empty or unknown accelerator lanes', () => {
      refusedAt(removeKey(validRecipeDocument(), 'provider', 'accelerators'), 'provider.accelerators')
      refusedAt(validRecipeDocument({ provider: { accelerators: [] } }), 'provider.accelerators')
      refusedAt(validRecipeDocument({ provider: { accelerators: 'cpu' } }), 'provider.accelerators')
      // An unknown lane is refused AT ITS INDEX, so a mixed list names the bad entry
      // instead of the whole array.
      refusedAt(validRecipeDocument({ provider: { accelerators: ['cpu', 'gpu'] } }), 'provider.accelerators[1]')
    })
  })

  describe('model', () => {
    it('refuses an empty asset set', () => {
      refusedAt(validRecipeDocument({ model: { assetSet: '' } }), 'model.assetSet')
      refusedAt(removeKey(validRecipeDocument(), 'model', 'assetSet'), 'model.assetSet')
    })

    it('refuses an unknown artifact format', () => {
      refusedAt(validRecipeDocument({ model: { format: 'safetensors' } }), 'model.format')
      refusedAt(removeKey(validRecipeDocument(), 'model', 'format'), 'model.format')
    })

    it('requires a BARE file name: no separators and no traversal', () => {
      for (const fileName of ['', 'nested/shapes.tflite', 'nested\\shapes.tflite', '..', '.', 'C:\\shapes.tflite']) {
        refusedAt(validRecipeDocument({ model: { fileName } }), 'model.fileName')
      }
      // A dotted file name is still a bare name, not a path.
      mustParse(validRecipeDocument({ model: { fileName: 'shapes.v2.tflite' } }))
    })

    it('refuses a missing file name', () => {
      refusedAt(removeKey(validRecipeDocument(), 'model', 'fileName'), 'model.fileName')
    })
  })

  describe('processor', () => {
    it('accepts ids shaped like <family>/<variant>', () => {
      for (const id of ['shapes', 'shapes/points-v1', 'a1/b2/c3', 'redact/wordpiece-v1']) {
        assert.equal(mustParse(validRecipeDocument({ processor: { id } })).processor.id, id)
      }
    })

    it('refuses ids outside ^[a-z0-9]+(?:/[a-z0-9-]+)*$', () => {
      for (const id of ['', 'Shapes/points', 'shapes//points', 'shapes/', '/shapes', 'shapes/points_v1', 'shapes points', '-shapes']) {
        refusedAt(validRecipeDocument({ processor: { id } }), 'processor.id')
      }
      refusedAt(removeKey(validRecipeDocument(), 'processor', 'id'), 'processor.id')
    })
  })

  describe('limits', () => {
    it('accepts positive integers', () => {
      const recipe = mustParse(validRecipeDocument({ limits: { maxInputBytes: 1, timeoutMs: 1 } }))
      assert.deepEqual(recipe.limits, { maxInputBytes: 1, timeoutMs: 1 })
    })

    it('refuses zero, negative, fractional, non-finite and non-numeric limits', () => {
      for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1024', null, undefined]) {
        refusedAt(validRecipeDocument({ limits: { maxInputBytes: value } }), 'limits.maxInputBytes')
        refusedAt(validRecipeDocument({ limits: { timeoutMs: value } }), 'limits.timeoutMs')
      }
    })

    it('requires both limits', () => {
      refusedAt(removeKey(validRecipeDocument(), 'limits', 'maxInputBytes'), 'limits.maxInputBytes')
      refusedAt(removeKey(validRecipeDocument(), 'limits', 'timeoutMs'), 'limits.timeoutMs')
    })
  })

  describe('tool', () => {
    it('requires a lower snake_case tool name', () => {
      for (const name of ['', 'Shape-Recognize', 'shape recognize', '1shape', 'shape.recognize']) {
        refusedAt(validRecipeDocument({ tool: { name } }), 'tool.name')
      }
      assert.equal(mustParse(validRecipeDocument({ tool: { name: 'shape_recognize' } })).tool.name, 'shape_recognize')
    })

    it('requires a non-empty description', () => {
      refusedAt(validRecipeDocument({ tool: { description: '' } }), 'tool.description')
      refusedAt(removeKey(validRecipeDocument(), 'tool', 'description'), 'tool.description')
    })

    it('requires package-relative schema paths that stay inside the package', () => {
      for (const path of ['/etc/passwd', 'C:\\schemas\\x.json', 'schemas/x.json', './../escape.json', './schemas/../../x.json']) {
        refusedAt(validRecipeDocument({ tool: { inputSchema: path } }), 'tool.inputSchema')
        refusedAt(validRecipeDocument({ tool: { outputSchema: path } }), 'tool.outputSchema')
      }
    })

    it('refuses a backslash or empty remainder in a schema path', () => {
      refusedAt(validRecipeDocument({ tool: { inputSchema: './schemas\\x.json' } }), 'tool.inputSchema')
      refusedAt(validRecipeDocument({ tool: { inputSchema: './' } }), 'tool.inputSchema')
      refusedAt(validRecipeDocument({ tool: { inputSchema: '.' } }), 'tool.inputSchema')
    })

    it('accepts a normal nested schema path', () => {
      const recipe = mustParse(
        validRecipeDocument({ tool: { inputSchema: './schemas/nested/shape.input.v2.json' } }),
      )
      assert.equal(recipe.tool.inputSchema, './schemas/nested/shape.input.v2.json')
    })

    it('requires both schema paths', () => {
      refusedAt(removeKey(validRecipeDocument(), 'tool', 'inputSchema'), 'tool.inputSchema')
      refusedAt(removeKey(validRecipeDocument(), 'tool', 'outputSchema'), 'tool.outputSchema')
    })
  })

  describe('constants', () => {
    it('publishes the closed sets the parser enforces', () => {
      assert.equal(MODEL_RUNTIME_KIND, 'model-runtime')
      assert.deepEqual(MODEL_RUNTIME_FORMATS, ['onnx', 'tflite', 'gguf'])
      assert.deepEqual(MODEL_RUNTIME_ACCELERATORS, ['cpu', 'dml', 'webgpu'])
    })
  })
})
