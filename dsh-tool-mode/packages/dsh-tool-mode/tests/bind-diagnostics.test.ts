/**
 * R4b (plan Phase 4, list half): authored-row `bindable` must be the SAME answer
 * the binding preflight gives.
 *
 * `tool_mode_list` advertises authored tools and workflows under
 * `authoring.tools`/`authoring.workflows`. A caller deciding whether a name can go
 * into a program reads that row; if the row omitted `bindable` — or disagreed
 * with `tool_mode_run({probe:true})` — the caller learns the answer only by
 * provoking a refusal (the reported R4 failure).
 *
 * These tests pin the agreement, including a FALSE row, and prove the row value
 * comes from the binding resolver rather than a second predicate.
 *
 * @module tests/bind-diagnostics
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this suite is the tool-result boundary; probe and list results are unknown values cast to the rows under test. */

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

/** In-process PTC stand-in: real binding plumbing, no sandbox. */
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

async function mountHost(confidentialTools: readonly string[] = []): Promise<Context> {
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
    ...confidentialTools.length === 0 ? {} : { confidentialTools: [...confidentialTools] },
  } as never)
  contexts.push(ctx)
  return ctx
}

function callAs(ctx: Context, name: string, args: unknown, sessionId = 'session-a') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`bind-diagnostics-${++counter}`),
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

/** One preflight row as probe:true reports it. */
interface PreflightRow {
  readonly name: string
  readonly resolved: boolean
  readonly reason?: string
  readonly action?: string
}

/** One authored row as tool_mode_list advertises it. */
interface AuthoredRow {
  readonly name: string
  readonly bindable?: boolean
  readonly [key: string]: unknown
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: { value: { type: 'integer' } },
  required: ['value'],
}

/** Define one authored tool, the artifact a caller asks list about. */
async function defineTool(ctx: Context, name: string): Promise<void> {
  await ok(ctx, 'tool_mode_tools', {
    action: 'define',
    name,
    description: 'Identity program for the bindable list test.',
    inputSchema: INPUT_SCHEMA,
    program: 'return input',
    tools: [],
  })
}

/** Save one authored workflow under a stored name; it is callable as workflow_<name>. */
async function saveWorkflow(ctx: Context, name: string): Promise<void> {
  await ok(ctx, 'tool_mode_workflows', {
    action: 'save',
    name,
    description: 'Identity workflow for the bindable list test.',
    program: 'return input',
    tools: [],
    inputSchema: INPUT_SCHEMA,
    scope: 'workspace',
  })
}

async function probe(ctx: Context, name: string): Promise<PreflightRow> {
  const result = await ok(ctx, 'tool_mode_run', { probe: true, tools: [name] }) as { preflight?: PreflightRow[] }
  const row = result.preflight?.[0]
  assert.ok(row !== undefined, `probe must answer for ${name}`)
  return row
}

/** Find one authoring row under the tool or workflow kind. */
function authoringRow(
  listed: { authoring?: { tools?: AuthoredRow[]; workflows?: AuthoredRow[] } },
  kind: 'tools' | 'workflows',
  name: string,
): AuthoredRow {
  const rows = listed.authoring?.[kind] ?? []
  const row = rows.find(candidate => candidate.name === name)
  assert.ok(row !== undefined, `tool_mode_list authoring.${kind} must include ${name}`)
  return row
}

