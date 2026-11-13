/**
 * The bounded external-MCP call ledger (plan §3.4).
 *
 * External MCP `tools/call`s are not session events, so the only honest way to answer
 * "MCP was used, by whom, how often" is to persist them. One JSONL row per call, trimmed
 * at a bound, written beside the host state.
 *
 * The record TYPE is the privacy boundary: it has identity, timings, failure class,
 * sizes and the receipt id, and deliberately nowhere to put arguments, results,
 * credentials or the bearer token. A future change cannot start logging payloads by
 * accident without changing this type.
 *
 * @module @try-works/dsh-tool-mode/mcp-usage
 */

import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { InvocationAccounting } from './invocation-accounting.ts'

/** How many rows the ledger retains. */
export const MCP_USAGE_MAX_ROWS = 5_000

/** The default page size for a call-log request. */
export const MCP_USAGE_DEFAULT_PAGE_SIZE = 50

/** One external call, as persisted. */
export interface McpCallRecord {
  /** Epoch milliseconds when the call settled. */
  readonly time: number
  /** The tool that was invoked (the accounting hook now carries it). */
  readonly tool: string
  /** The authenticated client identity. */
  readonly clientId: string
  /** The client's own grant identity, when one was derived. */
  readonly grantId: string | null
  readonly totalMs: number
  readonly queuedMs: number
  readonly loadMs: number
  readonly inferenceMs: number
  /** The closed failure-class vocabulary (`invocation-accounting.ts`). */
  readonly failureClass: string
  /** A class-level reason; never a payload. */
  readonly reason: string | null
  readonly inputBytes: number
  readonly outputBytes: number
  /** The native receipt id the call is correlatable by. */
  readonly receiptId: string
}

/** A page of the external call log, newest first. */
export interface McpCallsPage {
  readonly calls: readonly McpCallRecord[]
  /** Matching rows before pagination. */
  readonly total: number
  readonly page: number
  readonly pageSize: number
  /** Distinct client identities present in the ledger (all rows, not just the page). */
  readonly clients: readonly string[]
}

/** One client's external activity. */
export interface McpUsageClient {
  readonly clientId: string
  /** The client's own grant identity, when a ledger row carried one. */
  readonly grantId: string | null
  readonly calls: number
  readonly errors: number
  readonly lastSeen: number
}

/** One tool's external activity. */
export interface McpUsageTool {
  readonly tool: string
  readonly calls: number
}

/** The ledger's aggregate view. */
export interface McpUsageSummary {
  readonly total: number
  readonly clients: readonly McpUsageClient[]
  readonly tools: readonly McpUsageTool[]
}

/** What the accounting hook supplies, plus the tool name it now carries. */
export function recordFromAccounting(toolName: string, accounting: InvocationAccounting, time = Date.now()): McpCallRecord {
  return {
    time,
    tool: toolName,
    clientId: accounting.clientId ?? 'unknown',
    grantId: accounting.grantId ?? null,
    totalMs: accounting.timings.totalMs,
    queuedMs: accounting.timings.queuedMs,
    loadMs: accounting.timings.loadMs,
    inferenceMs: accounting.timings.inferenceMs,
    failureClass: accounting.failureClass,
    reason: accounting.reason,
    inputBytes: accounting.sizes.inputBytes,
    outputBytes: accounting.sizes.outputBytes,
    receiptId: accounting.receiptId,
  }
}

/** A finite number, else null. */
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Read one raw ledger line as a record, or null when it is not one. */
function readRecord(raw: string): McpCallRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  // SAFETY: the guard above proved a non-null, non-array object; every field the record
  // needs is type-checked below before it is copied into the typed result.
  const record = parsed as Record<string, unknown>
  const time = numberOrNull(record['time'])
  const totalMs = numberOrNull(record['totalMs'])
  if (time === null || totalMs === null) return null
  if (typeof record['tool'] !== 'string' || typeof record['clientId'] !== 'string') return null
  if (typeof record['receiptId'] !== 'string' || typeof record['failureClass'] !== 'string') return null
  return {
    time,
    tool: record['tool'],
    clientId: record['clientId'],
    grantId: typeof record['grantId'] === 'string' ? record['grantId'] : null,
    totalMs,
    queuedMs: numberOrNull(record['queuedMs']) ?? 0,
    loadMs: numberOrNull(record['loadMs']) ?? 0,
    inferenceMs: numberOrNull(record['inferenceMs']) ?? 0,
    failureClass: record['failureClass'],
    reason: typeof record['reason'] === 'string' ? record['reason'] : null,
    inputBytes: numberOrNull(record['inputBytes']) ?? 0,
    outputBytes: numberOrNull(record['outputBytes']) ?? 0,
    receiptId: record['receiptId'],
  }
}

