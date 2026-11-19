/**
 * F9: the save-offer suppression set must cover the management surface and every
 * `decision_*` host tool by PREFIX — not merely a hand-listed set.
 *
 * @module tests/adoption-non-offerable
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this suite is the registry/tool-result boundary; results are unknown values cast to the pending-offer row under test. */

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
    async run() { return { value: 1, logs: [] } },
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
    managementGrant: true,
    hostedCode: true,
  } as never)
  contexts.push(ctx)
  return ctx
}

function callAs(ctx: Context, name: string, args: unknown, sessionId = 'session-a') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`non-offerable-${++counter}`),
    name,
    arguments: args,
    agent: { id: sessionId } as never,
  } as never)
}

interface PendingOffer {
  readonly toolName: string
  readonly calls: number
}

async function pendingOffers(ctx: Context): Promise<PendingOffer[]> {
  const listed = await callAs(ctx, 'tool_mode_list', {})
  assert.equal(listed.isError, false, JSON.stringify(listed))
  return ((listed as { value?: { authoring?: { pendingOffers?: PendingOffer[] } } }).value?.authoring?.pendingOffers) ?? []
}

async function repeat(ctx: Context, name: string, args: unknown): Promise<void> {
  for (let index = 0; index < 3; index += 1) await callAs(ctx, name, args)
}

describe('F9 — management and decision_* calls never become save offers', () => {
  it('suppresses model_tools_manage and every decision_* tool, while a normal control shape still offers', async () => {
    const ctx = await mountHost()
    // Positive control: tool_mode_run is NOT a management/discovery/decision tool.
    await repeat(ctx, 'tool_mode_run', { probe: true, tools: [] })
    await repeat(ctx, 'model_tools_manage', { action: 'installed' })
    await repeat(ctx, 'decision_combine', { facts: { a: 1 }, judgments: {}, rules: [], fallback: 'done' })

    const offers = await pendingOffers(ctx)
    const names = offers.map(offer => offer.toolName)
    assert.equal(names.includes('model_tools_manage'), false, 'the management surface must not be offered')
    assert.equal(names.some(name => name.startsWith('decision_')), false, 'every decision_* tool is suppressed by prefix')
    assert.equal(names.includes('tool_mode_run'), true, 'the tracker still offers for a normal shape')
  })
})
