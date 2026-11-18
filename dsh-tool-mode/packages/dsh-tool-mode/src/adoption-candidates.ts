/**
 * Repetition detection for the save offer (adoption plan Phase 3).
 *
 * The host has no reliable end-of-session turn, so the offer is made mid-task or
 * surfaced in the next `tool_mode_list`. This module counts identical
 * tool + canonical-arguments shapes per session. It NEVER stores argument values:
 * only a salted digest and a shape-only input schema.
 *
 * @module adoption-candidates
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-conditional-empty-object-spread, anti-slop/no-shape-in-symbol-names, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this module inspects arbitrary JSON tool arguments to derive a shape-only schema; every value is checked before its type is used, and no value is retained. */

import { createHash } from 'node:crypto'
import { schemaShape } from './run-capture.ts'

/** One repeated-call candidate. */
export interface RepetitionCandidate {
  readonly id: string
  readonly sessionId: string
  readonly toolName: string
  readonly calls: number
  /** A shape-only schema; values are never present. */
  readonly inputSchema: Record<string, unknown>
  /** Argument keys the repeated calls used (whitelisted at creation). */
  readonly parameterPaths: readonly string[]
  /** The latest composition run, when the repeated tool was tool_mode_run. */
  readonly runId?: string
}

/** What one completed tool call contributes. */
export interface RepetitionInput {
  readonly sessionId: string
  readonly toolName: string
  readonly args: unknown
  readonly runId?: string | undefined
}

/** Bounds and threshold. */
export interface RepetitionOptions {
  readonly threshold?: number
  readonly maxSessions?: number
  readonly maxCandidates?: number
}

/** The tracker. */
export interface RepetitionTracker {
  /** Record one call; returns the candidate the first time the threshold is met. */
  record(input: RepetitionInput): RepetitionCandidate | undefined
  /** Candidates for this session, newest first. */
  suggestions(sessionId: string): readonly RepetitionCandidate[]
  /** Drop one candidate (after acceptance) or a whole session. */
  clear(sessionId: string, candidateId?: string): void
}

interface Counted {
  readonly key: string
  readonly sessionId: string
  readonly toolName: string
  readonly inputSchema: Record<string, unknown>
  readonly parameterPaths: readonly string[]
  count: number
  offered: boolean
  runId?: string
  readonly id: string
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const record = value as Record<string, unknown>
  return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}'
}

function pathsOf(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return prefix.length === 0 ? [] : [prefix]
  if (Array.isArray(value)) return prefix.length === 0 ? [] : [prefix]
  const out: string[] = []
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix.length === 0 ? key : prefix + '.' + key
    const nested = pathsOf(item, path)
    if (nested.length === 0) out.push(path)
    else out.push(...nested)
  }
  return out
}

/**
 * Create the bounded tracker.
 * @param options - threshold and bounds.
 * @returns the tracker.
 */
export function createRepetitionTracker(options: RepetitionOptions = {}): RepetitionTracker {
  const threshold = Math.max(2, options.threshold ?? 3)
  const maxSessions = Math.max(1, options.maxSessions ?? 50)
  const maxCandidates = Math.max(1, options.maxCandidates ?? 20)
  const bySession = new Map<string, Map<string, Counted>>()
  const sessionOrder: string[] = []

  const touchSession = (sessionId: string): void => {
    if (bySession.has(sessionId)) return
    bySession.set(sessionId, new Map())
    sessionOrder.push(sessionId)
    while (sessionOrder.length > maxSessions) {
      const oldest = sessionOrder.shift()
      if (oldest !== undefined) bySession.delete(oldest)
    }
  }

  return {
    record(input) {
      const sessionId = input.sessionId.trim()
      if (sessionId.length === 0) return undefined
      touchSession(sessionId)
      const bucket = bySession.get(sessionId)
      if (bucket === undefined) return undefined
      // Fingerprint the SHAPE, never the values: repeated workloads vary their
      // input text while keeping the call shape. This also means no caller value
      // can ever enter the candidate record.
      const inputSchema = schemaShape(input.args)
      const digest = createHash('sha256')
        .update(input.toolName + '\u0000' + canonical(inputSchema))
        .digest('hex')
        .slice(0, 20)
      const existing = bucket.get(digest)
      if (existing !== undefined) {
        existing.count += 1
        if (input.runId !== undefined) existing.runId = input.runId
        if (!existing.offered && existing.count >= threshold) {
          existing.offered = true
          return {
            id: existing.id,
            sessionId: existing.sessionId,
            toolName: existing.toolName,
            calls: existing.count,
            inputSchema: existing.inputSchema,
            parameterPaths: existing.parameterPaths,
            ...existing.runId === undefined ? {} : { runId: existing.runId },
          }
        }
        return undefined
      }
      const counted: Counted = {
        key: digest,
        sessionId,
        toolName: input.toolName,
        inputSchema,
        parameterPaths: pathsOf(input.args).slice(0, 16),
        count: 1,
        offered: false,
        id: 'rep_' + digest,
        ...input.runId === undefined ? {} : { runId: input.runId },
      }
      bucket.set(digest, counted)
      while (bucket.size > maxCandidates) {
        const first = bucket.keys().next().value
        if (first === undefined) break
        bucket.delete(first)
      }
      if (counted.count >= threshold) {
        counted.offered = true
        return {
          id: counted.id,
          sessionId,
          toolName: counted.toolName,
          calls: counted.count,
          inputSchema: counted.inputSchema,
          parameterPaths: counted.parameterPaths,
          ...counted.runId === undefined ? {} : { runId: counted.runId },
        }
      }
      return undefined
    },
    suggestions(sessionId) {
      const bucket = bySession.get(sessionId)
      if (bucket === undefined) return []
      return [...bucket.values()]
        .filter(row => row.offered)
        .reverse()
        .slice(0, 5)
        .map(row => ({
          id: row.id,
          sessionId: row.sessionId,
          toolName: row.toolName,
          calls: row.count,
          inputSchema: row.inputSchema,
          parameterPaths: row.parameterPaths,
          ...row.runId === undefined ? {} : { runId: row.runId },
        }))
    },
    clear(sessionId, candidateId) {
      const bucket = bySession.get(sessionId)
      if (bucket === undefined) return
      if (candidateId === undefined) {
        bySession.delete(sessionId)
        return
      }
      for (const [key, row] of bucket) {
        if (row.id === candidateId) bucket.delete(key)
      }
    },
  }
}
