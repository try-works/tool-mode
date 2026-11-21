/**
 * R12 — receipts carry the CALLING session alongside the root session.
 * @module tests/receipts-caller-session
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this suite is the registry/tool-result boundary; results and receipt rows are unknown values cast to the row under test. */

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
      const request = spec as { program?: unknown; bindings?: readonly { global: string; functions: Record<string, (args: unknown) => Promise<unknown>> }[] }
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

async function mountHost(dir: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, fakeRuntime())
  // leaf-a is a subagent of root-1: scope resolution walks to root-1, the caller stays leaf-a.
  ctx.provide('sessions' as never, {
    get: (id: string) => id === 'leaf-a' ? { header: { parentSession: 'root-1' } } : undefined,
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

function callAs(ctx: Context, name: string, args: unknown, sessionId: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('receipt-' + String(++counter)),
    name,
    arguments: args,
    agent: { id: sessionId } as never,
  } as never)
}

describe('R12 — receipts split by the calling session', () => {
  it('records the leaf caller and the root session separately', async () => {
    const ctx = await mountHost(tempDir())
    const defined = await callAs(ctx, 'tool_mode_tools', {
      action: 'define',
      name: 'agent_receipt_leaf',
      description: 'Counts items.',
      inputSchema: { type: 'object', properties: { texts: { type: 'array', items: { type: 'string' } } } },
      program: 'return { total: input.texts.length }',
      tools: [],
      scope: 'workspace',
    }, 'leaf-a')
    assert.equal(defined.isError, false)

    const run = await callAs(ctx, 'agent_receipt_leaf', { texts: ['a', 'b'] }, 'leaf-a')
    assert.equal(run.isError, false)

    const receipts = await callAs(ctx, 'model_tools', { action: 'receipts' }, 'leaf-a')
    assert.equal(receipts.isError, false)
    const rows = (receipts as unknown as { value: { receipts?: { receiptId?: string; artifactName?: string; sessionId?: string; rootSessionId?: string; kind?: string }[] } }).value?.receipts ?? []
    const row = rows.find(candidate => candidate.artifactName === 'agent_receipt_leaf')
    assert.ok(row, 'the artifact call must have a receipt')
    assert.equal(row.sessionId, 'leaf-a', 'the receipt must name the CALLING session: ' + JSON.stringify(row))
    assert.equal(row.rootSessionId, 'root-1', 'the receipt must keep the ROOT session: ' + JSON.stringify(row))
  })
})
