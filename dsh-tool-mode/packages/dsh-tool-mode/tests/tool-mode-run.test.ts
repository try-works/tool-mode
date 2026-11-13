/**
 * The authorized program pipeline, WIRED (CODE-02, CODE-03, CODE-08, ARCH-05).
 *
 * The finding this file answers came from adversarial review, not from a failing test:
 * `ptc-authority.ts` and `ptc-runtime.ts` had **zero callers outside tests**. Every control
 * in them was correct and thoroughly covered, and none of it ran. `tool_mode_run` did not
 * exist, the mount guard never executed, and the exposure gate guarded nothing because
 * there was no caller to refuse.
 *
 * These tests are therefore about CALLERS, not about behaviour in isolation. A control that
 * is only exercised by its own test is a symbol.
 *
 * Requirement links: CODE-02, CODE-03, CODE-05, CODE-08, ARCH-01, ARCH-05, SEC-03.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createProgramRunner, externalRefusal, serveProgram, TOOL_MODE_RUN_CONTRACT, type ProgramRuntime } from '../src/tool-mode-run.ts'
import { PTC_SERVICE, type PtcHostContext } from '../src/ptc-runtime.ts'
import type { ToolBinding } from '../src/ptc-authority.ts'
import { callTool, cleanup, mountPlugin, tempDir } from './helpers.ts'

/**
 * These cases assert the CLOSED exposure gate. A machine that has run the evidence recorder
 * carries `~/.dsh/ptc-confinement-evidence.json`, so the variable is pinned to a missing
 * path (an explicit bad path fails closed) and the cached reading is dropped.
 */
process.env['DSH_PTC_CONFINEMENT_EVIDENCE'] = join(tmpdir(), 'dsh-test-no-confinement-evidence.json')

after(async () => { await cleanup() })

/** A host context that records the mount, and can pretend a provider exists. */
function makeContext(options: { readonly provides?: unknown } = {}) {
  const mounted: unknown[] = []
  const context: PtcHostContext = {
    get: service => (service === PTC_SERVICE ? options.provides : undefined),
    plugin: (plugin) => { mounted.push(plugin) },
  }
  return { context, mounted }
}

/** A runtime that records what it was asked to run. */
function makeRuntime(options: { readonly fail?: string; readonly invokeBindings?: boolean; readonly repeatBinding?: number } = {}) {
  const requests: unknown[] = []
  const runtime: ProgramRuntime = {
    resolve: request => {
      requests.push(request)
      return request
    },
    async run(spec) {
      if (options.fail !== undefined) return { error: { kind: options.fail, message: 'probe' } }
      // When asked, the fake INVOKES every binding once — the program's own source
      // cannot run without a real runtime, so this simulates "the program called
      // each requested tool" and lets the counter wrapper be observed.
      if (options.repeatBinding !== undefined) {
        const namespace = (spec as { bindings?: { functions?: Record<string, ToolBinding> }[] }).bindings?.[0]
        const fn = Object.values(namespace?.functions ?? {})[0]
        for (let count = 0; count < options.repeatBinding; count += 1) await fn?.({ token: 'same' })
      }
      if (options.invokeBindings === true) {
        const namespace = (spec as { bindings?: { functions?: Record<string, ToolBinding> }[] }).bindings?.[0]
        for (const fn of Object.values(namespace?.functions ?? {})) {
          await fn({ token: 'a' })
        }
      }
      return { value: { ran: true } }
    },
  }
  return { runtime, requests }
}

