/**
 * The `toolModeUsage` session projection (Tool Insights plan §3.1).
 *
 * A pure fold over DSH session events. The projection STATE is the host-only detail
 * (exact per-tool matrix, 16-bucket duration histogram, error codes); the projection
 * WIRE is the compact value that rides every `session.list` row. Splitting them this
 * way keeps the session list small while the report channel can still answer exact
 * range questions from the detail.
 *
 * Truthfulness rules the fold enforces:
 *
 * - A call is counted when it is DISPATCHED (`tool/call`, `tool/ptc-dispatch-start`),
 *   and its duration is added only when a result settles it. A call whose result never
 *   lands is `unsettled` — never a fabricated success, and never in a percentile.
 * - `callId` is provider-minted, so pairing uses `Object.hasOwn`: a result naming
 *   `constructor`/`toString` must read as unmatched, not as an inherited function.
 * - Model attribution comes from the step's assistant message, then the request-header
 *   route in force, then the explicit `unattributed` bucket. Code Mode sub-calls
 *   inherit the parent program's model.
 * - Every bound is explicit and loses information LOUDLY (`unsettled`, `toolsTruncated`
 *   / `modelsTruncated`) rather than silently.
 * - All state is plain JSON: the projection cache persists it.
 *
 * @module @try-works/dsh-tool-mode/tool-usage-projection
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { staticToolOwner } from './tool-sources.ts'

/** The projection key the client reads as `projectionValues.toolModeUsage`. */
export const TOOL_USAGE_KEY = 'toolModeUsage'

/** The persisted-state version; a stale cache row is re-folded instead of trusted. */
export const TOOL_USAGE_STATE_VERSION = 1

/** The explicit bucket for calls with no readable model. */
export const UNATTRIBUTED_MODEL = 'unattributed'

/** The explicit per-tool bucket once the distinct-tool bound is reached. */
export const TOOLS_OVERFLOW = '(overflow)'

/**
 * Duration histogram upper edges, in milliseconds (16 buckets).
 *
 * Log-scale because tool latencies span four orders of magnitude; the last bucket is
 * open-ended. Percentiles are derived from this histogram, while `maxMs` stays exact.
 */
export const DURATION_BUCKETS_MS: readonly number[] = Object.freeze([
  10, 25, 50, 100, 200, 300, 500, 750, 1_000, 2_000, 3_000, 5_000, 10_000, 30_000, 60_000, 600_000,
])

/** Hard bounds. The wire caps and the fold caps come from one table. */
export const TOOL_USAGE_CAPS = Object.freeze({
  /** In-flight (call dispatched, result not yet seen) records retained. */
  pending: 100,
  /** Recent calls retained in the detail state; the wire carries {@link TOOL_USAGE_CAPS.wireRecent}. */
  recent: 200,
  /** Recent calls the compact wire carries. */
  wireRecent: 20,
  /** Distinct tool performance rows per session. */
  tools: 100,
  /** Distinct models per session. */
  models: 20,
  /** Distinct tool names tracked per model. */
  modelTools: 100,
  /** Retained local-time days. */
  days: 60,
  /** Duration buckets per tool. */
  buckets: 16,
  /** Top tools the compact wire carries. */
  topTools: 5,
})

/** One tool/day counter. */
export interface ToolDayCount {
  calls: number
  errors: number
  /** Settled duration for this tool on this day, ms. */
  ms: number
  /** Exact maximum settled duration for this tool on this day, ms. */
  maxMs: number
  /** Calls of this tool on this day whose result never landed. */
  unsettled: number
  /** Calls of this tool on this day dispatched from a Code Mode program. */
  codeCalls: number
}

/** One tool's performance detail. */
export interface ToolUsageBucket {
  calls: number
  errors: number
  unsettled: number
  /** Calls dispatched from inside a Code Mode program. */
  codeCalls: number
  /** Calls requested directly by the model. */
  directCalls: number
  totalMs: number
  maxMs: number
  argsBytes: number
  resultBytes: number
  firstUsed: number | null
  lastUsed: number | null
  /** 16 log-scale buckets over settled durations. */
  histogram: number[]
  byDay: Record<string, ToolDayCount>
}

/** One model/day counter. */
export interface ModelDayCount {
  calls: number
  errors: number
  ms: number
  maxMs: number
}

/** One model's usage. */
export interface ModelUsage {
  calls: number
  errors: number
  ms: number
  /** Distinct tool names this model used, bounded by {@link TOOL_USAGE_CAPS.modelTools}. */
  tools: string[]
  /** 16 log-scale buckets over this model's settled durations. */
  histogram: number[]
  byDay: Record<string, ModelDayCount>
}

/** One owner/day counter. */
export interface OwnerDayCount {
  calls: number
  errors: number
  ms: number
}

/** One owner's usage. */
export interface OwnerUsage {
  calls: number
  errors: number
  ms: number
  byDay: Record<string, OwnerDayCount>
}

/** One day's usage, host-local time. */
export interface DayUsage {
  calls: number
  errors: number
  ms: number
  unsettled: number
  /** Class-level error-code counts for this day. */
  byCode: Record<string, number>
}

/** One retained recent call (detail state). */
export interface RecentCall {
  /** The call start time (ms). */
  time: number
  name: string
  model: string
  kind: 'direct' | 'code'
  /** The direct `callId` or the PTC `subCallId`. */
  callId: string
  /** PTC linkage to the `tool_mode_run` parent. */
  parentCallId?: string
  rootCallId?: string
  /** Settled duration; null while the call is in flight or after it went unsettled. */
  ms: number | null
  /** true/false when settled; null when unsettled. */
  ok: boolean | null
  /** Class-level error code when the result carried one. */
  code: string | null
}

/** One in-flight call (detail state). */
export interface PendingCall {
  name: string
  time: number
  kind: 'direct' | 'code'
  model: string
  parentCallId?: string
  rootCallId?: string
}

/** The projection state: plain JSON, persisted by the projection cache. */
export interface ToolUsageState {
  stateVersion: 1
  calls: number
  errors: number
  unsettled: number
  /** Summed settled durations, ms. */
  toolMs: number
  /** Distinct tool names actually tracked (bounded). */
  uniqueTools: number
  byTool: Record<string, ToolUsageBucket>
  byModel: Record<string, ModelUsage>
  byOwner: Record<string, OwnerUsage>
  byDay: Record<string, DayUsage>
  byErrorCode: Record<string, number>
  recent: RecentCall[]
  pending: Record<string, PendingCall>
  /** The route in force from the latest request/header. */
  route: { provider: string; model: string } | null
  /** The model of the latest assistant message, scoped to its step. */
  stepModel: { turn: number; step: number; model: string } | null
  lastTurn: number | null
  /** Distinct tools that did not fit {@link TOOL_USAGE_CAPS.tools}. */
  toolsTruncated: number
  /** Models that did not fit {@link TOOL_USAGE_CAPS.models}. */
  modelsTruncated: number
}

