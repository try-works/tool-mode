/**
 * Repeated-shape detection over the invocation receipt ring.
 *
 * The unit is a COMPOSITION RUN, not a single call: the thing worth turning into
 * a workflow is the sequence an agent ran, not one tool it happened to invoke.
 * A shape is built only from host-authored metadata — contract identity, the
 * implementation that served it, and the argument paths a previous output
 * reached. It deliberately contains no argument VALUES, no model text and no
 * program source: the report is a prompt for a human/agent decision, not a
 * second copy of the work.
 *
 * @module @try-works/dsh-tool-mode/repeated-shapes
 */

import { createHash } from 'node:crypto'
import type { InvocationReceipt } from './receipt.ts'

/** One step in a repeated call shape. */
export interface ShapeStep {
  readonly contract: string
  readonly implementationId: string
  /** Argument paths an earlier result reached, sorted; empty when none was observed. */
  readonly inputs: readonly string[]
  /**
   * Argument KEYS the step was invoked with, sorted. Unlike `inputs` this is
   * available even when no value-equality edge was observed, so a repeated shape
   * carries its wiring rather than only the contract name.
   */
  readonly arguments: readonly string[]
}

/** One repeated shape report row. */
export interface RepeatedShape {
  /** Short stable digest of the shape (not a security primitive). */
  readonly signature: string
  /** How many composition runs in the retained receipts have this shape. */
  readonly count: number
  /** The most recent occurrence. */
  readonly lastAt: string
  /** A run that exhibited it, for a future define-from-run action. */
  readonly sampleRunId: string
  /** The ordered steps, with argument paths but no values. */
  readonly steps: readonly ShapeStep[]
}

/** One run's steps, keyed by the trace call id for data-flow lookup. */
function shapeOfRun(
  runId: string,
  receipts: readonly InvocationReceipt[],
): { readonly steps: readonly ShapeStep[]; readonly lastAt: string } | undefined {
  const nested = receipts.filter(receipt => receipt.runId === runId && receipt.parentReceiptId === runId)
  if (nested.length === 0) return undefined
  const composition = receipts.find(receipt => receipt.receiptId === runId)
  const edges = composition?.dataFlow ?? []
  const steps = nested.map(receipt => ({
    contract: receipt.contract,
    implementationId: receipt.implementationId,
    inputs: edges
      .filter(edge => receipt.callId !== undefined && edge.to === receipt.callId)
      .map(edge => edge.input)
      .sort(),
    arguments: [...(receipt.argumentPaths ?? [])].sort(),
  }))
  return { steps, lastAt: composition?.at ?? nested[nested.length - 1]!.at }
}

/**
 * Find shapes that occur at least twice in the retained receipts.
 *
 * Receipts are retained 200 at a time, so this is a lower bound across sessions:
 * it reports what is still in the window, never a fabricated historical total.
 * @param receipts - the host's receipt ring, oldest first.
 * @returns repeated shapes, most frequent first.
 */
export function findRepeatedShapes(receipts: readonly InvocationReceipt[]): RepeatedShape[] {
  const runs = new Map<string, { steps: readonly ShapeStep[]; lastAt: string }>()
  const runIds = new Set(receipts.map(receipt => receipt.runId))
  for (const runId of runIds) {
    const shape = shapeOfRun(runId, receipts)
    if (shape !== undefined) runs.set(runId, shape)
  }
  const groups = new Map<string, { steps: readonly ShapeStep[]; count: number; lastAt: string; sampleRunId: string }>()
  for (const [runId, shape] of runs) {
    const key = JSON.stringify(shape.steps)
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, { steps: shape.steps, count: 1, lastAt: shape.lastAt, sampleRunId: runId })
    } else {
      existing.count += 1
      if (shape.lastAt > existing.lastAt) {
        existing.lastAt = shape.lastAt
        existing.sampleRunId = runId
      }
    }
  }
  return [...groups.values()]
    .filter(group => group.count >= 2)
    .map(group => ({
      signature: createHash('sha256').update(JSON.stringify(group.steps)).digest('hex').slice(0, 16),
      count: group.count,
      lastAt: group.lastAt,
      sampleRunId: group.sampleRunId,
      steps: group.steps,
    }))
    .sort((left, right) => right.count - left.count || right.lastAt.localeCompare(left.lastAt))
}
