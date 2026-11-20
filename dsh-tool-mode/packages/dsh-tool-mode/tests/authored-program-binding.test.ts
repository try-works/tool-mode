/**
 * R1 (plan Phase 1, R1-A): authored artifacts must bind inside `tool_mode_run`.
 *
 * The 0.5.106 report's three calls — the authored tool, the stored workflow name, and the
 * `workflow_*` spelling — all refused with "the program requested tools it cannot bind".
 * This suite pins the acceptance: `probe:true` resolves the authored names, all three call
 * forms return the fixture result, and a workflow whose program binds another authored
 * artifact runs (the nested binding path, not only top-level preflight).
 *
 * @module tests/authored-program-binding
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this suite is the registry/tool-result boundary; tool results and runtime reports are unknown values cast to the row under test. */

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
import { cleanup, tempDir } from './helpers.ts'

process.env['DSH_PTC_CONFINEMENT_SEAM'] = 'open-for-acceptance-test'
setConfinementDemonstratedForTest(false)

const contexts: Context[] = []
let counter = 0

after(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  setConfinementDemonstratedForTest(false)
  await cleanup()
})

/** In-process PTC stand-in: the real binding plumbing, no sandbox. */
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

async function mountHost(): Promise<Context> {
  const dir = tempDir()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, fakeRuntime())
  ctx.provide('sessions' as never, {
    get(id: string) { return { header: { id, cwd: dir } } },
  } as never)
  setConfinementDemonstratedForTest(true)
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile: join(dir, 'agent-authoring.json'),
    artifactScopes: {
      enabled: true, defaultScope: 'session', workspaceRoot: dir,
      globalPromotion: 'human', promoteMinUses: 2, expireSessionArtifacts: true,
    },
    hostedCode: true,
  } as never)
  contexts.push(ctx)
  return ctx
}

function callAs(ctx: Context, name: string, args: unknown, sessionId = 'session-a') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`authored-binding-${++counter}`),
    name,
    arguments: args,
    agent: { id: sessionId } as never,
  } as never)
}

async function ok(ctx: Context, name: string, args: unknown, sessionId = 'session-a') {
  const result = await callAs(ctx, name, args, sessionId)
  if (result.isError) throw new Error(`${name} failed: ${result.error?.message ?? 'unknown'}`)
  return (result as { value: unknown }).value
}

const TEXTS = ['Dziękuję', 'Kiitos']
const EXPECTED = { counts: { pl: 1, fi: 1 }, total: 2 }
const INPUT_SCHEMA = {
  type: 'object',
  properties: { texts: { type: 'array', items: { type: 'string' } } },
  required: ['texts'],
}
const COUNT_PROGRAM = [
  'const counts = { pl: 0, fi: 0 }',
  'for (const text of input.texts) {',
  "  if (text === 'Dziękuję') counts.pl += 1",
  "  if (text === 'Kiitos') counts.fi += 1",
  '}',
  'return { counts, total: counts.pl + counts.fi }',
].join('\n')

/** The plan's fixture: a freshly defined authored tool and a saved workflow that calls it. */
async function seedFixture(ctx: Context): Promise<void> {
  await ok(ctx, 'tool_mode_tools', {
    action: 'define',
    name: 'agent_counts',
    description: 'Count languages in a list of texts.',
    inputSchema: INPUT_SCHEMA,
    program: COUNT_PROGRAM,
    tools: [],
  })
  await ok(ctx, 'tool_mode_workflows', {
    action: 'save',
    name: 'g1_lang_counts',
    description: 'Count languages through agent_counts.',
    program: 'return await agent_counts({ texts: input.texts })',
    tools: ['agent_counts'],
    inputSchema: INPUT_SCHEMA,
    scope: 'workspace',
  })
}

/** One preflight row as probe:true reports it. */
interface PreflightRow {
  readonly name: string
  readonly resolved: boolean
  readonly reason?: string
  readonly action?: string
}

