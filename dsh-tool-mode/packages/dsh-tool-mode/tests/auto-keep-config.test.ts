/**
 * Phase 2 completion: autoDraft is removed and autoKeep is the policy.
 *
 * @module tests/auto-keep-config
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

async function mountHost(config: Record<string, unknown> = {}): Promise<{ ctx: Context; authoringFile: string }> {
  const dir = tempDir()
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
    hostedCode: true,
    ...config,
  } as plugin.Config)
  contexts.push(ctx)
  return { ctx, authoringFile }
}

async function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`config-${++counter}`),
    name,
    arguments: args,
    agent: { id: 'session-config' },
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
  input: { value: 21 },
}

describe('autoKeep config after autoDraft removal', () => {
  it('omitted leaves one session draft', async () => {
    const { ctx, authoringFile } = await mountHost()
    const result = await call(ctx, 'tool_mode_run', RUN)
    assert.equal(result.isError, false, textOf(result))
    assert.equal(storedTools(authoringFile).filter(row => row['status'] === 'draft').length, 1)
  })

  it('autoKeep off captures only and leaves from-run available', async () => {
    const { ctx, authoringFile } = await mountHost({ adoption: { autoKeep: 'off' } })
    const run = JSON.parse(textOf(await call(ctx, 'tool_mode_run', RUN))) as { runId: string }
    assert.deepEqual(storedTools(authoringFile), [])
    const defined = await call(ctx, 'tool_mode_tools', { action: 'from-run', runId: run.runId })
    assert.equal((JSON.parse(textOf(defined)) as { defined?: boolean }).defined, true)
  })

  it('rejects the removed autoDraft key with a migration message', async () => {
    await assert.rejects(
      () => mountHost({ adoption: { autoDraft: false } }),
      /autoDraft was removed.*autoKeep/s,
    )
  })

  it('captureRunPrograms:false disables capture, drafts and from-run', async () => {
    const { ctx, authoringFile } = await mountHost({ captureRunPrograms: false, adoption: { autoKeep: 'session' } })
    const run = await call(ctx, 'tool_mode_run', RUN)
    assert.equal(run.isError, false, textOf(run))
    const runId = (JSON.parse(textOf(run)) as { runId: string }).runId
    assert.deepEqual(storedTools(authoringFile), [])
    const refused = await call(ctx, 'tool_mode_tools', { action: 'from-run', runId })
    assert.match(textOf(refused), /captureRunPrograms/)
  })
})