/** The compact value the client reads from `projectionValues`. */
export interface ToolUsageWire {
  stateVersion: 1
  calls: number
  errors: number
  unsettled: number
  toolMs: number
  uniqueTools: number
  byOwner: Record<string, { calls: number; errors: number; ms: number }>
  byModel: Record<string, { calls: number; errors: number; tools: number; ms: number }>
  byDay: Record<string, { calls: number; errors: number; ms: number; unsettled: number }>
  recent: Array<{
    time: number
    name: string
    model: string
    ms: number | null
    ok: boolean | null
    kind: 'direct' | 'code'
    code: string | null
  }>
  topTools: Array<{ name: string; calls: number; ms: number }>
}

/** The day-keyed state records (named so a return type keeps the known value type). */
type DayUsageRecord = Record<string, DayUsage>
type ModelDayUsageRecord = Record<string, ModelDayCount>
type OwnerDayUsageRecord = Record<string, OwnerDayCount>
type ToolDayUsageRecord = Record<string, ToolDayCount>

/** One resolved tool row for a dispatch or settlement. */
interface ToolBucketResolution {
  readonly key: string
  readonly bucket: ToolUsageBucket
  readonly state: ToolUsageState
}

/** One resolved model row for a dispatch or settlement. */
interface ModelBucketResolution {
  readonly bucket: ModelUsage
  readonly state: ToolUsageState
}

/** The structural event subset this fold consumes (so tests can synthesize logs). */
export type ToolUsageEvent =
  | { readonly type: 'request/header'; readonly time: number; readonly data: { readonly header: { readonly config: { readonly provider?: string; readonly model?: string } } } }
  | { readonly type: 'assistant/message'; readonly time: number; readonly data: { readonly turn: number; readonly step: number; readonly message: { readonly source: { readonly model?: string } } } }
  | { readonly type: 'tool/call'; readonly time: number; readonly data: { readonly turn: number; readonly step: number; readonly callId: string; readonly name: string; readonly arguments: string } }
  | {
    readonly type: 'tool/result'
    readonly time: number
    readonly data: {
      readonly turn: number
      readonly step: number
      readonly message: { readonly source: { readonly callId: string }; readonly isError?: boolean; readonly content?: unknown }
      readonly error?: { readonly code?: string }
    }
  }
  | {
    readonly type: 'tool/ptc-dispatch-start'
    readonly time: number
    readonly data: { readonly rootCallId: string; readonly parentCallId: string; readonly subCallId: string; readonly name: string; readonly arguments?: unknown }
  }
  | {
    readonly type: 'tool/ptc-dispatch'
    readonly time: number
    readonly data: {
      readonly rootCallId: string
      readonly parentCallId: string
      readonly subCallId: string
      readonly name: string
      readonly arguments?: unknown
      readonly isError?: boolean
      readonly content?: unknown
      readonly error?: { readonly code?: string }
    }
  }
  | { readonly type: 'turn/end'; readonly time: number; readonly data: { readonly turn: number } }

/** A fresh empty state. */
export function initToolUsageState(): ToolUsageState {
  return {
    stateVersion: TOOL_USAGE_STATE_VERSION,
    calls: 0,
    errors: 0,
    unsettled: 0,
    toolMs: 0,
    uniqueTools: 0,
    byTool: {},
    byModel: {},
    byOwner: {},
    byDay: {},
    byErrorCode: {},
    recent: [],
    pending: {},
    route: null,
    stepModel: null,
    lastTurn: null,
    toolsTruncated: 0,
    modelsTruncated: 0,
  }
}

/** The host-local `YYYY-MM-DD` day key for one timestamp (shared with the report). */
export function toolUsageDayKey(time: number): string {
  return dayKeyOf(time)
}

/** One local-time day key (`YYYY-MM-DD`). */
function dayKeyOf(time: number): string {
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The histogram bucket for one settled duration. */
function bucketOf(durationMs: number): number {
  for (let index = 0; index < DURATION_BUCKETS_MS.length - 1; index += 1) {
    const edge = DURATION_BUCKETS_MS[index]
    if (edge !== undefined && durationMs <= edge) return index
  }
  return DURATION_BUCKETS_MS.length - 1
}

/** Serialized byte length, with `-1` for an unserializable value (never `0`). */
function byteLengthOf(value: unknown): number {
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8')
  } catch {
    return -1
  }
}

/** The model that emitted a call in `turn`/`step`, never a guess. */
function modelFor(state: ToolUsageState, turn: number, step: number): string {
  if (state.stepModel !== null && state.stepModel.turn === turn && state.stepModel.step === step) {
    return state.stepModel.model
  }
  return state.route?.model ?? UNATTRIBUTED_MODEL
}

/** The model for a Code Mode sub-call: the parent program's step model, then the route. */
function codeModelFor(state: ToolUsageState): string {
  return state.stepModel?.model ?? state.route?.model ?? UNATTRIBUTED_MODEL
}

/** A copy of `state` with the oldest tool/day keys pruned past the day bound. */
function pruneDays(state: ToolUsageState): ToolUsageState {
  const days = Object.keys(state.byDay).sort()
  if (days.length <= TOOL_USAGE_CAPS.days) return state
  const keep = new Set(days.slice(days.length - TOOL_USAGE_CAPS.days))
  const byDay: Record<string, DayUsage> = {}
  for (const [day, usage] of Object.entries(state.byDay)) if (keep.has(day)) byDay[day] = usage
  const byTool: Record<string, ToolUsageBucket> = {}
  for (const [name, bucket] of Object.entries(state.byTool)) {
    const toolDays: Record<string, ToolDayCount> = {}
    for (const [day, count] of Object.entries(bucket.byDay)) if (keep.has(day)) toolDays[day] = count
    byTool[name] = { ...bucket, byDay: toolDays }
  }
  const byModel: Record<string, ModelUsage> = {}
  for (const [model, usage] of Object.entries(state.byModel)) {
    const modelDays: Record<string, ModelDayCount> = {}
    for (const [day, count] of Object.entries(usage.byDay)) if (keep.has(day)) modelDays[day] = count
    byModel[model] = { ...usage, byDay: modelDays }
  }
  const byOwner: Record<string, OwnerUsage> = {}
  for (const [owner, usage] of Object.entries(state.byOwner)) {
    const ownerDays: Record<string, OwnerDayCount> = {}
    for (const [day, count] of Object.entries(usage.byDay)) if (keep.has(day)) ownerDays[day] = count
    byOwner[owner] = { ...usage, byDay: ownerDays }
  }
  return { ...state, byDay, byTool, byModel, byOwner }
}

/** A copy of `state` with one tool/day counter incremented. */
function bumpToolDay(bucket: ToolUsageBucket, day: string, calls: number, errors: number, ms: number, unsettled: number, codeCalls: number): ToolUsageBucket {
  const current = bucket.byDay[day] ?? { calls: 0, errors: 0, ms: 0, maxMs: 0, unsettled: 0, codeCalls: 0 }
  return {
    ...bucket,
    byDay: {
      ...bucket.byDay,
      [day]: {
        calls: current.calls + calls,
        errors: current.errors + errors,
        ms: current.ms + ms,
        maxMs: Math.max(current.maxMs, ms),
        unsettled: current.unsettled + unsettled,
        codeCalls: current.codeCalls + codeCalls,
      },
    },
  }
}

