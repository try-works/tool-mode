#!/usr/bin/env node
/**
 * Verify the confinement evidence the package SHIPS (task-50).
 *
 * The Code Mode gate runs `tool_mode_run` only when it can validate a passing artifact for
 * THIS package version. The shipped artifact is what makes an installed host work with no
 * wrapper launcher, so a release must never publish a package whose artifact is missing,
 * stale, failed or recorded for another platform. This check fails the release instead of
 * shipping a package whose gate silently stays closed.
 *
 * The checks MIRROR `src/ptc-confinement.ts` field for field (kind, schema version, pass,
 * package version, platform, timestamp, test list, full-pass counts, command); the shape is
 * asserted with a JSON schema so the types are validated, not guessed with `typeof`.
 *
 * Usage:
 *   node packages/dsh-tool-mode/scripts/check-confinement-evidence.mjs
 *   node ... --write          # run the recorder, then verify what it wrote
 *   node ... --artifact <p>   # verify a specific artifact (used by the tests)
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv from 'ajv'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

const artifact = resolve(arg('artifact', join(packageDir, 'verification', 'ptc-confinement-evidence.json')))

if (process.argv.includes('--write')) {
  const recorded = spawnSync(process.execPath, [join(packageDir, 'scripts', 'record-confinement-evidence.mjs'), '--out', artifact], {
    cwd: dirname(dirname(packageDir)),
    stdio: 'inherit',
  })
  if (recorded.status !== 0) process.exit(recorded.status ?? 1)
}

/**
 * Fail with one actionable line.
 * @param {string} message - what is wrong.
 */
function fail(message) {
  process.stderr.write(`check-confinement-evidence: ${message}\n`)
  process.stderr.write('  fix: node packages/dsh-tool-mode/scripts/record-confinement-evidence.mjs --out '
    + `${artifact.replaceAll('\\', '/')}\n`)
  process.exit(1)
}

/** The artifact's shape, mirroring the runtime validator's field list. */
const EVIDENCE_SCHEMA = {
  type: 'object',
  required: [
    'kind', 'version', 'passed', 'generatedAt', 'packageVersion',
    'platform', 'node', 'tests', 'command', 'counts',
  ],
  properties: {
    kind: { const: 'ptc-confinement-evidence' },
    version: { const: 1 },
    passed: { const: true },
    generatedAt: { type: 'string' },
    packageVersion: { type: 'string' },
    platform: { type: 'string' },
    node: { type: 'string' },
    tests: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    command: { type: 'string', minLength: 1 },
    counts: {
      type: 'object',
      required: ['tests', 'pass', 'fail', 'skipped'],
      properties: {
        tests: { type: 'integer', minimum: 1 },
        pass: { type: 'integer', minimum: 0 },
        fail: { type: 'integer', minimum: 0 },
        skipped: { type: 'integer', minimum: 0 },
      },
    },
  },
}

const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
let text
try {
  text = readFileSync(artifact, 'utf8')
} catch (error) {
  fail(`the shipped confinement evidence is missing or unreadable (${error instanceof Error ? error.message : String(error)})`)
}
let evidence
try {
  evidence = JSON.parse(text)
} catch (error) {
  fail(`the shipped confinement evidence is not JSON (${error instanceof Error ? error.message : String(error)})`)
}

const validate = new Ajv({ allErrors: true }).compile(EVIDENCE_SCHEMA)
if (!validate(evidence)) {
  const detail = (validate.errors ?? [])
    .map(entry => `${entry.instancePath === '' ? '/' : entry.instancePath} ${entry.message ?? ''}`.trim())
    .join('; ')
  fail(`the shipped confinement evidence is not a valid evidence artifact (${detail})`)
}
if (evidence.packageVersion !== manifest.version) {
  fail(`the shipped confinement evidence was recorded for package version ${JSON.stringify(evidence.packageVersion)}, `
    + `but this package is ${JSON.stringify(manifest.version)}`)
}
if (evidence.platform !== process.platform) {
  fail(`the shipped confinement evidence was recorded on ${JSON.stringify(evidence.platform)}, not ${JSON.stringify(process.platform)}`)
}
if (Number.isNaN(Date.parse(evidence.generatedAt))) {
  fail('the shipped confinement evidence has no valid generatedAt timestamp')
}
if (evidence.counts.pass !== evidence.counts.tests || evidence.counts.fail !== 0 || evidence.counts.skipped !== 0) {
  fail(`the shipped confinement evidence records ${evidence.counts.tests} tests, ${evidence.counts.pass} passed, `
    + `${evidence.counts.fail} failed, ${evidence.counts.skipped} skipped; every arm must pass with none skipped`)
}

process.stdout.write('confinement evidence OK — package ' + manifest.version
  + ` · ${evidence.counts.tests} tests, ${evidence.counts.pass} pass, ${evidence.counts.fail} fail, ${evidence.counts.skipped} skipped`
  + ` · recorded ${evidence.generatedAt} on ${evidence.platform}\n`)