/** A runner over a fixed grant and tool set. */
function makeRunner(overrides: {
  readonly grant?: readonly string[]
  readonly visible?: readonly string[] | (() => readonly string[])
  readonly bindings?: Record<string, ToolBinding>
  readonly runtime?: ProgramRuntime
  readonly provides?: unknown
  readonly backend?: unknown | (() => Promise<unknown>)
  readonly operatorGranted?: boolean | (() => boolean)
  readonly budgets?: {
    readonly maxToolCalls?: number
    readonly maxHarnessModelCalls?: number
    readonly isHarnessTool?: (name: string) => boolean
  }
} = {}) {
  const { context, mounted } = makeContext({ provides: overrides.provides })
  const visible = overrides.visible ?? ['fixture_echo']
  const operatorGranted = overrides.operatorGranted ?? false
  const runner = createProgramRunner({
    context,
    backend: overrides.backend,
    // SEC-04: the grant is read PER RUN; the fixed value becomes a closure.
    grant: () => overrides.grant ?? ['fixture_echo'],
    visible: typeof visible === 'function' ? visible : () => visible,
    resolve: name => overrides.bindings?.[name],
    runtime: () => overrides.runtime,
    operatorGranted: typeof operatorGranted === 'function' ? operatorGranted : () => operatorGranted,
    ...overrides.budgets === undefined ? {} : { budgets: overrides.budgets },
  })
  return { runner, mounted }
}

describe('CODE-08 — the exposure gate now HAS a caller', () => {
  it('refuses an external caller when the operator has NOT granted hosted code', () => {
    const { runner } = makeRunner({ operatorGranted: false })
    // Before the wiring this returned false and NOTHING consulted it. Now a refusal is
    // reachable, which is the difference between a control and a symbol.
    const refusal = externalRefusal(runner)
    assert.ok(refusal, 'an external caller must be refused while exposure is withheld')
    assert.match(refusal.message, /operator has not granted hosted code execution/)
  })

  it('refuses even WITH the operator grant, while confinement is undemonstrated (CODE-09)', () => {
    const { runner } = makeRunner({ operatorGranted: true })
    // The two facts are a CONJUNCTION: the operator's consent alone cannot open a
    // gate whose other half is the release-gate confinement evidence.
    const refusal = externalRefusal(runner)
    assert.ok(refusal, 'confinement evidence is absent, so the caller must still be refused')
    assert.match(refusal.message, /withheld until the confinement tests pass/)
  })

  it('reports the gate state and its reason independently', () => {
    const { runner } = makeRunner()
    assert.equal(runner.externalExposurePermitted(), false)
    assert.match(runner.externalExposureReason(), /disabled|withheld/)
  })

  it('the refusal is the SAME text the gate reports, from one enforcement point', () => {
    const { runner } = makeRunner({ operatorGranted: true })
    assert.equal(externalRefusal(runner)?.message, runner.externalExposureReason())
  })
})

describe('CODE-02 — the mount is guarded and has a caller', () => {
  it('mounts the backend when nothing provides the service', async () => {
    const backend = class Backend {}
    const { runner, mounted } = makeRunner({ backend })
    const outcome = await runner.prepare()
    assert.equal(outcome.mounted, true)
    assert.deepEqual(mounted, [backend])
  })

  it('does NOT mount over a provider the host already has', async () => {
    const existing = { language: 'typescript' }
    const { runner, mounted } = makeRunner({ provides: existing, backend: class Backend {} })
    const outcome = await runner.prepare()
    // The base bundle mounts one, so this is the expected path in a real deployment and an
    // unguarded mount would throw here.
    assert.equal(outcome.mounted, false)
    assert.equal(outcome.reason, 'already-provided')
    assert.deepEqual(mounted, [])
  })

  it('reports a missing backend as a REASON rather than throwing', async () => {
    const { runner } = makeRunner({ backend: undefined })
    const outcome = await runner.prepare()
    assert.equal(outcome.mounted, false)
    assert.equal(outcome.reason, 'backend-unavailable')
  })

  it('prepare() is idempotent', async () => {
    const backend = class Backend {}
    const { runner, mounted } = makeRunner({ backend })
    await runner.prepare()
    await runner.prepare()
    // Re-running the guard must not double-mount.
    assert.equal(mounted.length, 1)
  })
})