/** A copy of `state` with one day counter incremented. */
function bumpDay(state: ToolUsageState, day: string, calls: number, errors: number, ms: number, unsettled: number, code: string | null): DayUsageRecord {
  const current = state.byDay[day] ?? { calls: 0, errors: 0, ms: 0, unsettled: 0, byCode: {} }
  return {
    ...state.byDay,
    [day]: {
      calls: current.calls + calls,
      errors: current.errors + errors,
      ms: current.ms + ms,
      unsettled: current.unsettled + unsettled,
      byCode: code === null ? current.byCode : { ...current.byCode, [code]: (current.byCode[code] ?? 0) + 1 },
    },
  }
}

/** A copy of one model's day counter with the given increments applied. */
function bumpModelDay(usage: ModelUsage, day: string, calls: number, errors: number, ms: number): ModelDayUsageRecord {
  const current = usage.byDay[day] ?? { calls: 0, errors: 0, ms: 0, maxMs: 0 }
  return { ...usage.byDay, [day]: { calls: current.calls + calls, errors: current.errors + errors, ms: current.ms + ms, maxMs: Math.max(current.maxMs, ms) } }
}

/** A copy of one owner's day counter with the given increments applied. */
function bumpOwnerDay(usage: OwnerUsage | undefined, day: string, calls: number, errors: number, ms: number): OwnerDayUsageRecord {
  const current = usage?.byDay[day] ?? { calls: 0, errors: 0, ms: 0 }
  return { ...usage?.byDay, [day]: { calls: current.calls + calls, errors: current.errors + errors, ms: current.ms + ms } }
}

/**
 * The tool bucket for a name, honouring the distinct-tool bound.
 *
 * Past the bound the call is still counted in the totals but no 101st performance row
 * is invented; `toolsTruncated` records how many calls lost their per-tool detail.
 * @param state - the current state.
 * @param name - the tool name.
 * @returns the effective row key (`''` when untracked), its bucket and the new state.
 */
function toolBucket(state: ToolUsageState, name: string): ToolBucketResolution {
  const existing = state.byTool[name]
  if (existing !== undefined) return { key: name, bucket: existing, state }
  if (Object.keys(state.byTool).length >= TOOL_USAGE_CAPS.tools) {
    return {
      key: '',
      bucket: emptyToolBucket(),
      state: { ...state, toolsTruncated: state.toolsTruncated + 1 },
    }
  }
  return { key: name, bucket: emptyToolBucket(), state: { ...state, uniqueTools: state.uniqueTools + 1 } }
}

/** A copy of a histogram with one settled duration added. */
function addToHistogram(histogram: readonly number[], ms: number): number[] {
  const next = [...histogram]
  const index = bucketOf(ms)
  next[index] = (next[index] ?? 0) + 1
  return next
}

/** A zeroed 16-bucket histogram. */
function emptyHistogram(): number[] {
  return Array.from({ length: TOOL_USAGE_CAPS.buckets }, () => 0)
}

/** A zeroed tool bucket. */
function emptyToolBucket(): ToolUsageBucket {
  return {
    calls: 0,
    errors: 0,
    unsettled: 0,
    codeCalls: 0,
    directCalls: 0,
    totalMs: 0,
    maxMs: 0,
    argsBytes: 0,
    resultBytes: 0,
    firstUsed: null,
    lastUsed: null,
    histogram: Array.from({ length: TOOL_USAGE_CAPS.buckets }, () => 0),
    byDay: {},
  }
}

/** The model bucket for a name, honouring the distinct-model bound. */
function modelBucket(state: ToolUsageState, model: string): ModelBucketResolution {
  const existing = state.byModel[model]
  if (existing !== undefined) return { bucket: existing, state }
  if (Object.keys(state.byModel).length >= TOOL_USAGE_CAPS.models) {
    // Past the bound, calls stay counted in the totals but attribution is explicit.
    const unattributed = state.byModel[UNATTRIBUTED_MODEL] ?? { calls: 0, errors: 0, ms: 0, tools: [], histogram: emptyHistogram(), byDay: {} }
    return {
      bucket: unattributed,
      state: {
        ...state,
        byModel: { ...state.byModel, [UNATTRIBUTED_MODEL]: unattributed },
        modelsTruncated: state.modelsTruncated + 1,
      },
    }
  }
  return { bucket: { calls: 0, errors: 0, ms: 0, tools: [], histogram: emptyHistogram(), byDay: {} }, state }
}

/** Add a tool name to a model's bounded distinct-tool list. */
function modelTools(usage: ModelUsage, name: string): string[] {
  if (usage.tools.includes(name)) return usage.tools
  if (usage.tools.length >= TOOL_USAGE_CAPS.modelTools) return usage.tools
  return [...usage.tools, name]
}

/** Append one recent entry, evicting the oldest past the bound. */
function appendRecent(state: ToolUsageState, entry: RecentCall): RecentCall[] {
  const recent = [...state.recent, entry]
  return recent.length > TOOL_USAGE_CAPS.recent ? recent.slice(recent.length - TOOL_USAGE_CAPS.recent) : recent
}

/** Patch a recent entry when its call settles or becomes unsettled. */
function patchRecent(recent: readonly RecentCall[], callId: string, kind: 'direct' | 'code', patch: Partial<RecentCall>): RecentCall[] {
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const entry = recent[index]
    if (entry === undefined || entry.callId !== callId || entry.kind !== kind) continue
    const next = [...recent]
    next[index] = { ...entry, ...patch }
    return next
  }
  return [...recent]
}

/** Drop one pending call, counting it unsettled (the result never landed). */
function dropUnsettled(state: ToolUsageState, key: string): ToolUsageState {
  const pending = state.pending[key]
  if (pending === undefined) return state
  const rest = { ...state.pending }
  delete rest[key]
  const day = dayKeyOf(pending.time)
  const bucket = state.byTool[pending.name]
  const byTool = bucket === undefined
    ? state.byTool
    : { ...state.byTool, [pending.name]: { ...bumpToolDay(bucket, day, 0, 0, 0, 1, 0), unsettled: bucket.unsettled + 1 } }
  return {
    ...state,
    pending: rest,
    byTool,
    byDay: bumpDay(state, day, 0, 0, 0, 1, null),
    unsettled: state.unsettled + 1,
  }
}

/** Evict the oldest pending call when the bound is reached. */
function evictOldestPending(state: ToolUsageState): ToolUsageState {
  let oldestKey: string | undefined
  let oldestTime = Number.POSITIVE_INFINITY
  for (const [key, pending] of Object.entries(state.pending)) {
    if (pending.time < oldestTime) {
      oldestTime = pending.time
      oldestKey = key
    }
  }
  return oldestKey === undefined ? state : dropUnsettled(state, oldestKey)
}

