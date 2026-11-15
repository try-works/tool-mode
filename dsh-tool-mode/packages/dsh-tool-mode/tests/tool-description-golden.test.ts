/**
 * The model-facing description list is reviewed like code: this test compares the
 * committed golden file with the renderer, so any text change shows up as a diff.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { STANDARD_CONTRACTS } from '@try-works/tool-mode-contracts'
import { loadCatalog } from '../src/catalog.ts'
import {
  TOOL_DESCRIPTION_MAX_CHARS,
  goldenDescriptionRows,
  renderToolDescriptionGolden,
} from '../src/tool-description.ts'

const GOLDEN = join(process.cwd(), 'packages', 'dsh-tool-mode', 'docs', 'audit', 'tool-description-golden.md')

test('the committed golden list is current', () => {
  const catalog = loadCatalog()
  const rows = goldenDescriptionRows(catalog, STANDARD_CONTRACTS)
  assert.equal(rows.length, 33, '16 per-model tools + 17 standard contracts')
  const rendered = renderToolDescriptionGolden(rows)
  assert.ok(existsSync(GOLDEN), 'docs/audit/tool-description-golden.md must be committed')
  assert.equal(readFileSync(GOLDEN, 'utf8'), rendered, 'the golden file is stale; run scripts/gen-tool-descriptions.mjs')
})

test('every golden description fits the budget and starts with its purpose', () => {
  const rows = goldenDescriptionRows(loadCatalog(), STANDARD_CONTRACTS)
  for (const row of rows) {
    assert.ok(row.description.length <= TOOL_DESCRIPTION_MAX_CHARS, row.name + ' is ' + row.description.length + ' characters')
    assert.ok(row.description.startsWith(row.purpose), row.name + ' must start with its purpose')
    assert.ok(row.parameterCount >= 1, row.name + ' must declare its parameters')
  }
})