describe('CODE-03 — ONE pipeline, and the GRANT is what limits it', () => {
  it('runs a program whose requested tools are granted and visible', async () => {
    const { runtime, requests } = makeRuntime()
    const { runner } = makeRunner({ runtime, bindings: { fixture_echo: async () => ({ ok: true }) } })
    const outcome = await runner.run({ program: 'return 1;', requested: ['fixture_echo'] })
    assert.equal(outcome.ok, true)
    assert.equal(requests.length, 1, 'the runtime must be reached exactly once')
  })

  it('refuses a REPLAY after the captured tool is withdrawn (CODE-05)', async () => {
    const { runtime } = makeRuntime()
    let visible: readonly string[] = ['fixture_echo']
    const { runner } = makeRunner({
      runtime,
      visible: () => visible,
      bindings: { fixture_echo: async () => ({ ok: true }) },
    })
    const captured = await runner.run({ program: 'return 1;', requested: ['fixture_echo'] })
    assert.equal(captured.ok, true)
    // The extension is deactivated/replaced: the name is no longer visible. The
    // SAME program must be refused on replay rather than dispatched to a
    // different implementation.
    visible = []
    const replay = await runner.run({ program: 'return 1;', requested: ['fixture_echo'] })
    assert.equal(replay.ok, false)
    if (replay.ok) return
    assert.equal(replay.code, 'unauthorized')
    assert.match(replay.message, /fixture_echo/)
  })

  it('REFUSES a program asking for a tool the host did not grant', async () => {
    const { runtime, requests } = makeRuntime()
    const { runner } = makeRunner({
      runtime,
      grant: ['fixture_echo'],
      visible: ['fixture_echo', 'lang_detect'],
      bindings: { fixture_echo: async () => ({}), lang_detect: async () => ({}) },
    })
    const outcome = await runner.run({ program: 'return 1;', requested: ['fixture_echo', 'lang_detect'] })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.code, 'unauthorized')
    assert.match(outcome.message, /lang_detect: forbidden/)
    // And nothing reached the runtime: the refusal is BEFORE execution, not during it.
    assert.equal(requests.length, 0)
  })

  it('refuses the WHOLE request rather than binding a subset', async () => {
    const { runtime, requests } = makeRuntime()
    const { runner } = makeRunner({ runtime, bindings: { fixture_echo: async () => ({}) } })
    const outcome = await runner.run({ program: 'return 1;', requested: ['fixture_echo', 'nope'] })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.code, 'unauthorized')
    assert.equal(requests.length, 0, 'a partial namespace must never execute')
  })

  it('reports UNAVAILABLE when no runtime is mounted, rather than pretending', async () => {
    const { runner } = makeRunner({ runtime: undefined })
    const outcome = await runner.run({ program: 'return 1;', requested: [] })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.code, 'unavailable')
    assert.match(outcome.message, /no PTC runtime is mounted/)
  })
})

describe('CODE-05 — cancellation is NOT reported as a failure', () => {
  it('classifies an aborted run as cancelled', async () => {
    const { runtime } = makeRuntime({ fail: 'abort' })
    const { runner } = makeRunner({ runtime })
    const outcome = await runner.run({ program: 'while(true){}', requested: [] })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    // A caller walking away must not inflate the error rate.
    assert.equal(outcome.code, 'cancelled')
  })

  it('classifies any other runtime error as failed', async () => {
    const { runtime } = makeRuntime({ fail: 'timeout' })
    const { runner } = makeRunner({ runtime })
    const outcome = await runner.run({ program: 'return 1;', requested: [] })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.code, 'failed')
  })
})