/** Fold one event into the state. Uninteresting events return the same reference. */
export function foldToolUsageEvent(state: ToolUsageState, event: ToolUsageEvent): ToolUsageState {
  switch (event.type) {
    case 'request/header': {
      const provider = event.data.header.config.provider
      const model = event.data.header.config.model
      if (typeof model !== 'string' || model.length === 0) return state
      return { ...state, route: { provider: typeof provider === 'string' ? provider : '', model } }
    }
    case 'assistant/message': {
      const model = event.data.message.source.model
      if (typeof model !== 'string' || model.length === 0) return state
      return { ...state, stepModel: { turn: event.data.turn, step: event.data.step, model } }
    }
    case 'tool/call': {
      const day = dayKeyOf(event.time)
      const model = modelFor(state, event.data.turn, event.data.step)
      const owner = staticToolOwner(event.data.name).owner
      const { key: toolKey, bucket, state: withBucket } = toolBucket(state, event.data.name)
      let next: ToolUsageState = {
        ...withBucket,
        calls: withBucket.calls + 1,
        byDay: bumpDay(withBucket, day, 1, 0, 0, 0, null),
        byOwner: { ...withBucket.byOwner, [owner]: bumpOwner(withBucket.byOwner[owner], day, 1, 0, 0) },
        byTool: toolKey === '' ? withBucket.byTool : {
          ...withBucket.byTool,
          [toolKey]: bumpToolDay({
            ...bucket,
            calls: bucket.calls + 1,
            directCalls: bucket.directCalls + 1,
            argsBytes: bucket.argsBytes + Buffer.byteLength(event.data.arguments, 'utf8'),
            firstUsed: bucket.firstUsed === null ? event.time : Math.min(bucket.firstUsed, event.time),
            lastUsed: bucket.lastUsed === null ? event.time : Math.max(bucket.lastUsed, event.time),
          }, day, 1, 0, 0, 0, 0),
        },
      }
      next = pruneDays(next)
      const { bucket: modelUsage, state: withModel } = modelBucket(next, model)
      next = {
        ...withModel,
        byModel: {
          ...withModel.byModel,
          [model]: {
            ...modelUsage,
            calls: modelUsage.calls + 1,
            tools: modelTools(modelUsage, event.data.name),
            byDay: bumpModelDay(modelUsage, day, 1, 0, 0),
          },
        },
      }
      if (Object.keys(next.pending).length >= TOOL_USAGE_CAPS.pending) next = evictOldestPending(next)
      next = {
        ...next,
        pending: {
          ...next.pending,
          [event.data.callId]: { name: event.data.name, time: event.time, kind: 'direct', model },
        },
      }
      return { ...next, recent: appendRecent(next, {
        time: event.time,
        name: event.data.name,
        model,
        kind: 'direct',
        callId: event.data.callId,
        ms: null,
        ok: null,
        code: null,
      }) }
    }
    case 'tool/result': {
      const callId = event.data.message.source.callId
      if (!Object.hasOwn(state.pending, callId)) return state
      const pending = state.pending[callId]
      if (pending === undefined) return state
      const ms = Math.max(0, event.time - pending.time)
      const isError = event.data.message.isError === true || event.data.error !== undefined
      const code = typeof event.data.error?.code === 'string' ? event.data.error.code : null
      const day = dayKeyOf(pending.time)
      const owner = staticToolOwner(pending.name).owner
      // A call past the distinct-tool bound has no per-tool row; its totals below are
      // still updated, but no 101st row is invented.
      const bucket = state.byTool[pending.name]
      const errors = isError ? 1 : 0
      const histogram = bucket === undefined ? undefined : [...bucket.histogram]
      if (histogram !== undefined) histogram[bucketOf(ms)] = (histogram[bucketOf(ms)] ?? 0) + 1
      const pendingRest = { ...state.pending }
      delete pendingRest[callId]
      const modelUsage = state.byModel[pending.model]
      return {
        ...state,
        errors: state.errors + errors,
        toolMs: state.toolMs + ms,
        byErrorCode: code === null ? state.byErrorCode : { ...state.byErrorCode, [code]: (state.byErrorCode[code] ?? 0) + 1 },
        byDay: bumpDay(state, day, 0, errors, ms, 0, code),
        byOwner: { ...state.byOwner, [owner]: bumpOwner(state.byOwner[owner], day, 0, errors, ms) },
        byModel: modelUsage === undefined
          ? state.byModel
          : {
            ...state.byModel,
            [pending.model]: {
              ...modelUsage,
              errors: modelUsage.errors + errors,
              ms: modelUsage.ms + ms,
              histogram: addToHistogram(modelUsage.histogram, ms),
              byDay: bumpModelDay(modelUsage, day, 0, errors, ms),
            },
          },
        byTool: bucket === undefined ? state.byTool : {
          ...state.byTool,
          [pending.name]: bumpToolDay({
            ...bucket,
            errors: bucket.errors + errors,
            totalMs: bucket.totalMs + ms,
            maxMs: Math.max(bucket.maxMs, ms),
            resultBytes: bucket.resultBytes + (event.data.message.content === undefined ? 0 : byteLengthOf(event.data.message.content)),
            histogram: histogram ?? bucket.histogram,
          }, day, 0, errors, ms, 0, 0),
        },
        pending: pendingRest,
        recent: patchRecent(state.recent, callId, 'direct', { ms, ok: !isError, code }),
      }
    }
    case 'tool/ptc-dispatch-start': {
      const day = dayKeyOf(event.time)
      const model = codeModelFor(state)
      const owner = staticToolOwner(event.data.name).owner
      const { key: toolKey, bucket, state: withBucket } = toolBucket(state, event.data.name)
      let next: ToolUsageState = {
        ...withBucket,
        calls: withBucket.calls + 1,
        byDay: bumpDay(withBucket, day, 1, 0, 0, 0, null),
        byOwner: { ...withBucket.byOwner, [owner]: bumpOwner(withBucket.byOwner[owner], day, 1, 0, 0) },
        byTool: toolKey === '' ? withBucket.byTool : {
          ...withBucket.byTool,
          [toolKey]: bumpToolDay({
            ...bucket,
            calls: bucket.calls + 1,
            codeCalls: bucket.codeCalls + 1,
            argsBytes: bucket.argsBytes + byteLengthOf(event.data.arguments),
            firstUsed: bucket.firstUsed === null ? event.time : Math.min(bucket.firstUsed, event.time),
            lastUsed: bucket.lastUsed === null ? event.time : Math.max(bucket.lastUsed, event.time),
          }, day, 1, 0, 0, 0, 1),
        },
      }
      next = pruneDays(next)
      const { bucket: modelUsage, state: withModel } = modelBucket(next, model)
      next = {
        ...withModel,
        byModel: {
          ...withModel.byModel,
          [model]: {
            ...modelUsage,
            calls: modelUsage.calls + 1,
            tools: modelTools(modelUsage, event.data.name),
            byDay: bumpModelDay(modelUsage, day, 1, 0, 0),
          },
        },
      }
      const key = `code:${event.data.subCallId}`
      if (Object.keys(next.pending).length >= TOOL_USAGE_CAPS.pending) next = evictOldestPending(next)
      next = {
        ...next,
        pending: {
          ...next.pending,
          [key]: {
            name: event.data.name,
            time: event.time,
            kind: 'code',
            model,
            parentCallId: event.data.parentCallId,
            rootCallId: event.data.rootCallId,
          },
        },
      }
      return {
        ...next,
        recent: appendRecent(next, {
          time: event.time,
          name: event.data.name,
          model,
          kind: 'code',
          callId: event.data.subCallId,
          parentCallId: event.data.parentCallId,
          rootCallId: event.data.rootCallId,
          ms: null,
          ok: null,
          code: null,
        }),
      }
    }
    case 'tool/ptc-dispatch': {
      const key = `code:${event.data.subCallId}`
      if (!Object.hasOwn(state.pending, key)) return state
      const pending = state.pending[key]
      if (pending === undefined) return state
      const ms = Math.max(0, event.time - pending.time)
      const isError = event.data.isError === true
      const code = typeof event.data.error?.code === 'string' ? event.data.error.code : null
      const day = dayKeyOf(pending.time)
      const owner = staticToolOwner(pending.name).owner
      // Untracked past the tool bound: totals still settle, no 101st row is invented.
      const bucket = state.byTool[pending.name]
      const errors = isError ? 1 : 0
      const histogram = bucket === undefined ? undefined : [...bucket.histogram]
      if (histogram !== undefined) histogram[bucketOf(ms)] = (histogram[bucketOf(ms)] ?? 0) + 1
      const pendingRest = { ...state.pending }
      delete pendingRest[key]
      const modelUsage = state.byModel[pending.model]
      return {
        ...state,
        errors: state.errors + errors,
        toolMs: state.toolMs + ms,
        byErrorCode: code === null ? state.byErrorCode : { ...state.byErrorCode, [code]: (state.byErrorCode[code] ?? 0) + 1 },
        byDay: bumpDay(state, day, 0, errors, ms, 0, code),
        byOwner: { ...state.byOwner, [owner]: bumpOwner(state.byOwner[owner], day, 0, errors, ms) },
        byModel: modelUsage === undefined
          ? state.byModel
          : {
            ...state.byModel,
            [pending.model]: {
              ...modelUsage,
              errors: modelUsage.errors + errors,
              ms: modelUsage.ms + ms,
              histogram: addToHistogram(modelUsage.histogram, ms),
              byDay: bumpModelDay(modelUsage, day, 0, errors, ms),
            },
          },
        byTool: bucket === undefined ? state.byTool : {
          ...state.byTool,
          [pending.name]: bumpToolDay({
            ...bucket,
            errors: bucket.errors + errors,
            totalMs: bucket.totalMs + ms,
            maxMs: Math.max(bucket.maxMs, ms),
            resultBytes: bucket.resultBytes + byteLengthOf(event.data.content),
            histogram: histogram ?? bucket.histogram,
          }, day, 0, errors, ms, 0, 0),
        },
        pending: pendingRest,
        recent: patchRecent(state.recent, event.data.subCallId, 'code', { ms, ok: !isError, code }),
      }
    }
    case 'turn/end': {
      let next = state
      for (const key of Object.keys(next.pending)) next = dropUnsettled(next, key)
      if (next.lastTurn === event.data.turn) return next === state ? state : next
      return { ...next, lastTurn: event.data.turn }
    }
    default:
      return state
  }
}

