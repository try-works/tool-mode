/**
 * File-backed invocation-receipt store (EXT-35, recommendation slice 2).
 *
 * The host used to keep receipts only in a bounded in-memory ring, so a restart
 * forgot every receipt. This store persists them next to the configured state
 * file, bounded and atomically written, and it QUARANTINES malformed data rather
 * than silently pretending the store was empty.
 *
 * Receipts are provenance, not content: the record shape is host-authored and
 * never carries a request body, token, or full skill text (see receipt.ts).
 *
 * @module @try-works/dsh-tool-mode/receipt-store
 */

/*
 * This module IS the I/O boundary for a hand-editable file: parsing `unknown`
 * JSON is its job, and the shape checks below are the parser. The generic
 * anti-slop rules assume a typed caller, so they are disabled only for this
 * parser, and any mismatch quarantines the file instead of trusting it.
 */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { MAX_RETAINED_RECEIPTS, type InvocationReceipt } from './receipt.ts'

/** The on-disk document version (v2 added the required runId/at on every receipt). */
export const RECEIPT_STORE_VERSION = 2

/**
 * The legacy document version this build MIGRATES instead of quarantining.
 *
 * A 0.5.69 store carried no runId/at; treating it as malformed moved a perfectly good
 * history aside. The migration rule is: runId = receiptId, at = the row's persisted
 * timestamp when it has one, otherwise the store file's mtime.
 */
export const MIGRATABLE_RECEIPT_STORE_VERSION = 1

/** Where the receipt store lives for a given state file. */
export function receiptStorePathFor(stateFile: string): string {
  return `${stateFile}.receipts.json`
}

/** One malformed store that was moved aside instead of being trusted. */
export interface ReceiptQuarantine {
  /** Where the offending bytes were moved. */
  readonly quarantinePath: string
  /** Why the document was refused. Never contains receipt content. */
  readonly reason: string
}

/** What a receipt store exposes. */
export interface ReceiptStore {
  /** The file path, or a synthetic path for the memory store. */
  readonly path: string
  /** Where malformed data was moved, when this instance quarantined a file. */
  readonly quarantinePath?: string | undefined
  /** The persisted receipts, oldest first, at most the configured limit. */
  readonly records: readonly InvocationReceipt[]
  /** Append one receipt, enforce the bound, and persist it. */
  append(receipt: InvocationReceipt): void
}

/** Store construction options. */
export interface ReceiptStoreOptions {
  /** Retention bound; defaults to MAX_RETAINED_RECEIPTS. */
  readonly limit?: number
  /** Called once for a malformed document, after it is moved aside. */
  readonly onQuarantine?: (quarantine: ReceiptQuarantine) => void
}

interface StoreDocument {
  readonly version: number
  readonly receipts: readonly InvocationReceipt[]
}

/** A receipt is shaped by the host, but a file may be hand-edited or truncated. */
function isReceipt(value: unknown): value is InvocationReceipt {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record['receiptId'] === 'string'
    && record['receiptId'].length > 0
    && typeof record['runId'] === 'string'
    && record['runId'].length > 0
    && typeof record['at'] === 'string'
    && record['at'].length > 0
    && typeof record['contract'] === 'string'
    && typeof record['implementationId'] === 'string'
    && typeof record['extension'] === 'string'
    && typeof record['modelIdentity'] === 'string'
    && typeof record['activationGeneration'] === 'number'
    && Array.isArray(record['warnings'])
}

/** The v1 shape: every required field EXCEPT the runId/at enrichment. */
function isLegacyReceipt(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record['receiptId'] === 'string'
    && record['receiptId'].length > 0
    && typeof record['contract'] === 'string'
    && typeof record['implementationId'] === 'string'
    && typeof record['extension'] === 'string'
    && typeof record['modelIdentity'] === 'string'
    && typeof record['activationGeneration'] === 'number'
    && Array.isArray(record['warnings'])
}

/**
 * Migrate one v1 row: runId = receiptId and at = the persisted timestamp or the file mtime.
 * A row that keeps its own runId/at (a hand-written v1 row may) is preserved.
 */
function migrateLegacyReceipt(value: unknown, fallbackAt: string): InvocationReceipt | undefined {
  if (!isLegacyReceipt(value)) return undefined
  const record = value as Record<string, unknown>
  const persistedAt = typeof record['at'] === 'string' && record['at'].length > 0 ? record['at'] : fallbackAt
  const runId = typeof record['runId'] === 'string' && record['runId'].length > 0
    ? record['runId']
    : record['receiptId'] as string
  // SAFETY: the legacy shape check above established every v2 field except runId/at, which
  // are supplied here from the row itself or the migration fallback. The cast is the one
  // boundary conversion v1 -> v2, and the parser above is what earns it.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  return { ...record as unknown as InvocationReceipt, runId, at: persistedAt }
}

