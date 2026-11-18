/**
 * Durable artifact usage (adoption plan Phase 0).
 *
 * Promotion evidence cannot depend on a bounded receipt ring: a busy host evicts
 * the receipts that prove an artifact was used. This store keeps one compacted
 * row per (name, digest) and is updated when an authored run completes.
 *
 * It records COUNTS and session identities only. No arguments, results or program
 * bodies are accepted by the API.
 *
 * @module artifact-usage
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-known-value-widening, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type -- SAFETY: this is the persisted JSON boundary; the reader validates every field before accepting a row, then narrows into the typed row. */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { PromotionEvidence } from './artifact-promotion.ts'

/** Default distinct session ids retained per artifact. */
export const DEFAULT_MAX_SESSIONS = 100
/** Default receipt ids retained for deduplication. */
export const DEFAULT_MAX_RECEIPTS = 500
/** Default artifact rows retained. */
export const DEFAULT_MAX_ROWS = 500

/** One artifact's compacted usage. */
export interface ArtifactUsageRow {
  readonly name: string
  readonly digest: string
  readonly uses: number
  readonly failures: number
  /** Distinct root session ids, bounded. */
  readonly sessions: readonly string[]
  /** Total distinct sessions observed, including ones no longer retained. */
  readonly sessionTotal: number
  readonly lastAt: string
  /** Receipt ids already counted, bounded. */
  readonly receiptIds: readonly string[]
}

/** What one completed artifact run contributes. */
export interface ArtifactUsageInput {
  readonly receiptId: string
  readonly name: string
  readonly digest: string
  readonly sessionId?: string | undefined
  readonly outcome: 'ok' | 'failed'
  readonly at?: string | undefined
}

/** Options for retention bounds. */
export interface ArtifactUsageOptions {
  readonly maxSessions?: number
  readonly maxReceipts?: number
  readonly maxRows?: number
}

/** The durable store. */
export interface ArtifactUsageStore {
  readonly file: string
  readonly issue: string | undefined
  record(input: ArtifactUsageInput): void
  evidence(name: string, digest?: string): PromotionEvidence
  rows(): readonly ArtifactUsageRow[]
}

interface UsageDocument {
  readonly version: 1
  readonly rows: readonly ArtifactUsageRow[]
}

function empty(): UsageDocument { return { version: 1, rows: [] } }

function read(file: string): { document: UsageDocument; issue: string | undefined } {
  if (!existsSync(file)) return { document: empty(), issue: undefined }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { rows?: unknown }).rows)) {
      return { document: empty(), issue: 'artifact-usage has no rows array' }
    }
    const rows: ArtifactUsageRow[] = []
    for (const raw of (parsed as { rows: unknown[] }).rows) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as Record<string, unknown>
      if (typeof row['name'] !== 'string' || typeof row['digest'] !== 'string') continue
      rows.push({
        name: row['name'],
        digest: row['digest'],
        uses: typeof row['uses'] === 'number' ? row['uses'] : 0,
        failures: typeof row['failures'] === 'number' ? row['failures'] : 0,
        sessions: Array.isArray(row['sessions']) ? row['sessions'].filter((id): id is string => typeof id === 'string') : [],
        sessionTotal: typeof row['sessionTotal'] === 'number' ? row['sessionTotal'] : 0,
        lastAt: typeof row['lastAt'] === 'string' ? row['lastAt'] : new Date(0).toISOString(),
        receiptIds: Array.isArray(row['receiptIds']) ? row['receiptIds'].filter((id): id is string => typeof id === 'string') : [],
      })
    }
    return { document: { version: 1, rows }, issue: undefined }
  } catch (error) {
    return {
      document: empty(),
      issue: 'artifact-usage could not be read: ' + (error instanceof Error ? error.message : String(error)),
    }
  }
}

function write(file: string, document: UsageDocument): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = file + '.tmp-' + process.pid.toString(36) + '-' + Date.now().toString(36)
  try {
    writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, file)
  } catch (error) {
    // A failed usage write must not fail the tool run; the evidence is degraded,
    // not the invocation.
    try { writeFileSync(file, JSON.stringify(document, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 }) } catch { /* logged by the caller */ }
    if (error instanceof Error) throw error
  }
}

/**
 * Create the durable usage store.
 * @param file - JSON path beside the authoring store.
 * @param options - retention bounds.
 * @returns the store.
 */
export function createArtifactUsageStore(file: string, options: ArtifactUsageOptions = {}): ArtifactUsageStore {
  const maxSessions = Math.max(1, options.maxSessions ?? DEFAULT_MAX_SESSIONS)
  const maxReceipts = Math.max(1, options.maxReceipts ?? DEFAULT_MAX_RECEIPTS)
  const maxRows = Math.max(1, options.maxRows ?? DEFAULT_MAX_ROWS)
  const loaded = read(file)
  let document = loaded.document

  const persist = (rows: readonly ArtifactUsageRow[]): void => {
    const bounded = rows.slice(-maxRows)
    write(file, { version: 1, rows: bounded })
    document = { version: 1, rows: bounded }
  }

  return {
    file,
    issue: loaded.issue,
    record(input) {
      const index = document.rows.findIndex(row => row.name === input.name && row.digest === input.digest)
      const existing = index < 0 ? undefined : document.rows[index]
      if (existing?.receiptIds.includes(input.receiptId) === true) return
      const sessions = existing?.sessions ?? []
      const seenSession = input.sessionId !== undefined && sessions.includes(input.sessionId)
      const nextSessions = input.sessionId === undefined || seenSession
        ? sessions
        : [...sessions, input.sessionId].slice(-maxSessions)
      const sessionTotal = existing === undefined
        ? (input.sessionId === undefined ? 0 : 1)
        : (input.sessionId !== undefined && !seenSession ? existing.sessionTotal + 1 : existing.sessionTotal)
      const next: ArtifactUsageRow = {
        name: input.name,
        digest: input.digest,
        uses: (existing?.uses ?? 0) + 1,
        failures: (existing?.failures ?? 0) + (input.outcome === 'failed' ? 1 : 0),
        sessions: nextSessions,
        sessionTotal,
        lastAt: input.at ?? new Date().toISOString(),
        receiptIds: [...(existing?.receiptIds ?? []), input.receiptId].slice(-maxReceipts),
      }
      const rows = [...document.rows]
      if (index < 0) rows.push(next)
      else rows[index] = next
      try {
        persist(rows)
      } catch {
        // Usage evidence is observability: a failed write degrades the record,
        // never the artifact run. Keep the in-memory view authoritative for this
        // process so the current session still counts.
        document = { version: 1, rows: rows.slice(-maxRows) }
      }
    },
    evidence(name, digest) {
      let uses = 0
      let sessions = 0
      let failures = 0
      for (const row of document.rows) {
        if (row.name !== name) continue
        if (digest !== undefined && row.digest !== digest) continue
        uses += row.uses
        sessions += row.sessionTotal
        failures += row.failures
      }
      return { uses, sessions, failures }
    },
    rows() {
      return [...document.rows]
    },
  }
}
