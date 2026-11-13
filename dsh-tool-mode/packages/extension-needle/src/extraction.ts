/**
 * One extraction attempt, and the ONE authorised repair retry.
 *
 * ## Why this is a separate module
 *
 * `extract_with_repair` exists because the engine's constraining grammar makes an
 * extraction WELL-FORMED, not CORRECT: the engine can return an object its own grammar
 * admitted and this package's validator then rejects. The retry is the only place a
 * second engine call is authorised, so the DECISION — was the first verdict clean, what
 * feedback does the second call carry, how many attempts happened — lives here, as a
 * function of an injected `extract` callback, away from the provider and away from the
 * process bridge. The provider supplies the real one-shot engine call; a test supplies a
 * fake and COUNTS the calls, so "at most two" is measured rather than asserted.
 *
 * ## The two hard rules
 *
 * - **At most two engine calls.** One initial attempt and at most one repair. There is
 *   no loop here, only straight-line code, so the shape of the function is the bound.
 * - **`valid` is never true with an unresolved issue.** The verdict is
 *   `proposed && valid && issues.length === 0`, so an attempt that reported a violation
 *   cannot be reported as a success, even if an injected callback hands back an
 *   internally inconsistent attempt.
 *
 * ## What is NOT repaired
 *
 * An invalid attempt with NO issues is the engine's "nothing matched" answer: the
 * validator never ran, so there is no finding to send back as repair feedback, and a
 * second, identical call would be a coin flip rather than a repair. That outcome is
 * returned as it stands — `valid: false`, `issues: []`, `repaired: false` — with the
 * attempt list showing that no retry happened. The alternative (inventing feedback the
 * validator did not produce) would be worse: it would tell the model it was corrected
 * when it was not.
 *
 * @module @try-works/extension-needle/extraction
 */

import type { EngineEnvelope, EngineValidation } from './engine.ts'
import type { OfferedTool } from './contracts.ts'
import { checkArguments } from './validation.ts'

/** Most issue lines the repair feedback quotes. The validator can report many. */
const MAX_FEEDBACK_ISSUES = 12

/** Most characters quoted from any one issue line. */
const MAX_FEEDBACK_ISSUE_CHARACTERS = 200

/** Most characters of the issue list itself, so the description stays bounded. */
const MAX_FEEDBACK_CHARACTERS = 1_024

/** One extraction attempt, as the extraction path reads it. */
export interface ExtractionAttempt {
  /** The record the engine returned, or null when it returned no call at all. */
  readonly extraction: Record<string, unknown> | null
  /** Whether the engine returned a call. False is the honest "nothing matched". */
  readonly proposed: boolean
  /** Whether the record satisfies the caller's prepared schema. */
  readonly valid: boolean
  /** Every violation the validator reported. */
  readonly issues: readonly string[]
  /** The engine's own account of the turn. */
  readonly reasoning: string
  /** The engine's self-reported confidence, or null. */
  readonly confidence: number | null
  /** The engine's grounding report, when it sent one. */
  readonly grounding: EngineValidation | undefined
}

/**
 * Read one engine envelope as an extraction attempt.
 *
 * This is the SINGLE projection both `structured_extract` and `extract_with_repair` use,
 * so a record returned by one is validated by exactly the code that validates the other.
 * That is the property `validate_record` then reuses: same sanitiser, same synthetic
 * function, same Ajv schema.
 * @param envelope - the decoded engine envelope.
 * @param tool - the extraction function the schema was offered under.
 * @returns the attempt, including the engine's own report.
 */
export function readAttempt(envelope: EngineEnvelope, tool: OfferedTool): ExtractionAttempt {
  const call = envelope.functionCalls[0]
  // The engine reports `validation: null` when it sent no grounding report. Converted to
  // `undefined` here because "absent" is a property state, not a value the engine asserted.
  const grounding = envelope.validation ?? undefined
  if (call === undefined) {
    return {
      extraction: null,
      proposed: false,
      valid: false,
      // Empty rather than invented: no validator ran, so there is nothing to report.
      issues: [],
      reasoning: envelope.reasoning,
      confidence: envelope.confidence,
      grounding,
    }
  }
  // Re-validate even though the grammar constrained the tokens. A constrained grammar
  // makes the object WELL-FORMED; it does not make it satisfy a keyword the engine
  // dropped or a value the document did not support.
  const report = checkArguments(tool, call.arguments)
  return {
    extraction: call.arguments,
    proposed: true,
    valid: report.valid,
    issues: [...report.issues],
    reasoning: envelope.reasoning,
    confidence: envelope.confidence,
    grounding,
  }
}

