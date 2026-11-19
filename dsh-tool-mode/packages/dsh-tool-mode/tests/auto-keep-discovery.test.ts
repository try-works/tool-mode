/**
 * Phase 5 of docs/auto-keep-plan.md: bounded discovery and tool budget.
 *
 * @module tests/auto-keep-discovery
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import * as plugin from '../src/index.ts'
import { createAgentAuthoringStore, type ArtifactScopeContext } from '../src/agent-authoring.ts'
import { workspaceKeyFor } from '../src/artifact-scope-context.ts'
import { buildDirectiveDigest } from '../src/library-digest.ts'
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

async function mountHost(agentAuthoringFile: string, dir: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, fakeRuntime())
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile,
    artifactScopes: { enabled: true, defaultScope: 'workspace', workspaceRoot: dir },
    hostedCode: true,
  } as plugin.Config)
  contexts.push(ctx)
  return ctx
}

async function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`budget-${++counter}`),
    name,
    arguments: args,
    agent: { id: 'session-budget' },
  } as never)
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('bounded auto-keep discovery', () => {
  it('caps tool_mode_tools list and exposes a next cursor', async () => {
    const dir = tempDir()
    const store = createAgentAuthoringStore({ file: join(dir, 'agent-authoring.json'), scopeEnabled: true })
    const workspace: ArtifactScopeContext = { scope: 'workspace', scopeKey: workspaceKeyFor(dir, 'auto'), workspaceKey: workspaceKeyFor(dir, 'auto') }
    for (let index = 0; index < 25; index += 1) {
      store.saveTool({
        name: 'agent_t' + String(index).padStart(2, '0'),
        description: 'tool ' + String(index),
        inputSchema: { type: 'object', properties: {} },
        program: 'return ' + String(index),
        tools: [],
      }, workspace)
    }
    const ctx = await mountHost(store.file, dir)
    const first = JSON.parse(textOf(await call(ctx, 'tool_mode_tools', { action: 'list' }))) as {
      tools: unknown[]; total?: number; limit?: number; nextCursor?: string
    }
    assert.equal(first.tools.length, 20)
    assert.equal(first.total, 25)
    assert.equal(first.limit, 20)
    assert.equal(first.nextCursor, '20')
    const second = JSON.parse(textOf(await call(ctx, 'tool_mode_tools', { action: 'list', cursor: '20' }))) as {
      tools: unknown[]; nextCursor?: string
    }
    assert.equal(second.tools.length, 5)
    assert.equal(second.nextCursor, undefined)
  })

  it('caps the tool_mode_list authoring block with a total', async () => {
    const dir = tempDir()
    const store = createAgentAuthoringStore({ file: join(dir, 'agent-authoring.json'), scopeEnabled: true })
    const workspace: ArtifactScopeContext = { scope: 'workspace', scopeKey: workspaceKeyFor(dir, 'auto'), workspaceKey: workspaceKeyFor(dir, 'auto') }
    for (let index = 0; index < 25; index += 1) {
      store.saveTool({
        name: 'agent_l' + String(index).padStart(2, '0'),
        description: 'tool ' + String(index),
        inputSchema: { type: 'object', properties: {} },
        program: 'return ' + String(index),
        tools: [],
      }, workspace)
    }
    const ctx = await mountHost(store.file, dir)
    const listed = JSON.parse(textOf(await call(ctx, 'tool_mode_list', {}))) as {
      authoring?: { tools?: unknown[]; toolsTotal?: number; toolsLimit?: number }
    }
    assert.equal(listed.authoring?.tools?.length, 20)
    assert.equal(listed.authoring?.toolsTotal, 25)
    assert.equal(listed.authoring?.toolsLimit, 20)
  })

  it('marks an auto-kept candidate unverified in the directive', async () => {
    const text = buildDirectiveDigest([{
      name: 'agent_a7f3',
      callableName: 'agent_a7f3',
      description: 'Computes an amount due.',
      scope: 'workspace',
      uses: 0,
      failures: 0,
      sessions: 0,
      unverified: true,
    }])
    assert.match(text, /unverified/i)
  })
})
