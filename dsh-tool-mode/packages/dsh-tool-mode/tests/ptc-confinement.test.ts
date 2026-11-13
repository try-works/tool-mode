/**
 * CODE-09 confinement evidence: artifact validation and the exposure gate.
 *
 * The gate used to be a module flag with a test-only setter, so a real deployment could
 * never serve `tool_mode_run` — the very tests the specification names had no way to
 * record their result. These tests pin the operator path: the artifact is validated
 * (kind, version, pass, package version, platform, timestamp, test list, command) and
 * ANY defect closes the gate with a reason; only a matching, passing artifact opens it,
 * and only together with the CODE-10 operator grant.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  checkConfinementEvidence,
  CONFINEMENT_EVIDENCE_ENV,
  CONFINEMENT_EVIDENCE_KIND,
} from '../src/ptc-confinement.ts'
import {
  confinementDemonstrated,
  confinementEvidenceReason,
  mayExposeToClients,
  resetConfinementEvidenceCacheForTest,
} from '../src/ptc-runtime.ts'
import { PACKAGE_VERSION } from '../src/version.ts'
import { cleanup, tempDir } from './helpers.ts'

afterEach(() => {
  delete process.env[CONFINEMENT_EVIDENCE_ENV]
  resetConfinementEvidenceCacheForTest()
})
process.on('exit', () => { void cleanup() })

/** Write an artifact and return its path. */
function artifact(overrides: Record<string, unknown> = {}): string {
  const directory = tempDir()
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'ptc-confinement-evidence.json')
  writeFileSync(path, JSON.stringify({
    kind: CONFINEMENT_EVIDENCE_KIND,
    version: 1,
    passed: true,
    generatedAt: '2026-10-21T00:00:00.000Z',
    packageVersion: PACKAGE_VERSION,
    platform: process.platform,
    node: process.version,
    tests: ['packages/dsh-tool-mode/tests/ptc-sandbox.test.ts'],
    command: 'node --import tsx --test packages/dsh-tool-mode/tests/ptc-sandbox.test.ts',
    counts: { tests: 5, pass: 5, fail: 0, skipped: 0 },
    ...overrides,
  }))
  return path
}

/** Run the validator over an artifact with overrides. */
function check(overrides: Record<string, unknown> = {}, env: Record<string, string | undefined> = {}) {
  return checkConfinementEvidence({
    env: { [CONFINEMENT_EVIDENCE_ENV]: artifact(overrides), ...env },
    expectedVersion: PACKAGE_VERSION,
  })
}

