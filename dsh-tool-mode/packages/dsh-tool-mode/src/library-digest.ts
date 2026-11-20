/**
 * The bounded library digest.
 *
 * `buildLibraryDigest` is the original neutral bullet list (kept for its existing callers).
 * `buildDirectiveDigest` is adoption plan Phase 3: ONE imperative line naming the
 * top-ranked artifact, its purpose, an evidence-backed known failure, a five-use evidence
 * line and a compact non-imperative list of the rest. Four lines / 600 characters at most,
 * recomputed per call, caller-scope isolated, and empty when the flag is off.
 *
 * @module library-digest
 */

import {
  rankAdoptionCandidates,
  type AdoptionDigestCandidate,
} from './adoption-digest-ranking.ts'

/** Default cap for the directive digest, as the plan requires. */
export const DIRECTIVE_DIGEST_MAX_CHARS = 600
/** Default line cap for the directive digest. */
export const DIRECTIVE_DIGEST_MAX_LINES = 4
/** Purpose and known-failure fragments stay single-line and bounded. */
const FRAGMENT_MAX_CHARS = 120
/** Supporting artifacts listed without an imperative. */
const DEFAULT_MAX_SUPPORTING = 3

/** One artifact line. */
export interface LibraryDigestRow {
  readonly name: string
  readonly callableName: string
  readonly description: string
  readonly uses?: number
  readonly sessions?: number
  readonly failures?: number
  readonly scope?: string
}

/** Options. */
export interface LibraryDigestOptions {
  readonly maxLines?: number
  readonly maxChars?: number
}

const DEFAULT_MAX_LINES = 4
const DEFAULT_MAX_CHARS = 600

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

/** Options for the directive digest. */
export interface DirectiveDigestOptions extends LibraryDigestOptions {
  /** The adoption flag; false emits no text at all. Defaults to true. */
  readonly enabled?: boolean
  /** The caller's session id; session-scope rows are visible only to their own caller. */
  readonly sessionId?: string
  /** How many other artifacts to name in the compact list. Defaults to 3. */
  readonly maxSupporting?: number
}

/** End a fragment with a period exactly once. */
function sentence(text: string): string {
  return text.endsWith('.') ? text : text + '.'
}

/**
 * Render the evidence line (allowed from five uses).
 *
 * Counts always state what was observed. A percentage is added only when a failure was
 * actually observed: a "0% failed" clause would read like a success claim the evidence does
 * not support.
 */
function evidenceLine(candidate: AdoptionDigestCandidate): string {
  const plural = candidate.failures === 1 ? 'failure' : 'failures'
  const percent = candidate.failures === 0
    ? ''
    : ' (' + String(Math.round((candidate.failures / Math.max(1, candidate.uses)) * 100)) + '% failed)'
  // Only claim sessions when the caller actually observed some: an unknown or zero count
  // printed as "0 sessions" would assert a fact from no data.
  const sessions = candidate.sessions !== undefined && candidate.sessions > 0
    ? ' across ' + String(candidate.sessions) + (candidate.sessions === 1 ? ' session' : ' sessions')
    : ''
  return 'Evidence: ' + String(candidate.uses) + ' uses, ' + String(candidate.failures) + ' ' + plural
    + sessions + percent + '.'
}

/**
 * Build the directive digest (adoption plan Phase 3).
 *
 * Exactly one line is imperative: `Use <callableName> — <purpose>`. A `Known failure:` line
 * appears only when the evidence carries a failure class; a counts/percentage line appears
 * only from five uses; the remaining candidates are one compact `Also available:` line.
 * @param rows - caller-visible artifacts and evidence.
 * @param options - flag, caller session, caps.
 * @returns the prompt text, or an empty string when disabled or nothing is eligible.
 */
