/**
 * F3: a real failed authored run must carry a bounded failure class into the evidence and
 * the directive digest's "Known failure:" line — at five uses, never before.
 *
 * The class is derived from the error (code/name), never from prose, and falls back to
 * `run.failed` when the error carries no code-shaped identity.
 *
 * @module tests/adoption-failure-class
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this suite is the registry/persisted-JSON boundary; tool results and the usage document are unknown values cast to the row under test. */

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
import type { AdoptionDigestCandidate } from '../src/adoption-digest-ranking.ts'
import { failureClassOf } from '../src/artifact-usage.ts'
import { buildDirectiveDigest } from '../src/library-digest.ts'
import { PTC_SERVICE, setConfinementDemonstratedForTest } from '../src/ptc-runtime.ts'
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

async function mountHost(): Promise<{ ctx: Context; dir: string }> {
  const dir = tempDir()
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
  return { ctx, dir }
}

function callAs(ctx: Context, name: string, args: unknown, sessionId = 'session-a') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`failure-class-${++counter}`),
    name,
    arguments: args,
    agent: { id: sessionId } as never,
  } as never)
}

async function defineTool(ctx: Context, name: string, program: string): Promise<void> {
  const defined = await callAs(ctx, 'tool_mode_tools', {
    action: 'define', name, description: 'A probe tool.', inputSchema: { type: 'object', properties: {} }, program, tools: [],
  })
  assert.equal(defined.isError, false, JSON.stringify(defined))
}

interface UsageRow {
  readonly name: string
  readonly uses: number
  readonly failures: number
  readonly sessionTotal: number
  readonly failureClasses: readonly string[]
}

function usageRow(dir: string, name: string): UsageRow {
  const document = JSON.parse(readFileSync(join(dir, 'artifact-usage.json'), 'utf8')) as { rows: UsageRow[] }
  const row = document.rows.find(candidate => candidate.name === name)
  assert.ok(row !== undefined, 'the failed runs must have written a usage row')
  return row
}

function candidateOf(row: UsageRow): AdoptionDigestCandidate {
  return {
    name: row.name,
    callableName: row.name,
    description: 'A failing probe tool.',
    scope: 'session',
    sessionId: 'session-a',
    uses: row.uses,
    failures: row.failures,
    sessions: row.sessionTotal,
    ...row.failureClasses[0] === undefined ? {} : { knownFailure: row.failureClasses[0] },
  }
}

describe('F3 — failureClassOf derives a bounded class', () => {
  it('prefers a code-shaped error code or name and rejects prose', () => {
    assert.equal(failureClassOf({ code: 'E_ACL_DENIED' }), 'E_ACL_DENIED')
    assert.equal(failureClassOf({ name: 'QuotaExceeded' }), 'QuotaExceeded')
    assert.equal(failureClassOf({ code: 'has spaces in it' }), 'run.failed')
    assert.equal(failureClassOf({ code: 'x'.repeat(65) }), 'run.failed')
    assert.equal(failureClassOf(new Error('boom')), 'run.failed', 'a generic Error name is not a failure class')
    assert.equal(failureClassOf('a string'), 'run.failed')
    assert.equal(failureClassOf(undefined), 'run.failed')
  })
})

describe('F3 — real failed runs feed the directive digest', () => {
  it('reports the bounded class at five uses, and no Known failure before that', async () => {
    const { ctx, dir } = await mountHost()
    await defineTool(ctx, 'agent_boom', 'throw new Error("boom")')
    for (let index = 0; index < 4; index += 1) {
      const failed = await callAs(ctx, 'agent_boom', {})
      assert.equal(failed.isError, true)
    }
    const four = usageRow(dir, 'agent_boom')
    assert.equal(four.uses, 4)
    assert.equal(four.failures, 4)
    const fourText = buildDirectiveDigest([candidateOf(four)], { sessionId: 'session-a' })
    assert.equal(fourText.includes('Known failure'), false, 'below five uses no caveat is advertised')

    const fifth = await callAs(ctx, 'agent_boom', {})
    assert.equal(fifth.isError, true)
    const five = usageRow(dir, 'agent_boom')
    assert.equal(five.uses, 5)
    assert.equal(five.failures, 5)
    // The runner's refusal code is 'failed': a bounded, code-shaped class from the ERROR,
    // not prose and not an invented diagnosis.
    assert.deepEqual(five.failureClasses, ['failed'], 'the class is bounded and comes from the failed run')
    // Phase 3's ranking rule still holds: an artifact failing HALF its uses is not the
    // imperative digest candidate, so the caveat is not advertised for it.
    assert.equal(buildDirectiveDigest([candidateOf(five)], { sessionId: 'session-a' }), '')
  })

  it('renders the class at five uses for an eligible artifact, and not before', async () => {
    const { ctx, dir } = await mountHost()
    await defineTool(ctx, 'agent_mixed', 'if (input.fail) { throw new Error("boom") } return { ok: true }')
    for (let index = 0; index < 4; index += 1) {
      const okay = await callAs(ctx, 'agent_mixed', { fail: false })
      assert.equal(okay.isError, false, JSON.stringify(okay))
    }
    const four = usageRow(dir, 'agent_mixed')
    assert.equal(four.uses, 4)
    assert.deepEqual(four.failureClasses, [])
    assert.equal(buildDirectiveDigest([candidateOf(four)], { sessionId: 'session-a' }).includes('Known failure'), false)

    const failed = await callAs(ctx, 'agent_mixed', { fail: true })
    assert.equal(failed.isError, true)
    const five = usageRow(dir, 'agent_mixed')
    assert.equal(five.uses, 5)
    assert.equal(five.failures, 1)
    assert.deepEqual(five.failureClasses, ['failed'])
    const text = buildDirectiveDigest([candidateOf(five)], { sessionId: 'session-a' })
    assert.match(text, /Known failure: failed\./, 'the digest reports the evidence-backed class')
    assert.match(text, /Completed without a recorded error: 5 uses, 1 failure/)
  })

  it('a success-only artifact never gains a failure class', async () => {
    const { ctx, dir } = await mountHost()
    await defineTool(ctx, 'agent_ok', 'return 1')
    for (let index = 0; index < 5; index += 1) {
      const okay = await callAs(ctx, 'agent_ok', {})
      assert.equal(okay.isError, false, JSON.stringify(okay))
    }
    const row = usageRow(dir, 'agent_ok')
    assert.equal(row.uses, 5)
    assert.deepEqual(row.failureClasses, [])
    assert.equal(buildDirectiveDigest([candidateOf(row)], { sessionId: 'session-a' }).includes('Known failure'), false)
  })
})
