/**
 * Phase 2 purge (task-65): a root session's tree reach dies with the session and never
 * leaks into another session's counts.
 *
 * @module tests/adoption-receipt-tree-purge
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-runtime-typeof -- SAFETY: this suite is the JSON/registry boundary; the fake PTC runtime and the ledger document are read as untrusted JSON. */

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
    async run() { return { value: 1, logs: [] } },
  } as unknown as ProgramRuntime
}

async function mountHost(dir: string, parents: Readonly<Record<string, string>>): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, fakeRuntime())
  ctx.provide('sessions' as never, {
    get(id: string) {
      const parent = parents[id]
      return { header: { id, ...parent === undefined ? {} : { parentSession: parent } } }
    },
  } as never)
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile: join(dir, 'agent-authoring.json'),
    artifactScopes: {
      enabled: true, defaultScope: 'session', workspaceRoot: dir,
      globalPromotion: 'human', promoteMinUses: 2, expireSessionArtifacts: true,
    },
  } as never)
  contexts.push(ctx)
  return ctx
}

function callAs(ctx: Context, name: string, args: unknown, sessionId: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`adoption-purge-${++counter}`),
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

/** The persisted ledger document, read directly (a call would recreate the row). */
function ledgerSessions(dir: string): Record<string, {
  called?: Record<string, number>
  reach?: { called?: Record<string, number>; agents?: Record<string, number>; total?: number }
}> {
  const parsed = JSON.parse(readFileSync(join(dir, 'session-ledger.json'), 'utf8')) as { sessions: Record<string, never> }
  return parsed.sessions
}

describe('Phase 2 — session-tree purge', () => {
  it("removes a disposed ROOT session's reach and keeps no other session's counts", async () => {
    const dir = tempDir()
    const ctx = await mountHost(dir, { 'child-a': 'root-a', 'child-b': 'root-b' })
    await ok(ctx, 'tool_mode_list', {}, 'child-a')
    await ok(ctx, 'tool_mode_describe', { tools: ['tool_mode_list'] }, 'child-b')

    const before = ledgerSessions(dir)
    assert.equal(before['root-a']?.reach?.called?.['tool_mode_list'], 1)
    assert.equal(before['root-b']?.reach?.called?.['tool_mode_describe'], 1)

    ctx.emit('session/disposed' as never, { header: { id: 'root-a' } } as never)
    const after = ledgerSessions(dir)
    assert.equal(after['root-a'], undefined, "the disposed root's reach row must be removed")
    assert.ok(after['root-b'], "another root's reach must survive")
    assert.equal(after['root-b']?.reach?.called?.['tool_mode_list'], undefined, 'the disposed tree must not leak into another root')

    // A live root still reports only its own tree.
    const listed = await ok(ctx, 'tool_mode_list', {}, 'root-b') as {
      authoring?: { session?: { reach?: { called: Record<string, number>; agents: Record<string, number> } } }
    }
    const reach = listed.authoring?.session?.reach
    assert.ok(reach)
    assert.equal(reach.agents['child-a'], undefined, 'no child of the disposed root may leak into root-b')
    assert.equal(reach.called['tool_mode_describe'], 1)
  })

  it("does not remove a parent root's reach when a LEAF session is disposed", async () => {
    const dir = tempDir()
    const ctx = await mountHost(dir, { 'child-a': 'root-a' })
    await ok(ctx, 'tool_mode_list', {}, 'child-a')
    ctx.emit('session/disposed' as never, { header: { id: 'child-a', parentSession: 'root-a' } } as never)
    const after = ledgerSessions(dir)
    assert.ok(after['root-a'], 'the root owns the tree; a leaf disposal must not remove it')
    assert.equal(after['root-a']?.reach?.called?.['tool_mode_list'], 1)
  })
})
