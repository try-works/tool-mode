/**
 * Readiness and inspection.
 *
 * Readiness is a closed set with an operator meaning:
 *
 * - `prepared-cold` — verified assets exist, nothing is loaded in this process.
 * - `ready` — the provider can answer right now.
 * - `failed` — this host cannot serve the provider; `reason` says why.
 * - `needs-preparation` — something is missing, and `missing` names each item.
 *
 * `features` and `missing` are required so that "nothing known" can never be
 * read as "nothing wrong".
 *
 * @module readiness
 */

import { Schema } from 'effect'

/** The closed set of readiness states. */
export const Readiness = Schema.Literals(['prepared-cold', 'ready', 'failed', 'needs-preparation'])
/** The closed set of readiness states. */
export type Readiness = Schema.Schema.Type<typeof Readiness>

/** A pre-load report: what works, what is missing, and why. */
export const Inspection = Schema.Struct({
  readiness: Readiness,
  features: Schema.Array(Schema.String),
  missing: Schema.Array(Schema.Struct({ name: Schema.String, reason: Schema.String })),
  reason: Schema.optional(Schema.String),
})
/** A pre-load report: what works, what is missing, and why. */
export type Inspection = Schema.Schema.Type<typeof Inspection>