async function probe(ctx: Context, names: readonly string[]): Promise<PreflightRow[]> {
  const listed = await ok(ctx, 'tool_mode_run', { probe: true, tools: names }) as { preflight?: PreflightRow[] }
  return listed.preflight ?? []
}

/** One program run's structured result. */
async function runProgram(ctx: Context, tools: readonly string[], code: string): Promise<unknown> {
  const result = await callAs(ctx, 'tool_mode_run', { tools, code }) as { value?: { result?: unknown } }
  return result.value?.result
}

describe('R1-A — authored tool and workflow bind inside tool_mode_run', () => {
  it('resolves the authored tool and the callable workflow spelling in preflight', async () => {
    const ctx = await mountHost()
    await seedFixture(ctx)
    const rows = await probe(ctx, ['agent_counts', 'workflow_g1_lang_counts'])
    assert.deepEqual(rows.map(row => [row.name, row.resolved]), [
      ['agent_counts', true],
      ['workflow_g1_lang_counts', true],
    ])
  })

  it('runs the authored tool directly inside a program', async () => {
    const ctx = await mountHost()
    await seedFixture(ctx)
    const result = await runProgram(ctx, ['agent_counts'], `return await agent_counts({ texts: ${JSON.stringify(TEXTS)} })`)
    assert.deepEqual(result, EXPECTED)
  })

  it('runs the stored workflow under its STORED name inside a program', async () => {
    const ctx = await mountHost()
    await seedFixture(ctx)
    // The report's second call: the digest names the workflow, and the agent passes that
    // name. It must bind and run, not refuse.
    const rows = await probe(ctx, ['g1_lang_counts'])
    assert.deepEqual(rows.map(row => [row.name, row.resolved]), [['g1_lang_counts', true]])
    const result = await runProgram(ctx, ['g1_lang_counts'], `return await g1_lang_counts({ texts: ${JSON.stringify(TEXTS)} })`)
    assert.deepEqual(result, EXPECTED)
  })

  it('runs the stored workflow under the workflow_* spelling inside a program', async () => {
    const ctx = await mountHost()
    await seedFixture(ctx)
    const result = await runProgram(
      ctx,
      ['workflow_g1_lang_counts'],
      `return await workflow_g1_lang_counts({ texts: ${JSON.stringify(TEXTS)} })`,
    )
    assert.deepEqual(result, EXPECTED)
  })

  it('runs a workflow whose program binds ANOTHER authored workflow (nested binding)', async () => {
    const ctx = await mountHost()
    await seedFixture(ctx)
    // g2_outer -> workflow_g1_lang_counts -> agent_counts: two nested authored bindings.
    await ok(ctx, 'tool_mode_workflows', {
      action: 'save',
      name: 'g2_outer',
      description: 'Outer workflow binding the inner workflow and its tool.',
      program: 'return await workflow_g1_lang_counts({ texts: input.texts })',
      tools: ['workflow_g1_lang_counts'],
      inputSchema: INPUT_SCHEMA,
      scope: 'workspace',
    })
    const result = await runProgram(
      ctx,
      ['workflow_g2_outer'],
      `return await workflow_g2_outer({ texts: ${JSON.stringify(TEXTS)} })`,
    )
    assert.deepEqual(result, EXPECTED)
  })

  it('still refuses a genuinely absent name, with a named reason and action', async () => {
    const ctx = await mountHost()
    await seedFixture(ctx)
    const rows = await probe(ctx, ['nonexistent_thing'])
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.resolved, false)
    assert.equal(rows[0]?.reason, 'not-registered')
    assert.ok((rows[0]?.action ?? '').length > 0)
    const refused = await callAs(ctx, 'tool_mode_run', {
      tools: ['nonexistent_thing'], code: 'return 1',
    })
    assert.equal(refused.isError, true)
    assert.match(refused.error?.message ?? '', /nonexistent_thing/)
  })
})
