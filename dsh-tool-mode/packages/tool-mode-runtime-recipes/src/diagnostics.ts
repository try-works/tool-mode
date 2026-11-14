/**
 * Internal diagnostic helpers shared by the recipe parser and the factory loader.
 *
 * Not exported from the package: these are how a refusal is WORDED, not part of the
 * contract a caller may depend on. They live in one place so a value is described the
 * same way whichever module refused it.
 *
 * @module diagnostics
 */

/*
 * Describing an UNKNOWN value is the entire job of this module: a refusal has to name what
 * arrived without trusting it, so runtime narrowing is the implementation, not evidence
 * about it. The generic anti-slop rules assume an already-typed caller and are disabled
 * only here; the described value is never acted on, only worded.
 */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof */

/**
 * Name a value's kind for an issue message, without echoing unbounded content.
 *
 * A string is quoted because an empty string and a missing field are different authoring
 * mistakes; everything else is named by kind, because a message that pastes an arbitrary
 * input is a message that can carry megabytes of it.
 *
 * @param value - the value to describe
 * @returns a short human-readable kind
 */
export function describeKind(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `the ${typeof value} ${String(value)}`
  }
  return `a ${typeof value}`
}

/**
 * Turn an unknown thrown value into a one-line detail.
 *
 * @param cause - the thrown or rejected value
 * @returns its message, or its string form
 */
export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
