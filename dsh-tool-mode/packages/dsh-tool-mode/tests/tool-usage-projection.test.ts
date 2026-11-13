/**
 * S1 — the `toolModeUsage` projection (tool-insights plan §3.1).
 *
 * Synthetic DSH session events, folded through the REAL projection definition, prove
 * the properties the page depends on: direct call/result pairing, unsettled calls,
 * error codes, Code Mode sub-call pairing and linkage, model attribution (including
 * explicit `unattributed`), the hard bounds, and JSON purity (the projection cache
 * persists the state as plain JSON).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  DURATION_BUCKETS_MS,
  TOOL_USAGE_CAPS,
  TOOL_USAGE_STATE_VERSION,
  UNATTRIBUTED_MODEL,
  foldToolUsageEvent,
  initToolUsageState,
  toolUsageProjectionDefinition,
  toolUsageWire,
  type ToolUsageEvent,
  type ToolUsageState,
} from '../src/tool-usage-projection.ts'

/** One model route header. */
function header(time: number, model: string, provider = 'test-provider'): ToolUsageEvent {
  return { type: 'request/header', time, data: { header: { config: { provider, model } } } }
}

/** One assistant message, which names the model that emitted the step's calls. */
function assistant(time: number, model: string, turn = 1, step = 1): ToolUsageEvent {
  return {
    type: 'assistant/message',
    time,
    data: { turn, step, message: { role: 'assistant', source: { kind: 'model', provider: 'test-provider', model }, content: [] }, stream: [] },
  }
}

/** One model-requested direct tool call. */
function call(time: number, callId: string, name: string, turn = 1, step = 1, args = '{"a":1}'): ToolUsageEvent {
  return { type: 'tool/call', time, data: { turn, step, callId, name, arguments: args } }
}

/** One settled direct tool result. */
function result(time: number, callId: string, options: { isError?: boolean; code?: string; turn?: number; step?: number } = {}): ToolUsageEvent {
  return {
    type: 'tool/result',
    time,
    data: {
      turn: options.turn ?? 1,
      step: options.step ?? 1,
      message: { role: 'tool', source: { kind: 'tool', callId }, content: [{ type: 'text', text: 'ok' }], ...options.isError === true ? { isError: true } : {} },
      ...options.code === undefined ? {} : { error: { name: 'ToolError', code: options.code } },
    },
  }
}

/** One Code Mode sub-dispatch starting. */
function ptcStart(time: number, subCallId: string, name: string, parentCallId = 'parent-1'): ToolUsageEvent {
  return {
    type: 'tool/ptc-dispatch-start',
    time,
    data: { rootCallId: parentCallId, parentCallId, subCallId, name, arguments: { a: 1 } },
  }
}

/** One Code Mode sub-dispatch settling. */
function ptcSettle(time: number, subCallId: string, name: string, options: { isError?: boolean; code?: string; parentCallId?: string } = {}): ToolUsageEvent {
  return {
    type: 'tool/ptc-dispatch',
    time,
    data: {
      rootCallId: options.parentCallId ?? 'parent-1',
      parentCallId: options.parentCallId ?? 'parent-1',
      subCallId,
      name,
      arguments: { a: 1 },
      isError: options.isError === true,
      content: [{ type: 'text', text: 'sub' }],
      ...options.code === undefined ? {} : { error: { name: 'SubError', code: options.code } },
    },
  }
}

/** Fold a synthetic event log into the initial state. */
function fold(events: readonly ToolUsageEvent[]): ToolUsageState {
  let state = initToolUsageState()
  for (const event of events) state = foldToolUsageEvent(state, event)
  return state
}