export function buildDirectiveDigest(
  rows: readonly AdoptionDigestCandidate[],
  options: DirectiveDigestOptions = {},
): string {
  if (options.enabled === false) return ''
  const maxChars = Math.max(80, options.maxChars ?? DIRECTIVE_DIGEST_MAX_CHARS)
  const maxLines = Math.max(1, options.maxLines ?? DIRECTIVE_DIGEST_MAX_LINES)
  const maxSupporting = Math.max(0, options.maxSupporting ?? DEFAULT_MAX_SUPPORTING)

  const visible = rows.filter(row => row.scope !== 'session'
    || (options.sessionId !== undefined && row.sessionId === options.sessionId))
  const ranked = rankAdoptionCandidates(visible)
  const top = ranked[0]
  if (top === undefined) return ''

  const callableName = oneLine(top.callableName)
  const purpose = truncate(oneLine(top.description), FRAGMENT_MAX_CHARS)
  /**
   * Name BOTH identities when they differ: the caller invokes `callableName`, but the
   * stored row is `name`, and the existing neutral section showed both. Dropping the
   * stored name would make the new digest strictly less useful for lookup.
   */
  const stored = top.name === top.callableName ? '' : ' (stored ' + truncate(oneLine(top.name), 60) + ')'
  const unverified = top.unverified === true ? ' (auto-kept, unverified)' : ''
  /* The shape is part of the directive: E15 showed the artifact was used but its
   * `texts[]` batch was ignored, so the call form must be visible before the first call. */
  const callSignature = top.callSignature === undefined || top.callSignature.length === 0 ? '' : '(' + oneLine(top.callSignature) + ')'
  const batchHint = top.batch === true ? ' Pass the whole list in one call.' : ''
  /**
   * The usage counters record exceptions, not correctness: a draft with 61 calls and
   * 0 failures was still wrong. An auto-kept row therefore gets a verification
   * instruction and NO evidence claim; only a kept row may show the counters.
   */
  const verify = top.unverified === true
    ? ' Verify its output on edge cases before relying on it.'
    : ''
  const lines: string[] = [purpose.length === 0
    ? 'Use ' + callableName + callSignature + stored + unverified + '.' + batchHint + verify
    : 'Use ' + callableName + callSignature + stored + unverified + ' — ' + sentence(purpose) + batchHint + verify]
  const knownFailure = top.knownFailure === undefined ? undefined : truncate(oneLine(top.knownFailure), FRAGMENT_MAX_CHARS)
  // The five-use rule gates the caveat and its counts together: a one-use failure is real
  // evidence, but it is not enough to advertise a "known failure" mode yet.
  if (top.uses >= 5 && knownFailure !== undefined && knownFailure.length > 0) {
    lines.push('Known failure: ' + sentence(knownFailure))
  }
  if (top.uses >= 5 && top.unverified !== true) lines.push(evidenceLine(top))
  const supporting = ranked.slice(1, 1 + maxSupporting).map(row => oneLine(row.callableName))
  if (supporting.length > 0) lines.push('Also available: ' + supporting.join(', ') + '.')

  const bounded = lines.slice(0, maxLines)
  let text = bounded.join('\n')
  while (text.length > maxChars && bounded.length > 1) {
    bounded.pop()
    text = bounded.join('\n')
  }
  return text.length > maxChars ? truncate(text, maxChars) : text
}

/**
 * Build the neutral digest, capped by whole lines.
 * @param rows - caller-visible workspace/global artifacts.
 * @param options - caps.
 * @returns the prompt text, or an empty string when there is nothing to show.
 */
export function buildLibraryDigest(rows: readonly LibraryDigestRow[], options: LibraryDigestOptions = {}): string {
  const maxLines = Math.max(1, options.maxLines ?? DEFAULT_MAX_LINES)
  const maxChars = Math.max(80, options.maxChars ?? DEFAULT_MAX_CHARS)
  const seen = new Set<string>()
  const lines: string[] = []
  for (const row of rows) {
    if (row.callableName.length === 0 || seen.has(row.callableName)) continue
    seen.add(row.callableName)
    const description = truncate(oneLine(row.description), 90)
    const evidence = row.uses !== undefined && row.uses >= 5
      ? ` [${row.uses} uses/${row.sessions ?? 0} sessions/${row.failures ?? 0} failures]`
      : ''
    const both = row.name === row.callableName
      ? `\`${row.callableName}\``
      : `\`${row.callableName}\` (stored \`${row.name}\`)`
    lines.push(`- ${both}: ${description}${evidence}`)
    if (lines.length >= maxLines) break
  }
  if (lines.length === 0) return ''
  const heading = '## Your saved Tool Mode artifacts\nCallable now; reuse beats rebuilding.\n'
  let out = heading
  for (const line of lines) {
    if (out.length + line.length + 1 > maxChars) break
    out += line + '\n'
  }
  return out.trimEnd()
}
