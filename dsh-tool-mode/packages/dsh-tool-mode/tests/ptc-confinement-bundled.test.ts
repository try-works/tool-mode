/**
 * The Code Mode gate must be SELF-SUFFICIENT (task-50).
 *
 * The gate read ONE artifact — `~/.dsh/ptc-confinement-evidence.json` — pinned to the package
 * version. Every release therefore started with the gate closed (a 0.5.19 artifact blocked
 * 0.5.66), and a host installed normally had no artifact at all. The package now SHIPS the
 * artifact it recorded against the release build, validated by the SAME checks, as the last
 * candidate. These tests pin the order, the refusal, and the actionable message.
 *
 * @module tests/ptc-confinement-bundled
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  checkConfinementEvidence,
  CONFINEMENT_EVIDENCE_ENV,
  CONFINEMENT_EVIDENCE_KIND,
} from '../src/ptc-confinement.ts'
import {
  confinementDemonstrated,
  exposureWithheldReason,
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

/** The fields a case may override; a precise shape, not a dictionary. */
interface EvidenceOverrides {
  readonly kind?: string
  readonly version?: number
  readonly passed?: boolean
  readonly packageVersion?: string
  readonly platform?: string
  readonly generatedAt?: string
  readonly tests?: readonly string[]
  readonly command?: string
  readonly counts?: { readonly tests: number; readonly pass: number; readonly fail: number; readonly skipped: number }
}

/** Write an artifact and return its path. */
function artifact(overrides: EvidenceOverrides = {}): string {
  const directory = tempDir()
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `evidence-${Math.random().toString(36).slice(2)}.json`)
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

describe('the evidence candidate order: env → home → bundled', () => {
  it('accepts the SHIPPED artifact when env and home are absent', () => {
    const outcome = checkConfinementEvidence({
      env: {},
      expectedVersion: PACKAGE_VERSION,
      bundledPath: artifact(),
    })
    assert.equal(outcome.ok, true, JSON.stringify(outcome))
    if (outcome.ok) assert.equal(outcome.source, 'bundled')
  })

  it('refuses a STALE shipped artifact, with the version reason', () => {
    const outcome = checkConfinementEvidence({
      env: {},
      expectedVersion: PACKAGE_VERSION,
      bundledPath: artifact({ packageVersion: '0.0.1' }),
    })
    assert.equal(outcome.ok, false)
    if (!outcome.ok) {
      assert.equal(outcome.present, true)
      assert.match(outcome.reason, /recorded for package version/)
    }
  })

  it('lets the env artifact WIN over the shipped one', () => {
    const outcome = checkConfinementEvidence({
      env: { [CONFINEMENT_EVIDENCE_ENV]: artifact() },
      expectedVersion: PACKAGE_VERSION,
      defaultPath: artifact(),
      bundledPath: artifact(),
    })
    assert.equal(outcome.ok, true)
    if (outcome.ok) assert.equal(outcome.source, 'env')
  })

  it('lets the HOME artifact win over the shipped one when env names none', () => {
    const outcome = checkConfinementEvidence({
      env: {},
      expectedVersion: PACKAGE_VERSION,
      defaultPath: artifact(),
      bundledPath: artifact(),
    })
    assert.equal(outcome.ok, true)
    if (outcome.ok) assert.equal(outcome.source, 'home')
  })

  it('falls back to the SHIPPED artifact from a broken explicit path, but never to HOME', () => {
    // The explicit path is operator intent for THEIR artifact, so it does not fall forward to
    // a second operator file — but the release's own evidence is a different thing, and this
    // is precisely the self-sufficiency the task requires.
    const toBundled = checkConfinementEvidence({
      env: { [CONFINEMENT_EVIDENCE_ENV]: join(tempDir(), 'absent.json') },
      expectedVersion: PACKAGE_VERSION,
      defaultPath: artifact(),
      bundledPath: artifact(),
    })
    assert.equal(toBundled.ok, true)
    if (toBundled.ok) assert.equal(toBundled.source, 'bundled')

    // Without a shipped artifact the same broken path fails closed, as it always did.
    const closed = checkConfinementEvidence({
      env: { [CONFINEMENT_EVIDENCE_ENV]: join(tempDir(), 'absent.json') },
      expectedVersion: PACKAGE_VERSION,
      defaultPath: artifact(),
    })
    assert.equal(closed.ok, false)
    if (!closed.ok) assert.match(closed.reason, /cannot be read/)
  })

  it('refuses a shipped artifact with a mismatched kind or schema version', () => {
    const wrongKind = checkConfinementEvidence({
      env: {}, expectedVersion: PACKAGE_VERSION, bundledPath: artifact({ kind: 'something-else' }),
    })
    assert.equal(wrongKind.ok, false)
    if (!wrongKind.ok) assert.match(wrongKind.reason, /kind/)

    const wrongSchema = checkConfinementEvidence({
      env: {}, expectedVersion: PACKAGE_VERSION, bundledPath: artifact({ version: 99 }),
    })
    assert.equal(wrongSchema.ok, false)
    if (!wrongSchema.ok) assert.match(wrongSchema.reason, /schema version/)
  })
})