describe('the confinement evidence artifact is validated, not merely read', () => {
  it('accepts a passing artifact recorded for this package and platform', () => {
    const outcome = check()
    assert.equal(outcome.ok, true, JSON.stringify(outcome))
  })

  it('names the configuration when no artifact is configured', () => {
    const outcome = checkConfinementEvidence({ env: {}, expectedVersion: PACKAGE_VERSION })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.present, false)
    assert.match(outcome.reason, new RegExp(CONFINEMENT_EVIDENCE_ENV))
  })

  it('refuses a missing or unreadable file', () => {
    const outcome = checkConfinementEvidence({
      env: { [CONFINEMENT_EVIDENCE_ENV]: join(tempDir(), 'absent.json') },
      expectedVersion: PACKAGE_VERSION,
    })
    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.match(outcome.reason, /cannot be read/)
  })

  it('refuses malformed JSON, a wrong kind, a failed run and a stale version', () => {
    const malformed = checkConfinementEvidence({
      env: { [CONFINEMENT_EVIDENCE_ENV]: writeRaw('{ not json') },
      expectedVersion: PACKAGE_VERSION,
    })
    assert.equal(malformed.ok, false)
    if (!malformed.ok) assert.match(malformed.reason, /not JSON/)

    const wrongKind = check({ kind: 'something-else' })
    assert.equal(wrongKind.ok, false)
    if (!wrongKind.ok) assert.match(wrongKind.reason, /kind/)

    const failed = check({ passed: false })
    assert.equal(failed.ok, false)
    if (!failed.ok) assert.match(failed.reason, /passing run/)

    const stale = check({ packageVersion: '0.0.1' })
    assert.equal(stale.ok, false)
    if (!stale.ok) assert.match(stale.reason, /re-run scripts\/record-confinement-evidence\.mjs/)
  })

  it('falls back to the standard local artifact when no path is configured', () => {
    const outcome = checkConfinementEvidence({
      env: {},
      expectedVersion: PACKAGE_VERSION,
      defaultPath: artifact(),
    })
    assert.equal(outcome.ok, true, JSON.stringify(outcome))
  })

  it('does NOT fall back when the configured path is bad', () => {
    // An explicit but broken path must fail closed: silently using another artifact would
    // make the configuration meaningless.
    const outcome = checkConfinementEvidence({
      env: { [CONFINEMENT_EVIDENCE_ENV]: join(tempDir(), 'absent.json') },
      expectedVersion: PACKAGE_VERSION,
      defaultPath: artifact(),
    })
    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.match(outcome.reason, /cannot be read/)
  })
  it('refuses an artifact whose arms were SKIPPED', () => {
    // The old recorder wrote 2 pass / 3 skipped and called it evidence. A skip is an arm
    // that never ran, so the artifact is refused and the gate stays closed.
    const partial = check({ counts: { tests: 5, pass: 2, fail: 0, skipped: 3 } })
    assert.equal(partial.ok, false)
    if (!partial.ok) assert.match(partial.reason, /none skipped/)

    const noCounts = check({ counts: undefined })
    assert.equal(noCounts.ok, false)
    if (!noCounts.ok) assert.match(noCounts.reason, /carries no test counts/)
  })
  it('refuses another platform, an invalid timestamp, an empty test list and no command', () => {
    const wrongPlatform = check({ platform: process.platform === 'win32' ? 'linux' : 'win32' })
    assert.equal(wrongPlatform.ok, false)
    if (!wrongPlatform.ok) assert.match(wrongPlatform.reason, /recorded on/)

    const badTime = check({ generatedAt: 'yesterday-ish' })
    assert.equal(badTime.ok, false)
    if (!badTime.ok) assert.match(badTime.reason, /generatedAt/)

    const noTests = check({ tests: [] })
    assert.equal(noTests.ok, false)
    if (!noTests.ok) assert.match(noTests.reason, /names no test file/)

    const noCommand = check({ command: '' })
    assert.equal(noCommand.ok, false)
    if (!noCommand.ok) assert.match(noCommand.reason, /no command line/)
  })
})

/** Write raw text and return its path. */
function writeRaw(text: string): string {
  const directory = tempDir()
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'ptc-confinement-evidence.json')
  writeFileSync(path, text)
  return path
}

describe('the exposure gate needs BOTH the operator grant and valid evidence', () => {
  it('stays closed without the operator grant even with valid evidence', () => {
    process.env[CONFINEMENT_EVIDENCE_ENV] = artifact()
    resetConfinementEvidenceCacheForTest()
    assert.equal(confinementDemonstrated(), true)
    assert.equal(mayExposeToClients(false), false, 'evidence cannot stand in for consent')
    assert.equal(confinementEvidenceReason(), undefined, 'the evidence half is open')
  })

  it('opens only when the grant and a valid artifact are both present', () => {
    process.env[CONFINEMENT_EVIDENCE_ENV] = artifact()
    resetConfinementEvidenceCacheForTest()
    assert.equal(mayExposeToClients(true), true)
  })

  it('stays closed, with the reason, when the artifact is stale', () => {
    process.env[CONFINEMENT_EVIDENCE_ENV] = artifact({ packageVersion: '9.9.9' })
    resetConfinementEvidenceCacheForTest()
    assert.equal(mayExposeToClients(true), false)
    assert.match(confinementEvidenceReason() ?? '', /re-run scripts\/record-confinement-evidence\.mjs/)
  })
})
