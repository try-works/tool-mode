/**
 * Slice 2 — REAL PTC composition, on the actual DSH backend.
 *
 * The directive's minimum evidence, verbatim:
 *
 *   "A program calls two deterministic fixture tools, handles a dependency and branch,
 *    returns canonical output, and obeys cancellation/revocation. Run the actual DSH PTC
 *    backend, not a fake executor. Model weights are unnecessary for this slice."
 *
 * This runs the REAL `NodePtcRuntime` over the real composed services. It is not a fake
 * executor and it is not a stub: the program is compiled and executed in a subprocess by
 * the backend, and the two tools it calls go through `buildToolBindings`, which is the
 * SAME authorization path an external `tool_mode_run` must use.
 *
 * Model weights are absent by design. A passing run proves COMPOSITION AND DISPATCH and
 * says nothing about model quality — which is why the fixture tools compute rather than
 * infer.
 *
 * The DSH packages are imported DYNAMICALLY so that a checkout without them SKIPS this
 * file rather than failing the suite: the plugin must remain buildable by an author who
 * has not installed the host.
 *
 * Requirement links: CODE-01, CODE-02, CODE-03, CODE-05, CODE-08, ARCH-05.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buildToolBindings, mountPtcRuntimeIfAbsent, PTC_SERVICE, type PtcHostContext } from '../src/ptc-runtime.ts'
import { createProgramRunner, serveProgram, type ProgramRuntime } from '../src/tool-mode-run.ts'
import type { ToolBinding } from '../src/ptc-authority.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { callTool, mountPluginWithTongue } from './helpers.ts'

/** Resolve the DSH packages, or report that this checkout cannot run the slice. */
async function loadDsh(): Promise<{
  Context: any
  backend: unknown
  plugins: unknown[]
  sandboxPolicy: unknown
} | { unavailable: string }> {
  try {
    const [{ Context }, node, sessionProjection, fsLocal, subprocessLocal, sandboxLocal, sandboxPolicy] =
      await Promise.all([
        import('@deepseek-ai/cordis'),
        import('@deepseek-ai/dsh-ptc-runtime-node'),
        import('@deepseek-ai/dsh-session-projection'),
        import('@deepseek-ai/dsh-fs-local'),
        import('@deepseek-ai/dsh-subprocess-local'),
        import('@deepseek-ai/dsh-sandbox-local'),
        import('@deepseek-ai/dsh-sandbox-policy'),
      ])
    return {
      Context,
      backend: (node as any).NodePtcRuntime ?? (node as any).default,
      plugins: [
        (sessionProjection as any).default ?? sessionProjection,
        (fsLocal as any).default ?? fsLocal,
        (subprocessLocal as any).default ?? subprocessLocal,
        (sandboxLocal as any).default ?? sandboxLocal,
      ],
      sandboxPolicy: (sandboxPolicy as any).default ?? sandboxPolicy,
    }
  } catch (error) {
    return { unavailable: error instanceof Error ? error.message : String(error) }
  }
}

const loaded = await loadDsh()
const SKIP = 'unavailable' in loaded
  ? `the DSH packages do not resolve in this checkout: ${loaded.unavailable}`
  : undefined

/** Build a live context with the backend mounted at most once. */
async function liveRuntime() {
  if ('unavailable' in loaded) throw new Error(loaded.unavailable)
  const ctx = new loaded.Context()
  for (const plugin of loaded.plugins) await ctx.plugin(plugin)
  await ctx.plugin(loaded.sandboxPolicy, { mode: 'danger-full-access' })
  // THE GUARDED MOUNT: inside a full DSH deployment the base bundle has already provided
  // this, and an unguarded ctx.plugin throws.
  const mount = await mountPtcRuntimeIfAbsent(ctx, loaded.backend, {
    timeoutMs: 30_000,
    maxTimeoutMs: 60_000,
  })
  const runtime = ctx.get(PTC_SERVICE)
  return { ctx, runtime, mount }
}

/** Two deterministic tools: one computes, the other depends on the first. */
function fixtureTools() {
  const calls: string[] = []
  const bindings: Record<string, ToolBinding> = {
    /** Doubles a number. */
    double_it: async args => {
      calls.push('double_it')
      const n = args.n
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('double_it requires a finite number')
      return { value: n * 2 }
    },
    /** Depends on `double_it` having produced a positive value. */
    label_it: async args => {
      calls.push('label_it')
      const value = args.value
      if (typeof value !== 'number') throw new Error('label_it requires a number')
      // A BRANCH: the label depends on the value, so the program must handle both paths.
      return { label: value > 10 ? 'large' : 'small' }
    },
  }
  return { bindings, calls }
}