describe('S1 direct call/result pairing', () => {
  it('measures elapsed wall time and records a settled success', () => {
    const state = fold([call(1_000, 'c1', 'read'), result(1_750, 'c1')])
    const wire = toolUsageWire(state)
    assert.equal(state.calls, 1)
    assert.equal(state.errors, 0)
    assert.equal(state.unsettled, 0)
    assert.equal(state.toolMs, 750)
    assert.equal(state.byTool['read']?.totalMs, 750)
    assert.equal(state.byTool['read']?.calls, 1)
    assert.equal(wire.calls, 1)
    assert.deepEqual(wire.recent[0], {
      time: 1_000,
      name: 'read',
      model: UNATTRIBUTED_MODEL,
      ms: 750,
      ok: true,
      kind: 'direct',
      code: null,
    })
  })

  it('clamps a result that arrives before its call to zero', () => {
    const state = fold([call(900, 'c1', 'read'), result(500, 'c1')])
    assert.equal(state.toolMs, 0)
    assert.equal(toolUsageWire(state).recent[0]?.ms, 0)
  })

  it('reports a call whose result never landed at turn/end as unsettled, never a success', () => {
    const state = fold([call(1_000, 'c1', 'read'), { type: 'turn/end', time: 2_000, data: { turn: 1 } }])
    const wire = toolUsageWire(state)
    assert.equal(state.calls, 1)
    assert.equal(state.unsettled, 1)
    assert.equal(state.errors, 0)
    assert.equal(state.byTool['read']?.unsettled, 1)
    assert.equal(wire.recent[0]?.ok, null, 'an unsettled call is not rendered as succeeded')
    assert.equal(wire.recent[0]?.ms, null)
    assert.equal(state.pending['c1'], undefined)
  })

  it('counts a tool error and records only the class-level code', () => {
    const state = fold([call(1_000, 'c1', 'read'), result(1_100, 'c1', { isError: true, code: 'FS_DENIED' })])
    assert.equal(state.errors, 1)
    assert.equal(state.byTool['read']?.errors, 1)
    assert.equal(state.byErrorCode['FS_DENIED'], 1)
    assert.equal(toolUsageWire(state).recent[0]?.ok, false)
    assert.equal(toolUsageWire(state).recent[0]?.code, 'FS_DENIED')
  })

  it('never pairs a prototype-named callId', () => {
    const unmatched = fold([result(1_100, 'constructor')])
    assert.equal(unmatched.calls, 0)
    assert.equal(unmatched.unsettled, 0)
    assert.equal(unmatched.errors, 0)
    assert.equal(Object.keys(unmatched.pending).length, 0)

    const paired = fold([call(1_000, 'constructor', 'read'), result(1_500, 'constructor')])
    assert.equal(paired.calls, 1)
    assert.equal(paired.toolMs, 500)
  })
})

describe('S1 Code Mode sub-calls', () => {
  it('pairs a sub-dispatch by subCallId and links it to the parent program', () => {
    const state = fold([
      call(1_000, 'parent-1', 'tool_mode_run'),
      ptcStart(1_100, 'parent-1:ptc:1', 'read'),
      ptcSettle(1_250, 'parent-1:ptc:1', 'read'),
      result(5_000, 'parent-1'),
    ])
    const wire = toolUsageWire(state)
    assert.equal(state.byTool['read']?.codeCalls, 1)
    assert.equal(state.byTool['read']?.totalMs, 150)
    assert.equal(state.byTool['tool_mode_run']?.totalMs, 4_000, 'sub-call duration never adds to the parent')
    assert.equal(state.toolMs, 4_150, 'each call contributes only its own duration')
    const sub = wire.recent.find(entry => entry.name === 'read')
    assert.ok(sub !== undefined)
    assert.equal(sub.kind, 'code')
    assert.equal(sub.ms, 150)
    const detail = state.recent.find(entry => entry.name === 'read')
    assert.equal(detail?.rootCallId, 'parent-1')
    assert.equal(detail?.parentCallId, 'parent-1')
  })

  it('counts a failed sub-dispatch as an error without a fake success', () => {
    const state = fold([
      call(1_000, 'parent-1', 'tool_mode_run'),
      ptcStart(1_100, 'parent-1:ptc:1', 'read'),
      ptcSettle(1_200, 'parent-1:ptc:1', 'read', { isError: true, code: 'SUB_FAILED' }),
    ])
    assert.equal(state.errors, 1)
    assert.equal(state.byErrorCode['SUB_FAILED'], 1)
    assert.equal(state.byTool['read']?.errors, 1)
  })
})

describe('S1 model attribution', () => {
  it('attributes a call to the request-header route', () => {
    const state = fold([header(100, 'model-a'), call(1_000, 'c1', 'read'), result(1_100, 'c1')])
    assert.equal(state.byModel['model-a']?.calls, 1)
    assert.equal(toolUsageWire(state).recent[0]?.model, 'model-a')
  })

  it('prefers the emitting assistant message for the call step', () => {
    const state = fold([header(100, 'model-route'), assistant(200, 'model-step'), call(1_000, 'c1', 'read'), result(1_100, 'c1')])
    assert.equal(state.byModel['model-step']?.calls, 1)
    assert.equal(state.byModel['model-route'], undefined)
  })

  it('splits a mid-turn route change by the route in force at each call', () => {
    const state = fold([
      header(100, 'model-a'),
      call(1_000, 'c1', 'read'),
      result(1_100, 'c1'),
      header(2_000, 'model-b'),
      call(3_000, 'c2', 'grep'),
      result(3_100, 'c2'),
    ])
    assert.equal(state.byModel['model-a']?.calls, 1)
    assert.equal(state.byModel['model-b']?.calls, 1)
  })

  it('uses the explicit unattributed bucket when no model is readable', () => {
    const state = fold([call(1_000, 'c1', 'read'), result(1_100, 'c1')])
    assert.equal(state.byModel[UNATTRIBUTED_MODEL]?.calls, 1)
    assert.equal(toolUsageWire(state).recent[0]?.model, UNATTRIBUTED_MODEL)
  })

  it('lets Code Mode sub-calls inherit the parent program model', () => {
    const state = fold([
      header(100, 'model-a'),
      call(1_000, 'parent-1', 'tool_mode_run'),
      ptcStart(1_100, 'parent-1:ptc:1', 'read'),
      ptcSettle(1_200, 'parent-1:ptc:1', 'read'),
      result(5_000, 'parent-1'),
    ])
    assert.equal(state.byTool['read']?.totalMs, 100)
    assert.equal(toolUsageWire(state).recent.find(entry => entry.name === 'read')?.model, 'model-a')
  })
})

