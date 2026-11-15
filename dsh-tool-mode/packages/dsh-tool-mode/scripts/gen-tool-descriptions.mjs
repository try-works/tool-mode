#!/usr/bin/env node
/**
 * Generate the reviewed model-facing tool-description list (P1).
 *
 * Every registered tool description is prompt text, so a change to it is a
 * change to the model-facing contract. This generator writes the full list to
 * docs/audit/tool-description-golden.md and the golden test diffs against it:
 * text changes are reviewed like code.
 *
 * Run from the package root; `--check` fails when the committed list is stale.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STANDARD_CONTRACTS } from '@try-works/tool-mode-contracts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(root, 'docs', 'audit', 'tool-description-golden.md')

if (!existsSync(join(root, 'lib', 'tool-description.js'))) {
  process.stderr.write('gen-tool-descriptions: lib/ is not built; run the package build first\n')
  process.exit(1)
}

const { loadCatalog } = await import(new URL('../lib/catalog.js', import.meta.url).href)
const { goldenDescriptionRows, renderToolDescriptionGolden } = await import(new URL('../lib/tool-description.js', import.meta.url).href)

const rows = goldenDescriptionRows(loadCatalog(), STANDARD_CONTRACTS)
const rendered = renderToolDescriptionGolden(rows)

if (process.argv.includes('--check')) {
  if (!existsSync(output)) {
    process.stderr.write('gen-tool-descriptions --check: docs/audit/tool-description-golden.md is missing; run the generator\n')
    process.exit(1)
  }
  if (readFileSync(output, 'utf8') !== rendered) {
    process.stderr.write('gen-tool-descriptions --check: the golden list is stale; run node scripts/gen-tool-descriptions.mjs\n')
    process.exit(1)
  }
  process.stdout.write(`tool descriptions current: ${rows.length} tools\n`)
  process.exit(0)
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, rendered)
process.stdout.write(`tool descriptions generated: ${rows.length} tools, ${rendered.length} bytes\n`)