describe('R4b — authored list rows carry the probe\'s bindable answer', () => {
  it('an authored TOOL row carries bindable:true and probe resolves it', async () => {
    const ctx = await mountHost()
    await defineTool(ctx, 'agent_bind_list')
    const listed = await ok(ctx, 'tool_mode_list', {}) as {
      tools?: AuthoredRow[]
      authoring?: { tools?: AuthoredRow[]; workflows?: AuthoredRow[] }
    }
    const row = authoringRow(listed, 'tools', 'agent_bind_list')
    assert.equal(typeof row.bindable, 'boolean', 'the authored tool row must carry the bindable bit')
    const probed = await probe(ctx, 'agent_bind_list')
    assert.equal(probed.resolved, true)
    assert.equal(row.bindable, probed.resolved, 'list authoring.tools bindable must equal the preflight answer')
    const topLevel = (listed.tools ?? []).find(candidate => candidate.name === 'agent_bind_list')
    assert.equal(topLevel?.bindable, probed.resolved, 'the top-level tools row must agree with the preflight')
  })

  it('an authored WORKFLOW row carries bindable:true and probe resolves workflow_<name>', async () => {
    const ctx = await mountHost()
    await saveWorkflow(ctx, 'bind_flow')
    const listed = await ok(ctx, 'tool_mode_list', {}) as {
      tools?: AuthoredRow[]
      authoring?: { tools?: AuthoredRow[]; workflows?: AuthoredRow[] }
    }
    const row = authoringRow(listed, 'workflows', 'bind_flow')
    assert.equal(typeof row.bindable, 'boolean', 'the authored workflow row must carry the bindable bit')
    const probed = await probe(ctx, 'workflow_bind_flow')
    assert.equal(probed.resolved, true)
    assert.equal(row.bindable, probed.resolved, 'list authoring.workflows bindable must equal the preflight answer')
    // The stored name and the callable spelling both resolve; the row's bindable was
    // derived from the callable spelling, so the plan's tools:[name] form must agree too.
    const storedProbe = await probe(ctx, 'bind_flow')
    assert.equal(storedProbe.resolved, true)
    assert.equal(row.bindable, storedProbe.resolved, 'the stored workflow name must give the same answer')
    const topLevel = (listed.tools ?? []).find(candidate => candidate.name === 'workflow_bind_flow')
    assert.equal(topLevel?.bindable, probed.resolved, 'the top-level workflow tools row must agree')
  })

  it('every authored row carries a boolean bindable bit, not only the rows under test', async () => {
    const ctx = await mountHost()
    await defineTool(ctx, 'agent_bind_list')
    await saveWorkflow(ctx, 'bind_flow')
    const listed = await ok(ctx, 'tool_mode_list', {}) as { authoring?: { tools?: AuthoredRow[]; workflows?: AuthoredRow[] } }
    const rows = [...(listed.authoring?.tools ?? []), ...(listed.authoring?.workflows ?? [])]
    assert.ok(rows.length >= 2, 'the fixture must be listed')
    for (const row of rows) {
      assert.equal(typeof row.bindable, 'boolean', `authoring row ${row.name} must carry bindable`)
    }
  })

  it('a NON-bindable authored TOOL row reports false, matching the refused probe', async () => {
    const ctx = await mountHost(['agent_bind_blocked'])
    await defineTool(ctx, 'agent_bind_blocked')
    const listed = await ok(ctx, 'tool_mode_list', {}) as {
      tools?: AuthoredRow[]
      authoring?: { tools?: AuthoredRow[]; workflows?: AuthoredRow[] }
    }
    const row = authoringRow(listed, 'tools', 'agent_bind_blocked')
    const probed = await probe(ctx, 'agent_bind_blocked')
    assert.equal(probed.resolved, false)
    assert.equal(probed.reason, 'confidential')
    assert.equal(row.bindable, false, 'a refused authored name must not be advertised as bindable')
    assert.equal(row.bindable, probed.resolved, 'the false answer must also come from the resolver')
    const topLevel = (listed.tools ?? []).find(candidate => candidate.name === 'agent_bind_blocked')
    assert.equal(topLevel?.bindable, false, 'the top-level row must refuse it too')
  })
  it('a refused bind names the name, the reason class and the action in the refusal TEXT', async () => {
    const ctx = await mountHost()
    const refused = await callAs(ctx, 'tool_mode_run', {
      tools: ['nonexistent_thing'],
      code: 'return 1',
    })
    assert.equal(refused.isError, true, 'an unresolved declared name must refuse the program')
    const message = (refused as { error?: { message?: string } }).error?.message ?? ''
    assert.match(message, /nonexistent_thing/, 'the refusal must quote the exact declared name')
    assert.match(message, /not-registered/, 'the refusal must name the reason class')
    assert.match(message, /Install or activate the tool/, 'the refusal must carry the resolver action')
    assert.match(message, /session/, 'the refusal must name the caller scope')
  })
})
