/**
 * The authoring event ledger: define/save/delete/run, separate from invocation
 * receipts.
 *
 * Invocation receipts say what a MODEL ran. Authoring events say what the agent
 * CHANGED or REUSED. Mixing them would make a `define` look like a model call,
 * and it would bury the event the adoption study actually needs. The ledger is
 * deliberately value-free: a name, a version, an operation and an outcome, never
 * a program body or caller input.
 *
 * @module @try-works/dsh-tool-mode/authoring-ledger
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** How many authoring events are retained. */
export const MAX_AUTHORING_EVENTS = 200

/** What happened to an artifact. */
export type AuthoringOperation = 'define' | 'save' | 'delete' | 'run'

/** Which artifact family the event concerns. */
export type ArtifactKind = 'tool' | 'workflow'

/** One authoring event. */
export interface AuthoringReceipt {
  readonly receiptId: string
  readonly at: string
  readonly operation: AuthoringOperation
  readonly artifactKind: ArtifactKind
  readonly name: string
  readonly version?: number
  readonly outcome: 'ok' | 'failed'
  readonly durationMs?: number
}

/** What a caller supplies to record an event. */
export interface AuthoringReceiptInput {
  readonly operation: AuthoringOperation
  readonly artifactKind: ArtifactKind
  readonly name: string
  readonly version?: number
  readonly outcome?: 'ok' | 'failed'
  readonly durationMs?: number
  readonly at?: string
}

/** The durable ledger. */
export interface AuthoringLedger {
  readonly file: string
  readonly issue: string | undefined
  list(): AuthoringReceipt[]
  record(input: AuthoringReceiptInput): AuthoringReceipt
}

interface LedgerDocument {
  readonly version: 1
  readonly receipts: readonly AuthoringReceipt[]
}

function emptyDocument(): LedgerDocument {
  return { version: 1, receipts: [] }
}

function readDocument(file: string): { document: LedgerDocument; issue: string | undefined } {
  if (!existsSync(file)) return { document: emptyDocument(), issue: undefined }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { document: emptyDocument(), issue: 'the authoring ledger is not a JSON object' }
    }
    const receipts = (parsed as { receipts?: unknown }).receipts
    if (!Array.isArray(receipts)) return { document: emptyDocument(), issue: 'the authoring ledger has no receipts array' }
    return { document: { version: 1, receipts: receipts.filter(isReceipt) }, issue: undefined }
  } catch (error) {
    return {
      document: emptyDocument(),
      issue: 'the authoring ledger could not be read: ' + (error instanceof Error ? error.message : String(error)),
    }
  }
}

function isReceipt(value: unknown): value is AuthoringReceipt {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record['receiptId'] === 'string'
    && typeof record['at'] === 'string'
    && ['define', 'save', 'delete', 'run'].includes(String(record['operation']))
    && (record['artifactKind'] === 'tool' || record['artifactKind'] === 'workflow')
    && typeof record['name'] === 'string'
    && (record['outcome'] === 'ok' || record['outcome'] === 'failed')
}

function writeDocument(file: string, document: LedgerDocument): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = file + '.tmp-' + process.pid.toString(36) + '-' + Date.now().toString(36)
  try {
    writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, file)
  } catch (error) {
    try { rmSync(temporary, { force: true }) } catch { /* best effort */ }
    throw error
  }
}

/**
 * Open the authoring ledger.
 * @param options - the file path.
 * @returns the ledger; a corrupt file is reported and starts empty rather than
 *   preventing the authoring surface from working.
 */
export function createAuthoringLedger(options: { readonly file: string }): AuthoringLedger {
  const loaded = readDocument(options.file)
  let receipts: AuthoringReceipt[] = [...loaded.document.receipts].slice(-MAX_AUTHORING_EVENTS)
  return {
    file: options.file,
    issue: loaded.issue,
    list: () => [...receipts],
    record(input) {
      const receipt: AuthoringReceipt = {
        receiptId: 'ar_' + randomUUID(),
        at: input.at ?? new Date().toISOString(),
        operation: input.operation,
        artifactKind: input.artifactKind,
        name: input.name,
        ...input.version === undefined ? {} : { version: input.version },
        ...input.durationMs === undefined ? {} : { durationMs: input.durationMs },
        outcome: input.outcome ?? 'ok',
      }
      receipts = [...receipts, receipt].slice(-MAX_AUTHORING_EVENTS)
      writeDocument(options.file, { version: 1, receipts })
      return receipt
    },
  }
}