/** A copy of one owner counter with the given increments applied. */
function bumpOwner(current: OwnerUsage | undefined, day: string, calls: number, errors: number, ms: number): OwnerUsage {
  return {
    calls: (current?.calls ?? 0) + calls,
    errors: (current?.errors ?? 0) + errors,
    ms: (current?.ms ?? 0) + ms,
    byDay: bumpOwnerDay(current, day, calls, errors, ms),
  }
}

/** The compact wire value, derived only from the detail state. */
export function toolUsageWire(state: ToolUsageState): ToolUsageWire {
  const byModel: ToolUsageWire['byModel'] = {}
  for (const [model, usage] of Object.entries(state.byModel)) {
    byModel[model] = { calls: usage.calls, errors: usage.errors, tools: usage.tools.length, ms: usage.ms }
  }
  const byOwner: ToolUsageWire['byOwner'] = {}
  for (const [owner, usage] of Object.entries(state.byOwner)) {
    byOwner[owner] = { calls: usage.calls, errors: usage.errors, ms: usage.ms }
  }
  const byDay: ToolUsageWire['byDay'] = {}
  for (const [day, usage] of Object.entries(state.byDay)) {
    byDay[day] = { calls: usage.calls, errors: usage.errors, ms: usage.ms, unsettled: usage.unsettled }
  }
  const topTools = Object.entries(state.byTool)
    .map(([name, bucket]) => ({ name, calls: bucket.calls, ms: bucket.totalMs }))
    .sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name))
    .slice(0, TOOL_USAGE_CAPS.topTools)
  return {
    stateVersion: TOOL_USAGE_STATE_VERSION,
    calls: state.calls,
    errors: state.errors,
    unsettled: state.unsettled,
    toolMs: state.toolMs,
    uniqueTools: state.uniqueTools,
    byOwner,
    byModel,
    byDay,
    recent: state.recent.slice(-TOOL_USAGE_CAPS.wireRecent).map(entry => ({
      time: entry.time,
      name: entry.name,
      model: entry.model,
      ms: entry.ms,
      ok: entry.ok,
      kind: entry.kind,
      code: entry.code,
    })),
    topTools,
  }
}

/**
 * A strict schema boundary.
 *
 * The projection contract types its schemas as `ZodType`, but the registry's only
 * runtime use is `parse(value)`. Hand-written validators implement exactly that and
 * keep this plugin from depending on a SECOND zod installation: the harness checkout
 * and this workspace resolve different zod copies, and a structural same-shape object
 * is not assignable between them. The validators are strict — an unknown field is a
 * parse failure — so a stale cache row or a corrupt wire value is rejected, never
 * rendered as zeros.
 */
export interface ProjectionSchema<T> {
  parse(value: unknown): T
  safeParse(value: unknown): { readonly success: true; readonly data: T } | { readonly success: false; readonly error: Error }
}

/** One validation failure, named with the path that failed. */
export class ToolUsageSchemaError extends Error {
  override readonly name = 'ToolUsageSchemaError'
}

/** Describe a rejected value without echoing its content. */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Refuse one value at a path. */
function fail(path: string, expected: string, value: unknown): never {
  throw new ToolUsageSchemaError(`${path}: expected ${expected}, received ${describeValue(value)}`)
}

/** Validate an object with NO undeclared fields. */
function objectAt(value: unknown, path: string, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'an object', value)
  // SAFETY: the guard above proved a non-null, non-array object; the cast only restores
  // the keyed view `Object.keys`/field reads require, and every field is validated below.
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!fields.includes(key)) fail(`${path}.${key}`, 'no such field', record[key])
  }
  return record
}

