/**
 * Adoption: the per-assembly prompt must see the CALLER's session artifacts.
 *
 * The prompt section is assembled before any tool call, but DSH supplies the live
 * Agent on the assembly context. Resolving the caller from that Agent is what makes a
 * session-scoped auto-draft visible to its owner at turn start.
 *
 * @module tests/adoption-session-prompt
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof */

import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'

import * as plugin from '../src/index.ts'
import { PTC_SERVICE, setConfinementDemonstratedForTest } from '../src/ptc-runtime.ts'
import type { ProgramRuntime } from '../src/tool-mode-run.ts'
import { cleanup, resultText, tempDir } from './helpers.ts'

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

async function mountHost(): Promise<Context> {
  const dir = tempDir()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, makeFakeRuntime())
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile: join(dir, 'agent-authoring.json'),
    artifactScopes: { enabled: true, defaultScope: 'session', workspaceRoot: dir },
    hostedCode: true,
  } as plugin.Config)
  contexts.push(ctx)
  return ctx
}

async function call(ctx: Context, name: string, args: unknown, sessionId = 'session-prompt') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`prompt-${++counter}`),
    name,
    arguments: args,
    agent: { id: sessionId },
  } as never)
}

async function sectionFor(ctx: Context, sessionId: string): Promise<string> {
  const service = ctx.get('systemPrompt') as {
    assemble(context?: { agent?: { id: string } }): Promise<{ sections: { name: string; text: string }[] }>
  } | undefined
  assert.ok(service)
  const assembly = await service.assemble({ agent: { id: sessionId } } as never)
  return assembly.sections.find(section => section.name === 'tool-mode:library')?.text ?? ''
}

const RUN = {
  description: 'count the texts',
  code: 'return { total: input.texts.length }',
  tools: [],
  input: { texts: ['one', 'two'] },
}

describe('session artifacts in the per-turn prompt', () => {
  it('names the caller auto-draft at assembly time, with its call shape', async () => {
    const ctx = await mountHost()
    const run = await call(ctx, 'tool_mode_run', RUN)
    assert.equal(run.isError, false, resultText(run))
    const list = JSON.parse(resultText(await call(ctx, 'tool_mode_tools', { action: 'list' }))) as {
      tools: { name: string; draft?: boolean }[]
    }
    const draft = list.tools.find(tool => tool.draft === true)
    assert.ok(draft !== undefined)

    const text = await sectionFor(ctx, 'session-prompt')
    assert.match(text, new RegExp('Use ' + draft.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(text, /\{texts: string\[\]\}/)
    assert.match(text, /auto-kept, unverified/)
    assert.doesNotMatch(text, /Evidence:/)
    assert.match(text, /Verify its output on edge cases/)
  })

  it('appends the digest to the first task step, not only the standing section', async () => {
    const ctx = await mountHost()
    await call(ctx, 'tool_mode_run', RUN)
    const task = createUserMessage({
      content: [{ type: 'text', text: 'do the task' }],
      source: { kind: 'user' },
    })
    const waterfall = (ctx as unknown as {
      waterfall(name: never, payload: never, next: () => Promise<unknown>): Promise<unknown>
    }).waterfall.bind(ctx)
    const decision = await waterfall('agent/pre-step' as never, {
      agent: { id: 'session-prompt' },
      messages: [task],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    } as never, async () => ({ kind: 'enter', messages: [task] })) as {
      kind: string
      messages: { content: { type: string; text?: string }[] }[]
    }
    assert.equal(decision.kind, 'enter')
    const text = decision.messages
      .flatMap(message => message.content)
      .filter(block => block.type === 'text')
      .map(block => block.text ?? '')
      .join('\n')
    assert.match(text, /Use agent_from_draft_/)
    assert.match(text, /Verify its output on edge cases/)
    assert.doesNotMatch(text, /Evidence:/)
  })

  it('does not leak one session auto-draft into another session assembly', async () => {
    const ctx = await mountHost()
    await call(ctx, 'tool_mode_run', RUN)
    assert.match(await sectionFor(ctx, 'session-prompt'), /^Use /m)
    assert.equal(await sectionFor(ctx, 'another-session'), '')
  })

  it('presents the caller draft and a workspace workflow together', async () => {
    const ctx = await mountHost()
    await call(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'session-flow', description: 'Counts things.',
      program: 'return 1', scope: 'workspace',
    })
    await call(ctx, 'tool_mode_run', RUN)
    const text = await sectionFor(ctx, 'session-prompt')
    assert.match(text, /^Use agent_from_draft_/m)
    assert.match(text, /Also available: .*workflow_session_flow/)
  })
})
