/**
 * Keep the public README honest about the shipped catalog.
 *
 * The README is the first thing a new user reads. A tool or model that exists
 * only in the docs makes the repository look current while the landing page
 * teaches an older surface. This check requires every catalog model and every
 * manifest-declared tool to be named in the root README.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readmePath = join(root, '..', 'README.md')
const failures = []

if (!existsSync(readmePath)) {
  console.error('✖ root README.md is missing')
  process.exit(1)
}

const readme = readFileSync(readmePath, 'utf8')
const catalog = JSON.parse(
  readFileSync(join(root, 'packages', 'dsh-tool-mode', 'catalog', 'desert-ant-models.json'), 'utf8'),
)

for (const model of catalog) {
  if (!readme.includes(`| ${model.name} |`) && !readme.includes(`| ${model.name} `)) {
    failures.push(`README.md: catalog model "${model.name}" is not listed`)
  }
}

for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifestPath = join(root, 'packages', entry.name, 'tool-mode.extension.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const tool of manifest.tools ?? []) {
    if (!readme.includes(`\`${tool.name}\``)) {
      failures.push(`README.md: tool "${tool.name}" from ${manifest.id} is not listed`)
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✖ ${failure}`)
  console.error('update README.md so it names every shipped model and tool')
  process.exit(1)
}

console.log(`README coverage OK — ${catalog.length} catalog models, extension tools included`)
