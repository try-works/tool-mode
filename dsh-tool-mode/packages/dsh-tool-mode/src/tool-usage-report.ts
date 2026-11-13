/**
 * The exact-range Tool Insights report (plan §3.1, S2; client contract in
 * `docs/tool-insights/host-contract.md`).
 *
 * The projection keeps the detail; this module filters it to a window and produces the
 * rollups the page renders. Range filtering uses the PER-DAY counters the projection
 * records, so call/error/duration totals are exact for the window.
 *
 * Percentiles come from the retained 16-bucket histograms. The histograms are not split
 * by day, so p50/p95 are an approximation over the retained settled calls while `maxMs`
 * is exact for the window. `histogramScope: 'retained'` states this.
 *
 * @module @try-works/dsh-tool-mode/tool-usage-report
 */

import {
  DURATION_BUCKETS_MS,
  TOOL_USAGE_CAPS,
  toolUsageDayKey,
  type RecentCall,
  type ToolUsageState,
} from './tool-usage-projection.ts'
import { staticToolOwner } from './tool-sources.ts'

/** The ranges the page offers. */
export type UsageRange = '24h' | '7d' | '30d' | 'all'

const DAY_MS = 24 * 60 * 60 * 1000

/** One resolved window. `from` is inclusive, `to` exclusive (milliseconds). */
export interface UsageWindow {
  readonly range: UsageRange
  readonly from: number
  readonly to: number
  /** Host-local day key of `from` (inclusive). */
  readonly fromDay: string
  /** Host-local day key of `to` (inclusive). */
  readonly toDay: string
}

/** One session's detail state joined with the workspace it belongs to. */
export interface SessionUsageInput {
  readonly sessionId: string
  readonly workspace: string | null
  readonly state: ToolUsageState
}

/** One tool's performance over the window (flat client contract). */
export interface UsageToolRow {
  readonly name: string
  readonly owner: string
  readonly calls: number
  readonly errors: number
  readonly unsettled: number
  readonly codeCalls: number
  readonly directCalls: number
  readonly totalMs: number
  readonly maxMs: number
  readonly p50: number | null
  readonly p95: number | null
  readonly firstUsed: number | null
  readonly lastUsed: number | null
  readonly argsBytes: number
  readonly resultBytes: number
}

/** One model row. */
export interface UsageModelRow {
  readonly model: string
  readonly calls: number
  readonly errors: number
  readonly tools: number
  readonly ms: number
  readonly p50: number | null
  readonly p95: number | null
}

/** One day row. */
export interface UsageDayRow {
  readonly day: string
  readonly calls: number
  readonly errors: number
  readonly ms: number
  readonly unsettled: number
}

/** One workspace row. */
export interface UsageWorkspaceRow {
  readonly workspace: string
  readonly sessions: number
  readonly calls: number
  readonly errors: number
  readonly ms: number
}

/** One recent call, in the client's flat vocabulary. */
export interface UsageRecentCall {
  readonly time: number
  readonly name: string
  readonly owner: string
  readonly model: string
  readonly ms: number | null
  readonly ok: boolean | null
  readonly errorCode: string | null
  readonly kind: 'direct' | 'code'
  readonly callId: string
  readonly parentCallId: string | null
  readonly sessionId: string
  readonly workspace: string | null
}

/** One error-code row. */
export interface UsageErrorCodeRow {
  readonly code: string
  readonly calls: number
}

/** The whole report (flat totals plus rollups; the client contract). */
export interface UsageReport {
  readonly range: UsageRange
  readonly from: number
  readonly to: number
  readonly calls: number
  readonly errors: number
  readonly unsettled: number
  readonly toolMs: number
  readonly codeCalls: number
  readonly sessions: number
  readonly uniqueTools: number
  /** Successes over SETTLED calls; null when nothing settled in the window. */
  readonly successRate: number | null
  readonly p50: number | null
  readonly p95: number | null
  readonly tools: readonly UsageToolRow[]
  readonly models: readonly UsageModelRow[]
  readonly days: readonly UsageDayRow[]
  readonly workspaces: readonly UsageWorkspaceRow[]
  readonly errorCodes: readonly UsageErrorCodeRow[]
  readonly recentCalls: readonly UsageRecentCall[]
  readonly histogramScope: 'retained'
}

