import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildLibraryDigest } from '../src/library-digest.ts'

const rows = [
  { name: 'g1_lang_counts', callableName: 'workflow_g1_lang_counts', description: 'Language counts over texts[].' },
  { name: 'agent_echo', callableName: 'agent_echo', description: 'Echo one value.' },
  { name: 'too_many', callableName: 'workflow_too_many', description: 'Should be capped.' },
  { name: 'fourth', callableName: 'workflow_fourth', description: 'Also capped.' },
  { name: 'fifth', callableName: 'workflow_fifth', description: 'Also capped.' },
]

describe('library digest', () => {
  it('is empty with no rows', () => {
    assert.equal(buildLibraryDigest([]), '')
  })

  it('shows both names and caps at four lines', () => {
    const text = buildLibraryDigest(rows)
    assert.match(text, /workflow_g1_lang_counts/)
    assert.match(text, /stored/)
    assert.match(text, /g1_lang_counts/)
    assert.equal(text.split('\n').filter(line => line.startsWith('- ')).length, 4)
    assert.doesNotMatch(text, /fifth/)
  })

  it('adds evidence only after five uses', () => {
    const low = buildLibraryDigest([{ ...rows[0]!, uses: 4, sessions: 1, failures: 0 }])
    assert.doesNotMatch(low, /uses/)
    const high = buildLibraryDigest([{ ...rows[0]!, uses: 5, sessions: 2, failures: 1 }])
    assert.match(high, /5 uses\/2 sessions\/1 failures/)
  })

  it('stays under the character cap by dropping whole lines', () => {
    const text = buildLibraryDigest(rows, { maxChars: 200 })
    assert.ok(text.length <= 200)
    assert.ok(text.split('\n').every(line => line.length < 200))
  })
})
