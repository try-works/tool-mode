/**
 * Verification generator integrity tests (task-20).
 *
 * These pin the three defects found by the 2026-11-01 audit:
 *  1. `**ID.** body` requirements lost their summary because the extractor only
 *     understood `**ID. body**`;
 *  2. acceptance evidence was emitted as the whole `{status, evidence}` object
 *     instead of its `.evidence` string;
 *  3. `--check` compared requirement IDs only, so status/evidence/count/report drift
 *     passed silently.
 *
 * The generator is imported for its pure helpers; importing it must NOT run the
 * command (no writes), which the module guarantees through its direct-invocation guard.
 */
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  countDrift,
  extractInventoryFromText,
  inventoryDrift,
  checkArtifacts,
  normalizeEvidenceFor,
  stripReleaseVolatility,
} from '../../../scripts/gen-verification.mjs'

const ROOT = process.cwd()
const REQUIREMENTS = join(ROOT, 'verification', 'requirements.json')
const EVIDENCE = join(ROOT, 'verification', 'evidence.json')

/** The spec uses both heading conventions; the extractor must read both. */
const BOTH_FORMATS = `
## 2. Verified starting point

**BASE-01.** Improve the existing package; do not discard the catalog, adapters,
skills, persistence, or platform checks merely to recreate them under new names.

**BASE-02. One tool per contract.** A catalog contract binding decides the tool name, and the
host registers one tool per contract.

| ID | Test |
| --- | --- |
| AT-01 | Install the built tarball into a clean DSH installation. |
| AT-02 | Start with no optional weights and no cloud credentials. |
`

describe('extractInventoryFromText — summaries', () => {
  it('reads the `**ID.** body` convention, which used to yield an empty summary', () => {
    const entries = extractInventoryFromText(BOTH_FORMATS, 'TM-DSH-001', 'a'.repeat(64))
    const base01 = entries.find(entry => entry.id === 'BASE-01')
    assert.ok(base01, 'BASE-01 must be inventoried')
    assert.equal(typeof base01.summary, 'string')
    assert.ok(base01.summary.length > 0, 'BASE-01 must carry its normative text')
    assert.match(base01.summary, /Improve the existing package/)
    assert.match(base01.summary, /platform checks/)
  })

  it('keeps the existing `**ID. text**` convention intact', () => {
    const entries = extractInventoryFromText(BOTH_FORMATS, 'TM-DSH-001', 'a'.repeat(64))
    const base02 = entries.find(entry => entry.id === 'BASE-02')
    assert.ok(base02)
    assert.match(base02.summary, /One tool per contract/)
    assert.match(base02.summary, /one tool per contract/i)
  })

  it('reads acceptance-test table rows and bounds every summary', () => {
    const entries = extractInventoryFromText(BOTH_FORMATS, 'TM-DSH-001', 'a'.repeat(64))
    const at01 = entries.find(entry => entry.id === 'AT-01')
    assert.ok(at01)
    assert.match(at01.summary, /clean DSH installation/)
    assert.ok(entries.every(entry => typeof entry.summary === 'string' && entry.summary.length > 0))
    assert.ok(entries.every(entry => entry.summary.length <= 301))
  })
})

describe('normalizeEvidenceFor — evidence is text or null, never an object', () => {
  it('reads requirement evidence as a string', () => {
    const status = { requirements: { 'BASE-01': { status: 'DONE', evidence: 'kept the package' } }, acceptance: {} }
    assert.equal(normalizeEvidenceFor(status, 'BASE-01'), 'kept the package')
  })

  it('reads acceptance evidence from `.evidence`, not the wrapper object', () => {
    const status = {
      requirements: {},
      acceptance: { 'AT-01': { status: 'PARTIAL', evidence: 'packed proof ran the tarball' } },
    }
    const evidence = normalizeEvidenceFor(status, 'AT-01')
    assert.equal(evidence, 'packed proof ran the tarball')
    assert.equal(typeof evidence, 'string')
  })

  it('returns null for a legacy acceptance string and for a missing record', () => {
    assert.equal(normalizeEvidenceFor({ requirements: {}, acceptance: { 'AT-02': 'PARTIAL' } }, 'AT-02'), null)
    assert.equal(normalizeEvidenceFor({ requirements: {}, acceptance: {} }, 'AT-03'), null)
    assert.equal(normalizeEvidenceFor(undefined, 'AT-01'), null)
  })

  it('never returns an object even when the record is malformed', () => {
    const status = {
      requirements: { 'BASE-02': { status: 'PARTIAL', evidence: { not: 'text' } } },
      acceptance: { 'AT-01': { status: 'PARTIAL' } },
    }
    assert.equal(normalizeEvidenceFor(status, 'BASE-02'), null)
    assert.equal(normalizeEvidenceFor(status, 'AT-01'), null)
  })
})

