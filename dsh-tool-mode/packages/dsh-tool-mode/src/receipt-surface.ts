/**
 * The host's invocation-receipt surface.
 *
 * Receipts persist next to the state file, keep a bounded in-memory ring for
 * discovery, and mint the ids every native and external call reports. This
 * module owns that state so index.ts only wires the surface into the host.
 *
 * @module receipt-surface
 */

import {
  MAX_RETAINED_RECEIPTS,
  type InvocationReceipt,
} from './receipt.ts'
import {
  createFileReceiptStore,
  createMemoryReceiptStore,
  receiptCounterFloor,
  receiptStorePathFor,
} from './receipt-store.ts'

/** What the host receives from one receipt surface. */
export interface ReceiptSurface {
  /** The bounded in-memory window, newest last; the same array is retained. */
  readonly receipts: InvocationReceipt[]
  /** Mint the next provenance id, never reusing a persisted one. */
  nextReceiptId(): string
  /** Persist and retain one receipt, evicting the oldest beyond the limit. */
  record(receipt: InvocationReceipt): void
}

/**
 * Build the receipt surface for one deployment.
 *
 * @param options - persistence mode, the state file it sits beside, and the
 *   quarantine warning sink.
 * @returns the surface.
 */
export function createReceiptSurface(options: {
  readonly persistent: boolean
  readonly stateFile: string
  readonly onQuarantine: (diagnostic: { readonly reason: string; readonly quarantinePath: string }) => void
  readonly limit?: number
}): ReceiptSurface {
  const limit = options.limit ?? MAX_RETAINED_RECEIPTS
  const store = options.persistent
    ? createFileReceiptStore(receiptStorePathFor(options.stateFile), {
        limit,
        onQuarantine: options.onQuarantine,
      })
    : createMemoryReceiptStore({ limit })
  let counter = receiptCounterFloor(store.records)
  const receipts: InvocationReceipt[] = [...store.records]
  return {
    receipts,
    nextReceiptId: () => `rcpt_${(++counter).toString(36).padStart(6, '0')}`,
    record(receipt) {
      store.append(receipt)
      receipts.push(receipt)
      if (receipts.length > limit) receipts.shift()
    },
  }
}
