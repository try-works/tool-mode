/**
 * R14/R15 — evidence-first digest selection and stale-draft cleanup.
 * @module tests/r14-r15
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this suite is the persisted-store/tool-result boundary; results are unknown values cast to the row under test. */

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
import { createAgentAuthoringStore, type ArtifactScopeContext } from '../src/agent-authoring.ts'
import { buildDirectiveDigest } from '../src/library-digest.ts'
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

const GLOBAL: ArtifactScopeContext = { scope: 'global', scopeKey: 'host', workspaceKey: '' }

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
  setConfinementDemonstratedForTest(true)
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile: join(dir, 'agent-authoring.json'),
    artifactScopes: { enabled: true, defaultScope: 'session', workspaceRoot: dir, globalPromotion: 'human', promoteMinUses: 2, expireSessionArtifacts: true },
    hostedCode: true,
  } as never)
  contexts.push(ctx)
  return ctx
}

function callAs(ctx: Context, name: string, args: unknown, sessionId = 'r14-session') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('r14-' + String(++counter)),
    name,
    arguments: args,
    agent: { id: sessionId } as never,
  } as never)
}

function textOf(result: { content?: { type: string; text?: string }[] }): string {
  return (result.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('R14 — the digest primary line prefers evidence', () => {
  it('names the 100-use artifact over a 0-use draft', () => {
    const text = buildDirectiveDigest([
      {
        name: 'fresh_kept', callableName: 'agent_fresh_kept', description: 'Freshly defined artifact.',
        scope: 'workspace', uses: 0, failures: 0,
        lastUsedAt: '2026-11-22T00:00:00.000Z',
      },
      {
        name: 'proven', callableName: 'agent_proven', description: 'Proven artifact.',
        scope: 'workspace', uses: 100, failures: 0,
      },
    ])
    assert.match(text, /^Use agent_proven\b/m, text)
    assert.ok(!/^Use agent_fresh_kept/m.test(text), text)
  })
})

describe('R15 — deleting an artifact leaves no stale wrapper in the digest', () => {
  it('cascades auto-kept drafts that wrapped the deleted artifact', async () => {
    const dir = tempDir()
    const file = join(dir, 'agent-authoring.json')
    const seed = createAgentAuthoringStore({ file })
    seed.saveTool({
      name: 'agent_wrap_target', description: 'Target artifact.',
      inputSchema: { type: 'object', properties: { value: { type: 'integer' } } },
      program: 'return input.value', tools: [],
    }, GLOBAL)
    seed.saveAutoKeep({
      runId: 'run_r15', program: 'return await agent_wrap_target({ value: 1 })',
      tools: ['agent_wrap_target'], inputSchema: { type: 'object', properties: {} },
      description: 'wrapper',
    }, GLOBAL)

    const ctx = await mountHost(dir)
    const deleted = await callAs(ctx, 'tool_mode_tools', { action: 'delete', name: 'agent_wrap_target', scope: 'global' })
    assert.equal(deleted.isError, false, textOf(deleted))

    const stored = JSON.parse(readFileSync(file, 'utf8')) as { tools?: { name?: string; status?: string; tools?: string[] }[] }
    const stale = (stored.tools ?? []).filter(row =>
      row.status === 'draft' && (row.tools ?? []).includes('agent_wrap_target'))
    assert.deepEqual(stale, [], 'the wrapper draft must be removed with its target')
  })

  it('never advertises a draft whose nested tool is gone', async () => {
    const dir = tempDir()
    const file = join(dir, 'agent-authoring.json')
    const seed = createAgentAuthoringStore({ file })
    seed.saveAutoKeep({
      runId: 'run_ghost', program: 'return await ghost_tool({ value: 1 })',
      tools: ['ghost_tool'], inputSchema: { type: 'object', properties: {} },
      description: 'ghost wrapper',
    }, GLOBAL)

    const ctx = await mountHost(dir)
    const service = ctx.get('systemPrompt') as {
      assemble(context?: { agent?: { id: string } }): Promise<{ sections: { name: string; text: string }[] }>
    } | undefined
    assert.ok(service)
    const assembly = await service.assemble({ agent: { id: 'r15-session' } } as never)
    const digest = assembly.sections.find(section => section.name === 'tool-mode:library')?.text ?? ''
    assert.ok(!digest.includes('ghost_tool'), 'a dangling draft must not be advertised: ' + digest)
    assert.ok(!digest.includes('agent_from_draft'), 'a dangling wrapper must not be advertised: ' + digest)
  })
})