describe('the gate opens on the artifact the package SHIPS', () => {
  it('is demonstrated with no env and no home artifact, once the shipped one is recorded', () => {
    delete process.env[CONFINEMENT_EVIDENCE_ENV]
    resetConfinementEvidenceCacheForTest()
    // THIS is the release path: an installed host needs no wrapper launcher and no operator
    // artifact. It fails until the bundled artifact is recorded for THIS package version.
    assert.equal(confinementDemonstrated(), true,
      'the shipped artifact must open the gate for the build it was recorded against')
    assert.equal(mayExposeToClients(true), true)
    assert.equal(mayExposeToClients(false), false, 'the operator grant is still required')
  })

  it('does NOT open the gate when neither the shipped nor the operator artifact is valid', () => {
    // The recorder also installs the HOME artifact, so disabling the shipped candidate alone
    // is not "no evidence" on a machine that has recorded. A stale operator path plus no
    // shipped artifact is the real closed state.
    process.env[CONFINEMENT_EVIDENCE_ENV] = artifact({ packageVersion: '0.0.1' })
    resetConfinementEvidenceCacheForTest({ bundledPath: null })
    assert.equal(confinementDemonstrated(), false)
    assert.equal(mayExposeToClients(true), false)
  })
})

describe('the refusal is actionable and leaks nothing', () => {
  it('names the missing evidence and the exact recovery command, without paths or versions', () => {
    resetConfinementEvidenceCacheForTest({ bundledPath: null })
    const message = exposureWithheldReason(true)
    assert.match(message, /no passing confinement evidence for this build/)
    assert.match(message, /node packages\/dsh-tool-mode\/scripts\/record-confinement-evidence\.mjs/)
    assert.match(message, /then restart DSH/)

    // The old message interpolated the validator reason, which printed the operator's home
    // directory and both package versions. Neither may appear.
    assert.doesNotMatch(message, /C:\\Users/i)
    assert.doesNotMatch(message, /\.dsh/)
    assert.doesNotMatch(message, new RegExp(PACKAGE_VERSION.replaceAll('.', '\\.')))
  })

  it('keeps the operator-grant refusal separate and equally actionable', () => {
    const message = exposureWithheldReason(false)
    assert.match(message, /operator has not granted hosted code execution/)
    assert.match(message, /hostedCode: true/)
    assert.match(message, /restart DSH/)
    assert.doesNotMatch(message, /confinement evidence for this build/)
  })
})

describe('scripts/check-confinement-evidence.mjs', () => {
  const script = fileURLToPath(new URL('../scripts/check-confinement-evidence.mjs', import.meta.url))

  it('exits zero for the artifact the package ships', () => {
    const run = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    assert.equal(run.status, 0, `${run.stdout ?? ''}\n${run.stderr ?? ''}`)
    assert.match(run.stdout ?? '', new RegExp(PACKAGE_VERSION.replaceAll('.', '\\.')))
  })

  it('exits nonzero for a stale artifact and names the fix', () => {
    const stale = artifact({ packageVersion: '0.0.1' })
    const run = spawnSync(process.execPath, [script, '--artifact', stale], { encoding: 'utf8' })
    assert.notEqual(run.status, 0)
    assert.match(run.stderr ?? '', /recorded for package version/)
  })

  it('exits nonzero when the artifact is missing', () => {
    const run = spawnSync(process.execPath, [script, '--artifact', join(tempDir(), 'absent.json')], { encoding: 'utf8' })
    assert.notEqual(run.status, 0)
    assert.match(run.stderr ?? '', /missing or unreadable/)
  })
})