describe('inventory/content comparators — drift is visible to --check', () => {
  const base = {
    id: 'BASE-01',
    requirementStatus: 'DONE',
    testStatus: 'PASS',
    evidence: 'kept',
    summary: 'Improve the existing package',
  }

  it('reports no drift for identical records', () => {
    assert.deepEqual(inventoryDrift([base], [{ ...base }]), [])
  })

  it('reports a changed status and a changed evidence string', () => {
    const other = { ...base, requirementStatus: 'PARTIAL', testStatus: 'FAIL', evidence: 'other' }
    const reasons = inventoryDrift([base], [other])
    assert.ok(reasons.some(reason => reason.includes('BASE-01') && reason.includes('requirementStatus')))
    assert.ok(reasons.some(reason => reason.includes('BASE-01') && reason.includes('evidence')))
  })

  it('reports missing and orphaned records', () => {
    const missing = inventoryDrift([], [{ ...base }])
    assert.ok(missing.some(reason => reason.includes('missing')))
    const orphan = inventoryDrift([{ ...base, id: 'BASE-99' }], [{ ...base }])
    assert.ok(orphan.some(reason => reason.includes('BASE-99') && reason.includes('spec inventory')))
  })

  it('reports count drift', () => {
    assert.deepEqual(countDrift({ PASS: 1, FAIL: 0 }, { PASS: 1, FAIL: 0 }), [])
    const reasons = countDrift({ PASS: 1, FAIL: 0 }, { PASS: 0, FAIL: 1 })
    assert.ok(reasons.some(reason => reason.includes('PASS')))
    assert.ok(reasons.some(reason => reason.includes('FAIL')))
  })

  it('normalises only the volatile release-report header', () => {
    const a = 'Generated 2026-10-25T14:54:08Z from commit `abc` (DIRTY).\n\n# Report\nbody\n'
    const b = 'Generated 2026-11-01T00:00:00Z from commit `def`.\n\n# Report\nbody\n'
    assert.equal(stripReleaseVolatility(a), stripReleaseVolatility(b))
    assert.match(stripReleaseVolatility(a), /# Report/)
  })
})

describe('the committed artifacts satisfy the generator contract', () => {
  it('every inventory summary is a non-empty string', () => {
    const inventory = JSON.parse(readFileSync(REQUIREMENTS, 'utf8'))
    const empty = inventory.requirements.filter(entry => typeof entry.summary !== 'string' || entry.summary.length === 0)
    assert.deepEqual(empty.map(entry => entry.id), [], 'these requirements lost their summary')
  })

  it('every evidence field is a string or null, never an object', () => {
    const inventory = JSON.parse(readFileSync(REQUIREMENTS, 'utf8'))
    const offenders = inventory.requirements.filter(entry => entry.evidence !== null && typeof entry.evidence !== 'string')
    assert.deepEqual(offenders.map(entry => entry.id), [], 'evidence must be text or null')
  })

  it('evidence.json carries string-or-null evidence too', () => {
    if (!existsSync(EVIDENCE)) return
    const evidence = JSON.parse(readFileSync(EVIDENCE, 'utf8'))
    const offenders = evidence.requirements.filter(entry => entry.evidence !== null && typeof entry.evidence !== 'string')
    assert.deepEqual(offenders.map(entry => entry.id), [], 'evidence must be text or null')
  })

  it('--check content sees the committed artifacts as current', () => {
    const result = checkArtifacts()
    assert.deepEqual(result.reasons, [], 'verification artifacts are stale; run `node scripts/gen-verification.mjs`')
    assert.equal(result.ok, true)
  })

  it('--release-gate does not rewrite the evidence artifacts', () => {
    const before = readFileSync(EVIDENCE, 'utf8')
    try {
      execFileSync('node', ['scripts/gen-verification.mjs', '--release-gate'], { stdio: 'pipe' })
    } catch {
      // The gate is expected to exit nonzero while requirements are unresolved.
    }
    assert.equal(
      readFileSync(EVIDENCE, 'utf8'),
      before,
      'the release gate must not mutate the evidence it is gating',
    )
  })
})
