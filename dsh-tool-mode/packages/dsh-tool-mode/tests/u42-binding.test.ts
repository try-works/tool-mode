/**
 * U42 — a declared-but-unbindable authored tool must not linger in the binding snapshot.
 *
 * The observed failure: a subagent's declared bindings named an `agent_from_draft_*` tool
 * that was absent from the session library; the call failed with "the program requested
 * tools it cannot bind". The registration (which writes the schema/binding snapshot) and
 * the authoring row (which preflight resolves against) had drifted apart: releasing the
 * session removed the ROW but not the REGISTRATION, so the host kept advertising a name
 * dispatch could no longer resolve.
 *
 * The invariant these tests pin: after a row is released, its name is ABSENT from the
 * registry snapshot; while any visible copy survives, the name stays registered and
 * bindable. The preflight refusal itself is untouched.
 *
 * @module tests/u42-binding
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

function callAs(ctx: Context, name: string, args: unknown, sessionId: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`u42-${++counter}`),
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

/** Names the registry currently advertises (the schema/binding snapshot). */
function registeredNames(ctx: Context): string[] {
  return ctx.tools.schemas().map(schema => schema.name)
}

/** One preflight row as probe:true reports it. */
interface PreflightRow {
  readonly name: string
  readonly resolved: boolean
  readonly reason?: string
}

async function probe(ctx: Context, name: string, sessionId: string): Promise<PreflightRow> {
  const listed = await ok(ctx, 'tool_mode_run', { probe: true, tools: [name] }, sessionId) as {
    preflight?: PreflightRow[]
  }
  const row = listed.preflight?.[0]
  assert.ok(row !== undefined, 'probe must report one row per declared name')
  return row
}

async function releaseSession(ctx: Context, sessionId: string): Promise<void> {
  ctx.emit('session/disposed' as never, { header: { id: sessionId } } as never)
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('U42 — registration and binding source share one snapshot', () => {
  it('withdraws a released session DRAFT from the advertised bindings (the phantom)', async () => {
    const ctx = await mountHost()
    // A successful run auto-keeps a session draft under agent_from_draft_<hash>.
    await ok(ctx, 'tool_mode_run', { code: 'return 1', tools: [] }, 'session-a')
    const authored = await ok(ctx, 'tool_mode_list', {}, 'session-a') as {
      authoring?: { tools?: { name: string }[] }
    }
    const draft = (authored.authoring?.tools ?? []).map(tool => tool.name).find(name => name.startsWith('agent_from_draft_'))
    assert.ok(draft !== undefined, 'the successful run must have left a session draft')

    assert.equal(registeredNames(ctx).includes(draft), true, 'the draft is registered while its row exists')
    assert.equal((await probe(ctx, draft, 'session-a')).resolved, true)

    // Releasing the root session removes the ROW. The REGISTRATION must go with it.
    await releaseSession(ctx, 'session-a')
    const after = await ok(ctx, 'tool_mode_list', {}, 'session-a') as {
      authoring?: { tools?: { name: string }[] }
    }
    assert.equal(
      (after.authoring?.tools ?? []).some(tool => tool.name === draft),
      false,
      'the released draft is gone from the library',
    )
    assert.equal(
      registeredNames(ctx).includes(draft),
      false,
      'a released row must be ABSENT from the binding snapshot, not advertised-but-unbindable',
    )
    const refusal = await probe(ctx, draft, 'session-a')
    assert.equal(refusal.resolved, false)
    assert.equal(
      refusal.reason,
      'not-registered',
      'preflight must refuse an absent name as not-registered (the refusal is not weakened)',
    )
  })

  it('withdraws a released session TOOL (kept row), not only drafts', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_u42_keep', description: 'Kept probe.',
      inputSchema: { type: 'object', properties: {} }, program: 'return 1', tools: [],
    }, 'session-a')
    assert.equal(registeredNames(ctx).includes('agent_u42_keep'), true)

    await releaseSession(ctx, 'session-a')
    assert.equal(
      registeredNames(ctx).includes('agent_u42_keep'),
      false,
      'an expired kept session tool must not stay advertised either',
    )
  })

  it('keeps a name registered while a WORKSPACE copy still answers it', async () => {
    const ctx = await mountHost()
    await ok(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_u42_copy', description: 'Copy probe.',
      inputSchema: { type: 'object', properties: {} }, program: 'return 1', tools: [],
    }, 'session-a')
    await ok(ctx, 'tool_mode_tools', {
      action: 'promote', name: 'agent_u42_copy', to: 'workspace', force: true,
    }, 'session-a')

    await releaseSession(ctx, 'session-a')
    assert.equal(
      registeredNames(ctx).includes('agent_u42_copy'),
      true,
      'a surviving workspace copy must keep the name registered',
    )
    const row = await probe(ctx, 'agent_u42_copy', 'session-a')
    assert.equal(row.resolved, true, 'and the surviving copy must still be bindable')
  })
})
