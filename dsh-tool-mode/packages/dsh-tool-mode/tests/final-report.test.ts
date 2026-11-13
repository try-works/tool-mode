/**
 * The final report is GENERATED evidence, not prose.
 *
 * This test pins the properties that let a reader trust it: its headline counts equal the
 * requirement inventory's own counts, every family row is derived from the same source,
 * the header names the verification timestamp and the commit it describes, every
 * first-party package identity is read from a manifest, and `--check` fails on a stale
 * copy while the committed file passes.
 *
 * It is deliberately independent of the other verification tests (no shared helpers): a
 * report that drifts must fail on the report's own contract, not on another lane's file.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readPackageIdentities, renderFinalReport } from '../../../scripts/gen-final-report.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const REPORT = join(ROOT, 'verification', 'FINAL-REPORT.md')
const inventory = JSON.parse(readFileSync(join(ROOT, 'verification', 'requirements.json'), 'utf8'))
const evidence = JSON.parse(readFileSync(join(ROOT, 'verification', 'evidence.json'), 'utf8'))
const report = readFileSync(REPORT, 'utf8')

const tempDirs = []
after(() => {
  for (const directory of tempDirs) rmSync(directory, { recursive: true, force: true })
})

/** The inventory's own status counts (the report must agree with these, not restate them). */
function inventoryCounts() {
  const families = new Map()
  const totals = { DONE: 0, PARTIAL: 0, BLOCKED: 0, NOT_RUN: 0 }
  for (const item of inventory.requirements) {
    const family = item.id.startsWith('AT-') ? 'AT' : item.id.split('-')[0]
    const entry = families.get(family) ?? { DONE: 0, PARTIAL: 0, BLOCKED: 0, NOT_RUN: 0 }
    entry[item.requirementStatus] = (entry[item.requirementStatus] ?? 0) + 1
    totals[item.requirementStatus] = (totals[item.requirementStatus] ?? 0) + 1
    families.set(family, entry)
  }
  return { families, totals }
}

describe('verification/FINAL-REPORT.md', () => {
  it('headline counts equal the requirement inventory', () => {
    const { totals } = inventoryCounts()
    const normative = inventory.requirements.filter(item => !item.id.startsWith('AT-')).length
    const acceptance = inventory.requirements.length - normative
    const match = /Of \*\*(\d+) tracked items\*\* — (\d+) normative requirements and (\d+) acceptance tests — \*\*(\d+) are done\*\*, (\d+) are partial, (\d+) are blocked by something outside this repository, and \*\*(\d+) were never started\*\*/.exec(report)
    assert.ok(match !== null, 'the report must carry the generated headline sentence')
    assert.equal(Number(match[1]), inventory.requirements.length)
    assert.equal(Number(match[2]), normative)
    assert.equal(Number(match[3]), acceptance)
    assert.equal(Number(match[4]), totals.DONE)
    assert.equal(Number(match[5]), totals.PARTIAL)
    assert.equal(Number(match[6]), totals.BLOCKED)
    assert.equal(Number(match[7]), totals.NOT_RUN)
  })

  it('every family row agrees with the inventory', () => {
    const { families } = inventoryCounts()
    for (const [family, counts] of families) {
      const row = new RegExp(`\\| \\\`${family}\\\` \\|[^\\n]*\\| ${counts.DONE} \\| ${counts.PARTIAL} \\| ${counts.BLOCKED} \\| ${counts.NOT_RUN} \\|`).exec(report)
      assert.ok(row !== null, `missing or stale family row for ${family}`)
    }
  })

  it('lists exactly the DONE and BLOCKED requirements', () => {
    const doneSection = report.split('## Blocked, with the concrete condition')[0] ?? ''
    const blockedSection = report.split('## Blocked, with the concrete condition')[1]?.split('## ')[0] ?? ''
    for (const item of inventory.requirements.filter(entry => entry.requirementStatus === 'DONE')) {
      assert.ok(doneSection.includes(`- **${item.id}** — `), `DONE requirement ${item.id} is omitted`)
    }
    for (const item of inventory.requirements.filter(entry => entry.requirementStatus !== 'DONE')) {
      assert.equal(doneSection.includes(`- **${item.id}** — `), false, `non-DONE requirement ${item.id} is listed as done`)
    }
    for (const item of inventory.requirements.filter(entry => entry.requirementStatus === 'BLOCKED')) {
      assert.ok(blockedSection.includes(`- **${item.id}** — `), `BLOCKED requirement ${item.id} is omitted`)
    }
  })

  it('names the verification timestamp and commit it describes', () => {
    assert.match(report, /\*\*Generated\*\* \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
    assert.ok(report.includes(`\`${evidence.git.commit}\``), 'the report must name the recorded commit')
    assert.match(report, /working tree (DIRTY|clean)/)
  })

  it('reads every package identity from its manifest, never a hardcoded version', () => {
    const packages = readPackageIdentities()
    assert.ok(packages.length >= 10, 'package discovery must find the workspace packages')
    for (const entry of packages) {
      assert.ok(report.includes(`\`${entry.name}\` | ${entry.version}`), `missing manifest package ${entry.name}@${entry.version}`)
    }
    assert.equal(report.includes('Five packages are published and installable'), false,
      'the old hardcoded package claim must be gone')
    assert.equal(report.includes('packages/dsh-tool-mode/package.json'), false,
      'the report must not embed a package path as a version claim')
  })

  it('is byte-identical to what the generator renders', () => {
    assert.equal(report, renderFinalReport(), 'the committed report differs from the generator output')
  })

  it('--check passes on the committed report and fails on a stale copy', () => {
    const current = spawnSync(process.execPath, ['scripts/gen-final-report.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(current.status, 0, `${current.stdout}\n${current.stderr}`)

    const directory = mkdtempSync(join(tmpdir(), 'final-report-check-'))
    tempDirs.push(directory)
    const stalePath = join(directory, 'FINAL-REPORT.md')
    const { totals } = inventoryCounts()
    writeFileSync(stalePath, renderFinalReport().replace(`**${totals.DONE} are done**`, `**${totals.DONE - 1} are done**`))
    const stale = spawnSync(process.execPath, ['scripts/gen-final-report.mjs', '--check', stalePath], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(stale.status, 1, 'a stale copy must fail the check')
    assert.match(stale.stderr, /stale/)
  })
})
