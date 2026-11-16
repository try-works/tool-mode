/**
 * Per-session adoption ledger: offered / called / authored / reused.
 *
 * This is a SESSION view, not the global authoring ledger. The two answer different
 * questions: "what did this session change?" and "what has this deployment accumulated?".
 * Values are counts and names only; no arguments, results or program bodies are stored.
 * "steps saved" is intentionally not invented — there is no counterfactual to measure.
 *
 * @module @try-works/dsh-tool-mode/session-ledger
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Most sessions retained. */
export const MAX_SESSION_LEDGERS = 200

/** One session's adoption counters. */
export interface SessionAdoption {
  readonly sessionId: string
  /** Tool names the session was shown, bounded. */
  readonly offered: string[]
  /** Calls by tool name, bounded. */
  readonly called: Record<string, number>
  /** Artifacts authored in this session. */
  authored: number
  /** Calls to an authored tool or workflow (reuse). */
  reused: number
  /** No counterfactual exists; null is the honest value. */
  readonly stepsSaved: null
  readonly updatedAt: string
}

/** The ledger. */
export interface SessionLedger {
  readonly file: string
  readonly issue: string | undefined
  offered(sessionId: string, names: readonly string[]): void
  called(sessionId: string, name: string): void
  authored(sessionId: string): void
  summary(sessionId: string): SessionAdoption | undefined
}

interface LedgerDocument {
  readonly version: 1
  readonly sessions: Record<string, SessionAdoption>
}

function empty(): LedgerDocument { return { version: 1, sessions: {} } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function read(file: string): { document: LedgerDocument; issue: string | undefined } {
  if (!existsSync(file)) return { document: empty(), issue: undefined }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!isRecord(parsed) || !isRecord(parsed['sessions'])) {
      return { document: empty(), issue: 'the session ledger has no sessions object' }
    }
    const sessions: Record<string, SessionAdoption> = {}
    for (const [id, row] of Object.entries(parsed['sessions'])) {
      if (!isRecord(row) || !Array.isArray(row['offered']) || !isRecord(row['called'])) continue
      const called: Record<string, number> = {}
      for (const [name, count] of Object.entries(row['called'])) {
        if (typeof count === 'number' && Number.isFinite(count) && count >= 0) called[name] = count
      }
      sessions[id] = {
        sessionId: id,
        offered: row['offered'].filter((name): name is string => typeof name === 'string').slice(0, 200),
        called,
        authored: typeof row['authored'] === 'number' ? row['authored'] : 0,
        reused: typeof row['reused'] === 'number' ? row['reused'] : 0,
        stepsSaved: null,
        updatedAt: typeof row['updatedAt'] === 'string' ? row['updatedAt'] : new Date(0).toISOString(),
      }
    }
    return { document: { version: 1, sessions }, issue: undefined }
  } catch (error) {
    return { document: empty(), issue: 'the session ledger could not be read: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

function write(file: string, document: LedgerDocument): void {
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
 * Open the session ledger.
 * @param options - file path.
 * @returns the ledger.
 */
export function createSessionLedger(options: { readonly file: string }): SessionLedger {
  const loaded = read(options.file)
  let sessions: Record<string, SessionAdoption> = { ...loaded.document.sessions }
  const update = (sessionId: string, change: (current: SessionAdoption) => SessionAdoption): void => {
    if (sessionId.length === 0) return
    const now = new Date().toISOString()
    const current = sessions[sessionId] ?? {
      sessionId, offered: [], called: {}, authored: 0, reused: 0, stepsSaved: null, updatedAt: now,
    }
    const next = change(current)
    const bounded: Record<string, SessionAdoption> = { ...sessions, [sessionId]: { ...next, updatedAt: now } }
    const entries = Object.entries(bounded).sort((left, right) => right[1].updatedAt.localeCompare(left[1].updatedAt))
    sessions = Object.fromEntries(entries.slice(0, MAX_SESSION_LEDGERS))
    write(options.file, { version: 1, sessions })
  }
  return {
    file: options.file,
    issue: loaded.issue,
    offered(sessionId, names) {
      update(sessionId, current => ({ ...current, offered: [...new Set([...current.offered, ...names])].slice(0, 200) }))
    },
    called(sessionId, name) {
      update(sessionId, current => ({
        ...current,
        called: { ...current.called, [name]: (current.called[name] ?? 0) + 1 },
        reused: current.reused + (name.startsWith('agent_') || name.startsWith('workflow_') ? 1 : 0),
      }))
    },
    authored(sessionId) {
      update(sessionId, current => ({ ...current, authored: current.authored + 1 }))
    },
    summary(sessionId) {
      return sessions[sessionId]
    },
  }
}
