/**
 * Auto-keep lifecycle corrections found by the live verification note.
 *
 * These pin three defects the first 0.5.98 probe exposed:
 * - a workspace promotion must land in the CALLER's workspace, not the host process cwd;
 * - auto-keep at workspace scope has the same target rule;
 * - an automatic draft carries a digest purpose, and a run that only calls a draft does
 *   not produce another draft (U41: drafts must not self-amplify).
 *
 * @module tests/auto-keep-lifecycle
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
  config: Record<string, unknown>,
  dir: string,
  sessionCwd?: string,
): Promise<{ ctx: Context; authoringFile: string }> {
  const authoringFile = join(dir, 'agent-authoring.json')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  if (sessionCwd !== undefined) {
    ctx.provide('sessions' as never, {
      get: () => ({ header: { cwd: sessionCwd } }),
    } as never)
  }
  ctx.provide(PTC_SERVICE, makeFakeRuntime())
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile: authoringFile,
    artifactScopes: { enabled: true, defaultScope: 'session', workspaceRoot: 'auto' },
    hostedCode: true,
    ...config,
  } as plugin.Config)
  contexts.push(ctx)
  return { ctx, authoringFile }
}

async function call(ctx: Context, name: string, args: unknown, sessionId = 'session-lifecycle') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`lifecycle-${++counter}`),
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

describe('auto-keep lifecycle correction', () => {
  it('promotes the second capture into the caller workspace, not process.cwd()', async () => {
    const hostDir = tempDir()
    const callerDir = tempDir()
    const { ctx, authoringFile } = await mountHost({}, hostDir, callerDir)
    await call(ctx, 'tool_mode_run', RUN)
    await call(ctx, 'tool_mode_run', RUN)
    const rows = storedTools(authoringFile)
    const workspace = rows.find(row => row['scope'] === 'workspace')
    assert.ok(workspace !== undefined, 'the second success promotes to workspace')
    assert.equal(workspace?.['scopeKey'], workspaceKeyFor(callerDir, 'auto'))
    assert.equal(rows.some(row => row['scope'] === 'session'), false, 'the session draft is consumed')
  })

  it('autoKeep workspace writes into the caller workspace', async () => {
    const hostDir = tempDir()
    const callerDir = tempDir()
    const { ctx, authoringFile } = await mountHost({ adoption: { autoKeep: 'workspace' } }, hostDir, callerDir)
    await call(ctx, 'tool_mode_run', RUN)
    const draft = storedTools(authoringFile).find(row => row['status'] === 'draft')
    assert.equal(draft?.['scope'], 'workspace')
    assert.equal(draft?.['scopeKey'], workspaceKeyFor(callerDir, 'auto'))
  })

  it('sets the run description as the automatic draft purpose', async () => {
    const { ctx, authoringFile } = await mountHost({}, tempDir())
    await call(ctx, 'tool_mode_run', RUN)
    const draft = storedTools(authoringFile).find(row => row['status'] === 'draft')
    assert.equal(draft?.['purpose'], RUN.description)
  })

  it('does not create a draft for a run that only calls an existing draft', async () => {
    const { ctx, authoringFile } = await mountHost({}, tempDir())
    await call(ctx, 'tool_mode_run', RUN)
    const first = storedTools(authoringFile).find(row => row['status'] === 'draft')
    assert.ok(first !== undefined)
    const result = await call(ctx, 'tool_mode_run', {
      description: 'call the captured draft',
      code: 'return { ok: true }',
      tools: [String(first?.['name'])],
      input: {},
    })
    assert.equal(result.isError, false, textOf(result))
    const rows = storedTools(authoringFile)
    assert.equal(rows.filter(row => row['status'] === 'draft').length, 1, 'the call does not create another draft')
  })
})