/** Validate a finite number (optionally an integer and/or non-negative). */
function numberAt(value: unknown, path: string, options: { int?: boolean; min?: number } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'a finite number', value)
  if (options.int === true && !Number.isInteger(value)) fail(path, 'an integer', value)
  if (options.min !== undefined && value < options.min) fail(path, `a number >= ${options.min}`, value)
  return value
}

/** A non-negative integer counter. */
function countAt(value: unknown, path: string): number {
  return numberAt(value, path, { int: true, min: 0 })
}

/** A number or null. */
function nullableNumberAt(value: unknown, path: string): number | null {
  return value === null ? null : numberAt(value, path)
}

/** A string. */
function stringAt(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'a string', value)
  return value
}

/** A string or null. */
function nullableStringAt(value: unknown, path: string): string | null {
  return value === null ? null : stringAt(value, path)
}

/** A boolean. */
function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'a boolean', value)
  return value
}

/** A boolean or null. */
function nullableBooleanAt(value: unknown, path: string): boolean | null {
  return value === null ? null : booleanAt(value, path)
}

/** An array. */
function arrayAt(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, 'an array', value)
  return value
}

/** The entries of a string-keyed record. */
function recordAt(value: unknown, path: string): ReadonlyArray<readonly [string, unknown]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'a string-keyed record', value)
  // SAFETY: the guard above proved a non-null, non-array object; `Object.entries` is the
  // only operation, and every entry value is validated by the caller's value parser.
  return Object.entries(value as Record<string, unknown>)
}

/** One call kind. */
function kindAt(value: unknown, path: string): 'direct' | 'code' {
  if (value !== 'direct' && value !== 'code') fail(path, '"direct" or "code"', value)
  return value
}

const TOOL_DAY_FIELDS = ['calls', 'errors', 'ms', 'maxMs', 'unsettled', 'codeCalls'] as const
const BUCKET_FIELDS = ['calls', 'errors', 'unsettled', 'codeCalls', 'directCalls', 'totalMs', 'maxMs', 'argsBytes', 'resultBytes', 'firstUsed', 'lastUsed', 'histogram', 'byDay'] as const
const MODEL_FIELDS = ['calls', 'errors', 'ms', 'tools', 'histogram', 'byDay'] as const
const OWNER_FIELDS = ['calls', 'errors', 'ms', 'byDay'] as const
const DAY_FIELDS = ['calls', 'errors', 'ms', 'unsettled', 'byCode'] as const
const RECENT_FIELDS = ['time', 'name', 'model', 'kind', 'callId', 'parentCallId', 'rootCallId', 'ms', 'ok', 'code'] as const
const PENDING_FIELDS = ['name', 'time', 'kind', 'model', 'parentCallId', 'rootCallId'] as const

/** Parse one tool/day counter. */
function parseToolDay(value: unknown, path: string): ToolDayCount {
  const record = objectAt(value, path, TOOL_DAY_FIELDS)
  return {
    calls: countAt(record['calls'], `${path}.calls`),
    errors: countAt(record['errors'], `${path}.errors`),
    ms: numberAt(record['ms'], `${path}.ms`, { min: 0 }),
    maxMs: numberAt(record['maxMs'], `${path}.maxMs`, { min: 0 }),
    unsettled: countAt(record['unsettled'], `${path}.unsettled`),
    codeCalls: countAt(record['codeCalls'], `${path}.codeCalls`),
  }
}

/** Parse a record of tool/day counters. */
function parseToolDayRecord(value: unknown, path: string): ToolDayUsageRecord {
  const out: Record<string, ToolDayCount> = {}
  for (const [day, entry] of recordAt(value, path)) out[day] = parseToolDay(entry, `${path}.${day}`)
  return out
}

/** Parse one tool performance row. */
function parseToolBucket(value: unknown, path: string): ToolUsageBucket {
  const record = objectAt(value, path, BUCKET_FIELDS)
  const histogram = arrayAt(record['histogram'], `${path}.histogram`)
  if (histogram.length !== TOOL_USAGE_CAPS.buckets) fail(`${path}.histogram`, `${TOOL_USAGE_CAPS.buckets} entries`, histogram.length)
  return {
    calls: countAt(record['calls'], `${path}.calls`),
    errors: countAt(record['errors'], `${path}.errors`),
    unsettled: countAt(record['unsettled'], `${path}.unsettled`),
    codeCalls: countAt(record['codeCalls'], `${path}.codeCalls`),
    directCalls: countAt(record['directCalls'], `${path}.directCalls`),
    totalMs: numberAt(record['totalMs'], `${path}.totalMs`, { min: 0 }),
    maxMs: numberAt(record['maxMs'], `${path}.maxMs`, { min: 0 }),
    argsBytes: numberAt(record['argsBytes'], `${path}.argsBytes`),
    resultBytes: numberAt(record['resultBytes'], `${path}.resultBytes`),
    firstUsed: nullableNumberAt(record['firstUsed'], `${path}.firstUsed`),
    lastUsed: nullableNumberAt(record['lastUsed'], `${path}.lastUsed`),
    histogram: histogram.map((entry, index) => countAt(entry, `${path}.histogram[${index}]`)),
    byDay: parseToolDayRecord(record['byDay'], `${path}.byDay`),
  }
}

/** Parse a model/day record. */
function parseModelDayRecord(value: unknown, path: string): ModelDayUsageRecord {
  const out: Record<string, ModelDayCount> = {}
  for (const [day, entry] of recordAt(value, path)) {
    const record = objectAt(entry, `${path}.${day}`, ['calls', 'errors', 'ms', 'maxMs'])
    out[day] = {
      calls: countAt(record['calls'], `${path}.${day}.calls`),
      errors: countAt(record['errors'], `${path}.${day}.errors`),
      ms: numberAt(record['ms'], `${path}.${day}.ms`, { min: 0 }),
      maxMs: numberAt(record['maxMs'], `${path}.${day}.maxMs`, { min: 0 }),
    }
  }
  return out
}

/** Parse an owner/day record (owners carry no durations-per-call bound). */
function parseOwnerDayRecord(value: unknown, path: string): OwnerDayUsageRecord {
  const out: Record<string, OwnerDayCount> = {}
  for (const [day, entry] of recordAt(value, path)) {
    const record = objectAt(entry, `${path}.${day}`, ['calls', 'errors', 'ms'])
    out[day] = {
      calls: countAt(record['calls'], `${path}.${day}.calls`),
      errors: countAt(record['errors'], `${path}.${day}.errors`),
      ms: numberAt(record['ms'], `${path}.${day}.ms`, { min: 0 }),
    }
  }
  return out
}