/**
 * Resolve one range to a window.
 * @param range - the selected range.
 * @param now - the current time in milliseconds.
 * @returns the window with host-local day keys.
 */
export function rangeWindow(range: UsageRange, now: number): UsageWindow {
  const from = range === 'all' ? 0 : now - (range === '24h' ? DAY_MS : range === '7d' ? 7 * DAY_MS : 30 * DAY_MS)
  return { range, from, to: now, fromDay: toolUsageDayKey(from), toDay: toolUsageDayKey(now) }
}

/**
 * The percentile an aggregated 16-bucket histogram implies.
 *
 * Each bucket answers with its UPPER edge; the open-ended last bucket answers with the
 * exact retained maximum. An empty histogram has no percentile.
 * @param histogram - bucket counts.
 * @param percentile - 1..100.
 * @param maxMs - the exact maximum observed duration.
 * @returns the derived duration, or null for an empty histogram.
 */
export function percentileFromHistogram(histogram: readonly number[], percentile: number, maxMs: number): number | null {
  const total = histogram.reduce((sum, count) => sum + count, 0)
  if (total <= 0) return null
  if (percentile >= 100) return maxMs
  const rank = Math.max(1, Math.ceil((Math.max(1, percentile) / 100) * total))
  let seen = 0
  for (let index = 0; index < histogram.length; index += 1) {
    seen += histogram[index] ?? 0
    if (seen < rank) continue
    if (index >= DURATION_BUCKETS_MS.length - 1) return maxMs
    return DURATION_BUCKETS_MS[index] ?? maxMs
  }
  return maxMs
}

/** Whether a day key falls inside the window's inclusive day span. */
function dayInWindow(day: string, window: UsageWindow): boolean {
  return day >= window.fromDay && day <= window.toDay
}

/** The retained minimum time when it falls inside the window, else null. */
function minTime(current: number | null, candidate: number | null, window: UsageWindow): number | null {
  const values = [current, candidate].filter((value): value is number => value !== null && value >= window.from && value < window.to)
  return values.length === 0 ? null : Math.min(...values)
}

/** The retained maximum time when it falls inside the window, else null. */
function maxTime(current: number | null, candidate: number | null, window: UsageWindow): number | null {
  const values = [current, candidate].filter((value): value is number => value !== null && value >= window.from && value < window.to)
  return values.length === 0 ? null : Math.max(...values)
}

/** The owner resolver the host supplies (live extension store), with a static fallback. */
export type UsageOwnerResolver = (name: string) => string

/** The default owner resolution: pinned map, Tool Mode, MCP grammar, else `unattributed`. */
function defaultOwner(name: string): string {
  return staticToolOwner(name).owner
}

/** One tool accumulator. */
interface ToolAccumulator {
  calls: number; errors: number; unsettled: number; codeCalls: number; directCalls: number
  totalMs: number; maxMs: number; histogram: number[]; firstUsed: number | null; lastUsed: number | null
  argsBytes: number; resultBytes: number
}

/**
 * Aggregate the sessions' detail states over one window.
 * @param sessions - the sessions' detail states and workspaces.
 * @param window - the resolved window.
 * @param options - `recentLimit` bounds recent calls; `resolveOwner` supplies live owners.
 * @returns the client-contract report.
 */
