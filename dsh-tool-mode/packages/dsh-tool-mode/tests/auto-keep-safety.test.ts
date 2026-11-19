/**
 * Phase 6 of docs/auto-keep-plan.md: safety checks for auto-kept artifacts.
 *
 * @module tests/auto-keep-safety
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
import { containsSecretLikeLiteral, hasSideEffectTools } from '../src/artifact-safety.ts'
import { PTC_SERVICE, setConfinementDemonstratedForTest } from '../src/ptc-runtime.ts'
import type { ProgramRuntime } from '../src/tool-mode-run.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

process.env['DSH_PTC_CONFINEMENT_SEAM'] = 'open-for-acceptance-test'
setConfinementDemonstratedForTest(false)

function fakeRuntime(): ProgramRuntime {
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

async function mountHost(): Promise<{ ctx: Context; authoringFile: string }> {
  const dir = tempDir()
  const authoringFile = join(dir, 'agent-authoring.json')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, fakeRuntime())
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile: authoringFile,
    artifactScopes: { enabled: true, defaultScope: 'session', workspaceRoot: dir },
    hostedCode: true,
    adoption: { autoKeep: 'session' },
  } as plugin.Config)
  contexts.push(ctx)
  return { ctx, authoringFile }
}

async function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`safety-${++counter}`),
    name,
    arguments: args,
    agent: { id: 'session-safety' },
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

describe('auto-keep safety', () => {
  it('detects credential-shaped literals and side-effect tools', () => {
    assert.equal(containsSecretLikeLiteral('const key = "AKIAIOSFODNN7EXAMPLE"'), true)
    assert.equal(containsSecretLikeLiteral('return { doubled: input.value * 2 }'), false)
    assert.equal(hasSideEffectTools(['pwsh']), true)
    assert.equal(hasSideEffectTools(['lang_detect']), false)
  })

  it('does not persist a run whose program contains a credential-shaped literal', async () => {
    const { ctx, authoringFile } = await mountHost()
    const result = await call(ctx, 'tool_mode_run', {
      description: 'unsafe',
      code: 'const key = "AKIAIOSFODNN7EXAMPLE"; return { key }',
      tools: [],
      input: {},
    })
    assert.equal(result.isError, false, textOf(result))
    assert.deepEqual(storedTools(authoringFile), [])
  })
})