/** Parse one model usage row. */
function parseModelUsage(value: unknown, path: string): ModelUsage {
  const record = objectAt(value, path, MODEL_FIELDS)
  const histogram = arrayAt(record['histogram'], `${path}.histogram`)
  if (histogram.length !== TOOL_USAGE_CAPS.buckets) fail(`${path}.histogram`, `${TOOL_USAGE_CAPS.buckets} entries`, histogram.length)
  return {
    calls: countAt(record['calls'], `${path}.calls`),
    errors: countAt(record['errors'], `${path}.errors`),
    ms: numberAt(record['ms'], `${path}.ms`, { min: 0 }),
    tools: arrayAt(record['tools'], `${path}.tools`).map((entry, index) => stringAt(entry, `${path}.tools[${index}]`)),
    histogram: histogram.map((entry, index) => countAt(entry, `${path}.histogram[${index}]`)),
    byDay: parseModelDayRecord(record['byDay'], `${path}.byDay`),
  }
}

/** Parse one owner usage row. */
function parseOwnerUsage(value: unknown, path: string): OwnerUsage {
  const record = objectAt(value, path, OWNER_FIELDS)
  return {
    calls: countAt(record['calls'], `${path}.calls`),
    errors: countAt(record['errors'], `${path}.errors`),
    ms: numberAt(record['ms'], `${path}.ms`, { min: 0 }),
    byDay: parseOwnerDayRecord(record['byDay'], `${path}.byDay`),
  }
}

/** Parse one day usage row. */
function parseDayUsage(value: unknown, path: string): DayUsage {
  const record = objectAt(value, path, DAY_FIELDS)
  const byCode: Record<string, number> = {}
  for (const [code, entry] of recordAt(record['byCode'], `${path}.byCode`)) byCode[code] = countAt(entry, `${path}.byCode.${code}`)
  return {
    calls: countAt(record['calls'], `${path}.calls`),
    errors: countAt(record['errors'], `${path}.errors`),
    ms: numberAt(record['ms'], `${path}.ms`, { min: 0 }),
    unsettled: countAt(record['unsettled'], `${path}.unsettled`),
    byCode,
  }
}

/** Parse one retained recent call. */
function parseRecentCall(value: unknown, path: string): RecentCall {
  const record = objectAt(value, path, RECENT_FIELDS)
  return {
    time: numberAt(record['time'], `${path}.time`),
    name: stringAt(record['name'], `${path}.name`),
    model: stringAt(record['model'], `${path}.model`),
    kind: kindAt(record['kind'], `${path}.kind`),
    callId: stringAt(record['callId'], `${path}.callId`),
    ...record['parentCallId'] === undefined ? {} : { parentCallId: stringAt(record['parentCallId'], `${path}.parentCallId`) },
    ...record['rootCallId'] === undefined ? {} : { rootCallId: stringAt(record['rootCallId'], `${path}.rootCallId`) },
    ms: nullableNumberAt(record['ms'], `${path}.ms`),
    ok: nullableBooleanAt(record['ok'], `${path}.ok`),
    code: nullableStringAt(record['code'], `${path}.code`),
  }
}

/** Parse one in-flight call. */
function parsePendingCall(value: unknown, path: string): PendingCall {
  const record = objectAt(value, path, PENDING_FIELDS)
  return {
    name: stringAt(record['name'], `${path}.name`),
    time: numberAt(record['time'], `${path}.time`),
    kind: kindAt(record['kind'], `${path}.kind`),
    model: stringAt(record['model'], `${path}.model`),
    ...record['parentCallId'] === undefined ? {} : { parentCallId: stringAt(record['parentCallId'], `${path}.parentCallId`) },
    ...record['rootCallId'] === undefined ? {} : { rootCallId: stringAt(record['rootCallId'], `${path}.rootCallId`) },
  }
}

const STATE_FIELDS = [
  'stateVersion', 'calls', 'errors', 'unsettled', 'toolMs', 'uniqueTools', 'byTool', 'byModel',
  'byOwner', 'byDay', 'byErrorCode', 'recent', 'pending', 'route', 'stepModel', 'lastTurn',
  'toolsTruncated', 'modelsTruncated',
] as const

/** Parse the persisted fold state (the projection cache's input boundary). */
function parseToolUsageState(value: unknown): ToolUsageState {
  const record = objectAt(value, 'state', STATE_FIELDS)
  if (record['stateVersion'] !== TOOL_USAGE_STATE_VERSION) fail('state.stateVersion', String(TOOL_USAGE_STATE_VERSION), record['stateVersion'])
  const byTool: Record<string, ToolUsageBucket> = {}
  for (const [name, entry] of recordAt(record['byTool'], 'state.byTool')) byTool[name] = parseToolBucket(entry, `state.byTool.${name}`)
  const byModel: Record<string, ModelUsage> = {}
  for (const [model, entry] of recordAt(record['byModel'], 'state.byModel')) byModel[model] = parseModelUsage(entry, `state.byModel.${model}`)
  const byOwner: Record<string, OwnerUsage> = {}
  for (const [owner, entry] of recordAt(record['byOwner'], 'state.byOwner')) byOwner[owner] = parseOwnerUsage(entry, `state.byOwner.${owner}`)
  const byDay: Record<string, DayUsage> = {}
  for (const [day, entry] of recordAt(record['byDay'], 'state.byDay')) byDay[day] = parseDayUsage(entry, `state.byDay.${day}`)
  const byErrorCode: Record<string, number> = {}
  for (const [code, entry] of recordAt(record['byErrorCode'], 'state.byErrorCode')) byErrorCode[code] = countAt(entry, `state.byErrorCode.${code}`)
  const pending: Record<string, PendingCall> = {}
  for (const [key, entry] of recordAt(record['pending'], 'state.pending')) pending[key] = parsePendingCall(entry, `state.pending.${key}`)
  const route = record['route'] === null ? null : (() => {
    const parsed = objectAt(record['route'], 'state.route', ['provider', 'model'])
    return { provider: stringAt(parsed['provider'], 'state.route.provider'), model: stringAt(parsed['model'], 'state.route.model') }
  })()
  const stepModel = record['stepModel'] === null ? null : (() => {
    const parsed = objectAt(record['stepModel'], 'state.stepModel', ['turn', 'step', 'model'])
    return {
      turn: numberAt(parsed['turn'], 'state.stepModel.turn', { int: true }),
      step: numberAt(parsed['step'], 'state.stepModel.step', { int: true }),
      model: stringAt(parsed['model'], 'state.stepModel.model'),
    }
  })()
  return {
    stateVersion: TOOL_USAGE_STATE_VERSION,
    calls: countAt(record['calls'], 'state.calls'),
    errors: countAt(record['errors'], 'state.errors'),
    unsettled: countAt(record['unsettled'], 'state.unsettled'),
    toolMs: numberAt(record['toolMs'], 'state.toolMs', { min: 0 }),
    uniqueTools: countAt(record['uniqueTools'], 'state.uniqueTools'),
    byTool,
    byModel,
    byOwner,
    byDay,
    byErrorCode,
    recent: arrayAt(record['recent'], 'state.recent').map((entry, index) => parseRecentCall(entry, `state.recent[${index}]`)),
    pending,
    route,
    stepModel,
    lastTurn: record['lastTurn'] === null ? null : numberAt(record['lastTurn'], 'state.lastTurn', { int: true }),
    toolsTruncated: countAt(record['toolsTruncated'], 'state.toolsTruncated'),
    modelsTruncated: countAt(record['modelsTruncated'], 'state.modelsTruncated'),
  }
}

