/**
 * Phase 3 of docs/auto-keep-plan.md: evidence-based workspace persistence.
 *
 * A first successful run stays session-only. A second success with the same content
 * digest creates a workspace draft; a constant/no-input program never does.
 *
 * @module tests/auto-keep-evidence
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

async function mountHost(config: Record<string, unknown> = {}, dirOverride?: string): Promise<{ ctx: Context; authoringFile: string; dir: string }> {
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

async function call(ctx: Context, name: string, args: unknown, sessionId = 'session-evidence') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`evidence-${++counter}`),
    name,
    arguments: args,
    agent: { id: sessionId },
  } as never)
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function storedTools(file: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { tools?: unknown }
    return Array.isArray(parsed.tools) ? parsed.tools as Record<string, unknown>[] : []
  } catch {
    return []
  }
}

const RUN = {
  description: 'double an input value',
  code: 'return { doubled: input.value * 2 }',
  tools: [],
  input: { value: 2 },
}

describe('evidence-based workspace persistence', () => {
  it('a first run stays session-only', async () => {
    const { ctx, authoringFile } = await mountHost()
    await call(ctx, 'tool_mode_run', RUN)
    const rows = storedTools(authoringFile)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.['scope'], 'session')
    assert.equal(rows.some(row => row['scope'] === 'workspace'), false)
  })

  it('a second success with the same content creates a workspace draft', async () => {
    const { ctx, authoringFile } = await mountHost()
    await call(ctx, 'tool_mode_run', RUN)
    await call(ctx, 'tool_mode_run', RUN)
    const rows = storedTools(authoringFile)
    assert.equal(rows.some(row => row['scope'] === 'session'), false, 'the session draft is consumed')
    const workspace = rows.find(row => row['scope'] === 'workspace')
    assert.ok(workspace !== undefined, 'the second success promotes to workspace')
    assert.equal(workspace?.['status'], 'draft')
    assert.equal(typeof workspace?.['expiresAt'], 'string')
  })

  it('a new session can see the workspace draft', async () => {
    const first = await mountHost()
    await call(first.ctx, 'tool_mode_run', RUN)
    await call(first.ctx, 'tool_mode_run', RUN)
    const second = await mountHost({}, first.dir)
    const listed = JSON.parse(textOf(await call(second.ctx, 'tool_mode_tools', { action: 'list' }))) as {
      tools: { name: string; draft?: boolean; scope?: string }[]
    }
    assert.ok(listed.tools.some(row => row.draft === true && row.scope === 'workspace'))
  })

  it('never promotes a constant no-input program', async () => {
    const { ctx, authoringFile } = await mountHost()
    const constant = { description: 'constant', code: 'return { constant: 1 }', tools: [], input: {} }
    await call(ctx, 'tool_mode_run', constant)
    await call(ctx, 'tool_mode_run', constant)
    assert.equal(storedTools(authoringFile).some(row => row['scope'] === 'workspace'), false)
  })

  it('does not promote a failed run', async () => {
    const { ctx, authoringFile } = await mountHost()
    await call(ctx, 'tool_mode_run', RUN)
    await call(ctx, 'tool_mode_run', { ...RUN, code: 'throw new Error("fail")' })
    assert.equal(storedTools(authoringFile).some(row => row['scope'] === 'workspace'), false)
  })
})
