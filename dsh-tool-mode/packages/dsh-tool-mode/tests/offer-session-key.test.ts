/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this suite is the registry/tool-result boundary; results are unknown values cast to the row under test. */
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
async function mountHost(dir: string, config: Record<string, unknown> = {}): Promise<Context> {
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
    artifactScopes: { enabled: true, defaultScope: 'session', workspaceRoot: dir, globalPromotion: 'human', promoteMinUses: 2, expireSessionArtifacts: true },
    hostedCode: true,
    ...config,
  } as never)
  contexts.push(ctx)
  return ctx
}
function callAs(ctx: Context, name: string, args: unknown, sessionId: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('r8r11-' + String(++counter)),
    name,
    arguments: args,
    agent: { id: sessionId } as never,
  } as never)
}
function textOf(result: { content?: { type: string; text?: string }[] }): string {
  return (result.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('R5 — an offer is stored under the identity the list filters by', () => {
  it('shows a subagent offer and its command defines a bindable artifact', async () => {
    const dir = tempDir()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    ctx.provide(PTC_SERVICE, fakeRuntime())
    ctx.provide('sessions' as never, {
      get: (id: string) => id === 'leaf-offer' ? { header: { parentSession: 'root-offer' } } : undefined,
    } as never)
    setConfinementDemonstratedForTest(true)
    await ctx.plugin(plugin, {
      stateFile: join(dir, 'state.json'),
      credentialsFile: join(dir, 'credentials.json'),
      agentAuthoringFile: join(dir, 'agent-authoring.json'),
      artifactScopes: { enabled: true, defaultScope: 'session', workspaceRoot: dir, globalPromotion: 'human', promoteMinUses: 2, expireSessionArtifacts: true },
      hostedCode: true,
      adoption: { saveOffer: true, maxRepeats: 3 },
    } as never)
    contexts.push(ctx)

    // A bindable authored tool: no extension install needed, and no equivalent wrapper.
    const defined = await callAs(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_repeat_me', description: 'Repeated shape.',
      inputSchema: { type: 'object', properties: { value: { type: 'integer' } } },
      program: 'return input.value', tools: [], scope: 'workspace',
    }, 'leaf-offer')
    assert.equal(defined.isError, false, textOf(defined))
    const args = { value: 2 }
    for (let index = 0; index < 3; index += 1) {
      const called = await callAs(ctx, 'agent_repeat_me', args, 'leaf-offer')
      assert.equal(called.isError, false, textOf(called))
    }
    const listed = await callAs(ctx, 'tool_mode_list', {}, 'leaf-offer')
    assert.equal(listed.isError, false, textOf(listed))
    const authoring = ((listed as unknown as { value: { authoring?: { pendingOffers?: Record<string, unknown>[] } } }).value?.authoring ?? {})
    const offers = authoring.pendingOffers ?? []
    assert.ok(offers.length > 0, 'a subagent offer must be visible to the session tree: ' + JSON.stringify(authoring))
    const offer = offers[0] ?? {}
    const command = offer['command'] as { tool?: string; arguments?: unknown } | undefined
    assert.ok(command?.tool, JSON.stringify(offer))
    const accepted = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('r5-accept'),
      name: String(command?.tool),
      arguments: command?.arguments,
      agent: { id: 'leaf-offer' } as never,
    } as never)
    assert.equal(accepted.isError, false, textOf(accepted))
  })
})
