/**
 * Typed runtime failures, re-exported from the shared contract package.
 *
 * The classes are the SAME VALUES the whole runtime layer uses, so `instanceof` and
 * `catchTag` in any consumer matches the error it saw. `describeCause` is a message
 * helper, not part of the error protocol, and stays local.
 *
 * @module errors
 */

import { Schema } from 'effect'

import { InferenceFailed, InvalidInput, RuntimeUnavailable } from '@try-works/tool-mode-runtime-core'

export { InferenceFailed, InvalidInput, RuntimeUnavailable }

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
