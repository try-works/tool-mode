/**
 * R3 (0.5.106 verification rendered mid-token) — TDD red test.
 *
 * The report's stored verification is 176 characters with SIX word->code mappings and a
 * closing instruction. At ~60 characters the prompt showed one-and-a-bit mappings, cut
 * MID-TOKEN (`'Terve'->h...`), so a solver knew "short words are unreliable" but not WHICH
 * words — the difference the programme measured between 2/2 correct and 2/2 wrong.
 *
 * Contract pinned here:
 * - the whole value renders for the TOP candidate and for a SUPPORTING artifact;
 * - every word->code pair and the closing instruction survive;
 * - no rendered value ends mid-token;
 * - a value over the explicit budget is cut at a WORD boundary and ends with the pointer
 *   `… read the full text with tool_mode_tools {action:'get'}`;
 * - the 1000-character / 6-line cap still holds.
 *
 * @module tests/verification-fidelity
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildDirectiveDigest,
  DIRECTIVE_DIGEST_MAX_CHARS,
  DIRECTIVE_DIGEST_MAX_LINES,
} from '../src/library-digest.ts'
import type { AdoptionDigestCandidate } from '../src/adoption-digest-ranking.ts'

/** The report's stored value, verbatim (176 characters). */
const REPORT_VERIFICATION =
  "Mislabels short one-word items: 'Tere'->da, 'Terve'->hu, 'Dobry'->sk, 'Hej'->pl, 'Labas'->lv, "
  + "a 'Por favor' in the pt block->st. Check those items yourself; other labels agree."

/** The six mappings, as they appear in the stored value. */
const SIX_MAPPINGS = [
  /'Tere'->da/,
  /'Terve'->hu/,
  /'Dobry'->sk/,
  /'Hej'->pl/,
  /'Labas'->lv/,
  /'Por favor' in the pt block->st/,
]

const CLOSING = 'Check those items yourself; other labels agree.'
const POINTER = "… read the full text with tool_mode_tools {action:'get'}"

/** One caller-visible artifact. */
function candidate(
  overrides: Partial<AdoptionDigestCandidate> & { readonly name: string },
): AdoptionDigestCandidate {
  return {
    callableName: overrides.name,
    description: 'Count languages across a list of texts.',
    scope: 'workspace',
    uses: 0,
    failures: 0,
    ...overrides,
  }
}

/** Assert the whole verification contract for one rendered digest. */
function assertFull(value: string, digest: string): void {
  assert.ok(value.length === 176, 'the report value is 176 characters; got ' + String(value.length))
  for (const mapping of SIX_MAPPINGS) {
    assert.match(digest, mapping, 'missing mapping ' + String(mapping))
  }
  assert.ok(digest.includes(CLOSING), 'the closing instruction must render')
  assert.ok(digest.includes(value), 'the WHOLE value must render when it fits')
  assert.equal(digest.includes(POINTER), false, 'a value that fits needs no pointer')
  // No mid-token cut of a mapping: an arrow must not be followed by an ellipsis.
  assert.doesNotMatch(digest, /->\S*…/, 'a rendered value must not end mid-token')
}

describe('R3 — verification renders in full for the top candidate', () => {
  it('renders all six mappings and the closing instruction', () => {
    const digest = buildDirectiveDigest([
      candidate({ name: 'agent_from_draft_051ab807', verification: REPORT_VERIFICATION, unverified: true }),
    ])
    assertFull(REPORT_VERIFICATION, digest)
    assert.match(digest, /^Use agent_from_draft_051ab807\b/m)
    assert.ok(digest.length <= DIRECTIVE_DIGEST_MAX_CHARS)
    assert.ok(digest.split('\n').length <= DIRECTIVE_DIGEST_MAX_LINES)
  })
})

describe('R3 — verification renders in full for a SUPPORTING artifact', () => {
  it('carries every mapping when the artifact ranks second', () => {
    const digest = buildDirectiveDigest([
      candidate({ name: 'top_flow', description: 'Builds a summary.', lastUsedAt: '2026-06-02T00:00:00.000Z' }),
      candidate({ name: 'agent_supporting', verification: REPORT_VERIFICATION, unverified: true }),
    ])
    const supporting = digest.split('\n').find(line => line.startsWith('Also available:'))
    assert.ok(supporting !== undefined, 'the supporting artifact must have a line')
    assertFull(REPORT_VERIFICATION, supporting)
    assert.ok(digest.length <= DIRECTIVE_DIGEST_MAX_CHARS)
    assert.ok(digest.split('\n').length <= DIRECTIVE_DIGEST_MAX_LINES)
  })
})

describe('R3 — an over-budget value is cut at a WORD boundary with the explicit pointer', () => {
  const TAIL = Array.from({ length: 40 }, (_, index) => 'token' + String(index)).join(' ')
  const LONG = REPORT_VERIFICATION + ' Additional context: ' + TAIL

  it('ends with the pointer and never splits a token', () => {
    const digest = buildDirectiveDigest([
      candidate({ name: 'agent_long_verify', verification: LONG, unverified: true }),
    ])
    assert.ok(digest.includes(POINTER), 'the pointer is not optional: ' + digest)
    assert.ok(digest.trimEnd().endsWith(POINTER), 'the clause ENDS with the pointer')
    const clause = digest.slice(digest.indexOf('Verify: ') + 'Verify: '.length, digest.indexOf(POINTER)).trimEnd()
    // The cut is at whitespace, and the last emitted token is a COMPLETE source word.
    const sourceWords = new Set(LONG.split(/\s+/))
    const lastWord = clause.split(/\s+/).pop() ?? ''
    assert.ok(sourceWords.has(lastWord), 'the last emitted token must be a whole source word, got ' + JSON.stringify(lastWord))
    assert.doesNotMatch(clause, /->\S*$/, 'the cut must not leave a dangling mapping')
    // The explicit budget covers value + pointer.
    assert.ok((clause + ' ' + POINTER).length <= 240, 'budget: ' + String((clause + ' ' + POINTER).length))
  })
})

describe('R3 — the documented 1000-character / 6-line cap still holds', () => {
  it('stays within the cap with many long-verification candidates', () => {
    const rows = Array.from({ length: 12 }, (_, index) => candidate({
      name: 'flow_' + String(index),
      description: 'A long purpose sentence that keeps going to exercise the bound. '.repeat(3),
      verification: REPORT_VERIFICATION + ' extra detail ' + String(index),
      lastUsedAt: '2026-06-01T00:00:00.000Z',
    }))
    const digest = buildDirectiveDigest(rows)
    assert.ok(digest.length <= DIRECTIVE_DIGEST_MAX_CHARS, 'length ' + String(digest.length))
    assert.ok(digest.split('\n').length <= DIRECTIVE_DIGEST_MAX_LINES, 'lines ' + String(digest.split('\n').length))
    assert.match(digest, /^Use /)
    // Cap enforcement drops WHOLE lines/entries; it must never slice mid-token.
    assert.doesNotMatch(digest, /->\S*…/)
  })
})
