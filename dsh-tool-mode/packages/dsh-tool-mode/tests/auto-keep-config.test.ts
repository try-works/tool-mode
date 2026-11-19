/**
 * Phase 1 of docs/auto-keep-plan.md: autoDraft is deprecated for one release.
 *
 * The flag remains compatible, but false is no longer the recommended way to turn
 * automatic materialization off. captureRunPrograms is the hard switch. The false path
 * must still capture the run and support from-run, with one migration warning.
 *
 * @module tests/auto-keep-config
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
  onContext?: (ctx: Context) => void,
): Promise<{ ctx: Context; authoringFile: string }> {
  const dir = tempDir()
  const authoringFile = join(dir, 'agent-authoring.json')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, makeFakeRuntime())
  onContext?.(ctx)
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
  })
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

describe('autoDraft deprecation compatibility', () => {
  it('omitted leaves one callable draft', async () => {
    const { ctx, authoringFile } = await mountHost()
    const result = await call(ctx, 'tool_mode_run', RUN)
    assert.equal(result.isError, false, textOf(result))
    const drafts = storedTools(authoringFile).filter(row => row['status'] === 'draft')
    assert.equal(drafts.length, 1)
  })

  it('true behaves the same as omitted', async () => {
    const { ctx, authoringFile } = await mountHost({ adoption: { autoDraft: true } })
    const result = await call(ctx, 'tool_mode_run', RUN)
    assert.equal(result.isError, false, textOf(result))
    assert.equal(storedTools(authoringFile).filter(row => row['status'] === 'draft').length, 1)
  })

  it('false leaves no draft but still captures the run for from-run', async () => {
    const { ctx, authoringFile } = await mountHost({ adoption: { autoDraft: false } })
    const run = JSON.parse(textOf(await call(ctx, 'tool_mode_run', RUN))) as { runId: string; result: { doubled: number } }
    assert.equal(run.result.doubled, 42)
    assert.deepEqual(storedTools(authoringFile).filter(row => row['status'] === 'draft'), [])

    const defined = await call(ctx, 'tool_mode_tools', { action: 'from-run', runId: run.runId })
    assert.equal(defined.isError, false, textOf(defined))
    assert.equal((JSON.parse(textOf(defined)) as { defined?: boolean }).defined, true)
    assert.equal(storedTools(authoringFile).filter(row => row['status'] === 'draft').length, 0)
  })

  it('warns once on false and points at captureRunPrograms', async () => {
    const logs: string[] = []
    let restore = () => {}
    try {
      await mountHost({ adoption: { autoDraft: false } }, ctx => {
        const proto = Object.getPrototypeOf(ctx.logger) as { warn(...args: unknown[]): void }
        const original = proto.warn
        restore = () => { proto.warn = original }
        proto.warn = function (this: unknown, ...args: unknown[]) {
          logs.push(args.map(String).join(' '))
          return original.apply(this, args)
        }
      })
      const warnings = logs.filter(line => line.includes('autoDraft') && line.includes('captureRunPrograms'))
      assert.equal(warnings.length, 1, JSON.stringify(logs))
    } finally {
      restore()
    }
  })

  it('captureRunPrograms:false disables capture, drafts and from-run', async () => {
    const { ctx, authoringFile } = await mountHost({ captureRunPrograms: false, adoption: { autoDraft: true } })
    const run = await call(ctx, 'tool_mode_run', RUN)
    assert.equal(run.isError, false, textOf(run))
    const runId = (JSON.parse(textOf(run)) as { runId: string }).runId
    assert.deepEqual(storedTools(authoringFile), [])
    const refused = await call(ctx, 'tool_mode_tools', { action: 'from-run', runId })
    assert.match(textOf(refused), /captureRunPrograms/)
  })
})