/** One attempt's verdict, as the output schema publishes it. */
export interface RepairAttempt {
  /** Whether this attempt was an admissible extraction. */
  readonly valid: boolean
  /** Every violation this attempt reported. */
  readonly issues: readonly string[]
}

/** What one `extract_with_repair` call produced. */
export interface RepairResult {
  /** The last attempt's record, or null when none was produced. */
  readonly extraction: Record<string, unknown> | null
  /** Admissible only when an extraction exists and no issue remains. */
  readonly valid: boolean
  /** The LAST attempt's issues, so a caller sees what still fails. */
  readonly issues: readonly string[]
  /** Whether a second engine call actually ran. */
  readonly repaired: boolean
  /** One entry per engine call, oldest first. Never longer than two. */
  readonly attempts: readonly RepairAttempt[]
}

/**
 * Whether one attempt is an ADMISSIBLE extraction.
 *
 * The three conditions are deliberately conjunctive: an extraction must exist, the
 * validator must have accepted it, and the validator must have reported nothing. The
 * issue count is included because `valid` alone is a claim this module refuses to take
 * on faith from an injected callback.
 * @param attempt - the attempt to judge.
 * @returns whether it may be reported as valid.
 */
function admissible(attempt: ExtractionAttempt): boolean {
  return attempt.proposed && attempt.valid && attempt.issues.length === 0
}

/**
 * Run an extraction, and at most ONE repair attempt if the validator rejected it.
 *
 * @param extract - one engine call. Called first with `undefined` (the initial attempt),
 *   then — only when there are issues to report — once with those issues as repair
 *   feedback. An engine failure must THROW from this callback: it is never converted
 *   into an empty record, so a failure cannot be mistaken for a model answer.
 * @returns the last attempt's record, its verdict, and the attempt history.
 */
export async function extractWithRepair(
  extract: (repairFeedback: readonly string[] | undefined) => Promise<ExtractionAttempt>,
): Promise<RepairResult> {
  const first = await extract(undefined)
  const firstAdmissible = admissible(first)
  const attempts: RepairAttempt[] = [{ valid: firstAdmissible, issues: [...first.issues] }]

  if (firstAdmissible) {
    return { extraction: first.extraction, valid: true, issues: [], repaired: false, attempts }
  }

  if (first.issues.length === 0) {
    // "Nothing matched": no finding exists to repair, and a second identical call is not
    // a repair. Reported as it stands rather than dressed up with invented feedback.
    return { extraction: first.extraction, valid: false, issues: [], repaired: false, attempts }
  }

  const second = await extract([...first.issues])
  const secondAdmissible = admissible(second)
  attempts.push({ valid: secondAdmissible, issues: [...second.issues] })
  return {
    extraction: second.extraction,
    // Never valid while an issue is unresolved, whatever the attempt claims.
    valid: secondAdmissible,
    issues: [...second.issues],
    repaired: true,
    attempts,
  }
}

/**
 * Prefix the extraction instruction with the validator's findings.
 *
 * The instruction is the extraction function's DESCRIPTION in the engine's tool
 * document, so this is where a caller's request already reaches the model; appending
 * the findings keeps the repair in the same channel instead of inventing a second one.
 * The quoted findings are bounded (issue count, per-issue length, total length) so a
 * pathological validator report cannot grow the tool document without limit.
 * @param instruction - the caller's instruction, unchanged.
 * @param issues - the previous attempt's violations.
 * @returns the instruction for the repair attempt.
 */
export function withRepairFeedback(instruction: string, issues: readonly string[]): string {
  const lines: string[] = []
  let used = 0
  for (const issue of issues) {
    if (lines.length >= MAX_FEEDBACK_ISSUES) break
    const line = `- ${issue.slice(0, MAX_FEEDBACK_ISSUE_CHARACTERS)}`
    if (used + line.length + 1 > MAX_FEEDBACK_CHARACTERS) break
    lines.push(line)
    used += line.length + 1
  }
  if (lines.length === 0) {
    // Nothing quotable: return the caller's instruction rather than a repair header with
    // an empty finding list, which would claim a correction that never happened.
    return instruction
  }
  const omitted = issues.length - lines.length
  const feedback = 'REPAIR: your previous answer was rejected by the record validator. '
    + 'These are the validator\'s own findings:\n'
    + lines.join('\n')
    + (omitted > 0 ? `\n- (${omitted} further issue(s) omitted for length)` : '')
    + '\nReturn a corrected object that satisfies the schema. '
    + 'Do not invent values the document does not support.'
  return `${instruction}\n\n${feedback}`
}
