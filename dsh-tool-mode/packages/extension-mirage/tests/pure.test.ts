/**
 * Pure Mirage contract tests. These prove option bounds, form order and output
 * normalization without loading a model; live inference is qualified separately.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  describeOptions,
  detectOptions,
  extractOptions,
  normalizeDescribe,
  normalizeDetect,
  normalizeExtract,
  normalizeOcr,
  ocrOptions,
  readFields,
  readImagePath,
  readLanguage,
  readSections,
} from '../src/pure.ts'

describe('Mirage option bounds', () => {
  it('defaults describe to all five sections and accepts a bounded subset', () => {
    assert.deepEqual(describeOptions({}).options, { sections: ['scene', 'objects', 'text', 'relations', 'reasoning'] })
    assert.deepEqual(describeOptions({ sections: ['objects', 'text'] }).options, { sections: ['objects', 'text'] })
    assert.deepEqual(readSections(['objects', 'objects']), ['objects'])
  })

  it('refuses unknown sections, bad languages and out-of-range numbers', () => {
    assert.throws(() => readSections(['objects', 'form']), /MIRAGE_INVALID_INPUT/)
    assert.throws(() => readLanguage('ja'), /MIRAGE_INVALID_INPUT/)
    assert.throws(() => describeOptions({ maxObjects: 65 }), /MIRAGE_INVALID_INPUT/)
    assert.throws(() => describeOptions({ conf: 1.1 }), /MIRAGE_INVALID_INPUT/)
    assert.throws(() => readImagePath(''), /MIRAGE_INVALID_INPUT/)
  })

  it('builds detect fields only for the requested mask format', () => {
    assert.deepEqual(detectOptions({ maskFormat: 'none' }), { sections: ['objects'], fields: ['bbox', 'score'] })
    assert.deepEqual(detectOptions({ maskFormat: 'polygons', maxObjects: 2 }), {
      sections: ['objects'], fields: ['bbox', 'score', 'mask'], max_objects: 2, mask_format: 'polygons',
    })
    assert.throws(() => detectOptions({ maskFormat: 'svg' }), /MIRAGE_INVALID_INPUT/)
    assert.deepEqual(ocrOptions({ maxTextLines: 3 }), { sections: ['text'], fields: ['bbox', 'score'], max_text_lines: 3 })
  })
})

describe('Mirage form order and constraints', () => {
  it('preserves field order and emits the native form shape', () => {
    const { form, fields } = readFields([
      { name: 'sign', kind: 'enum', options: ['stop', 'yield'] },
      { name: 'count', kind: 'integer', minimum: 0, maximum: 4 },
      { name: 'label', kind: 'string', maxLength: 20 },
    ])
    assert.deepEqual(fields.map(field => field.name), ['sign', 'count', 'label'])
    assert.deepEqual(Object.keys(form), ['sign', 'count', 'label'])
    assert.deepEqual(form.sign, { enum: ['stop', 'yield'] })
    assert.deepEqual(form.count, { type: 'integer', minimum: 0, maximum: 4 })
    assert.deepEqual(extractOptions(form), { form })
    const boxed = readFields([{ name: 'sign', kind: 'enum', options: ['stop', 'yield'] }, { name: 'location', kind: 'box', of: 'sign' }])
    assert.deepEqual(boxed.form.location, { 'x-source': 'bbox', 'x-of': 'sign' })
  })

  it('refuses duplicate/unsafe names, duplicate enum labels and inverted bounds', () => {
    assert.throws(() => readFields([{ name: 'a', kind: 'enum', options: ['x', 'y'] }, { name: 'a', kind: 'string' }]), /duplicated/)
    assert.throws(() => readFields([{ name: '../x', kind: 'string' }]), /MIRAGE_INVALID_INPUT/)
    assert.throws(() => readFields([{ name: 'a', kind: 'enum', options: ['x', 'x'] }]), /distinct/)
    assert.throws(() => readFields([{ name: 'a', kind: 'integer', minimum: 5, maximum: 2 }]), /bounds/)
  })
})

describe('Mirage output normalization', () => {
  it('passes scene/objects/text/relations through and defaults missing sections honestly', () => {
    const result = normalizeDescribe({
      scene: { setting: 'street' },
      objects: [{ id: 1, name: 'sign', bbox: [1, 2, 3, 4], score: 0.8 }],
      text: [{ string: 'ARRÊT', bbox: [1, 2, 3, 4], score: 0.7 }],
      relations: [{ type: 'attached', from: 1 }],
      reasoning: 'The sign is attached to a pole.',
    }, 'fr')
    assert.equal(result.scene?.setting, 'street')
    assert.equal(result.objects.length, 1)
    assert.equal(result.text.length, 1)
    assert.equal(result.relations.length, 1)
    assert.equal(result.reasoning, 'The sign is attached to a pole.')
    assert.equal(result.language, 'fr')
    const empty = normalizeDescribe({}, 'en')
    assert.deepEqual(empty.scene, {})
    assert.deepEqual(empty.objects, [])
  })

  it('maps OCR string to text and drops unrequested masks', () => {
    assert.deepEqual(normalizeOcr({ text: [{ string: 'Mirage', bbox: [0, 0, 1, 1], score: 0.9 }] }).text[0]?.text, 'Mirage')
    const detected = normalizeDetect({ objects: [{ id: 1, name: 'sign', bbox: [0, 0, 1, 1], score: 0.5, mask: { size: [2, 2], counts: [1, 2] } }] }, 'none')
    assert.equal('mask' in (detected.objects as Record<string, unknown>[])[0]!, false)
  })

  it('preserves null enum values and the engine-provided probabilities as ordered fields', () => {
    const result = normalizeExtract({ form: { sign: { value: null, probabilities: { stop: 0.4, '-': 0.5 } } } }, ['sign'], 'en')
    const fields = result.fields as { name: string; value: unknown; probabilities: { key: string; probability: number }[] }[]
    assert.equal(fields[0]?.value, null)
    assert.equal(fields[0]?.probabilities.find(entry => entry.key === '-')?.probability, 0.5)
  })
})
