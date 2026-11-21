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
export const DIRECTIVE_DIGEST_MAX_CHARS = 1000
/**
 * Default line cap for the directive digest.
 *
 * R3 raised this from 4 to 6: the 176-character report value plus TWO supporting
 * artifacts' bounded purposes and verification notes exceed 600 characters, and the
 * previous loop dropped the ENTIRE `Also available` line. That is exactly the E26/E27/E28
 * failure in a new form. 1000/6 keeps the full verification and all three entries.
 */
export const DIRECTIVE_DIGEST_MAX_LINES = 6
/** Purpose and known-failure fragments stay single-line and bounded. */
const FRAGMENT_MAX_CHARS = 120
/**
 * The explicit verification budget (R3, plan Phase 3 starts at 240 characters).
 *
 * The report's value is 176 characters: it fits WHOLE, and it must — the six word->code
 * mappings are what makes verification cheap. A longer value is cut at a word boundary and
 * ends with the pointer below.
 */
const VERIFICATION_MAX_CHARS = 240
/** The pointer a budget-cut verification ends with. It is not optional. */
const VERIFICATION_POINTER = "… read the full text with tool_mode_tools {action:'get'}"
/** Supporting artifacts listed without an imperative. */
const DEFAULT_MAX_SUPPORTING = 3

/** R8: the author's claim about output granularity. NEVER inferred from program text. */
export type AdvisoryVerifiability = 'per-item' | 'aggregate'

/** A digest row plus the optional R8 claim. */
export interface VerifiabilityCandidate extends AdoptionDigestCandidate {
  /**
   * `aggregate` means the artifact reports a total (or an aggregate) and cannot be
   * verified item by item from its output alone; the digest says so and names the cheapest
   * executable route (R11) it can derive from the declared nested tools. Absent or
   * `per-item` renders no caveat.
   */
  readonly verifiability?: AdvisoryVerifiability
  /** The artifact's declared nested tools; the cheapest per-item route names one of them. */
  readonly nestedTools?: readonly string[]
  /** R11: the artifact declares a one-call perItem mode returning labelled rows. */
  readonly perItem?: boolean
}

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

/**
 * Cut at the last whitespace boundary at or below `max`.
 *
 * NEVER `slice` a token in half: the report's failure was `'Terve'->h…`, which told a solver
 * that short words are unreliable while hiding WHICH words. A cut that lands mid-token is
 * worse than an earlier cut at a boundary.
 */
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, Math.max(0, max))
  const boundary = cut.lastIndexOf(' ')
  const head = boundary > 0 ? cut.slice(0, boundary) : cut
  return head.replace(/[\s,;:]+$/, '')
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return truncateAtWord(text, Math.max(0, max - 1)) + '…'
}

/**
 * Render a verification value under the explicit budget (R3).
 *
 * Fits: the WHOLE normalized value. Over budget: a word-boundary prefix plus the exact
 * pointer `… read the full text with tool_mode_tools {action:'get'}`.
 * @param value - the stored verification.
 * @returns the rendered text and whether it was cut.
 */
