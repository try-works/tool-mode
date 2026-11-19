/**
 * Phase 2 of docs/auto-keep-plan.md: autoKeep selects the storage scope.
 *
 * @module tests/auto-keep-scope
 */

/*
 * This suite is the JSON/registry BOUNDARY: tool results are unknown and are cast to the
 * shape under test, and the fake PTC runtime takes untyped values by design.
 */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof */

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
import { workspaceKeyFor } from '../src/artifact-scope-context.ts'
import { PTC_SERVICE, setConfinementDemonstratedForTest } from '../src/ptc-runtime.ts'
import type { ProgramRuntime } from '../src/tool-mode-run.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

process.env['DSH_PTC_CONFINEMENT_SEAM'] = 'open-for-acceptance-test'
setConfinementDemonstratedForTest(false)

function makeFakeRuntime(): ProgramRuntime {
  return {
    resolve: request => request,
    async run(spec) {
      const request = spec as { program?: unknown; bindings?: readonly { global: string; functions: Record<string, (args: unknown) => Promise<unknown>> }[] }
      const namespaces = Array.isArray(request.bindings) ? request.bindings : []
      const names = namespaces.map(namespace => namespace.global)
      const values = namespaces.map(namespace => {
        const api: Record<string, unknown> = {}
        for (const [name, fn] of Object.entries(namespace.functions)) api[name] = (args: unknown) => fn(args)
        return api
      })
      const body = typeof request.program === 'string' ? request.program : ''
      try {
        const evaluate = new Function(...names, `return (async () => { ${body} })()`)
        return { value: await evaluate(...values), logs: [] }
      } catch (error) {
        return { error: { kind: 'exception', message: error instanceof Error ? error.message : String(error) } }
      }
    },
  }
}

const contexts: Context[] = []
let counter = 0

async function mountHost(
  config: Record<string, unknown> = {},
  dirOverride?: string,
): Promise<{ ctx: Context; authoringFile: string; dir: string }> {
  const dir = dirOverride ?? tempDir()
  const authoringFile = join(dir, 'agent-authoring.json')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, makeFakeRuntime())
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile: authoringFile,
    artifactScopes: { enabled: true, defaultScope: 'session', workspaceRoot: dir },
    hostedCode: true,
    ...config,
  } as plugin.Config)
  contexts.push(ctx)
  return { ctx, authoringFile, dir }
}

async function call(ctx: Context, name: string, args: unknown, sessionId = 'session-scope') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`scope-${++counter}`),
    name,
    arguments: args,
    agent: { id: sessionId },
  } as never)
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function storedTools(authoringFile: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(readFileSync(authoringFile, 'utf8')) as { tools?: unknown }
    return Array.isArray(parsed.tools) ? parsed.tools as Record<string, unknown>[] : []
  } catch {
    return []
  }
}

const RUN = {
  description: 'double an input value',
  code: 'return { doubled: input.value * 2 }',
  tools: [],
  input: { value: 21 },
}

describe('autoKeep scope policy', () => {
  it('defaults to a session draft', async () => {
    const { ctx, authoringFile } = await mountHost()
    const result = await call(ctx, 'tool_mode_run', RUN)
    assert.equal(result.isError, false, textOf(result))
    const draft = storedTools(authoringFile).find(row => row['status'] === 'draft')
    assert.equal(draft?.['scope'], 'session')
  })

  it('off captures only and leaves from-run available', async () => {
    const { ctx, authoringFile } = await mountHost({ adoption: { autoKeep: 'off' } })
    const run = JSON.parse(textOf(await call(ctx, 'tool_mode_run', RUN))) as { runId: string }
    assert.deepEqual(storedTools(authoringFile), [])
    const defined = await call(ctx, 'tool_mode_tools', { action: 'from-run', runId: run.runId })
    assert.equal((JSON.parse(textOf(defined)) as { defined?: boolean }).defined, true)
  })

  it('workspace writes the draft at workspace scope', async () => {
    const { ctx, authoringFile, dir } = await mountHost({ adoption: { autoKeep: 'workspace' } })
    const result = await call(ctx, 'tool_mode_run', RUN)
    assert.equal(result.isError, false, textOf(result))
    const draft = storedTools(authoringFile).find(row => row['status'] === 'draft')
    assert.equal(draft?.['scope'], 'workspace')
    assert.equal(draft?.['scopeKey'], workspaceKeyFor(dir, 'auto'))
  })

  it('a workspace draft is visible to a new session', async () => {
    const first = await mountHost({ adoption: { autoKeep: 'workspace' } })
    await call(first.ctx, 'tool_mode_run', RUN)
    const second = await mountHost({}, first.dir)
    const listed = JSON.parse(textOf(await call(second.ctx, 'tool_mode_tools', { action: 'list' }))) as {
      tools: { name: string; draft?: boolean; scope?: string }[]
    }
    assert.ok(listed.tools.some(row => row.draft === true && row.scope === 'workspace'))
  })

  it('never creates a global draft automatically', async () => {
    const { ctx, authoringFile } = await mountHost({ adoption: { autoKeep: 'workspace' } })
    await call(ctx, 'tool_mode_run', RUN)
    assert.equal(storedTools(authoringFile).some(row => row['scope'] === 'global'), false)
  })
})
