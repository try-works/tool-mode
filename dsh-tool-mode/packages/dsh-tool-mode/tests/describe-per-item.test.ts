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

describe('R8 — describe carries verifiability and an honest output shape', () => {
  it('reports the aggregate claim, perItem, and a non-empty output schema', async () => {
    const ctx = await mountHost(tempDir())
    const session = 'r8-session'
    const defined = await callAs(ctx, 'tool_mode_tools', {
      action: 'define',
      name: 'agent_per_item',
      description: 'Count languages per text.',
      verifiability: 'aggregate',
      perItem: true,
      inputSchema: { type: 'object', properties: { texts: { type: 'array', items: { type: 'string' } } }, required: ['texts'] },
      program: 'return input.texts.map((text) => ({ text, shown: true }))',
      tools: [],
      scope: 'workspace',
    }, session)
    assert.equal(defined.isError, false, textOf(defined))

    const described = await callAs(ctx, 'tool_mode_describe', { tools: ['agent_per_item'] }, session)
    assert.equal(described.isError, false, textOf(described))
    const row = ((described as unknown as { value: { tools?: Record<string, unknown>[] } }).value?.tools ?? [])[0] ?? {}
    assert.equal(row['verifiability'], 'aggregate', JSON.stringify(row))
    assert.equal(row['perItem'], true, JSON.stringify(row))
    const outputSchema = row['outputSchema'] as Record<string, unknown>
    assert.equal(typeof outputSchema?.['description'], 'string', 'an empty {} reads as "nothing comes back": ' + JSON.stringify(row))
    assert.match(String(outputSchema['description']), /labelled row/)
  })
})

describe('R11 — the declared perItem mode is a validated one-call contract', () => {
  it('returns one labelled row per item, refuses mismatches and undeclared modes', async () => {
    const ctx = await mountHost(tempDir())
    const session = 'r11-session'
    await callAs(ctx, 'tool_mode_tools', {
      action: 'define',
      name: 'agent_per_item_run',
      description: 'Count languages per text.',
      verifiability: 'aggregate',
      perItem: true,
      inputSchema: { type: 'object', properties: { texts: { type: 'array', items: { type: 'string' } } }, required: ['texts'] },
      program: 'return input.texts.map((text) => ({ text, shown: true }))',
      tools: [],
      scope: 'workspace',
    }, session)

    const ok = await callAs(ctx, 'agent_per_item_run', { texts: ['a', 'b'], perItem: true }, session)
    assert.equal(ok.isError, false, textOf(ok))
    assert.deepEqual((ok as unknown as { value: unknown[] }).value, [{ text: 'a', shown: true }, { text: 'b', shown: true }])

    await callAs(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_per_item_bad', description: 'Returns the wrong row count.',
      verifiability: 'aggregate', perItem: true,
      inputSchema: { type: 'object', properties: { texts: { type: 'array', items: { type: 'string' } } } },
      program: 'return [{ label: "a" }, { label: "b" }]', tools: [], scope: 'workspace',
    }, session)
    const mismatch = await callAs(ctx, 'agent_per_item_bad', { texts: ['a', 'b', 'c'], perItem: true }, session)
    assert.equal(mismatch.isError, true)
    assert.match(textOf(mismatch), /3 input item\(s\)|returned 2 row/, textOf(mismatch))

    const plain = await callAs(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_no_per_item', description: 'No mode.',
      inputSchema: { type: 'object', properties: { texts: { type: 'array', items: { type: 'string' } } } },
      program: 'return input.texts.length', tools: [], scope: 'workspace',
    }, session)
    assert.equal(plain.isError, false, textOf(plain))
    const undeclared = await callAs(ctx, 'agent_no_per_item', { texts: ['a'], perItem: true }, session)
    assert.equal(undeclared.isError, true)
    assert.match(textOf(undeclared), /does not declare perItem mode/, textOf(undeclared))

    const service = ctx.get('systemPrompt') as {
      assemble(context?: { agent?: { id: string } }): Promise<{ sections: { name: string; text: string }[] }>
    } | undefined
    assert.ok(service)
    const assembly = await service.assemble({ agent: { id: session } } as never)
    const digest = assembly.sections.find(section => section.name === 'tool-mode:library')?.text ?? ''
    assert.match(digest, /agent_per_item_run using perItem: true/, 'the digest must name the declared one-call route: ' + digest)
  })
})
