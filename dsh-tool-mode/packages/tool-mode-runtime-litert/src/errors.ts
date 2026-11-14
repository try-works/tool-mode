/**
 * Typed runtime failures, re-exported from the shared contract package.
 *
 * `@try-works/tool-mode-runtime-core` owns the tagged-error classes for the whole runtime
 * layer. This package imports the same class VALUES rather than redeclaring them, so an
 * `instanceof` or `catchTag` in any consumer matches the error it saw — two structurally
 * identical copies would not. `describeCause` stays local: it is a message helper, not part
 * of the error protocol.
 */

import { Schema } from 'effect'

import { InferenceFailed, RuntimeUnavailable } from '@try-works/tool-mode-runtime-core'

export { InferenceFailed, RuntimeUnavailable }

/** A short, always-defined description of an unknown thrown value. */
export const describeCause = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message === '' ? cause.name : cause.message
  if (Schema.is(Schema.String)(cause)) return cause
  if (cause === undefined || cause === null) return String(cause)
  try {
    const encoded = JSON.stringify(cause)
    return encoded ?? String(cause)
  } catch {
    return String(cause)
  }
}