describe('S1 bounds and JSON purity', () => {
  it('caps pending calls at 100 and reports the evicted call as unsettled', () => {
    const events: ToolUsageEvent[] = []
    for (let index = 0; index < TOOL_USAGE_CAPS.pending + 1; index += 1) events.push(call(1_000 + index, `c${index}`, 'read'))
    const state = fold(events)
    assert.equal(Object.keys(state.pending).length, TOOL_USAGE_CAPS.pending)
    assert.equal(state.calls, TOOL_USAGE_CAPS.pending + 1)
    assert.equal(state.unsettled, 1, 'the evicted pending call is named unsettled, not dropped')
  })

  it('caps recent calls at 200 keeping the newest', () => {
    const events: ToolUsageEvent[] = []
    for (let index = 0; index < TOOL_USAGE_CAPS.recent + 1; index += 1) {
      events.push(call(1_000 + index * 10, `c${index}`, 'read'), result(1_005 + index * 10, `c${index}`))
    }
    const state = fold(events)
    assert.equal(state.recent.length, TOOL_USAGE_CAPS.recent)
    assert.equal(state.recent[0]?.time, 1_010, 'the oldest entry is evicted')
    assert.equal(state.recent.at(-1)?.time, 1_000 + TOOL_USAGE_CAPS.recent * 10)
  })

  it('caps distinct tools at 100 and records the overflow explicitly', () => {
    const events: ToolUsageEvent[] = []
    for (let index = 0; index < TOOL_USAGE_CAPS.tools + 1; index += 1) {
      events.push(call(1_000 + index, `c${index}`, `tool-${index}`), result(1_001 + index, `c${index}`))
    }
    const state = fold(events)
    assert.equal(Object.keys(state.byTool).length, TOOL_USAGE_CAPS.tools)
    assert.equal(state.toolsTruncated, 1)
    assert.equal(state.calls, TOOL_USAGE_CAPS.tools + 1, 'totals still count every call')
  })

  it('caps retained days at 60', () => {
    const events: ToolUsageEvent[] = []
    const day = 24 * 60 * 60 * 1000
    const start = Date.UTC(2026, 0, 1)
    for (let index = 0; index < TOOL_USAGE_CAPS.days + 1; index += 1) {
      events.push(call(start + index * day, `c${index}`, 'read'), result(start + index * day + 5, `c${index}`))
    }
    const state = fold(events)
    assert.equal(Object.keys(state.byDay).length, TOOL_USAGE_CAPS.days)
    assert.equal(Object.keys(state.byTool['read']?.byDay ?? {}).length, TOOL_USAGE_CAPS.days)
  })

  it('keeps a 16-bucket duration histogram with log-scale edges', () => {
    assert.equal(DURATION_BUCKETS_MS.length, 16)
    const state = fold([call(0, 'c1', 'read'), result(0, 'c1'), call(1, 'c2', 'read'), result(1_001, 'c2')])
    const histogram = state.byTool['read']?.histogram ?? []
    assert.equal(histogram.length, 16)
    assert.equal(histogram[0], 1, 'a zero-duration call lands in the first bucket')
    assert.equal(histogram.reduce((sum, count) => sum + count, 0), 2)
  })

  it('is plain JSON and carries the state version', () => {
    const state = fold([
      header(100, 'model-a'),
      call(1_000, 'c1', 'read'),
      result(1_750, 'c1'),
      ptcStart(2_000, 'p:ptc:1', 'grep'),
      ptcSettle(2_100, 'p:ptc:1', 'grep'),
    ])
    assert.equal(state.stateVersion, TOOL_USAGE_STATE_VERSION)
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state)
    const wire = toolUsageWire(state)
    assert.equal(wire.stateVersion, TOOL_USAGE_STATE_VERSION)
    assert.deepEqual(JSON.parse(JSON.stringify(wire)), wire)
    assert.equal(toolUsageProjectionDefinition.wire?.viewSchema.safeParse(wire).success, true)
  })

  it('rejects an unknown field in the persisted state and the wire', () => {
    const state = fold([call(1_000, 'c1', 'read'), result(1_100, 'c1')])
    assert.equal(toolUsageProjectionDefinition.stateSchema.safeParse(state).success, true)
    assert.equal(toolUsageProjectionDefinition.stateSchema.safeParse({ ...state, unexpected: true }).success, false)
    const wire = toolUsageWire(state)
    assert.equal(toolUsageProjectionDefinition.wire?.viewSchema.safeParse({ ...wire, unexpected: true }).success, false)
  })
})
