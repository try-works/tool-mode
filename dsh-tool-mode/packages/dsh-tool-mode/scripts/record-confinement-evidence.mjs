#!/usr/bin/env node
/**
 * Record the CODE-09 confinement evidence for THIS build.
 *
 * This is the operator's release path for hosted code mode:
 *
 *   1. run this script;
 *   2. it runs the confinement acceptance suite on the real Node PTC backend;
 *   3. ONLY when the suite passes does it write the artifact;
 *   4. start the host with DSH_PTC_CONFINEMENT_EVIDENCE=<artifact>.
 *
 * The artifact is refused by the runtime when it is stale (different package version),
 * recorded on another platform, failed, malformed or names no test — so "a file exists"
 * is never mistaken for evidence.
 *
 * Usage:
 *   node packages/dsh-tool-mode/scripts/record-confinement-evidence.mjs
 *   node ... --out verification/ptc-confinement-evidence.json
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(dirname(packageDir))

/** The suite that proves confinement. */
const TESTS = ['packages/dsh-tool-mode/tests/ptc-sandbox.test.ts']

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

const output = resolve(arg('out', join(repoRoot, 'verification', 'ptc-confinement-evidence.json')))
const command = ['--import', 'tsx', '--test', ...TESTS]

/**
 * The suite's temp root must be a directory where the sandbox can PROVISION an ACL.
 *
 * On Windows the workspace-write arm grants write through the DACL of the workspace and
 * its private temp directory. `%TEMP%` is often a directory whose inherited ACL grants
 * only the groups, so the medium-integrity caller has no WRITE_DAC and the sandbox
 * reports `SetNamedSecurityInfoW failed (Win32 5)` — a real environment limitation that
 * made every workspace-write test skip. A dedicated root with an explicit FullControl
 * ACE for the current user removes the limitation instead of hiding it.
 */
const tempRoot = join(dirname(repoRoot), '.dsh-confinement-tmp')
mkdirSync(join(tempRoot, 'ws'), { recursive: true })
mkdirSync(join(tempRoot, 'tmp'), { recursive: true })
if (process.platform === 'win32') {
  const user = `${process.env['USERDOMAIN'] ?? ''}\\${process.env['USERNAME'] ?? ''}`
  const granted = spawnSync('icacls', [tempRoot, '/grant', `${user}:(OI)(CI)F`, '/T'], { encoding: 'utf8' })
  if (granted.status !== 0) {
    process.stderr.write(`record-confinement-evidence: could not grant the temp root ACL: ${granted.stdout ?? ''}`
      + `${granted.stderr ?? ''}\n`)
    process.exit(1)
  }
}

const run = spawnSync(process.execPath, command, {
  cwd: repoRoot,
  encoding: 'utf8',
  // The suite reads TMP/TEMP at run time; pointing them at the provisioned root is what
  // lets the workspace-write arm start.
  env: { ...process.env, TMP: tempRoot, TEMP: tempRoot },
  maxBuffer: 64 * 1024 * 1024,
})
const stdout = `${run.stdout ?? ''}\n${run.stderr ?? ''}`

/** Read one `ℹ tests N` style count, or undefined when the runner did not print it. */
function count(label) {
  const match = new RegExp(`^ℹ ${label} (\\d+)$`, 'm').exec(stdout)
  return match === null ? undefined : Number(match[1])
}

const tests = count('tests')
const pass = count('pass')
const fail = count('fail')
const skipped = count('skipped') ?? 0

/**
 * Full coverage, not "some tests passed".
 *
 * A skipped workspace-write arm is not evidence of workspace-write confinement: the gate
 * would be opening on the read-only arm alone. Each of these must appear as a PASS.
 */
const REQUIRED_PASSES = [
  /read-only REFUSES a write/,
  /workspace-write is AVAILABLE/,
  /workspace-write PERMITS a write inside the workspace/,
  /workspace-write REFUSES a write OUTSIDE the workspace/,
  /reports the ENFORCEMENT the sandbox actually applied/,
]
const passedLines = stdout.split('\n').filter(line => line.includes('✔'))
const missing = REQUIRED_PASSES.filter(pattern => !passedLines.some(line => pattern.test(line)))

if (run.status !== 0 || fail === undefined || fail !== 0 || pass === undefined || pass === 0
  || skipped !== 0 || missing.length > 0) {
  process.stderr.write('record-confinement-evidence: the confinement suite did not pass COMPLETELY; '
    + 'NO evidence was written\n')
  if (missing.length > 0) {
    process.stderr.write(`  missing passing arms: ${missing.map(pattern => pattern.source).join(' | ')}\n`)
  }
  process.stderr.write(`  counts: tests=${String(tests)} pass=${String(pass)} fail=${String(fail)} skipped=${String(skipped)}\n`)
  process.stderr.write(stdout.split('\n').slice(-40).join('\n'))
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
mkdirSync(dirname(output), { recursive: true })
const evidence = {
  kind: 'ptc-confinement-evidence',
  version: 1,
  passed: true,
  generatedAt: new Date().toISOString(),
  packageVersion: manifest.version,
  platform: process.platform,
  node: process.version,
  tests: TESTS,
  command: `node ${command.join(' ')}`,
  counts: { tests, pass, fail, skipped },
}
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`)
/**
 * Also write the STANDARD LOCAL artifact. The runtime reads it when the environment names
 * no path, which is the case for a host started normally — requiring a wrapper launcher
 * for the only release path would leave the gate effectively closed.
 */
const homeArtifact = join(homedir(), '.dsh', 'ptc-confinement-evidence.json')
mkdirSync(dirname(homeArtifact), { recursive: true })
writeFileSync(homeArtifact, `${JSON.stringify(evidence, null, 2)}\n`)
process.stdout.write(`confinement evidence written: ${output}\n`
  + `  also installed for normal hosts: ${homeArtifact}\n`
  + `  package ${manifest.version} · ${tests} tests, ${pass} pass, ${fail} fail, ${skipped} skipped\n`)
if (!existsSync(output)) process.exit(1)
