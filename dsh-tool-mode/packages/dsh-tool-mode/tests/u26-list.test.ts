/**
 * U26 reproduction — a promoted workspace row must be LISTABLE.
 *
 * Scenario: a successful run leaves a SESSION draft; the caller promotes it to the
 * workspace with the default keepSource (the session source row survives and still wins
 * normal resolution, so the workspace row is a shadowed row). `tool_mode_tools list
 * {scope:'workspace'}` must still show the workspace row: the explicit scope filter is
 * the documented way to see the row the caller's resolution chain hides.
 *
 * This test is EXPECTED TO FAIL before the U26 fix. It changes no source.
 *
 * @module tests/u26-list
 */

/*
 * This suite is the JSON/registry BOUNDARY: tool results are unknown and are cast to the
 * shape under test, and the fake PTC runtime takes untyped values by design.
 */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof */

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

after(async () => { await cleanup() })

process.env['DSH_PTC_CONFINEMENT_SEAM'] = 'open-for-acceptance-test'
setConfinementDemonstratedForTest(false)

/** The confined runner double: evaluates the program body with the bound namespaces. */
function fakeRuntime(): ProgramRuntime {
  return {
    resolve: request => request,
    async run(spec) {
      const request = spec as {
        program?: unknown
        bindings?: readonly { global: string; functions: Record<string, (args: unknown) => Promise<unknown>> }[]
      }
      const namespaces = Array.isArray(request.bindings) ? request.bindings : []
      const names = namespaces.map(namespace => namespace.global)
      const values = namespaces.map(namespace => {
        const api: Record<string, unknown> = {}
        for (const [name, fn] of Object.entries(namespace.functions)) api[name] = (args: unknown) => fn(args)
        return api
      })
      const body = typeof request.program === 'string' ? request.program : ''
      const fn = new Function(...names, 'input', 'return (async () => { ' + body + ' })()')
      return { value: await fn(...values, { value: 21, text: 'hello' }) }
    },
  } as never
}

const contexts: Context[] = []
let counter = 0

async function mountHost(): Promise<Context> {
  const dir = tempDir()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, fakeRuntime())
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
    },
    hostedCode: true,
  })
  contexts.push(ctx)
  return ctx
}

async function callAs(ctx: Context, name: string, args: unknown, sessionId = 'u26-session') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('u26-' + String(++counter)),
    name,
    arguments: args,
    agent: { id: sessionId },
  } as never)
}

interface ToolRow {
  readonly name: string
  readonly scope: string
  readonly draft?: boolean
  readonly promotedFrom?: { readonly scope: string }
}

interface ListResult {
  readonly tools: readonly ToolRow[]
}

async function ok(ctx: Context, name: string, args: unknown): Promise<unknown> {
  const result = await callAs(ctx, name, args)
  assert.equal(result.isError, false, JSON.stringify(result))
  return (result as { value?: unknown }).value
}

async function listTools(ctx: Context, args: Record<string, unknown>): Promise<ListResult> {
  const value = await ok(ctx, 'tool_mode_tools', { action: 'list', ...args })
  assert.ok(typeof value === 'object' && value !== null, 'list must return an object')
  const rows = (value as { tools?: unknown }).tools
  assert.ok(Array.isArray(rows), 'list must return a tools array')
  return value as ListResult
}

const RUN = {
  description: 'double an input value',
  code: 'return { doubled: input.value * 2 }',
  tools: [],
  input: { value: 21 },
}

describe('U26 — a promoted workspace row is listable by scope', () => {
  it('shows the workspace row while the session draft survives and shadows it', async () => {
    const ctx = await mountHost()

    // 1. A successful run leaves a SESSION draft (auto-keep default).
    const run = await ok(ctx, 'tool_mode_run', RUN)
    assert.ok(typeof run === 'object' && run !== null)
    const sessionRow = (await listTools(ctx, {})).tools.find(row => row.draft === true)
    assert.ok(sessionRow !== undefined, 'a session draft must have been captured')
    assert.equal(sessionRow.scope, 'session')
    const name = sessionRow.name

    // 2. Promote it to the workspace, keeping the session source (keepSource defaults true).
    const promoted = await ok(ctx, 'tool_mode_tools', { action: 'promote', name, to: 'workspace', force: true })
    assert.ok(typeof promoted === 'object' && promoted !== null)
    assert.equal((promoted as { promoted?: unknown }).promoted, true)
    assert.equal((promoted as { tool?: { scope?: string } }).tool?.scope, 'workspace')

    // 3. The session source survives: default resolution still sees the draft row.
    const resolvedAfter = await listTools(ctx, {})
    const surviving = resolvedAfter.tools.find(row => row.name === name)
    assert.ok(surviving !== undefined, 'the kept session source row must survive the promotion')
    assert.equal(surviving.scope, 'session')

    // 4. U26: the explicit workspace scope must reveal the promoted row, even though
    //    resolution hides it behind the surviving session row.
    const workspace = await listTools(ctx, { scope: 'workspace' })
    const promotedRow = workspace.tools.find(row => row.name === name)
    assert.ok(
      promotedRow !== undefined,
      'U26: tool_mode_tools list({scope:"workspace"}) omitted the promoted workspace row; saw: '
        + JSON.stringify(workspace.tools.map(row => ({ name: row.name, scope: row.scope }))),
    )
    assert.equal(promotedRow.scope, 'workspace')
    // The provenance is the FULL PromotedFrom record (scope, scopeKey, version, at, tools,
    // sessionId); assert the identifying fields, not deep equality with a partial object.
    const provenance = promotedRow.promotedFrom as { scope?: string; scopeKey?: string }
    assert.equal(provenance.scope, 'session')
    assert.equal(provenance.scopeKey, 'u26-session')
  })
})
