/**
 * The one model-facing tool-description composer (P1).
 *
 * Every registered tool's description comes from composeToolDescription, so its
 * section order, fallbacks and length are a contract: a model that reads two
 * tools' descriptions sees the same shape in both. These tests pin that shape.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { TOOL_DESCRIPTION_MAX_CHARS, composeToolDescription } from '../src/tool-description.ts'

const SECTIONS = ['When to use:', 'When not to use:', 'Inputs and outputs:', 'Limits:', 'Example:', 'Skill:']

/** The index of a heading, asserted present. */
function at(text: string, heading: string): number {
  const index = text.indexOf(heading)
  assert.ok(index >= 0, 'missing section ' + heading + ' in: ' + text)
  return index
}

test('the sections render in the fixed order purpose -> when to use -> when not to use -> inputs/outputs -> limits -> example -> skill', () => {
  const description = composeToolDescription({
    purpose: 'Identify the language of a short piece of text.',
    whenToUse: ['Route text to a locale-specific template.', 'Check generated copy language.'],
    whenNotToUse: 'Do not use on code identifiers or single words.',
    inputs: 'text (string): the text to identify.',
    outputs: 'language (string), confidence (number).',
    limits: ['At least three words.', 'Microseconds per call on device.'],
    example: 'lang_detect({ text: "bonjour" }) -> { language: "fr" }',
    skill: { name: 'desert-ant-tongue' },
  })
  assert.equal(description.startsWith('Identify the language of a short piece of text.'), true, 'the purpose comes first')
  let previous = -1
  for (const heading of SECTIONS) {
    const index = at(description, heading)
    assert.ok(index > previous, heading + ' out of order: ' + description)
    previous = index
  }
})

test('empty optional sections are omitted, never rendered as an empty heading', () => {
  assert.equal(composeToolDescription({ purpose: 'Do one thing.' }), 'Do one thing.')
})

test('when-to-use falls back to the skill guidance when the tool names none', () => {
  const description = composeToolDescription({
    purpose: 'Detect the language of short text.',
    skill: { name: 'desert-ant-tongue', whenToUse: 'Use before translating or routing to a locale.' },
  })
  assert.ok(description.includes('When to use:'))
  assert.ok(description.includes('- Use before translating or routing to a locale.'))
})

test('bullets render from an array and from a single string', () => {
  const array = composeToolDescription({ purpose: 'P.', whenToUse: ['One.', 'Two.'] })
  assert.equal((array.match(/^- /gm) ?? []).length, 2, array)
  const single = composeToolDescription({ purpose: 'P.', whenNotToUse: 'Not for code.' })
  assert.equal((single.match(/^- /gm) ?? []).length, 1, single)
})

test('at most one example is rendered, even when several are supplied', () => {
  const description = composeToolDescription({ purpose: 'P.', example: ['first example', 'second example'] })
  assert.equal((description.match(/Example:/g) ?? []).length, 1)
  assert.ok(description.includes('first example'))
  assert.equal(description.includes('second example'), false)
})

test('the description is bounded, and over-long input keeps the purpose and truncates deterministically', () => {
  const purpose = 'Keep this purpose sentence at the front.'
  const description = composeToolDescription({
    purpose,
    whenToUse: 'Use when a caller needs this.',
    limits: Array.from({ length: 40 }, (_, index) => 'limit ' + index + ' is a long sentence that fills the budget.'),
  })
  assert.ok(description.length <= TOOL_DESCRIPTION_MAX_CHARS, 'description is ' + description.length + ' characters')
  assert.equal(description.startsWith(purpose), true)
  assert.equal(description, composeToolDescription({
    purpose,
    whenToUse: 'Use when a caller needs this.',
    limits: Array.from({ length: 40 }, (_, index) => 'limit ' + index + ' is a long sentence that fills the budget.'),
  }), 'the bounded output is deterministic')
})

test('the composer trims input and refuses a blank purpose', () => {
  const description = composeToolDescription({ purpose: '  Padded purpose.  ', whenToUse: '  Trimmed.  ' })
  assert.equal(description, 'Padded purpose.\n\nWhen to use:\n- Trimmed.')
  assert.throws(() => composeToolDescription({ purpose: '   ' }), /purpose/i)
})

test('the 700-char budget is ABSOLUTE for any input: long purposes and long section bodies', () => {
  const cases = [
    { purpose: 'P'.repeat(2000) },
    { purpose: 'P'.repeat(2000), whenToUse: 'W'.repeat(2000), limits: ['L'.repeat(1000), 'M'.repeat(1000)] },
    {
      purpose: 'S'.repeat(2000),
      whenToUse: 'W'.repeat(2000),
      whenNotToUse: 'N'.repeat(2000),
      inputs: 'I'.repeat(900),
      outputs: 'O'.repeat(900),
      limits: 'L'.repeat(900),
      example: 'E'.repeat(2000),
      skill: { name: 'k'.repeat(100) },
    },
  ]
  for (const input of cases) {
    const text = composeToolDescription(input)
    assert.ok(text.length <= TOOL_DESCRIPTION_MAX_CHARS, 'length ' + text.length + ' for ' + input.purpose.length)
    const purposeBlock = text.split('\n\n')[0] ?? ''
    assert.ok(
      purposeBlock.length <= Math.ceil(TOOL_DESCRIPTION_MAX_CHARS * 0.4),
      'the purpose must not exceed its bounded share: ' + purposeBlock.length,
    )
    assert.equal(text, composeToolDescription(input), 'truncation must be deterministic')
  }
})