describe('slice 2 — REAL PTC composition', { skip: SKIP }, () => {
  it('mounts through the guard and exposes the service either way', async () => {
    const { mount, runtime } = await liveRuntime()
    // Inside a full deployment the base bundle provides the runtime, so `mounted` is
    // false and that is a SUCCESS — the service is present and usable.
    assert.ok(mount.service === PTC_SERVICE)
    assert.ok(runtime !== undefined, 'the service must be usable after the mount attempt')
  })

  it('runs a program that calls TWO tools, branches on a DEPENDENCY, and returns canonical output', async () => {
    const { runtime } = await liveRuntime()
    const { bindings, calls } = fixtureTools()

    // The program's requested names go through the SAME authorization path an external
    // tool_mode_run uses — that is the point of the single pipeline.
    const outcome = buildToolBindings({
      requested: ['double_it', 'label_it'],
      authority: { granted: ['double_it', 'label_it'], visible: ['double_it', 'label_it'] },
      resolve: name => bindings[name],
    })
    assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.message)
    if (!outcome.ok) return

    const result = await runtime.run(runtime.resolve({
      program: `
        const first = await tools.double_it({ n: 21 });
        const second = await tools.label_it({ value: first.value });
        return { doubled: first.value, label: second.label };
      `,
      bindings: [outcome.namespace],
      timeoutMs: 30_000,
    }))

    assert.equal(result.error, undefined, `the run failed: ${JSON.stringify(result.error)}`)
    // CANONICAL OUTPUT: the completion value, not a log line.
    assert.deepEqual(result.value, { doubled: 42, label: 'large' })
    // Both tools ran, in the order the program asked for them.
    assert.deepEqual(calls, ['double_it', 'label_it'])
  })

  it('takes the OTHER branch when the value is small', async () => {
    const { runtime } = await liveRuntime()
    const { bindings } = fixtureTools()
    const outcome = buildToolBindings({
      requested: ['double_it', 'label_it'],
      authority: { granted: ['double_it', 'label_it'], visible: ['double_it', 'label_it'] },
      resolve: name => bindings[name],
    })
    if (!outcome.ok) throw new Error(outcome.message)

    const result = await runtime.run(runtime.resolve({
      program: `
        const first = await tools.double_it({ n: 2 });
        const second = await tools.label_it({ value: first.value });
        return { doubled: first.value, label: second.label };
      `,
      bindings: [outcome.namespace],
      timeoutMs: 30_000,
    }))
    assert.deepEqual(result.value, { doubled: 4, label: 'small' })
  })

  it('ABORTS a running program rather than letting it finish', async () => {
    const { runtime } = await liveRuntime()
    const controller = new AbortController()
    const started = Date.now()
    // Abort shortly after the program starts a long loop.
    setTimeout(() => controller.abort(), 250)

    const result = await runtime.run(runtime.resolve({
      program: `
        let spins = 0;
        while (true) { spins += 1; }
        return { spins };
      `,
      bindings: [],
      timeoutMs: 30_000,
      signal: controller.signal,
    }))

    // A HARD stop: the runtime must not wait for the loop to end, because it never would.
    assert.equal(result.error?.kind, 'abort', `expected an abort, got ${JSON.stringify(result.error)}`)
    assert.ok(Date.now() - started < 20_000, 'the abort must stop the program, not time it out')
  })

  it('FAILS a program that calls a tool it was not granted, instead of omitting it', async () => {
    const { bindings } = fixtureTools()
    const outcome = buildToolBindings({
      requested: ['double_it', 'label_it'],
      authority: { granted: ['double_it'], visible: ['double_it', 'label_it'] },
      resolve: name => bindings[name],
    })
    // All-or-nothing: the program never runs against a smaller namespace than it declared.
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.match(outcome.message, /label_it: forbidden/)
  })

  it('reports a tool failure through the program rather than swallowing it', async () => {
    const { runtime } = await liveRuntime()
    const outcome = buildToolBindings({
      requested: ['double_it'],
      authority: { granted: ['double_it'], visible: ['double_it'] },
      resolve: () => async () => {
        throw new Error('the fixture refused')
      },
    })
    if (!outcome.ok) throw new Error(outcome.message)

    const result = await runtime.run(runtime.resolve({
      program: `
        try {
          await tools.double_it({ n: 1 });
          return { reached: false };
        } catch (error) {
          return { reached: true, message: String(error && error.message ? error.message : error) };
        }
      `,
      bindings: [outcome.namespace],
      timeoutMs: 30_000,
    }))
    // The program CAN observe the rejection; the runtime does not convert a failed call
    // into a successful value.
    assert.equal(result.value?.reached, true)
    assert.match(String(result.value?.message), /refused/)
  })

  it('serves a REAL program through serveProgram, the tool_mode_run path (CODE-02)', async () => {
    const { ctx, runtime } = await liveRuntime()
    const { bindings, calls } = fixtureTools()
    const runner = createProgramRunner({
      context: ctx as unknown as PtcHostContext,
      backend: loaded.backend,
      grant: () => ['double_it', 'label_it'],
      visible: () => ['double_it', 'label_it'],
      resolve: name => bindings[name],
      runtime: () => runtime as unknown as ProgramRuntime,
      operatorGranted: () => true,
    })

    const report = await serveProgram({
      description: 'compose two deterministic tools',
      code: `
        const first = await tools.double_it({ n: 21 });
        const second = await tools.label_it({ value: first.value });
        return { doubled: first.value, label: second.label };
      `,
      tools: ['double_it', 'label_it'],
    }, runner, { receiptId: 'rcpt_composition', catalogRevision: '1' })

    // THE SERVED PATH END TO END: the real backend ran the program, the two bindings
    // were called through the authorized namespace, and the report carries the
    // canonical value plus the real call count.
    assert.deepEqual(report.result, { doubled: 42, label: 'large' })
    assert.deepEqual(calls, ['double_it', 'label_it'])
    assert.equal(report.meta.toolCalls, 2, 'the served path must count real binding calls')
    assert.equal(report.meta.receiptId, 'rcpt_composition')
    assert.equal(report.meta.catalogRevision, '1')
    assert.ok(report.meta.elapsedMs >= 0)
  })

  it('binds a structured input through a JSON binding and runs it on the real backend (CODE-04)', async () => {
    const { ctx, runtime } = await liveRuntime()
    const { bindings } = fixtureTools()
    const runner = createProgramRunner({
      context: ctx as unknown as PtcHostContext,
      backend: loaded.backend,
      grant: () => ['double_it'],
      visible: () => ['double_it'],
      resolve: name => bindings[name],
      runtime: () => runtime as unknown as ProgramRuntime,
      operatorGranted: () => true,
    })
    const report = await serveProgram({
      description: 'probe',
      code: 'return { doubled: input.n * 2 };',
      input: { n: 21 },
      tools: ['double_it'],
    }, runner, { receiptId: 'rcpt_input', catalogRevision: '1' })
    assert.deepEqual(report.result, { doubled: 42 })
  })

  it('terminates an infinite CPU loop on the deadline instead of returning a success (AT-15)', { timeout: 20_000 }, async () => {
    const { ctx, runtime } = await liveRuntime()
    const { bindings } = fixtureTools()
    const runner = createProgramRunner({
      context: ctx as unknown as PtcHostContext,
      backend: loaded.backend,
      grant: () => ['double_it'],
      visible: () => ['double_it'],
      resolve: name => bindings[name],
      runtime: () => runtime as unknown as ProgramRuntime,
      operatorGranted: () => true,
    })
    await assert.rejects(
      serveProgram({ description: 'infinite', code: 'while (true) {}', tools: ['double_it'], timeout_ms: 300 }, runner, {
        receiptId: 'rcpt_infinite', catalogRevision: '1',
      }),
      /deadline|timeout|timed out/i,
    )
  })

  it('generates TypeScript bindings for EXACTLY the bound set (CODE-03)', async () => {
    const { ctx, runtime } = await liveRuntime()
    const { bindings } = fixtureTools()
    const runner = createProgramRunner({
      context: ctx as unknown as PtcHostContext,
      backend: loaded.backend,
      grant: () => ['double_it', 'label_it'],
      visible: () => ['double_it', 'label_it'],
      resolve: name => bindings[name],
      runtime: () => runtime as unknown as ProgramRuntime,
      operatorGranted: () => true,
    })
    const report = await serveProgram({
      description: 'bind one of two granted tools',
      code: 'return await tools.double_it({ n: 2 });',
      tools: ['double_it'],
    }, runner, { receiptId: 'rcpt_types', catalogRevision: '1' })
    const types = (report.meta as { typescript?: string }).typescript ?? ''
    assert.match(types, /double_it/)
    assert.doesNotMatch(types, /label_it/, 'types must come from the bound set, not the whole grant')
  })

  it('does not leak mutable program globals between runs (CODE-08)', async () => {
    const { ctx, runtime } = await liveRuntime()
    const { bindings } = fixtureTools()
    const runner = createProgramRunner({
      context: ctx as unknown as PtcHostContext,
      backend: loaded.backend,
      grant: () => ['double_it'],
      visible: () => ['double_it'],
      resolve: name => bindings[name],
      runtime: () => runtime as unknown as ProgramRuntime,
      operatorGranted: () => true,
    })
    const first = await serveProgram({
      description: 'write a global',
      code: 'globalThis.__leaked = 42; return 1;',
      tools: ['double_it'],
    }, runner, { receiptId: 'rcpt_global1', catalogRevision: '1' })
    assert.equal(first.result, 1)
    const second = await serveProgram({
      description: 'observe whether the global survived',
      code: 'return typeof globalThis.__leaked;',
      tools: ['double_it'],
    }, runner, { receiptId: 'rcpt_global2', catalogRevision: '1' })
    assert.equal(second.result, 'undefined', 'program globals must not survive a run')
  })

  it('does not let a scheduled background task hold a run open (CODE-08)', async () => {
    const { ctx, runtime } = await liveRuntime()
    const { bindings } = fixtureTools()
    const runner = createProgramRunner({
      context: ctx as unknown as PtcHostContext,
      backend: loaded.backend,
      grant: () => ['double_it'],
      visible: () => ['double_it'],
      resolve: name => bindings[name],
      runtime: () => runtime as unknown as ProgramRuntime,
      operatorGranted: () => true,
    })
    const started = Date.now()
    const report = await serveProgram({
      description: 'schedule a long timer but return',
      code: 'setTimeout(() => {}, 60000); return 1;',
      tools: ['double_it'],
    }, runner, { receiptId: 'rcpt_timer', catalogRevision: '1' })
    assert.equal(report.result, 1)
    assert.ok(Date.now() - started < 10_000, 'a scheduled background task must not hold the run open')
  })

  it('supports bounded independent concurrency in one program (CODE-07)', async () => {
    const { ctx, runtime } = await liveRuntime()
    const { bindings, calls } = fixtureTools()
    const runner = createProgramRunner({
      context: ctx as unknown as PtcHostContext,
      backend: loaded.backend,
      grant: () => ['double_it'],
      visible: () => ['double_it'],
      resolve: name => bindings[name],
      runtime: () => runtime as unknown as ProgramRuntime,
      operatorGranted: () => true,
    })
    const report = await serveProgram({
      description: 'two independent calls in parallel',
      code: `
        const [first, second] = await Promise.all([
          tools.double_it({ n: 1 }),
          tools.double_it({ n: 2 }),
        ]);
        return { first: first.value, second: second.value };
      `,
      tools: ['double_it'],
    }, runner, { receiptId: 'rcpt_concurrent', catalogRevision: '1' })
    assert.deepEqual(report.result, { first: 2, second: 4 })
    assert.deepEqual(calls, ['double_it', 'double_it'])
  })

  it('binds a REAL leaf tool (lang_detect) through the live registry (CODE-01)', async () => {
    const plugin = await mountPluginWithTongue({ models: ['title'] })
    const enabled = await callTool(plugin, 'model_tools', { action: 'enable', model: 'tongue' })
    assert.equal(enabled.isError, false, JSON.stringify(enabled))
    const { ctx: ptcCtx, runtime } = await liveRuntime()
    const runner = createProgramRunner({
      context: ptcCtx as unknown as PtcHostContext,
      backend: loaded.backend,
      grant: () => ['lang_detect'],
      visible: () => ['lang_detect'],
      resolve: name => name === 'lang_detect'
        ? async (args) => {
          const result = await plugin.tools.execute({
            signal: new AbortController().signal,
            callId: ToolCallId(`ptc-real-${Date.now()}`),
            name,
            arguments: args,
          })
          if (result.isError) throw new Error(result.error.message)
          return result.value
        }
        : undefined,
      runtime: () => runtime as unknown as ProgramRuntime,
      operatorGranted: () => true,
    })
    const report = await serveProgram({
      description: 'call the real language detector inside a program',
      code: `
        const detected = await tools.lang_detect({ text: 'kann ich das haben' });
        return { language: detected.language, reliability: detected.reliability };
      `,
      tools: ['lang_detect'],
    }, runner, { receiptId: 'rcpt_real_tool', catalogRevision: '1' })
    assert.equal((report.result as { language?: string }).language, 'de')
    assert.ok((report.result as { reliability?: string }).reliability !== undefined)
  })

  it('a program can CATCH a failed tool call and continue (CODE-06)', async () => {
    const { ctx, runtime } = await liveRuntime()
    const { bindings, calls } = fixtureTools()
    const runner = createProgramRunner({
      context: ctx as unknown as PtcHostContext,
      backend: loaded.backend,
      grant: () => ['fail_it', 'double_it'],
      visible: () => ['fail_it', 'double_it'],
      resolve: name => name === 'fail_it'
        ? async () => { calls.push('fail_it'); throw new Error('scripted failure') }
        : bindings[name],
      runtime: () => runtime as unknown as ProgramRuntime,
      operatorGranted: () => true,
    })
    const report = await serveProgram({
      description: 'catch a failed tool call and continue',
      code: `
        let handled = false;
        try { await tools.fail_it({}); } catch (error) { handled = true; }
        const doubled = await tools.double_it({ n: 21 });
        return { handled, value: doubled.value };
      `,
      tools: ['fail_it', 'double_it'],
    }, runner, { receiptId: 'rcpt_catch', catalogRevision: '1' })
    assert.deepEqual(report.result, { handled: true, value: 42 })
    assert.deepEqual(calls, ['fail_it', 'double_it'])
  })

  it('a program cannot reach an excluded management binding from inside the runtime (CODE-10)', async () => {
    const { ctx, runtime } = await liveRuntime()
    const { bindings, calls } = fixtureTools()
    const runner = createProgramRunner({
      context: ctx as unknown as PtcHostContext,
      backend: loaded.backend,
      // Even granting and listing the management name must not make it bindable.
      grant: () => ['double_it', 'model_tools_manage'],
      visible: () => ['double_it', 'model_tools_manage'],
      resolve: name => name === 'model_tools_manage'
        ? async () => { calls.push(name); return { mutated: true } }
        : bindings[name],
      runtime: () => runtime as unknown as ProgramRuntime,
      operatorGranted: () => true,
    })
    await assert.rejects(
      serveProgram({
        description: 'attempt to reach an excluded management binding',
        code: 'return await tools.model_tools_manage({ action: "list" });',
        tools: ['double_it'],
      }, runner, { receiptId: 'rcpt_excluded', catalogRevision: '1' }),
      /model_tools_manage is not a function/,
    )
    assert.equal(calls.includes('model_tools_manage'), false, 'the excluded binding must never be dispatched')
  })

  it('a plan-shaped value does not implicitly dispatch a tool (CODE-12)', async () => {
    const { ctx, runtime } = await liveRuntime()
    const { bindings, calls } = fixtureTools()
    const runner = createProgramRunner({
      context: ctx as unknown as PtcHostContext,
      backend: loaded.backend,
      grant: () => ['double_it'],
      visible: () => ['double_it'],
      resolve: name => bindings[name],
      runtime: () => runtime as unknown as ProgramRuntime,
      operatorGranted: () => true,
    })
    const report = await serveProgram({
      description: 'return a plan-shaped value without dispatching it',
      code: `
        const plan = { tool: 'double_it', arguments: { n: 21 } };
        return plan;
      `,
      tools: ['double_it'],
    }, runner, { receiptId: 'rcpt_plan', catalogRevision: '1' })
    assert.deepEqual(calls, [], 'no implicit dispatch is allowed from a plan-shaped value')
    assert.deepEqual(report.result, { tool: 'double_it', arguments: { n: 21 } })
  })
})

