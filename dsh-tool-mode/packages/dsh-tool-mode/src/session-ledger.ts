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

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-conditional-empty-object-spread, anti-slop/no-known-value-widening, anti-slop/no-shape-in-symbol-names, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this is the persisted session-ledger JSON boundary; every field is validated before it enters the typed row. */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Most sessions retained. */
export const MAX_SESSION_LEDGERS = 200

/** Most distinct tool names retained in one root session's reach. */
export const MAX_REACH_TOOLS = 100

/** Most distinct agent session ids retained in one root session's reach. */
export const MAX_REACH_AGENTS = 50

/**
 * The ROOT session's tree reach (task-65).
 *
 * `called` is the UNION of the root's own calls and every subagent's calls, so "looked
 * and declined" and "never looked" are different observations. `agents` counts each
 * agent's calls separately. Names and counts only: no arguments, no results, so a child
 * cannot leak caller content into the root's record.
 */
export interface SessionReach {
  /** Calls by tool name across the tree, bounded. */
  readonly called: Record<string, number>
  /** Calls per participating agent session id (children keyed by their LEAF id). */
  readonly agents: Record<string, number>
  /** Total calls recorded in the tree (not bounded by the name map size). */
  readonly total: number
}

/** One session's adoption counters. */
export interface SessionAdoption {
  readonly sessionId: string
  /** Tool names the session was shown, bounded. */
  readonly offered: string[]
  /** Calls by tool name, bounded. */
  readonly called: Record<string, number>
  /** The ROOT session's tree reach: union of the root and its subagents, names only. */
  readonly reach: SessionReach
  /** Artifacts authored in this session. */
  authored: number
  /** Calls to an authored tool or workflow (reuse). */
  reused: number
  /** No counterfactual exists; null is the honest value. */
  readonly stepsSaved: null
  /** Experiment arm (D/G/O), or null when the session is not in an experiment. */
  arm: string | null
  /** Save suggestions surfaced to this session. */
  saveOffers: number
  readonly updatedAt: string
}

/** The ledger. */
export interface SessionLedger {
  readonly file: string
  readonly issue: string | undefined
  offered(sessionId: string, names: readonly string[]): void
  called(sessionId: string, name: string): void
  /**
   * Record one call into the ROOT session's tree reach (task-65).
   * @param rootSessionId - the root session whose row carries the tree.
   * @param agentSessionId - the LEAF agent that made the call (root or subagent).
   * @param name - the tool name; arguments are never recorded.
   */
  treeCalled(rootSessionId: string, agentSessionId: string, name: string): void
  /** Remove one session's ledger row entirely (root-session disposal). */
  forget(sessionId: string): void
  authored(sessionId: string): void
  /** Record the experiment arm once; later calls are idempotent. */
  markArm(sessionId: string, arm: string): void
  /** Count one save suggestion surfaced to the session. */
  offer(sessionId: string): void
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

/**
 * Read one persisted reach object, or the empty shape when it is absent/malformed.
 * A pre-task-65 ledger has no `reach`; that is an absent measurement, never a zero
 * claim, and the row still loads.
 * @param raw - the untrusted stored value.
 * @returns the validated reach.
 */
function readReach(raw: unknown): SessionReach {
  if (!isRecord(raw)) return { called: {}, agents: {}, total: 0 }
  const called: Record<string, number> = {}
  if (isRecord(raw['called'])) {
    for (const [name, count] of Object.entries(raw['called'])) {
      if (typeof count === 'number' && Number.isFinite(count) && count >= 0) called[name] = count
    }
  }
  const agents: Record<string, number> = {}
  if (isRecord(raw['agents'])) {
    for (const [agent, count] of Object.entries(raw['agents'])) {
      if (typeof count === 'number' && Number.isFinite(count) && count >= 0) agents[agent] = count
    }
  }
  return {
    called,
    agents,
    total: typeof raw['total'] === 'number' && raw['total'] >= 0 ? raw['total'] : 0,
  }
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
        reach: readReach(row['reach']),
        authored: typeof row['authored'] === 'number' ? row['authored'] : 0,
        reused: typeof row['reused'] === 'number' ? row['reused'] : 0,
        stepsSaved: null,
        arm: typeof row['arm'] === 'string' ? row['arm'] : null,
        saveOffers: typeof row['saveOffers'] === 'number' ? row['saveOffers'] : 0,
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
      sessionId, offered: [], called: {}, reach: { called: {}, agents: {}, total: 0 },
      authored: 0, reused: 0, stepsSaved: null, arm: null, saveOffers: 0, updatedAt: now,
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
    treeCalled(rootSessionId, agentSessionId, name) {
      if (rootSessionId.length === 0 || name.length === 0) return
      update(rootSessionId, current => {
        const called = { ...current.reach.called, [name]: (current.reach.called[name] ?? 0) + 1 }
        const agents = { ...current.reach.agents, [agentSessionId]: (current.reach.agents[agentSessionId] ?? 0) + 1 }
        return {
          ...current,
          reach: {
            called: Object.fromEntries(Object.entries(called).slice(-MAX_REACH_TOOLS)),
            agents: Object.fromEntries(Object.entries(agents).slice(-MAX_REACH_AGENTS)),
            total: current.reach.total + 1,
          },
        }
      })
    },
    forget(sessionId) {
      if (sessions[sessionId] === undefined) return
      const next = { ...sessions }
      delete next[sessionId]
      sessions = next
      write(options.file, { version: 1, sessions })
    },
    authored(sessionId) {
      update(sessionId, current => ({ ...current, authored: current.authored + 1 }))
    },
    markArm(sessionId, arm) {
      update(sessionId, current => current.arm === null ? { ...current, arm } : current)
    },
    offer(sessionId) {
      update(sessionId, current => ({ ...current, saveOffers: current.saveOffers + 1 }))
    },
    summary(sessionId) {
      return sessions[sessionId]
    },
  }
}
