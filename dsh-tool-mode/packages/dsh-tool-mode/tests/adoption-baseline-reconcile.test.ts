/**
 * Phase 0 reconciliation (adoption-improvement-plan.md): reproduce or refute the
 * internal findings against THIS build, before changing any behaviour.
 *
 * Each block maps one reported issue to an executable observation. A block that passes
 * refutes the report for this build (it stays as a regression test); a block that failed
 * was moved to the phase that owned the fix (task-65) and is now unskipped: the receipt
 * tree and the root-session reach landed in af70dbb, and every block below runs.
 *
 * @module tests/adoption-baseline-reconcile
 */

/*
 * This suite is the registry/receipt boundary: tool results are `unknown` and are cast
 * to the row under test, and the fake PTC runtime takes untyped values by design.
 */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: the fake runtime is the same in-process stand-in the neighbouring receipt suites use, and an absent optional config field must be OMITTED under exactOptionalPropertyTypes. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import * as plugin from '../src/index.ts'
import { PTC_SERVICE, setConfinementDemonstratedForTest } from '../src/ptc-runtime.ts'
import type { ProgramRuntime } from '../src/tool-mode-run.ts'
import { cleanup, installTongueFixture, tempDir } from './helpers.ts'

process.env['DSH_PTC_CONFINEMENT_SEAM'] = 'open-for-acceptance-test'
setConfinementDemonstratedForTest(false)

const contexts: Context[] = []
let counter = 0

after(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  setConfinementDemonstratedForTest(false)
  await cleanup()
})

/** The in-process PTC stand-in: real binding plumbing, no sandbox. */
function fakeRuntime(): ProgramRuntime {
  return {
    resolve: request => request,
    async run(spec) {
      const request = spec as {
        program?: unknown
        bindings?: readonly { global: string; functions: Record<string, (args: unknown) => Promise<unknown>> }[]
      }
      const namespaces = Array.isArray(request.bindings) ? request.bindings : []
      const values = namespaces.map(namespace => {
        const api: Record<string, unknown> = {}
        for (const [name, fn] of Object.entries(namespace.functions)) api[name] = (args: unknown) => fn(args)
        return api
      })
      const body = typeof request.program === 'string' ? request.program : ''
      try {
        const evaluate = new Function(...namespaces.map(n => n.global), `return (async () => { ${body} })()`)
        return { value: await evaluate(...values), logs: [] }
      } catch (error) {
        return { error: { kind: 'exception', message: error instanceof Error ? error.message : String(error) } }
      }
    },
  } as unknown as ProgramRuntime
}

/** Mount the plugin with scoping on, an isolated authoring file and optional sessions. */
async function mountHost(options: {
  readonly tongue?: boolean
  readonly gateOpen?: boolean
  readonly parents?: Readonly<Record<string, string>>
} = {}): Promise<Context> {
  const dir = tempDir()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, fakeRuntime())
  if (options.parents !== undefined) {
    ctx.provide('sessions' as never, {
      get(id: string) {
        const parent = options.parents?.[id]
        return { header: { id, ...parent === undefined ? {} : { parentSession: parent } } }
      },
    } as never)
  }
  if (options.gateOpen === true) setConfinementDemonstratedForTest(true)
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile: join(dir, 'agent-authoring.json'),
    artifactScopes: {
      enabled: true,
      defaultScope: 'session',
      workspaceRoot: dir,
      globalPromotion: 'human',
      promoteMinUses: 2,
      expireSessionArtifacts: true,
    },
    hostedCode: options.gateOpen === true,
    ...options.tongue === true ? { extensionStore: await installTongueFixture() } : {},
  } as never)
  contexts.push(ctx)
  return ctx
}

function callAs(ctx: Context, name: string, args: unknown, sessionId: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`adoption-reconcile-${++counter}`),
    name,
    arguments: args,
    agent: { id: sessionId } as never,
  } as never)
}

async function ok(ctx: Context, name: string, args: unknown, sessionId: string) {
  const result = await callAs(ctx, name, args, sessionId)
  if (result.isError) throw new Error(`${name} failed: ${result.error?.message ?? 'unknown'}`)
  return (result as { value: unknown }).value
}

/** One receipt row, as the model_tools receipts action publishes it. */
interface ReceiptRow {
  readonly receiptId: string
  readonly contract: string
  readonly kind: string
  readonly parentReceiptId: string | null
  readonly runId: string
  readonly artifactName?: string
  readonly sessionId?: string
  readonly rootSessionId?: string
}

async function receiptsOf(ctx: Context): Promise<ReceiptRow[]> {
  const listed = await ok(ctx, 'model_tools', { action: 'receipts' }, 'session-a')
  return (listed as { receipts: ReceiptRow[] }).receipts
}

const SCHEMA = { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }

describe('Phase 0 — receipts for a direct call and inside a program', () => {
  it('U35 (direct lane, refuted): a top-level model call records exactly one direct receipt', async () => {
    const ctx = await mountHost({ tongue: true })
    await ok(ctx, 'lang_detect', { text: 'hallo wereld' }, 'session-a')
    const rows = (await receiptsOf(ctx)).filter(row => row.contract === 'text.language_detect')
    assert.equal(rows.length, 1, `expected exactly one receipt, saw ${rows.length}`)
    assert.equal(rows[0]?.kind, 'direct')
    assert.equal(rows[0]?.parentReceiptId, null)
    assert.equal(rows[0]?.runId, rows[0]?.receiptId)
  })

  // Was RED before Phase 2 (an orphan `text.language_detect` invocation receipt beside the
  // composition). af70dbb suppressed the nested tool's own receipt, so the assertion now
  // runs unchanged.
  it('U36 (fixed in af70dbb): a call inside a program adds NO second top-level receipt', async () => {
    const ctx = await mountHost({ tongue: true, gateOpen: true })
    const run = await ok(ctx, 'tool_mode_run', {
      code: 'return await lang_detect({ text: "hallo" })',
      tools: ['lang_detect'],
    }, 'session-a')
    assert.ok(run !== undefined)
    const rows = await receiptsOf(ctx)
    const directLane = rows.filter(row => row.contract === 'text.language_detect' && row.kind !== 'nested')
    assert.equal(directLane.length, 0, `a program sub-call must not also appear as a top-level invocation (saw ${directLane.length})`)
    const nested = rows.filter(row => row.kind === 'nested' && row.parentReceiptId !== null)
    assert.equal(nested.length >= 1, true, 'the program trace must still record the sub-call')
  })

  it('U35 (workflow parent, refuted): a direct workflow run leaves a parent workflow receipt', async () => {
    const ctx = await mountHost({ gateOpen: true })
    await ok(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_probe', description: 'Probe.', inputSchema: SCHEMA,
      program: 'return input.value', tools: [],
    }, 'session-a')
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'probe-flow', description: 'Probe flow.',
      program: 'return await agent_probe({ value: "z" })', tools: ['agent_probe'],
    }, 'session-a')
    await ok(ctx, 'workflow_probe_flow', {}, 'session-a')

    const rows = await receiptsOf(ctx)
    const parent = rows.find(row => row.contract === 'workflow.probe-flow')
    assert.ok(parent, 'the workflow run must have its own parent receipt')
    assert.equal(parent.artifactName, 'probe-flow')
    assert.equal(parent.parentReceiptId, null)
    assert.equal(parent.runId, parent.receiptId)
    const children = rows.filter(row => row.parentReceiptId === parent.receiptId)
    assert.ok(children.length >= 1, 'the workflow sub-call must be parented to that receipt')
  })

  // Was RED before Phase 2 (the sub-call's own receipt was orphaned, parent null).
  // af70dbb records exactly one receipt tree for the run.
  it('U35 (children, fixed in af70dbb): the workflow sub-call leaves no orphan receipt of its own', async () => {
    const ctx = await mountHost({ gateOpen: true })
    await ok(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_probe', description: 'Probe.', inputSchema: SCHEMA,
      program: 'return input.value', tools: [],
    }, 'session-a')
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'probe-flow', description: 'Probe flow.',
      program: 'return await agent_probe({ value: "z" })', tools: ['agent_probe'],
    }, 'session-a')
    await ok(ctx, 'workflow_probe_flow', {}, 'session-a')

    const orphans = (await receiptsOf(ctx))
      .filter(row => row.contract === 'agent_probe' && row.parentReceiptId === null)
    assert.equal(orphans.length, 0, `a sub-call must belong to its composition, saw ${orphans.length} orphan receipt(s)`)
  })
})

describe('Phase 0 — session-tree reach (U29)', () => {
  // Was RED before Phase 2 (the ledger keyed by the LEAF session id). af70dbb added the
  // ROOT session's tree reach; `authoring.session.called` stays the leaf-only counter.
  it('U29 (fixed in af70dbb): a subagent call is visible in the ROOT session reach counter', async () => {
    const ctx = await mountHost({ tongue: true, parents: { child: 'root' } })
    await ok(ctx, 'lang_detect', { text: 'hallo wereld' }, 'child')
    const root = await ok(ctx, 'tool_mode_list', {}, 'root') as {
      authoring?: {
        session?: {
          called?: Record<string, number>
          reach?: { called?: Record<string, number>; agents?: Record<string, number> }
        }
      }
    }
    const reach = root.authoring?.session?.reach
    assert.ok(reach, 'the root session must publish its tree reach')
    assert.equal(reach.called?.['lang_detect'], 1, 'the root session must see the subagent call in reach.called')
    assert.equal(reach.agents?.['child'], 1, 'and the call must be attributed to the child that made it')
  })
})

describe('Phase 0 — stored vs callable names', () => {
  it('U37 (list, refuted): list rows carry both the stored and the callable name', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'double-value', program: 'return 1', tools: [] }, 'session-a')
    await ok(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_double', description: 'Double.', inputSchema: SCHEMA, program: 'return 1', tools: [],
    }, 'session-a')
    const listed = await ok(ctx, 'tool_mode_list', {}, 'session-a') as {
      tools: { name: string }[]
      authoring: {
        workflows: { name: string; callableName: string }[]
        tools: { name: string; callableName: string }[]
      }
    }
    const workflow = listed.authoring.workflows.find(row => row.name === 'double-value')
    assert.ok(workflow)
    assert.equal(workflow.callableName, 'workflow_double_value')
    assert.equal(listed.tools.some(row => row.name === 'workflow_double_value'), true, 'the callable workflow must be listed')
    const tool = listed.authoring.tools.find(row => row.name === 'agent_double')
    assert.ok(tool)
    assert.equal(tool.callableName, 'agent_double')
  })

  it('U37 (describe, reproduced): describe reports both spellings it accepts', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_workflows', { action: 'save', name: 'double-value', program: 'return 1', tools: [] }, 'session-a')
    const described = await ok(ctx, 'tool_mode_describe', { tools: ['double-value', 'workflow_double_value'] }, 'session-a') as {
      tools: { name: string; storedName?: string }[]
    }
    const byStored = described.tools[0]
    const byCallable = described.tools[1]
    assert.equal(byStored?.name, 'workflow_double_value')
    assert.equal(byStored?.storedName, 'double-value', 'describe must not lose the stored artifact name')
    assert.equal(byCallable?.storedName, 'double-value')
  })
})