describe('CODE-03 — the budget cannot be widened by asking', () => {
  it('CLAMPS a null budget rather than removing the deadline', async () => {
    const { runtime, requests } = makeRuntime()
    const { runner } = makeRunner({ runtime })
    await runner.run({ program: 'return 1;', requested: [], timeoutMs: null })
    // `null` means "no deadline" in the runtime's vocabulary, which is a request to opt out
    // of budgeting entirely.
    const sent = requests[0] as { timeoutMs: number }
    assert.equal(sent.timeoutMs, 600_000)
  })

  it('clamps an oversized budget to the ceiling', async () => {
    const { runtime, requests } = makeRuntime()
    const { runner } = makeRunner({ runtime })
    await runner.run({ program: 'return 1;', requested: [], timeoutMs: 99_999_999 })
    assert.equal((requests[0] as { timeoutMs: number }).timeoutMs, 600_000)
  })
})

describe('CODE-11 — nested calls share ONE root budget', () => {
  it('refuses the second nested call once the root tool-call budget is spent', async () => {
    const { runtime } = makeRuntime({ invokeBindings: true })
    const { runner } = makeRunner({
      runtime,
      visible: ['fixture_echo', 'fixture_second'],
      grant: ['fixture_echo', 'fixture_second'],
      budgets: { maxToolCalls: 1 },
      bindings: {
        fixture_echo: async () => ({ echoed: true }),
        fixture_second: async () => ({ echoed: true }),
      },
    })
    const outcome = await runner.run({ program: 'return 1;', requested: ['fixture_echo', 'fixture_second'] })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.code, 'failed')
    assert.match(outcome.message, /root tool-call budget of 1 was exhausted/)
  })
})

describe('the host REGISTERS tool_mode_run, so the gate is reachable through it', () => {
  it('is registered and REFUSES naming the missing operator grant (CODE-10 default)', async () => {
    const ctx = await mountPlugin({})
    const names = ctx.tools.schemas().map(schema => schema.name)
    // The registration is what makes the gate reachable at all: before this, the refusal
    // existed and no caller could obtain it.
    assert.ok(names.includes('tool_mode_run'), `expected tool_mode_run, saw: ${names.join(', ')}`)

    // Valid CODE-02 arguments, so the registry lets the call REACH execute and the gate
    // is what refuses it — the point of the assertion.
    const result = await callTool(ctx, 'tool_mode_run', {
      description: 'probe',
      code: 'return 1;',
      tools: ['lang_detect'],
    })
    assert.equal(result.isError, true, 'generated-code execution must be withheld')
    const message = JSON.stringify(result)
    assert.match(message, /operator has not granted hosted code execution/)
    void tempDir
  })

  it('with the operator grant, still REFUSES on the confinement gate (CODE-09)', async () => {
    const ctx = await mountPlugin({ hostedCode: true })
    const result = await callTool(ctx, 'tool_mode_run', {
      description: 'probe',
      code: 'return 1;',
      tools: ['lang_detect'],
    })
    assert.equal(result.isError, true, 'the confinement gate must stay closed')
    assert.match(JSON.stringify(result), /withheld until the confinement tests pass/)
    void tempDir
  })
})

