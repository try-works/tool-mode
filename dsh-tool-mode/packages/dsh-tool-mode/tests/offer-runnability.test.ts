/**
 * R5 (0.5.106 fix requirements): an offer either accepts to a RUNNABLE artifact or refuses
 * by name and saves nothing.
 *
 * Regression (0.5.104): repeating `run_code` offered `repeat_run_code` with
 * `tools:['run_code']`; accepting saved a wrapper that failed at run time with
 * "unauthorized: the program requested tools it may not use". `run_code` and
 * `tool_mode_run` are CONTROL tools and are not bindable.
 *
 * This test repeats control-tool shapes, asserts neither the result offer line nor
 * `authoring.pendingOffers` / `authoring.suggestions` advertises them, then accepts the
 * remaining legitimate offer, proves it is bindable, and RUNS the saved artifact.
 *
 * @module tests/offer-runnability
 */

/*
 * This suite is the registry/tool-result BOUNDARY: results are unknown values cast to the
 * rows under test, and the fake PTC runtime takes untyped values by design.
 */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof */

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
import { callTool, cleanup, installTongueFixture, tempDir } from './helpers.ts'

process.env['DSH_PTC_CONFINEMENT_SEAM'] = 'open-for-acceptance-test'
setConfinementDemonstratedForTest(false)

after(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  setConfinementDemonstratedForTest(false)
  await cleanup()
})

const contexts: Context[] = []
let counter = 0

/** The confined runner double: evaluates the body with the namespaces the host supplies. */
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
      return { value: await fn(...values, { text: 'kann ich das haben', value: 21 }), logs: [] }
    },
  } as never
}

async function mountHost(): Promise<Context> {
  const dir = tempDir()
  const extensionStore = await installTongueFixture(dir)
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
    extensionStore,
    managementGrant: true,
    hostedCode: true,
    adoption: { saveOffer: true },
  } as never)
  contexts.push(ctx)
  return ctx
}

function callAs(ctx: Context, name: string, args: unknown, sessionId = 'r5-session') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('r5-' + String(++counter)),
    name,
    arguments: args,
    agent: { id: sessionId },
  } as never)
}

interface OfferRow {
  readonly id: string
  readonly toolName: string
  readonly calls: number
  readonly name: string
  readonly callableName: string
  readonly command: { readonly tool: string; readonly arguments: Record<string, unknown> }
}

interface AuthoringBlock {
  readonly pendingOffers?: readonly OfferRow[]
  readonly suggestions?: readonly { readonly toolName: string; readonly name: string }[]
  readonly tools?: readonly { readonly name: string; readonly status?: string }[]
  readonly workflows?: readonly { readonly name: string; readonly status?: string }[]
  readonly saveOffersAccepted?: number
}

async function authoringOf(ctx: Context): Promise<AuthoringBlock> {
  const listed = await callAs(ctx, 'tool_mode_list', {})
  assert.equal(listed.isError, false, JSON.stringify(listed))
  return ((listed as { value?: { authoring?: AuthoringBlock } }).value?.authoring) ?? {}
}

