/**
 * 0.5.110 report follow-ups (docs/fix-0.5.110-report-plan.md).
 * @module tests/fix-0-5-110-report
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this suite is the registry/tool-result boundary; tool results are unknown values cast to the row under test. */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'

import * as plugin from '../src/index.ts'
import { createAgentAuthoringStore } from '../src/agent-authoring.ts'
import { PTC_SERVICE, setConfinementDemonstratedForTest } from '../src/ptc-runtime.ts'
import type { ProgramRuntime } from '../src/tool-mode-run.ts'
import { cleanup, tempDir, callTool, resultText } from './helpers.ts'

process.env['DSH_PTC_CONFINEMENT_SEAM'] = 'open-for-acceptance-test'
setConfinementDemonstratedForTest(false)

const contexts: Context[] = []

after(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  setConfinementDemonstratedForTest(false)
  await cleanup()
})

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
    artifactScopes: {
      enabled: true, defaultScope: 'session', workspaceRoot: dir,
      globalPromotion: 'human', promoteMinUses: 2, expireSessionArtifacts: true,
    },
    hostedCode: true,
  } as never)
  contexts.push(ctx)
  return ctx
}

describe('F4 — describe tells the truth about a stored artifact\'s data path', () => {
  it('never renders the host-owned-discovery boilerplate for an authored tool', async () => {
    const ctx = await mountHost(tempDir())
    const defined = await callTool(ctx, 'tool_mode_tools', {
      action: 'define',
      name: 'agent_data_handling',
      description: 'Counts items.',
      inputSchema: { type: 'object', properties: { texts: { type: 'array', items: { type: 'string' } } } },
      program: 'return { total: input.texts.length }',
      tools: [],
      scope: 'workspace',
    })
    assert.equal(defined.isError, false, resultText(defined))
    const described = await callTool(ctx, 'tool_mode_describe', { tools: ['agent_data_handling'] })
    assert.equal(described.isError, false, resultText(described))
    const text = resultText(described)
    assert.ok(!text.includes('This host-owned discovery tool reads the local registry'),
      'a stored device-execution artifact must not wear the discovery-lane boilerplate: ' + text)
    assert.match(text, /stored program/, 'the honest authored-artifact data path must be stated')
  })
})
