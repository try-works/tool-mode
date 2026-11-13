#!/usr/bin/env node
/**
 * CODE-09 — record REAL confinement evidence for the live host gate.
 *
 * This runs the Windows sandbox suite and the environment/process/network
 * denial probes, requires every test to pass with none skipped, and writes the
 * artifact shape `checkConfinementEvidence` validates. It never opens the gate
 * itself: the artifact only records what the suite actually did.
 *
 * Usage: node scripts/record-confinement-evidence.mjs [--out <path>]
 * Defaults to ~/.dsh/ptc-confinement-evidence.json.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, platform, release } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TESTS = [
  'packages/dsh-tool-mode/tests/ptc-sandbox.test.ts',
  'packages/dsh-tool-mode/tests/code09-probes.test.ts',
]
const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const OUT = outIndex === -1 ? join(homedir(), '.dsh', 'ptc-confinement-evidence.json') : resolve(args[outIndex + 1])
const tmp = process.env.TMP?.toLowerCase().startsWith('d:')
  ? process.env.TMP
  : existsSync('D:\\DEV\\dsh-temp') ? 'D:\\DEV\\dsh-temp' : process.env.TMP
const cli = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const command = [process.execPath, cli, '--test', ...TESTS].join(' ')
const run = spawnSync(process.execPath, [cli, '--test', ...TESTS], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 600_000,
  maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, ...tmp === undefined ? {} : { TMP: tmp, TEMP: tmp } },
})
const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
const number = pattern => {
  const matches = [...output.matchAll(pattern)]
  return matches.length === 0 ? undefined : Number(matches.at(-1)[1])
}
const tests = number(/^ℹ tests (\d+)$/gm)
const pass = number(/^ℹ pass (\d+)$/gm)
const fail = number(/^ℹ fail (\d+)$/gm)
const skipped = number(/^ℹ skipped (\d+)$/gm)
if (run.status !== 0 || tests === undefined || pass === undefined || fail === undefined || skipped === undefined
  || fail !== 0 || skipped !== 0 || pass !== tests || tests <= 0) {
  process.stderr.write(`confinement evidence NOT recorded: status=${String(run.status)} tests=${String(tests)} pass=${String(pass)} fail=${String(fail)} skipped=${String(skipped)}\n`)
  process.stderr.write(output.slice(-4000))
  process.exit(1)
}
const packageJson = JSON.parse(readFileSync(join(ROOT, 'packages', 'dsh-tool-mode', 'package.json'), 'utf8'))
const evidence = {
  kind: 'ptc-confinement-evidence',
  version: 1,
  passed: true,
  generatedAt: new Date().toISOString(),
  packageVersion: packageJson.version,
  platform: platform(),
  node: process.version,
  tests: TESTS.map(file => relative(ROOT, join(ROOT, file)).replace(/\\/g, '/')),
  command,
  counts: { tests, pass, fail, skipped },
  environment: { tmp, os: `${platform()} ${release()}` },
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`)
console.log(`CONFINEMENT-EVIDENCE-OK ${OUT} tests=${tests} pass=${pass} fail=${fail} skipped=${skipped}`)