/**
 * A bounded JSONL ledger over one file.
 *
 * Operations are synchronous and defensive: an unreadable or corrupt line contributes
 * nothing, and a rotated file keeps the newest rows rather than failing the append.
 */
export class McpUsageLedger {
  readonly #file: string
  readonly #maxRows: number

  /**
   * @param file - the JSONL path.
   * @param options - `maxRows` defaults to {@link MCP_USAGE_MAX_ROWS}.
   */
  constructor(file: string, options: { readonly maxRows?: number } = {}) {
    this.#file = file
    this.#maxRows = Math.max(2, options.maxRows ?? MCP_USAGE_MAX_ROWS)
  }

  /** The ledger path (the MCP status surface names it, never its contents). */
  get file(): string {
    return this.#file
  }

  /** All readable rows, oldest first. */
  #rows(): McpCallRecord[] {
    let text: string
    try {
      text = readFileSync(this.#file, 'utf8')
    } catch {
      return []
    }
    const rows: McpCallRecord[] = []
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue
      const record = readRecord(line)
      if (record !== null) rows.push(record)
    }
    return rows
  }

  /** Atomically replace the file with exactly these rows. */
  #write(rows: readonly McpCallRecord[]): void {
    mkdirSync(dirname(this.#file), { recursive: true })
    const temporary = `${this.#file}.${process.pid}.${Date.now().toString(36)}.tmp`
    writeFileSync(temporary, rows.map(row => `${JSON.stringify(row)}\n`).join(''), 'utf8')
    renameSync(temporary, this.#file)
  }

  /**
   * Append one call, trimming at the bound.
   * @param call - the record to persist.
   */
  record(call: McpCallRecord): void {
    mkdirSync(dirname(this.#file), { recursive: true })
    const existing = this.#rows()
    if (existing.length >= this.#maxRows) {
      // Rotation: keep the newest (bound - 1) rows, then append the new one.
      this.#write([...existing.slice(existing.length - (this.#maxRows - 1)), call])
      return
    }
    appendFileSync(this.#file, `${JSON.stringify(call)}\n`, 'utf8')
  }

  /**
   * Read one page, newest first.
   * @param query - optional client filter and 1-based page.
   * @returns the page plus the matching total and the ledger's client identities.
   */
  read(query: { readonly clientId?: string; readonly page?: number; readonly pageSize?: number } = {}): McpCallsPage {
    const all = this.#rows()
    const clients = [...new Set(all.map(row => row.clientId))].sort((left, right) => left.localeCompare(right))
    const matching = query.clientId === undefined ? all : all.filter(row => row.clientId === query.clientId)
    const page = Math.max(1, Math.trunc(query.page ?? 1))
    const pageSize = Math.min(200, Math.max(1, Math.trunc(query.pageSize ?? MCP_USAGE_DEFAULT_PAGE_SIZE)))
    const newestFirst = [...matching].reverse()
    const start = (page - 1) * pageSize
    return {
      calls: newestFirst.slice(start, start + pageSize),
      total: matching.length,
      page,
      pageSize,
      clients,
    }
  }

  /** Aggregate the ledger by client and tool. */
  summarize(): McpUsageSummary {
    const rows = this.#rows()
    const clients = new Map<string, { calls: number; errors: number; lastSeen: number; grantId: string | null }>()
    const tools = new Map<string, number>()
    for (const row of rows) {
      const client = clients.get(row.clientId) ?? { calls: 0, errors: 0, lastSeen: 0, grantId: null }
      clients.set(row.clientId, {
        calls: client.calls + 1,
        errors: client.errors + (row.failureClass === 'none' ? 0 : 1),
        lastSeen: Math.max(client.lastSeen, row.time),
        grantId: row.grantId ?? client.grantId,
      })
      tools.set(row.tool, (tools.get(row.tool) ?? 0) + 1)
    }
    return {
      total: rows.length,
      clients: [...clients.entries()]
        .map(([clientId, client]) => ({ clientId, ...client }))
        .sort((left, right) => left.clientId.localeCompare(right.clientId)),
      tools: [...tools.entries()]
        .map(([tool, calls]) => ({ tool, calls }))
        .sort((left, right) => right.calls - left.calls || left.tool.localeCompare(right.tool)),
    }
  }
}
