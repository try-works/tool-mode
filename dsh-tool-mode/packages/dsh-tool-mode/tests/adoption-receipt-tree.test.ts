/**
 * Phase 2 (U29, U35, U36): a receipt tree that can see the session tree.
 *
 * "Looked and declined" and "never looked" must be different observations, and one
 * execution must be ONE receipt tree: a direct call is its own run, a program's sub-call
 * is represented by the composition's nested trace row (not also by a second top-level
 * receipt), and the ROOT session carries the union of its subagents' calls.
 *
 * @module tests/adoption-receipt-tree
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this suite is the registry/receipt JSON boundary (tool results are unknown, the fake PTC runtime takes untyped values), the same justified boundary the neighbouring receipt suites use. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import * as plugin from '../src/index.ts'
import { MAX_RETAINED_RECEIPTS } from '../src/receipt.ts'
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

interface Mounted {
  readonly ctx: Context
  readonly dir: string
}

async function mountHost(options: {
  readonly tongue?: boolean
  readonly gateOpen?: boolean
  readonly parents?: Readonly<Record<string, string>>
} = {}): Promise<Mounted> {
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
      enabled: true, defaultScope: 'session', workspaceRoot: dir,
      globalPromotion: 'human', promoteMinUses: 2, expireSessionArtifacts: true,
    },
    hostedCode: options.gateOpen === true,
    ...options.tongue === true ? { extensionStore: await installTongueFixture() } : {},
  } as never)
  contexts.push(ctx)
  return { ctx, dir }
}

function callAs(ctx: Context, name: string, args: unknown, sessionId: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`adoption-tree-${++counter}`),
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

interface ReceiptRow {
  readonly receiptId: string
  readonly contract: string
  readonly kind: string
  readonly parentReceiptId: string | null
  readonly runId: string
  readonly outcome: string | null
  readonly sessionId?: string
  readonly rootSessionId?: string
  readonly artifactName?: string
  readonly artifactDigest?: string
  readonly callId?: string
}

async function receiptsOf(ctx: Context): Promise<ReceiptRow[]> {
  const listed = await ok(ctx, 'model_tools', { action: 'receipts' }, 'session-a')
  return (listed as { receipts: ReceiptRow[] }).receipts
}

const SCHEMA = { type: 'object', properties: { value: { type: 'string' } } }

async function defineTool(ctx: Context, name: string, program: string): Promise<void> {
  const defined = await callAs(ctx, 'tool_mode_tools', {
    action: 'define', name, description: 'A probe tool.', inputSchema: SCHEMA, program, tools: [],
  }, 'session-a')
  if (defined.isError) throw new Error(`define ${name} failed: ${defined.error?.message ?? 'unknown'}`)
}

describe('Phase 2 — one execution is one receipt tree', () => {
  it('a direct workflow run yields one parent receipt with artifact identity and parented children', async () => {
    const { ctx } = await mountHost({ gateOpen: true })
    await defineTool(ctx, 'agent_probe', 'return input.value')
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'probe-flow', description: 'Probe flow.',
      program: 'return await agent_probe({ value: "z" })', tools: ['agent_probe'],
    }, 'session-a')
    await ok(ctx, 'workflow_probe_flow', {}, 'session-a')

    const rows = await receiptsOf(ctx)
    const parent = rows.find(row => row.contract === 'workflow.probe-flow')
    assert.ok(parent, 'the workflow run must have one parent receipt')
    assert.equal(parent.artifactName, 'probe-flow')
    assert.match(parent.artifactDigest ?? '', /^[0-9a-f]{64}$/)
    assert.equal(parent.runId, parent.receiptId)
    assert.equal(parent.parentReceiptId, null)
    assert.equal(parent.sessionId, 'session-a')
    assert.equal(parent.rootSessionId, 'session-a')

    const children = rows.filter(row => row.parentReceiptId === parent.receiptId)
    assert.ok(children.length >= 1, 'the workflow sub-call must be parented to the parent receipt')
    assert.ok(children.every(row => row.kind === 'nested'), 'children must be the nested trace rows')
    // U35: the sub-call must NOT also leave a second top-level receipt of its own.
    const orphans = rows.filter(row => row.contract === 'agent_probe' && row.parentReceiptId === null)
    assert.equal(orphans.length, 0, `the sub-call left ${orphans.length} orphan receipt(s)`)
  })

  it('a direct model call is one DIRECT receipt; a program call adds only nested receipts', async () => {
    const { ctx } = await mountHost({ tongue: true, gateOpen: true })
    await ok(ctx, 'lang_detect', { text: 'hallo wereld' }, 'session-a')
    await ok(ctx, 'tool_mode_run', {
      code: 'return await lang_detect({ text: "hallo" })', tools: ['lang_detect'],
    }, 'session-a')

    const rows = await receiptsOf(ctx)
    const direct = rows.filter(row => row.contract === 'text.language_detect' && row.kind === 'direct')
    assert.equal(direct.length, 1, 'exactly one direct receipt for the direct call')
    const nonNested = rows.filter(row => row.contract === 'text.language_detect' && row.kind !== 'nested')
    assert.equal(nonNested.length, 1, `a program sub-call must not add a top-level receipt (saw ${nonNested.length - 1})`)
    const composition = rows.find(row => row.contract === 'tool_mode_run')
    assert.ok(composition)
    const nested = rows.filter(row => row.kind === 'nested' && row.parentReceiptId === composition.receiptId)
    assert.ok(nested.length >= 1, 'the program trace must record the sub-call')
  })

  it('discovery calls create discovery receipts', async () => {
    const { ctx } = await mountHost()
    await ok(ctx, 'tool_mode_list', {}, 'session-a')
    await ok(ctx, 'tool_mode_describe', { tools: ['tool_mode_list'] }, 'session-a')
    const rows = (await receiptsOf(ctx)).filter(row => row.kind === 'discovery')
    assert.ok(rows.some(row => row.contract === 'tool_mode_list'), 'tool_mode_list must be a discovery receipt')
    assert.ok(rows.some(row => row.contract === 'tool_mode_describe'), 'tool_mode_describe must be a discovery receipt')
  })

  it('the ROOT session sees two subagents in reach.called with per-agent counts and no arguments', async () => {
    const { ctx } = await mountHost({ tongue: true, parents: { 'child-a': 'root', 'child-b': 'root' } })
    await ok(ctx, 'lang_detect', { text: 'hallo wereld' }, 'child-a')
    await ok(ctx, 'lang_detect', { text: 'bonjour le monde' }, 'child-b')
    const listed = await ok(ctx, 'tool_mode_list', {}, 'root') as {
      authoring?: { session?: { reach?: { called: Record<string, number>; agents: Record<string, number>; total: number } } }
    }
    const reach = listed.authoring?.session?.reach
    assert.ok(reach, 'the root session must publish its tree reach')
    assert.equal(reach.called['lang_detect'], 2, 'the union of both subagents must be visible')
    assert.equal(reach.agents['child-a'], 1, 'per-agent counts must name the child')
    assert.equal(reach.agents['child-b'], 1)
    assert.equal(JSON.stringify(listed.authoring?.session).includes('hallo wereld'), false, 'no argument content may leak')
  })

  it('after 250 unrelated calls the durable uses still equal the artifact runs', async () => {
    const { ctx } = await mountHost({ gateOpen: true })
    await defineTool(ctx, 'agent_counted', 'return 1')
    await ok(ctx, 'agent_counted', {}, 'session-a')
    await ok(ctx, 'agent_counted', {}, 'session-a')
    for (let index = 0; index < 250; index += 1) await ok(ctx, 'tool_mode_list', {}, 'session-a')
    const listed = await ok(ctx, 'tool_mode_list', {}, 'session-a') as {
      authoring: { tools: { name: string; uses: number; sessions: number; failures: number }[] }
    }
    const row = listed.authoring.tools.find(candidate => candidate.name === 'agent_counted')
    assert.ok(row)
    assert.equal(row.uses, 2, 'the durable usage count is not a bounded receipt ring')
    // And the receipt ring itself stayed bounded rather than growing with the churn.
    assert.ok((await receiptsOf(ctx)).length <= MAX_RETAINED_RECEIPTS)
  })

  it('a failed run increments uses and failures, not sessions', async () => {
    const { ctx } = await mountHost({ gateOpen: true })
    await defineTool(ctx, 'agent_boom', 'throw new Error("secret-caller-text")')
    for (let index = 0; index < 2; index += 1) {
      const failed = await callAs(ctx, 'agent_boom', {}, 'session-a')
      assert.equal(failed.isError, true)
    }
    const listed = await ok(ctx, 'tool_mode_list', {}, 'session-a') as {
      authoring: { tools: { name: string; uses: number; sessions: number; failures: number }[] }
    }
    const row = listed.authoring.tools.find(candidate => candidate.name === 'agent_boom')
    assert.ok(row)
    assert.equal(row.uses, 2)
    assert.equal(row.failures, 2)
    assert.equal(row.sessions, 1, 'the same session is one session, not one per failure')
  })

  it('a failed receipt is not lost when the tool throws before returning', async () => {
    const { ctx } = await mountHost({ gateOpen: true })
    await defineTool(ctx, 'agent_throws', 'throw new Error("secret-caller-text")')
    const failed = await callAs(ctx, 'agent_throws', {}, 'session-a')
    assert.equal(failed.isError, true)
    const row = (await receiptsOf(ctx)).find(receipt => receipt.contract === 'agent_throws')
    assert.ok(row, 'a failed composition must still leave a receipt')
    assert.equal(row.outcome, 'failed')
    assert.equal(row.runId, row.receiptId)
    assert.equal(JSON.stringify(row).includes('secret-caller-text'), false, 'no caller content in the receipt')
  })
})
