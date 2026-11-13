/** AT-23 — distribution is a recorded decision, distinct from native/export state. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLicenseBases, recordLicenseBasis } from '../src/license-basis.ts'

const dirs: string[] = []
after(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'license-basis-'))
  dirs.push(dir)
  return dir
}

describe('AT-23 — native, export and distribution decisions are separate', () => {
  it('records a distribution grant without turning on export', () => {
    const dir = scratch()
    const record = recordLicenseBasis(
      dir,
      '@author/source-available',
      { native: true, export: false, distribution: true, telemetry: false },
      'lead',
      () => new Date('2026-11-05T00:00:00.000Z'),
    )
    assert.equal(record.native, true)
    assert.equal(record.export, false)
    assert.equal(record.distribution, true)
    assert.equal(record.principal, 'lead')
    const stored = readLicenseBases(dir)['@author/source-available']
    assert.deepEqual(stored, record)
  })

  it('preserves other providers when one decision changes', () => {
    const dir = scratch()
    recordLicenseBasis(dir, 'provider-a', { native: true }, 'a', () => new Date(0))
    recordLicenseBasis(dir, 'provider-b', { distribution: true }, 'b', () => new Date(0))
    const all = readLicenseBases(dir)
    assert.equal(all['provider-a']?.native, true)
    assert.equal(all['provider-b']?.distribution, true)
    assert.equal(all['provider-a']?.distribution, false)
  })

  it('a malformed record reads as empty rather than fabricating consent', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'license-bases.json'), '{"provider-a": "yes"}')
    assert.deepEqual(readLicenseBases(dir), {})
  })
})