/** Parse one document, distinguishing "absent" from "malformed" and "migratable". */
function parseDocument(text: string, fallbackAt: string): { readonly ok: true; readonly receipts: readonly InvocationReceipt[]; readonly migrated: boolean } | { readonly ok: false; readonly reason: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'the document is not a JSON object' }
  const document = parsed as Partial<StoreDocument>
  if (!Array.isArray(document.receipts)) return { ok: false, reason: 'receipts is not an array' }
  if (document.version === MIGRATABLE_RECEIPT_STORE_VERSION) {
    const migrated: InvocationReceipt[] = []
    for (const receipt of document.receipts) {
      const row = migrateLegacyReceipt(receipt, fallbackAt)
      if (row === undefined) return { ok: false, reason: 'the store contains a malformed receipt' }
      migrated.push(row)
    }
    return { ok: true, receipts: migrated, migrated: true }
  }
  if (document.version !== RECEIPT_STORE_VERSION) {
    return { ok: false, reason: `unsupported receipt store version ${String(document.version)}` }
  }
  const invalid = document.receipts.find(receipt => !isReceipt(receipt))
  if (invalid !== undefined) return { ok: false, reason: 'the store contains a malformed receipt' }
  return { ok: true, receipts: document.receipts, migrated: false }
}

/** Keep the newest `limit` receipts, never exceeding it. */
function bounded(receipts: InvocationReceipt[], limit: number): InvocationReceipt[] {
  return receipts.length > limit ? receipts.slice(receipts.length - limit) : receipts
}

/** A file-backed store; the in-memory ring stays the host's read cache. */
export function createFileReceiptStore(path: string, options: ReceiptStoreOptions = {}): ReceiptStore {
  const limit = options.limit ?? MAX_RETAINED_RECEIPTS
  let records: InvocationReceipt[] = []
  let quarantinePath: string | undefined

  const persist = (): void => {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp-${process.pid.toString(36)}-${randomBytes(6).toString('hex')}`
    writeFileSync(temporary, `${JSON.stringify({ version: RECEIPT_STORE_VERSION, receipts: records }, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, path)
  }

  if (existsSync(path)) {
    const text = readFileSync(path, 'utf8')
    // A v1 row with no persisted timestamp takes the FILE's mtime: the closest honest
    // approximation of when the call happened. If the stat itself fails, epoch is the
    // documented fallback rather than "now", which would claim the call just happened.
    let fallbackAt = new Date(0).toISOString()
    try {
      fallbackAt = statSync(path).mtime.toISOString()
    } catch {
      // The documented fallback stands.
    }
    const parsed = parseDocument(text, fallbackAt)
    if (parsed.ok) {
      records = bounded([...parsed.receipts], limit)
      // Persist the upgrade so the next load is a plain v2 read.
      if (parsed.migrated) persist()
    } else {
      // QUARANTINE, never "start empty": overwriting the bytes would destroy the
      // only evidence of what the store used to hold.
      quarantinePath = `${path}.quarantined-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
      renameSync(path, quarantinePath)
      options.onQuarantine?.({ quarantinePath, reason: parsed.reason })
    }
  }

  return {
    path,
    get quarantinePath() {
      return quarantinePath
    },
    get records() {
      return records
    },
    append(receipt) {
      records = bounded([...records, receipt], limit)
      persist()
    },
  }
}

/** The memory store used when persistence is disabled; same contract, no file. */
export function createMemoryReceiptStore(options: ReceiptStoreOptions = {}): ReceiptStore {
  const limit = options.limit ?? MAX_RETAINED_RECEIPTS
  let records: InvocationReceipt[] = []
  return {
    path: '(memory)',
    get records() {
      return records
    },
    append(receipt) {
      records = bounded([...records, receipt], limit)
    },
  }
}

/**
 * The highest receipt counter already used by `receipts`.
 *
 * Receipt ids are `rcpt_` plus a zero-padded base-36 counter. A new host continues
 * from this floor so an id is never reused after a restart.
 * @param receipts - the persisted receipts.
 * @returns the highest counter, or 0 when none parse.
 */
export function receiptCounterFloor(receipts: readonly InvocationReceipt[]): number {
  let floor = 0
  for (const receipt of receipts) {
    if (!receipt.receiptId.startsWith('rcpt_')) continue
    const value = Number.parseInt(receipt.receiptId.slice('rcpt_'.length), 36)
    if (Number.isSafeInteger(value) && value > floor) floor = value
  }
  return floor
}