function textOf(result: { content?: readonly { type: string; text?: string }[] }): string {
  return (result.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

async function enableTongue(ctx: Context): Promise<void> {
  const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
  assert.equal(enabled.isError, false, JSON.stringify(enabled))
}

/** Three identical control-tool calls: the repetition shape the 0.5.104 offer wrapped. */
async function repeatControlCalls(ctx: Context): Promise<{ offerLine: string; names: readonly string[] }> {
  let last = ''
  // tool_mode_run is the control surface that runs programs. Its program lane is not
  // bindable, so a wrapper program calling it would be saved but unable to run.
  for (let index = 0; index < 3; index += 1) {
    const result = await callAs(ctx, 'tool_mode_run', { probe: true, tools: [] })
    assert.equal(result.isError, false, JSON.stringify(result))
    last = textOf(result as never)
  }
  // If the deployment also exposes the historical run_code spelling, repeat it too.
  const names = (ctx.tools.schemas() as readonly { name: string }[]).map(schema => schema.name)
  if (names.includes('run_code')) {
    for (let index = 0; index < 3; index += 1) {
      const result = await callAs(ctx, 'run_code', { code: 'return 1', tools: [] })
      assert.equal(result.isError, false, JSON.stringify(result))
      last = textOf(result as never)
    }
  }
  return { offerLine: last, names }
}

describe('R5 — offers accept to runnable artifacts or refuse by name', () => {
  it('never offers a wrapper around a control tool (tool_mode_run / run_code)', async () => {
    const ctx = await mountHost()
    const { offerLine, names } = await repeatControlCalls(ctx)
    assert.equal(offerLine.includes('Offer:'), false, 'a control-tool shape must not append an offer line')

    const authoring = await authoringOf(ctx)
    const offered = (authoring.pendingOffers ?? []).map(offer => offer.toolName)
    const suggested = (authoring.suggestions ?? []).map(suggestion => suggestion.toolName)
    const control = ['run_code', 'tool_mode_run', 'tool_mode_list', 'tool_mode_describe']
    for (const name of control) {
      if (!names.includes(name)) continue
      assert.equal(offered.includes(name), false, 'pendingOffers must not offer ' + name)
      assert.equal(suggested.includes(name), false, 'authoring.suggestions must not suggest ' + name)
    }
    assert.equal(offered.some(name => name.startsWith('tool_mode_')), false)
    assert.equal(suggested.some(name => name.startsWith('tool_mode_')), false)
    // No accepted artifact may exist: nothing was saved for these shapes.
    assert.equal(authoring.saveOffersAccepted ?? 0, 0)
    assert.deepEqual(authoring.tools ?? [], [])
    assert.deepEqual(authoring.workflows ?? [], [])
  })

  it('accepts the remaining legitimate offer and RUNS the saved artifact', async () => {
    const ctx = await mountHost()
    await enableTongue(ctx)
    for (let index = 0; index < 3; index += 1) {
      const result = await callAs(ctx, 'lang_detect', { text: 'kann ich das haben' })
      assert.equal(result.isError, false, JSON.stringify(result))
    }

    const before = await authoringOf(ctx)
    const offers = before.pendingOffers ?? []
    assert.equal(offers.length, 1, 'exactly one legitimate offer is pending; saw ' + JSON.stringify(offers))
    const offer = offers[0] as OfferRow
    assert.equal(offer.toolName, 'lang_detect')
    assert.equal(offer.command.tool, 'tool_mode_workflows')

    // Acceptance: run the offered one-call command verbatim (plus the description the
    // command schema requires), then prove the saved artifact is a BINDABLE name.
    const saved = await callTool(ctx, 'tool_mode_workflows', {
      ...offer.command.arguments,
      description: 'Saved from the R5 offer.',
      scope: 'workspace',
    })
    assert.equal(saved.isError, false, 'accepting the offered command must save: ' + JSON.stringify(saved))
    const afterSave = await authoringOf(ctx)
    assert.equal(afterSave.pendingOffers?.length, 0, 'acceptance clears the pending offer')
    assert.equal(afterSave.saveOffersAccepted, 1, 'acceptance is counted')

    const probe = await callAs(ctx, 'tool_mode_run', { probe: true, tools: [offer.callableName] })
    assert.equal(probe.isError, false, JSON.stringify(probe))
    const preflight = (probe as { value?: { preflight?: readonly { name: string; resolved: boolean; reason?: string }[] } }).value?.preflight ?? []
    assert.equal(preflight[0]?.resolved, true, 'the accepted artifact must be bindable, not a dead wrapper: ' + JSON.stringify(preflight))

    // RUN the accepted artifact. A failure here is the 0.5.104 defect: the test then
    // requires a NAMED refusal and that nothing was left saved.
    const run = await callAs(ctx, 'tool_mode_workflows', {
      action: 'run',
      name: offer.name,
      input: { text: 'kann ich das haben' },
    })
    if (run.isError) {
      const message = JSON.stringify(run.error ?? run)
      assert.match(message, new RegExp(offer.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'a refusal must name the artifact: ' + message)
      const leftovers = await authoringOf(ctx)
      assert.equal((leftovers.workflows ?? []).some(row => row.name === offer.name), false, 'a refused acceptance must save nothing')
      assert.equal((leftovers.tools ?? []).some(row => row.name === offer.name), false, 'a refused acceptance must save nothing')
      assert.fail('the accepted offer saved an artifact that cannot run: ' + message)
    }
    const value = JSON.stringify((run as { value?: unknown }).value)
    assert.match(value, /language|de|Detected/, 'the accepted artifact must actually run: ' + value)
  })
})