describe('CODE-02 — the served path (serveProgram) reports what the interface promises', () => {
  const REPORT = { receiptId: 'rcpt_probe', catalogRevision: '7' }

  it('runs a program through the runner and reports result, logs, elapsed and tool calls', async () => {
    const calls: string[] = []
    const { runtime } = makeRuntime({ invokeBindings: true })
    // A backend CLASS: the runner's prepare() mounts it through the guarded context
    // so the served path sees a usable deployment rather than backend-unavailable.
    const { runner } = makeRunner({
      runtime,
      backend: class Backend {},
      bindings: {
        fixture_echo: async (args: Record<string, unknown>) => {
          calls.push(String(args.token))
          return { ok: true }
        },
      },
    })
    const report = await serveProgram({
      description: 'probe',
      code: 'await tools.fixture_echo({ token: "a" }); return { done: true };',
      tools: ['fixture_echo'],
    }, runner, REPORT)

    // The FAKE runtime returns a fixed value; what is asserted here is the pipeline
    // around it: the report shape, the receipt/revision facts, and — most
    // importantly — that the program's binding call reached the REAL wrapped
    // binding through the authorized namespace.
    assert.deepEqual(report.result, { ran: true })
    assert.deepEqual(calls, ['a'], 'the program must reach the binding through the authorized pipeline')
    assert.equal(report.meta.receiptId, 'rcpt_probe')
    assert.equal(report.meta.catalogRevision, '7')
    assert.equal(report.meta.toolCalls, 1, 'the call count must be real, not a fabricated zero')
    assert.ok(report.meta.elapsedMs >= 0)
    assert.ok(Array.isArray(report.logs))
    const accountingLine = report.logs.find(line => line.startsWith('tool_mode_accounting:'))
    assert.ok(accountingLine, 'the supported log channel must expose subcall accounting (AT-76)')
    const accounting = JSON.parse(accountingLine.slice('tool_mode_accounting:'.length)) as {
      toolCalls: number
      calls: readonly { name: string }[]
    }
    assert.equal(accounting.toolCalls, 1)
    assert.deepEqual(accounting.calls.map(call => call.name), ['fixture_echo'])
  })

  it('serves the literal CODE-02 payload { code, tools } with no description', async () => {
    // The advertised schema is the contract a client codes against. `description` is
    // advisory and is never interpolated, so requiring it made the documented payload
    // fail input validation before the program could run.
    assert.equal(
      (TOOL_MODE_RUN_CONTRACT.inputSchema.required as readonly string[]).includes('description'),
      false,
      'the MCP input schema must not require an advisory description',
    )
    const calls: string[] = []
    const { runtime } = makeRuntime({ invokeBindings: true })
    const { runner } = makeRunner({
      runtime,
      backend: class Backend {},
      bindings: {
        fixture_echo: async (args: Record<string, unknown>) => {
          calls.push(String(args.token))
          return { ok: true }
        },
      },
    })
    const report = await serveProgram({
      code: 'await tools.fixture_echo({ token: "a" }); return { done: true };',
      tools: ['fixture_echo'],
    }, runner, REPORT)
    assert.deepEqual(report.result, { ran: true })
    assert.deepEqual(calls, ['a'])
    assert.equal(report.meta.toolCalls, 1)
  })

  it('binds input through a JSON binding, never into the program source (CODE-04)', async () => {
    const { runtime, requests } = makeRuntime()
    const { runner } = makeRunner({
      runtime,
      backend: class Backend {},
      bindings: { fixture_echo: async () => ({ ok: true }) },
    })
    const report = await serveProgram({
      description: 'probe',
      code: 'return input.x;',
      input: { x: 1 },
      tools: ['fixture_echo'],
    }, runner, REPORT)
    assert.deepEqual(report.result, { ran: true })
    const spec = requests[0] as {
      program: string
      bindings: { global: string; functions: Record<string, (args: unknown) => Promise<unknown>> }[]
    }
    assert.match(spec.program, /^const input = await inputSource\.read\(null\);\n/)
    const inputNamespace = spec.bindings.find(namespace => namespace.global === 'inputSource')
    assert.ok(inputNamespace !== undefined, 'the input namespace must be bound')
    assert.deepEqual(await inputNamespace.functions.read!({}), { x: 1 })
    assert.equal(spec.program.includes('"x":1'), false, 'the data must not be interpolated into source')
  })

  it('detects a repeated identical tool call instead of looping forever (AT-10/AT-15)', async () => {
    const { runtime } = makeRuntime({ repeatBinding: 40 })
    const { runner } = makeRunner({
      runtime,
      backend: class Backend {},
      bindings: { fixture_echo: async () => ({ ok: true }) },
    })
    await assert.rejects(
      serveProgram({ description: 'loop', code: 'return 1;', tools: ['fixture_echo'] }, runner, REPORT),
      /MODEL_LOOP_DETECTED/,
    )
  })

  it('refuses a nested program chain beyond the depth bound (AT-10/AT-15)', async () => {
    let runner: ReturnType<typeof makeRunner>['runner']
    const runtime: ProgramRuntime = {
      resolve: request => request,
      async run(spec) {
        const namespace = (spec as { bindings?: { functions?: Record<string, ToolBinding> }[] }).bindings?.[0]
        await namespace?.functions['nested']?.({})
        return { value: { ran: true } }
      },
    }
    const made = makeRunner({
      runtime,
      backend: class Backend {},
      grant: ['nested'],
      visible: ['nested'],
      bindings: {
        nested: async () => {
          await serveProgram({ description: 'nested', code: 'return 1;', tools: ['nested'] }, runner, REPORT)
          return { ok: true }
        },
      },
    })
    runner = made.runner
    await assert.rejects(
      serveProgram({ description: 'outer', code: 'return 1;', tools: ['nested'] }, runner, REPORT),
      /MODEL_NESTED_DEPTH_EXCEEDED/,
    )
  })

  it('refuses when the backend is unavailable, naming the deployment fact', async () => {
    const { runtime } = makeRuntime()
    const { runner } = makeRunner({ runtime, backend: undefined })
    await assert.rejects(
      serveProgram({ description: 'probe', code: 'return 1;', tools: ['fixture_echo'] }, runner, REPORT),
      /backend is unavailable/,
    )
  })

  it('refuses a program that requests the recursive composition door (CODE-07)', async () => {
    const { runtime } = makeRuntime()
    const { runner } = makeRunner({
      runtime,
      backend: class Backend {},
      grant: ['tool_mode_run'],
      visible: () => ['tool_mode_run'],
      bindings: { tool_mode_run: async () => ({ nested: true }) },
    })
    await assert.rejects(
      serveProgram({ description: 'probe', code: 'await tools.tool_mode_run({});', tools: ['tool_mode_run'] }, runner, REPORT),
      /excluded.*CODE-07/s,
    )
  })
})

