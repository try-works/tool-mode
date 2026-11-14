/**
 * The runtime's tagged errors.
 *
 * Callers route on `_tag` and read named fields; that is the whole error
 * protocol. The distinctions are deliberate:
 *
 * - {@link InvalidInput} — the caller can fix this.
 * - {@link RuntimeUnavailable} — this machine cannot run the provider at all.
 * - {@link InferenceFailed} — the engine ran (or tried to) and the failure is
 *   the engine's, with the phase that broke.
 * - {@link PortFailure} — a control-plane seam failed, and the message names it.
 *
 * @module errors
 */

import { Schema } from 'effect'

/** The request is well-formed but the model cannot use it. */
export class InvalidInput extends Schema.TaggedError<InvalidInput>()('InvalidInput', {
  field: Schema.String,
  message: Schema.String,
}) {}

/** The provider cannot run on this host, for the stated reason. */
export class RuntimeUnavailable extends Schema.TaggedError<RuntimeUnavailable>()('RuntimeUnavailable', {
  provider: Schema.String,
  reason: Schema.String,
}) {}

/** The engine failed during a named phase. */
export class InferenceFailed extends Schema.TaggedError<InferenceFailed>()('InferenceFailed', {
  provider: Schema.String,
  phase: Schema.Literals(['load', 'run', 'post']),
  message: Schema.String,
}) {}

/** A port (catalog, deployment store, entitlement, telemetry) failed. */
export class PortFailure extends Schema.TaggedError<PortFailure>()('PortFailure', {
  port: Schema.String,
  message: Schema.String,
}) {}
