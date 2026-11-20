/**
 * R2 (plan Phase 2): every artifact the digest advertises must execute exactly as it is
 * named. The 0.5.106 report's digest was program-call syntax over an artifact that refused
 * to bind; this suite pins the fixture digest's top and supporting names through
 * tool_mode_run and requires a result, not a refusal.
 *
 * @module tests/digest-executable
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
import { buildDirectiveDigest } from '../src/library-digest.ts'
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
  } as never)
  contexts.push(ctx)
  return ctx
}

function callAs(ctx: Context, name: string, args: unknown, sessionId = 'session-a') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`digest-executable-${++counter}`),
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

const TEXTS = ['Dziękuję', 'Kiitos']
const EXPECTED = { counts: { pl: 1, fi: 1 }, total: 2 }
const INPUT_SCHEMA = {
  type: 'object',
  properties: { texts: { type: 'array', items: { type: 'string' } } },
  required: ['texts'],
}
const COUNT_PROGRAM = [
  'const counts = { pl: 0, fi: 0 }',
  'for (const text of input.texts) {',
  "  if (text === 'Dziękuję') counts.pl += 1",
  "  if (text === 'Kiitos') counts.fi += 1",
  '}',
  'return { counts, total: counts.pl + counts.fi }',
].join('\n')

async function seed(ctx: Context): Promise<void> {
  await ok(ctx, 'tool_mode_tools', {
    action: 'define',
    name: 'agent_counts',
    description: 'Count languages in a list of texts.',
    inputSchema: INPUT_SCHEMA,
    program: COUNT_PROGRAM,
    tools: [],
    scope: 'workspace',
  })
  await ok(ctx, 'tool_mode_workflows', {
    action: 'save',
    name: 'g1_lang_counts',
    description: 'Count languages through agent_counts.',
    program: 'return await agent_counts({ texts: input.texts })',
    tools: ['agent_counts'],
    inputSchema: INPUT_SCHEMA,
    scope: 'workspace',
  })
}

describe('R2 — the digest advertises only executable artifacts', () => {
  it('executes the top and supporting names the digest prints', async () => {
    const ctx = await mountHost()
    await seed(ctx)
    const digest = buildDirectiveDigest([
      {
        name: 'agent_counts', callableName: 'agent_counts', description: 'Count languages.',
        scope: 'workspace', uses: 8, failures: 0, sessions: 3,
      },
      {
        name: 'g1_lang_counts', callableName: 'workflow_g1_lang_counts',
        description: 'Count languages through a saved workflow.',
        scope: 'workspace', uses: 1, failures: 0, sessions: 1,
      },
    ] as never)
    assert.match(digest, /agent_counts/)
    assert.match(digest, /workflow_g1_lang_counts/)

    for (const advertised of ['agent_counts', 'workflow_g1_lang_counts']) {
      const result = await ok(ctx, 'tool_mode_run', {
        tools: [advertised],
        code: `return await ${advertised}({ texts: ${JSON.stringify(TEXTS)} })`,
      }) as { result?: unknown }
      assert.deepEqual(result.result, EXPECTED, `${advertised} must execute exactly as advertised`)
    }
  })
})
