/**
 * Check the user docs tree.
 *
 * - every page has title/description frontmatter;
 * - every relative Markdown link resolves;
 * - every page is reachable from SUMMARY.md;
 * - the generated reference pages are current.
 *
 * This is a docs check, not a prose linter. It is intentionally cheap enough to
 * run on every docs contribution without a browser or a renderer.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docs = join(root, 'docs', 'guide')
const failures = []

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : entry.name.endsWith('.md') ? [full] : []
  })
}

const pages = walk(docs)
const relativePages = new Set(pages.map(page => relative(docs, page).replaceAll('\\', '/')))

for (const page of pages) {
  const text = readFileSync(page, 'utf8')
  const rel = relative(docs, page).replaceAll('\\', '/')
  if (rel !== 'SUMMARY.md') {
    if (!/^---\r?\n[\s\S]*?title:/m.test(text)) failures.push(`${rel}: missing frontmatter title`)
    if (!/^---\r?\n[\s\S]*?description:/m.test(text)) failures.push(`${rel}: missing frontmatter description`)
  }

  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    const pathOnly = target.split('#')[0]
    if (pathOnly === '') continue
    const resolved = resolve(dirname(page), pathOnly)
    if (!existsSync(resolved)) failures.push(`${rel}: broken link ${target}`)
  }
}

const summaryPath = join(docs, 'SUMMARY.md')
if (!existsSync(summaryPath)) {
  failures.push('SUMMARY.md is missing')
} else {
  const summary = readFileSync(summaryPath, 'utf8')
  for (const match of summary.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (!relativePages.has(target)) failures.push(`SUMMARY.md: missing page ${target}`)
  }
  for (const page of relativePages) {
    if (page === 'index.md' || page === 'SUMMARY.md') continue
    if (!summary.includes(`(${page})`)) failures.push(`${page}: not listed in SUMMARY.md`)
  }
}

const generated = spawnSync(process.execPath, [join(root, 'scripts', 'gen-user-docs.mjs'), '--check'], {
  cwd: root,
  encoding: 'utf8',
})
if (generated.status !== 0) failures.push(`generated reference is stale: ${generated.stderr.trim()}`)

if (failures.length > 0) {
  for (const failure of failures) console.error(`✖ ${failure}`)
  process.exit(1)
}
console.log(`user docs OK — ${pages.length} pages`)
