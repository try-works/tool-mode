/**
 * The model-visible projection of one invocation receipt.
 *
 * Separate from storage: retention and id minting are `receipt-surface`; this is
 * the stable read shape `model_tools` action "receipts" publishes.
 *
 * @module receipt-view
 */

/* oxlint-disable anti-slop/no-conditional-empty-object-spread, anti-slop/no-known-value-widening, anti-slop/no-unsafe-dictionary-type -- SAFETY: this is the published read projection; optional fields are omitted exactly when the receipt does not carry them, and the result is JSON data for discovery. */

import type { InvocationReceipt } from './receipt.ts'

/**
 * Render one receipt for discovery.
 *
 * @param receipt - the persisted receipt.
 * @returns the JSON-safe row.
 */
export function receiptView(receipt: InvocationReceipt): Record<string, unknown> {
  return {
    receiptId: receipt.receiptId,
    /** When the host authored the receipt (EXT-35 enrichment). */
    at: receipt.at,
    /** The composition run this receipt belongs to. */
    runId: receipt.runId,
    contract: receipt.contract,
    implementationId: receipt.implementationId,
    extension: receipt.extension,
    modelIdentity: receipt.modelIdentity,
    activationGeneration: receipt.activationGeneration,
    executionLocation: receipt.executionLocation,
    kind: receipt.kind ?? 'invocation',
    parentReceiptId: receipt.parentReceiptId ?? null,
    ...receipt.sessionId === undefined ? {} : { sessionId: receipt.sessionId },
    ...receipt.rootSessionId === undefined ? {} : { rootSessionId: receipt.rootSessionId },
    ...receipt.artifactScope === undefined ? {} : { artifactScope: receipt.artifactScope },
    ...receipt.artifactName === undefined ? {} : { artifactName: receipt.artifactName },
    ...receipt.artifactDigest === undefined ? {} : { artifactDigest: receipt.artifactDigest },
    ...receipt.callId === undefined ? {} : { callId: receipt.callId },
    ...receipt.argumentPaths === undefined ? {} : { argumentPaths: [...receipt.argumentPaths] },
    ...receipt.dataFlow === undefined ? {} : { dataFlow: [...receipt.dataFlow] },
    ...receipt.dataFlowCoverage === undefined ? {} : { dataFlowCoverage: receipt.dataFlowCoverage },
    // Exposed as null when the lane genuinely cannot know: the schema declares the
    // field, so an absent value is visible rather than silently missing.
    outcome: receipt.outcome ?? null,
    // task-57: a failed composition's bounded warning is part of the provenance a
    // caller/operator needs; a receipt nobody can read cannot explain the failure.
    warnings: [...receipt.warnings],
    ...receipt.usage === undefined ? {} : { usage: receipt.usage },
    ...receipt.cost === undefined ? {} : { cost: receipt.cost },
  }
}