describe('CODE-02 — a run reports WHICH tools the program combined', () => {
  it('records a trace entry per sub-call, in dispatch order', async () => {
    const { runtime } = makeRuntime({ invokeBindings: true })
    const { runner } = makeRunner({
      bindings: {
        fixture_echo: async (args) => {
          // The trace must show the ARGUMENTS the program passed, not a placeholder.
          assert.deepEqual(args, { token: 'a' })
          return { echoed: 'a', length: 1 }
        },
      },
      runtime,
    })
    const outcome = await runner.run({ program: 'x', requested: ['fixture_echo'] })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.equal(outcome.toolCalls, 1, 'the count must still be reported')
    assert.equal(outcome.calls.length, 1, 'the count alone cannot say WHICH tool ran')
    const call = outcome.calls[0]
    assert.equal(call?.name, 'fixture_echo')
    assert.equal(call?.ok, true)
    assert.match(call?.argumentsPreview ?? '', /token/, 'the arguments are previewed')
    assert.match(call?.resultPreview ?? '', /echoed/, 'the result is previewed')
    assert.ok((call?.elapsedMs ?? -1) >= 0, 'each call carries how long it took')
  })

  it('caps the trace at 50 entries while the count keeps counting', async () => {
    const calls: number[] = []
    const runtime: ProgramRuntime = {
      resolve: request => request,
      async run(spec) {
        const namespace = (spec as { bindings?: { functions?: Record<string, ToolBinding> }[] }).bindings?.[0]
        const fn = namespace?.functions?.fixture_echo
        assert.ok(fn)
        for (let index = 0; index < 60; index += 1) {
          calls.push(index)
          await fn({ index })
        }
        return { value: null }
      },
    }
    const { runner } = makeRunner({ runtime, bindings: { fixture_echo: async () => ({ ok: true }) } })
    const outcome = await runner.run({ program: 'x', requested: ['fixture_echo'] })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.equal(outcome.toolCalls, 60, 'the COUNT is never truncated')
    assert.equal(outcome.calls.length, 50, 'the TRACE is bounded')
    assert.equal(calls.length, 60)
  })
})
