/** AT-88 — the combined release drift gate passes on this repo and fails on a bad digest. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(process.cwd(), 'scripts', 'check-release-drift.mjs')
const dirs: string[] = []
after(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function run(root?: string) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...root === undefined ? {} : { RELEASE_DRIFT_ROOT: root } },
  })
}

describe('AT-88 combined release drift gate', () => {
  it('passes on the current repository locks, assets, recipes and protocol', () => {
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /RELEASE-DRIFT-OK/)
    assert.match(result.stdout, /protocol=2026-07-28/)
  })

  it('fails with the file and field when an asset digest drifts', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-drift-'))
    dirs.push(root)
    const ext = join(root, 'packages', 'extension-x')
    const protocol = join(root, 'packages', 'dsh-tool-mode', 'src', 'mcp')
    mkdirSync(ext, { recursive: true })
    mkdirSync(protocol, { recursive: true })
    writeFileSync(join(protocol, 'protocol.ts'), "export const PROTOCOL_VERSION = '2026-07-28'\n")
    writeFileSync(join(ext, 'tool-mode.extension.json'), JSON.stringify({
      protocolVersion: '1.1.0',
      id: '@x/extension-x',
      models: [{ id: 'm', assetSet: 'set-x', assetLock: './models.lock.json' }],
    }))
    writeFileSync(join(ext, 'models.lock.json'), JSON.stringify({
      lockVersion: 1,
      assetSets: {
        'set-x': {
          model: { revision: '0123456789abcdef0123456789abcdef01234567' },
          engine: { version: '1.0.0' },
          tokenizer: { identity: 'fixture' },
          groups: [{
            id: 'g',
            assets: [{ id: 'asset-x', file: 'x.bin', bytes: 4, source: 'https://example.invalid/x', digest: 'deadbeef' }],
          }],
        },
      },
    }))
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /asset-x\.digest/)
    assert.match(result.stderr, /not a SHA-256\/512 hex digest/)
  })
})