export function buildUsageReport(
  sessions: readonly SessionUsageInput[],
  window: UsageWindow,
  options: { readonly recentLimit?: number; readonly resolveOwner?: UsageOwnerResolver } = {},
): UsageReport {
  const recentLimit = options.recentLimit ?? TOOL_USAGE_CAPS.recent
  const resolveOwner = options.resolveOwner ?? defaultOwner
  let calls = 0
  let errors = 0
  let unsettled = 0
  let toolMs = 0
  let codeCalls = 0
  let sessionsWithCalls = 0
  const overallHistogram = Array.from({ length: TOOL_USAGE_CAPS.buckets }, () => 0)
  const days = new Map<string, UsageDayRow>()
  const tools = new Map<string, ToolAccumulator>()
  const models = new Map<string, { model: string; calls: number; errors: number; ms: number; tools: number; histogram: number[]; maxMs: number }>()
  const workspaces = new Map<string, UsageWorkspaceRow>()
  const errorCodes = new Map<string, number>()
  const recentCalls: UsageRecentCall[] = []

  for (const session of sessions) {
    let sessionCalls = 0
    let sessionErrors = 0
    let sessionMs = 0
    for (const [day, usage] of Object.entries(session.state.byDay)) {
      if (!dayInWindow(day, window)) continue
      sessionCalls += usage.calls
      sessionErrors += usage.errors
      sessionMs += usage.ms
      const current = days.get(day) ?? { day, calls: 0, errors: 0, ms: 0, unsettled: 0 }
      days.set(day, { day, calls: current.calls + usage.calls, errors: current.errors + usage.errors, ms: current.ms + usage.ms, unsettled: current.unsettled + usage.unsettled })
      for (const [code, count] of Object.entries(usage.byCode)) errorCodes.set(code, (errorCodes.get(code) ?? 0) + count)
    }
    calls += sessionCalls
    errors += sessionErrors
    toolMs += sessionMs
    if (sessionCalls === 0) continue
    sessionsWithCalls += 1
    const workspaceLabel = session.workspace ?? '(no workspace)'
    const workspace = workspaces.get(workspaceLabel) ?? { workspace: workspaceLabel, sessions: 0, calls: 0, errors: 0, ms: 0 }
    workspaces.set(workspaceLabel, { ...workspace, sessions: workspace.sessions + 1, calls: workspace.calls + sessionCalls, errors: workspace.errors + sessionErrors, ms: workspace.ms + sessionMs })

    for (const [name, bucket] of Object.entries(session.state.byTool)) {
      let rowCalls = 0
      let rowErrors = 0
      let rowMs = 0
      let rowMax = 0
      let rowUnsettled = 0
      let rowCode = 0
      let rowDirect = 0
      for (const [day, count] of Object.entries(bucket.byDay)) {
        if (!dayInWindow(day, window)) continue
        rowCalls += count.calls
        rowErrors += count.errors
        rowMs += count.ms
        rowMax = Math.max(rowMax, count.maxMs)
        rowUnsettled += count.unsettled
        rowCode += count.codeCalls
        rowDirect += count.calls - count.codeCalls
      }
      if (rowCalls === 0 && rowUnsettled === 0) continue
      codeCalls += rowCode
      const current = tools.get(name) ?? {
        calls: 0, errors: 0, unsettled: 0, codeCalls: 0, directCalls: 0, totalMs: 0, maxMs: 0,
        histogram: Array.from({ length: TOOL_USAGE_CAPS.buckets }, () => 0), firstUsed: null, lastUsed: null,
        argsBytes: 0, resultBytes: 0,
      }
      const histogram = current.histogram.map((count, index) => count + (bucket.histogram[index] ?? 0))
      for (let index = 0; index < histogram.length; index += 1) overallHistogram[index] = (overallHistogram[index] ?? 0) + (bucket.histogram[index] ?? 0)
      tools.set(name, {
        calls: current.calls + rowCalls,
        errors: current.errors + rowErrors,
        unsettled: current.unsettled + rowUnsettled,
        codeCalls: current.codeCalls + rowCode,
        directCalls: current.directCalls + rowDirect,
        totalMs: current.totalMs + rowMs,
        maxMs: Math.max(current.maxMs, rowMax),
        histogram,
        firstUsed: minTime(current.firstUsed, bucket.firstUsed, window),
        lastUsed: maxTime(current.lastUsed, bucket.lastUsed, window),
        argsBytes: current.argsBytes + bucket.argsBytes,
        resultBytes: current.resultBytes + bucket.resultBytes,
      })
    }

    for (const [model, usage] of Object.entries(session.state.byModel)) {
      let rowCalls = 0
      let rowErrors = 0
      let rowMs = 0
      let rowMax = 0
      const rowHistogram = Array.from({ length: TOOL_USAGE_CAPS.buckets }, () => 0)
      for (const [day, count] of Object.entries(usage.byDay)) {
        if (!dayInWindow(day, window)) continue
        rowCalls += count.calls
        rowErrors += count.errors
        rowMs += count.ms
        rowMax = Math.max(rowMax, count.maxMs)
      }
      if (rowCalls === 0) continue
      for (let index = 0; index < rowHistogram.length; index += 1) rowHistogram[index] = (rowHistogram[index] ?? 0) + (usage.histogram[index] ?? 0)
      const current = models.get(model) ?? { model, calls: 0, errors: 0, ms: 0, tools: 0, histogram: Array.from({ length: TOOL_USAGE_CAPS.buckets }, () => 0), maxMs: 0 }
      models.set(model, {
        model,
        calls: current.calls + rowCalls,
        errors: current.errors + rowErrors,
        ms: current.ms + rowMs,
        tools: Math.max(current.tools, usage.tools.length),
        histogram: current.histogram.map((count, index) => count + (rowHistogram[index] ?? 0)),
        maxMs: Math.max(current.maxMs, rowMax),
      })
    }

    for (const entry of session.state.recent) {
      if (entry.time < window.from || entry.time >= window.to) continue
      recentCalls.push(recentProjection(entry, resolveOwner(entry.name), session.sessionId, session.workspace))
    }
    for (const [day, usage] of Object.entries(session.state.byDay)) {
      if (dayInWindow(day, window)) unsettled += usage.unsettled
    }
  }

  const toolRows: UsageToolRow[] = [...tools.entries()].map(([name, tool]) => ({
    name,
    owner: resolveOwner(name),
    calls: tool.calls,
    errors: tool.errors,
    unsettled: tool.unsettled,
    codeCalls: tool.codeCalls,
    directCalls: tool.directCalls,
    totalMs: tool.totalMs,
    maxMs: tool.maxMs,
    p50: percentileFromHistogram(tool.histogram, 50, tool.maxMs),
    p95: percentileFromHistogram(tool.histogram, 95, tool.maxMs),
    firstUsed: tool.firstUsed,
    lastUsed: tool.lastUsed,
    argsBytes: tool.argsBytes,
    resultBytes: tool.resultBytes,
  }))
  const modelRows: UsageModelRow[] = [...models.values()].map(model => ({
    model: model.model,
    calls: model.calls,
    errors: model.errors,
    tools: model.tools,
    ms: model.ms,
    p50: percentileFromHistogram(model.histogram, 50, model.maxMs),
    p95: percentileFromHistogram(model.histogram, 95, model.maxMs),
  }))
  const settled = calls - unsettled
  return {
    range: window.range,
    from: window.from,
    to: window.to,
    calls,
    errors,
    unsettled,
    toolMs,
    codeCalls,
    sessions: sessionsWithCalls,
    uniqueTools: toolRows.length,
    successRate: settled <= 0 ? null : (settled - errors) / settled,
    p50: percentileFromHistogram(overallHistogram, 50, Math.max(0, ...toolRows.map(row => row.maxMs))),
    p95: percentileFromHistogram(overallHistogram, 95, Math.max(0, ...toolRows.map(row => row.maxMs))),
    tools: toolRows.sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name)),
    models: modelRows.sort((left, right) => right.calls - left.calls || left.model.localeCompare(right.model)),
    days: [...days.values()].sort((left, right) => left.day.localeCompare(right.day)),
    workspaces: [...workspaces.values()].sort((left, right) => right.calls - left.calls || left.workspace.localeCompare(right.workspace)),
    errorCodes: [...errorCodes.entries()]
      .map(([code, count]) => ({ code, calls: count }))
      .sort((left, right) => right.calls - left.calls || left.code.localeCompare(right.code)),
    recentCalls: recentCalls.sort((left, right) => left.time - right.time).slice(-recentLimit),
    histogramScope: 'retained',
  }
}

/** Project one detail recent call onto the client's flat vocabulary. */
function recentProjection(entry: RecentCall, owner: string, sessionId: string, workspace: string | null): UsageRecentCall {
  return {
    time: entry.time,
    name: entry.name,
    owner,
    model: entry.model,
    ms: entry.ms,
    ok: entry.ok,
    errorCode: entry.code,
    kind: entry.kind,
    callId: entry.callId,
    parentCallId: entry.parentCallId ?? null,
    sessionId,
    workspace,
  }
}
