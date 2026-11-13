/**
 * S2 — the exact-range usage report (plan §3.1/§3.2, table S2).
 *
 * The report reads the projection's host-only detail state, filters it to a window and
 * produces the flat client contract: totals, per-tool rows (with owner), per-model,
 * per-day, per-workspace and per-error-code rollups plus recent calls. Timezone day
 * keys are host-local, matching dsh-context; the day bucket is the unit of range
 * filtering.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { foldToolUsageEvent, initToolUsageState, type ToolUsageEvent, type ToolUsageState } from '../src/tool-usage-projection.ts'
import { buildUsageReport, percentileFromHistogram, rangeWindow, type SessionUsageInput } from '../src/tool-usage-report.ts'

const DAY = 24 * 60 * 60 * 1000

/** Local-time `YYYY-MM-DD`, the same key the projection writes. */
function dayKey(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Fold synthetic events into a projection state. */
function fold(events: readonly ToolUsageEvent[]): ToolUsageState {
  let state = initToolUsageState()
  for (const event of events) state = foldToolUsageEvent(state, event)
  return state
}

/** One direct call + result pair at `time`. */
function settled(time: number, callId: string, name: string, ms: number, options: { model?: string; isError?: boolean; code?: string } = {}): ToolUsageEvent[] {
  const events: ToolUsageEvent[] = [
    ...options.model === undefined ? [] : [{ type: 'request/header', time: time - 1, data: { header: { config: { provider: 'test', model: options.model } } } } satisfies ToolUsageEvent],
    { type: 'tool/call', time, data: { turn: 1, step: 1, callId, name, arguments: '{}' } },
    {
      type: 'tool/result',
      time: time + ms,
      data: {
        turn: 1,
        step: 1,
        message: { role: 'tool', source: { kind: 'tool', callId }, content: [], ...options.isError === true ? { isError: true } : {} },
        ...options.code === undefined ? {} : { error: { name: 'ToolError', code: options.code } },
      },
    },
  ]
  return events
}

function session(id: string, workspace: string | null, events: readonly ToolUsageEvent[]): SessionUsageInput {
  return { sessionId: id, workspace, state: fold(events) }
}

describe('S2 window and percentiles', () => {
  it('computes fixed range windows with an inclusive from and exclusive to', () => {
    const now = new Date(2026, 5, 15, 12, 0, 0).getTime()
    assert.deepEqual(rangeWindow('24h', now), { range: '24h', from: now - DAY, to: now, fromDay: dayKey(now - DAY), toDay: dayKey(now) })
    assert.equal(rangeWindow('7d', now).from, now - 7 * DAY)
    assert.equal(rangeWindow('30d', now).from, now - 30 * DAY)
    const all = rangeWindow('all', now)
    assert.equal(all.from, 0)
    assert.equal(all.to, now)
  })

  it('derives percentiles from the histogram and keeps max exact', () => {
    const histogram = Array.from({ length: 16 }, () => 0)
    histogram[3] = 9
    histogram[10] = 1
    assert.equal(percentileFromHistogram(histogram, 50, 1_234), 100, 'the median is the 100ms bucket upper edge')
    assert.equal(percentileFromHistogram(histogram, 95, 1_234), 3_000)
    assert.equal(percentileFromHistogram(histogram, 100, 1_234), 1_234, 'the maximum is the exact value')
    assert.equal(percentileFromHistogram(Array.from({ length: 16 }, () => 0), 50, 0), null, 'an empty histogram has no percentile')
  })
})

describe('S2 rollups', () => {
  const now = new Date(2026, 5, 15, 12, 0, 0).getTime()
  const window = rangeWindow('7d', now)
  const sessions: SessionUsageInput[] = [
    session('s1', 'D:/work/a', [
      ...settled(now - 2 * DAY, 'c3', 'grep', 50, { model: 'model-b', isError: true, code: 'FS_DENIED' }),
      ...settled(now - DAY - 60_000, 'c2', 'read', 200, { model: 'model-a' }),
      ...settled(now - 2 * 60 * 60 * 1000, 'c1', 'read', 100, { model: 'model-a' }),
      { type: 'tool/call', time: now - 60_000, data: { turn: 1, step: 1, callId: 'pending', name: 'read', arguments: '{}' } },
      { type: 'turn/end', time: now - 30_000, data: { turn: 1 } },
    ]),
    session('s2', 'D:/work/b', settled(now - 60 * 60 * 1000, 'c4', 'lang_detect', 150, { model: 'model-b' })),
  ]

  it('aggregates calls, errors, unsettled calls and success over the window', () => {
    const report = buildUsageReport(sessions, window)
    assert.equal(report.range, '7d')
    assert.equal(report.calls, 5)
    assert.equal(report.errors, 1)
    assert.equal(report.unsettled, 1)
    assert.equal(report.sessions, 2)
    assert.equal(report.uniqueTools, 3)
    assert.equal(report.toolMs, 500)
    assert.equal(report.codeCalls, 0)
    assert.equal(report.successRate, 0.75, '3 successes of 4 settled calls')
    assert.equal(report.p50, 100)
    assert.equal(report.p95, 200)
  })

  it('sums per-tool day buckets and keeps percentiles out of unsettled calls', () => {
    const report = buildUsageReport(sessions, window, { resolveOwner: name => name === 'lang_detect' ? '@try-works/extension-tongue' : '@deepseek-ai/dsh-tool-fs' })
    const read = report.tools.find(row => row.name === 'read')
    assert.ok(read !== undefined)
    assert.equal(read.owner, '@deepseek-ai/dsh-tool-fs')
    assert.equal(read.calls, 3)
    assert.equal(read.errors, 0)
    assert.equal(read.unsettled, 1)
    assert.equal(read.totalMs, 300)
    assert.equal(read.maxMs, 200)
    assert.equal(read.p50, 100)
    assert.equal(read.firstUsed, now - DAY - 60_000)
    assert.equal(read.lastUsed, now - 60_000)
    assert.equal(report.tools.find(row => row.name === 'lang_detect')?.owner, '@try-works/extension-tongue')
    assert.deepEqual(report.tools.map(row => row.name), ['read', 'grep', 'lang_detect'])
  })

  it('rolls up by model, workspace, day and error code', () => {
    const report = buildUsageReport(sessions, window)
    const modelA = report.models.find(row => row.model === 'model-a')
    assert.equal(modelA?.calls, 3, 'the unsettled call is still a dispatched call of model-a')
    assert.equal(modelA?.tools, 1)
    assert.equal(modelA?.p50, 100)
    const workspaceA = report.workspaces.find(row => row.workspace === 'D:/work/a')
    assert.equal(workspaceA?.sessions, 1)
    assert.equal(workspaceA?.calls, 4)
    assert.equal(report.errorCodes[0]?.code, 'FS_DENIED')
    assert.equal(report.errorCodes[0]?.calls, 1)
    assert.deepEqual(report.days.map(day => day.day), [dayKey(now - 2 * DAY), dayKey(now - DAY), dayKey(now)].sort())
  })

  it('excludes calls outside the window and never changes totals with the recent limit', () => {
    const older = [session('s3', 'D:/work/c', settled(now - 40 * DAY, 'c9', 'read', 900, { model: 'model-a' }))]
    const report = buildUsageReport([...sessions, ...older], window)
    assert.equal(report.calls, 5)
    const small = buildUsageReport(sessions, window, { recentLimit: 1 })
    assert.equal(small.recentCalls.length, 1)
    assert.equal(small.calls, report.calls, 'page size never changes aggregates')
    assert.equal(report.recentCalls.length, 5)
    assert.equal(report.recentCalls.every(entry => entry.time >= window.from && entry.time < window.to), true)
    const first = report.recentCalls[0]
    assert.equal(first?.name, 'grep')
    assert.equal(first?.sessionId, 's1')
    assert.equal(first?.workspace, 'D:/work/a')
    assert.equal(first?.owner, '@deepseek-ai/dsh-tool-fs-search')
  })
})