function renderVerification(value: string) {
  const normalized = oneLine(value)
  if (normalized.length <= VERIFICATION_MAX_CHARS) return { text: normalized, truncated: false }
  const room = Math.max(0, VERIFICATION_MAX_CHARS - VERIFICATION_POINTER.length - 1)
  return { text: truncateAtWord(normalized, room) + ' ' + VERIFICATION_POINTER, truncated: true }
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
 * R8: the aggregate-only caveat, for the imperative candidate.
 *
 * Rendered ONLY on an explicit `aggregate` claim: per-item and absent hints invent
 * nothing. It names the artifact's own callable name as the per-item route — that call can
 * be made with a single item — so the caveat never points at a route the caller cannot run.
 * @param candidate - the ranked candidate.
 * @returns the caveat clause, or an empty string.
 */
function aggregateCaveat(candidate: VerifiabilityCandidate): string {
  if (candidate.verifiability !== 'aggregate') return ''
  return ' Aggregate-only output (not per-item verifiable): ' + verificationRoute(candidate)
}

/**
 * R11: the cheapest executable per-item route the host can name.
 *
 * Measured on 0.5.112 at 60 items: one Code Mode program looping the declared nested tool
 * is 7.8 s; looping the artifact per-item is ~118 s (deadline). The old "one item at a
 * time" instruction named the worst route. When no nested tool is declared, no route is
 * invented.
 */
function verificationRoute(candidate: VerifiabilityCandidate): string {
  // R11: a declared perItem mode is the one-call route; it beats the nested-tool loop.
  if (candidate.perItem === true) {
    return 'verify with ' + oneLine(candidate.callableName) + ' using perItem: true (one labelled row per item).'
  }
  const tool = candidate.nestedTools?.find(name => name.trim().length > 0)
  return tool === undefined
    ? 'verify each item against an independent source (no per-item route is declared).'
    : 'verify with one Code Mode program looping ' + oneLine(tool) + ' over the list.'
}

/**
 * The compact supporting-row form of the same claim.
 * @param candidate - a supporting candidate.
 * @returns the bracket, or an empty string.
 */
function aggregateSupporting(candidate: VerifiabilityCandidate): string {
  if (candidate.verifiability !== 'aggregate') return ''
  if (candidate.perItem === true) {
    return ' [aggregate-only; verify with ' + oneLine(candidate.callableName) + ' using perItem:true]'
  }
  const tool = candidate.nestedTools?.find(name => name.trim().length > 0)
  return tool === undefined
    ? ' [aggregate-only; no per-item route declared]'
    : ' [aggregate-only; verify in one Code Mode program looping ' + oneLine(tool) + ']'
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
  // R13: crash-free is NOT correctness. Name the measurement, never "evidence".
  return 'Completed without a recorded error: ' + String(candidate.uses) + ' uses, ' + String(candidate.failures) + ' ' + plural
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
  rows: readonly VerifiabilityCandidate[],
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
  const verification = top.verification === undefined ? undefined : renderVerification(top.verification)
  const verify = verification !== undefined && verification.text.length > 0
    ? ' Verify: ' + (verification.truncated ? verification.text : sentence(verification.text))
    : top.unverified === true
      ? ' Verify its output on edge cases before relying on it.'
      : ''
  /**
   * R8: the aggregate caveat is appended to the directive line (never a second line, so the
   * 6-line budget is unchanged), and only when the author made the claim.
   */
  const aggregate = aggregateCaveat(top)
  const lines: string[] = [purpose.length === 0
    ? 'Use ' + callableName + callSignature + stored + unverified + '.' + batchHint + verify + aggregate
    : 'Use ' + callableName + callSignature + stored + unverified + ' — ' + sentence(purpose) + batchHint + verify + aggregate]
  const knownFailure = top.knownFailure === undefined ? undefined : truncate(oneLine(top.knownFailure), FRAGMENT_MAX_CHARS)
  // The five-use rule gates the caveat and its counts together: a one-use failure is real
  // evidence, but it is not enough to advertise a "known failure" mode yet.
  if (top.uses >= 5 && knownFailure !== undefined && knownFailure.length > 0) {
    lines.push('Known failure: ' + sentence(knownFailure))
  }
  if (top.uses >= 5 && top.unverified !== true && verification === undefined) lines.push(evidenceLine(top))
  /**
   * Supporting rows are not just names. A field that reaches only the imperative
   * candidate is invisible whenever an artifact ranks second — E28 put both markers on
   * one tool and saw neither because it was in "Also available". Carry the same metadata
   * here, bounded per entry.
   */
  const supporting = ranked.slice(1, 1 + maxSupporting).map(row => {
    const name = oneLine(row.callableName)
    const purpose = truncate(oneLine(row.description), 55).replace(/[.;]+$/, '')
    /**
     * R3: supporting artifacts carry the SAME full verification as the top candidate — a
     * field that renders only for rank 1 is invisible whenever the artifact ranks second
     * (E26/E27/E28). The 55-character mid-token cap is gone; the shared budget applies.
     */
    // The value renders VERBATIM inside the bracket (its own closing period included):
    // punctuation is part of the stored text, and the R3 contract is "render it in full".
    const verification = row.verification === undefined
      ? ''
      : ' [Verify: ' + renderVerification(row.verification).text + ']'
    return name + (purpose.length === 0 ? '' : ' — ' + purpose) + verification + aggregateSupporting(row)
  })
  if (supporting.length > 0) {
    const line = 'Also available: ' + supporting.join('; ')
    // A verification bracket carries its own punctuation; adding another period after ']'
    // would render '…agree.].' — one closing mark is enough.
    lines.push(line.endsWith(']') ? line : line + '.')
  }

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