const WIRE_RECENT_FIELDS = ['time', 'name', 'model', 'ms', 'ok', 'kind', 'code'] as const
const WIRE_FIELDS = ['stateVersion', 'calls', 'errors', 'unsettled', 'toolMs', 'uniqueTools', 'byOwner', 'byModel', 'byDay', 'recent', 'topTools'] as const

/** Parse the compact wire value (the host's outbound boundary). */
function parseToolUsageWire(value: unknown): ToolUsageWire {
  const record = objectAt(value, 'wire', WIRE_FIELDS)
  if (record['stateVersion'] !== TOOL_USAGE_STATE_VERSION) fail('wire.stateVersion', String(TOOL_USAGE_STATE_VERSION), record['stateVersion'])
  const byOwner: ToolUsageWire['byOwner'] = {}
  for (const [owner, entry] of recordAt(record['byOwner'], 'wire.byOwner')) {
    const parsed = objectAt(entry, `wire.byOwner.${owner}`, ['calls', 'errors', 'ms'])
    byOwner[owner] = {
      calls: countAt(parsed['calls'], `wire.byOwner.${owner}.calls`),
      errors: countAt(parsed['errors'], `wire.byOwner.${owner}.errors`),
      ms: numberAt(parsed['ms'], `wire.byOwner.${owner}.ms`, { min: 0 }),
    }
  }
  const byModel: ToolUsageWire['byModel'] = {}
  for (const [model, entry] of recordAt(record['byModel'], 'wire.byModel')) {
    const parsed = objectAt(entry, `wire.byModel.${model}`, ['calls', 'errors', 'tools', 'ms'])
    byModel[model] = {
      calls: countAt(parsed['calls'], `wire.byModel.${model}.calls`),
      errors: countAt(parsed['errors'], `wire.byModel.${model}.errors`),
      tools: countAt(parsed['tools'], `wire.byModel.${model}.tools`),
      ms: numberAt(parsed['ms'], `wire.byModel.${model}.ms`, { min: 0 }),
    }
  }
  const byDay: ToolUsageWire['byDay'] = {}
  for (const [day, entry] of recordAt(record['byDay'], 'wire.byDay')) {
    const parsed = objectAt(entry, `wire.byDay.${day}`, ['calls', 'errors', 'ms', 'unsettled'])
    byDay[day] = {
      calls: countAt(parsed['calls'], `wire.byDay.${day}.calls`),
      errors: countAt(parsed['errors'], `wire.byDay.${day}.errors`),
      ms: numberAt(parsed['ms'], `wire.byDay.${day}.ms`, { min: 0 }),
      unsettled: countAt(parsed['unsettled'], `wire.byDay.${day}.unsettled`),
    }
  }
  return {
    stateVersion: TOOL_USAGE_STATE_VERSION,
    calls: countAt(record['calls'], 'wire.calls'),
    errors: countAt(record['errors'], 'wire.errors'),
    unsettled: countAt(record['unsettled'], 'wire.unsettled'),
    toolMs: numberAt(record['toolMs'], 'wire.toolMs', { min: 0 }),
    uniqueTools: countAt(record['uniqueTools'], 'wire.uniqueTools'),
    byOwner,
    byModel,
    byDay,
    recent: arrayAt(record['recent'], 'wire.recent').map((entry, index) => {
      const parsed = objectAt(entry, `wire.recent[${index}]`, WIRE_RECENT_FIELDS)
      return {
        time: numberAt(parsed['time'], `wire.recent[${index}].time`),
        name: stringAt(parsed['name'], `wire.recent[${index}].name`),
        model: stringAt(parsed['model'], `wire.recent[${index}].model`),
        ms: nullableNumberAt(parsed['ms'], `wire.recent[${index}].ms`),
        ok: nullableBooleanAt(parsed['ok'], `wire.recent[${index}].ok`),
        kind: kindAt(parsed['kind'], `wire.recent[${index}].kind`),
        code: nullableStringAt(parsed['code'], `wire.recent[${index}].code`),
      }
    }),
    topTools: arrayAt(record['topTools'], 'wire.topTools').map((entry, index) => {
      const parsed = objectAt(entry, `wire.topTools[${index}]`, ['name', 'calls', 'ms'])
      return {
        name: stringAt(parsed['name'], `wire.topTools[${index}].name`),
        calls: countAt(parsed['calls'], `wire.topTools[${index}].calls`),
        ms: numberAt(parsed['ms'], `wire.topTools[${index}].ms`, { min: 0 }),
      }
    }),
  }
}

/** Wrap one parser in the schema contract. */
function schemaOf<T>(parse: (value: unknown) => T): ProjectionSchema<T> {
  return {
    parse,
    safeParse: (value) => {
      try {
        return { success: true, data: parse(value) }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error : new Error(String(error)) }
      }
    },
  }
}

/** The strict persisted-state schema (the projection cache's input boundary). */
export const toolUsageStateSchema: ProjectionSchema<ToolUsageState> = schemaOf(parseToolUsageState)

/** The compact wire's strict shape (the host's outbound boundary). */
export const toolUsageWireSchema: ProjectionSchema<ToolUsageWire> = schemaOf(parseToolUsageWire)

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    toolModeUsage: ToolUsageState
  }
  interface SessionProjectionMap {
    toolModeUsage: ToolUsageWire
  }
}

/**
 * The projection unit this module registers, typed locally.
 *
 * The harness contract types the schemas as `ZodType`; this plugin deliberately keeps
 * its own zod-free schema surface (see {@link ProjectionSchema}) and the host casts
 * once at registration, where the projection contract is the authority.
 */
export interface ToolUsageProjectionDefinition {
  readonly key: typeof TOOL_USAGE_KEY
  readonly stateVersion: number
  readonly stateSchema: ProjectionSchema<ToolUsageState>
  init(): ToolUsageState
  apply(state: ToolUsageState, event: SessionEvent): ToolUsageState
  readonly wire: {
    readonly viewSchema: ProjectionSchema<ToolUsageWire>
    view(state: ToolUsageState): ToolUsageWire
  }
}

/**
 * The registered unit. Its STATE is the detail; its WIRE is the compact value.
 *
 * `apply` receives a full `SessionEvent`; the fold reads only the seven event types
 * declared by {@link ToolUsageEvent} and returns the state unchanged otherwise.
 */
export const toolUsageProjectionDefinition: ToolUsageProjectionDefinition = {
  key: TOOL_USAGE_KEY,
  stateVersion: TOOL_USAGE_STATE_VERSION,
  stateSchema: toolUsageStateSchema,
  init: () => initToolUsageState(),
  // SAFETY: the projection registry passes the session's own `SessionEvent`; the fold
  // reads only the seven event types declared by `ToolUsageEvent` and ignores the rest.
  apply: (state: ToolUsageState, event: SessionEvent) => foldToolUsageEvent(state, event as ToolUsageEvent),
  wire: { viewSchema: toolUsageWireSchema, view: toolUsageWire },
}
