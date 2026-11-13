/**
 * `scripts/gen-models-index.mjs --check` gate behavior (task-22).
 *
 * The gate must be a TWO-WAY signal: a stale index exits 1 AND never prints the
 * success line, while a current index exits 0 AND prints it. Before the fix the
 * stale arm called fail() (exit 1) and still printed "models-index OK", so the
 * last line contradicted the exit code.
 *
 * Black-box on purpose: the stale arm runs a COPY of the real script against a
 * temp tree (its `root` is resolved from the script location, so no production
 * environment hook is needed), and the current arm runs the real repo gate.
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(import.meta.dirname, '..', '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'gen-models-index.mjs')
const SUCCESS_LINE = 'models-index OK'

const tempRoots = []
after(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true })
})

/** Build a temp tree that mirrors the real inputs the script reads. */
function tempTree() {
  const dir = mkdtempSync(join(tmpdir(), 'models-index-check-'))
  tempRoots.push(dir)
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'verification'), { recursive: true })
  copyFileSync(SCRIPT, join(dir, 'scripts', 'gen-models-index.mjs'))
  for (const pkg of readdirSync(join(ROOT, 'packages'))) {
    const lock = join(ROOT, 'packages', pkg, 'models.lock.json')
    if (!existsSync(lock)) continue
    // The script itself skips dsh-tool-mode (fixtures only); mirror only the
    // top-level package locks it actually reads.
    mkdirSync(join(dir, 'packages', pkg), { recursive: true })
    copyFileSync(lock, join(dir, 'packages', pkg, 'models.lock.json'))
  }
  for (const artifact of ['compatibility.json', 'quality-gates.json']) {
    copyFileSync(join(ROOT, 'verification', artifact), join(dir, 'verification', artifact))
  }
  return dir
}

function runCheck(script, cwd) {
  return spawnSync(process.execPath, [script, '--check'], { cwd, encoding: 'utf8' })
}

describe('models-index --check reports one consistent verdict', () => {
  it('stale index: exits 1 and prints NO success line', () => {
    const dir = tempTree()
    writeFileSync(join(dir, 'verification', 'models.lock.json'), JSON.stringify({
      schemaVersion: '0.0.0',
      generatedAt: '1999-01-01T00:00:00.000Z',
      extensions: [],
    }, null, 2))
    const result = runCheck(join(dir, 'scripts', 'gen-models-index.mjs'), dir)
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
    assert.equal(result.stdout.includes(SUCCESS_LINE), false,
      `a failed check must not print "${SUCCESS_LINE}"; stdout was:\n${result.stdout}`)
    assert.match(result.stderr, /stale/, `expected a stale diagnostic on stderr, got:\n${result.stderr}`)
  })

  it('current index: exits 0 and prints the success line', () => {
    const result = runCheck(SCRIPT, ROOT)
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
    assert.equal(result.stdout.includes(SUCCESS_LINE), true,
      `a current index must print "${SUCCESS_LINE}"; stdout was:\n${result.stdout}`)
  })
})
