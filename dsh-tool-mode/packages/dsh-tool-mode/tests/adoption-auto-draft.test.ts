/**
 * Auto-draft: a successful run answers with a callable draft, and keeping it is one call.
 *
 * Phase 4 makes authoring ambient: the agent runs a program, and the run itself leaves a
 * DRAFT it can keep with one `from-run`. These cases are behavioural, through the mounted
 * plugin and a fake PTC runtime, so they pin the plumbing (capture -> draft -> promote) and
 * not the sandbox. Drafts are ON by default (`adoption.autoKeep:'session'`); the
 * explicit cases prove the policy still works.
 *
 * @module tests/adoption-auto-draft
 */

/*
 * This suite is the JSON/registry BOUNDARY: tool results are `unknown` and are cast to the
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

/** A PTC runtime that evaluates the program body in-process. */
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

/** Mount the real plugin with an isolated authoring file and a fake runtime. */
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
    callId: ToolCallId(`draft-${++counter}`),
    name,
    arguments: args,
  })
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** The tool rows persisted by the authoring store. */
function storedTools(authoringFile: string): Record<string, unknown>[] {
  let text: string
  try {
    text = readFileSync(authoringFile, 'utf8')
  } catch {
    // An absent authoring file means NO rows were ever authored. Treating that as an
    // error would turn "nothing was written" into a failure to read.
    return []
  }
  const parsed = JSON.parse(text) as { tools?: unknown }
  return Array.isArray(parsed.tools) ? parsed.tools as Record<string, unknown>[] : []
}

const ENABLED = { adoption: { autoKeep: 'session' } }

describe('auto-draft after a successful run', () => {
  it('leaves exactly one draft carrying the run id, program and shape-only schema', async () => {
    const { ctx, authoringFile } = await mountHost(ENABLED)
    const run = JSON.parse(textOf(await call(ctx, 'tool_mode_run', {
      description: 'double an input value',
      code: 'return { doubled: input.value * 2 }',
      tools: [],
      input: { value: 21 },
    }))) as { runId: string; result: { doubled: number } }
    assert.equal(run.result.doubled, 42)

    const drafts = storedTools(authoringFile).filter(row => row['status'] === 'draft')
    assert.equal(drafts.length, 1, 'one success leaves exactly one draft')
    const draft = drafts[0]!
    assert.match(String(draft['name']), /^agent_from_draft_[0-9a-f]{8}$/)
    assert.equal(draft['program'], 'return { doubled: input.value * 2 }')
    assert.deepEqual(draft['tools'], [])
    const schema = draft['inputSchema'] as { properties?: Record<string, unknown> }
    assert.deepEqual(Object.keys(schema.properties ?? {}), ['value'], 'shape-only schema, no values')
    // Assert on the CONTENT fields, not the whole row: an ISO timestamp legitimately
    // contains digit pairs like "21" and would make a whole-row search flaky.
    assert.equal(JSON.stringify(draft['inputSchema']).includes('21'), false, 'schema must hold shapes, never values')
    assert.equal(String(draft['program']).includes('21'), false, 'the program carries no input values')
  })

  it('ships with auto-draft enabled by default', async () => {
    const { ctx, authoringFile } = await mountHost()
    await call(ctx, 'tool_mode_run', { description: 'double', code: 'return { doubled: input.value * 2 }', tools: [], input: { value: 3 } })
    const drafts = storedTools(authoringFile).filter(row => row['status'] === 'draft')
    assert.equal(drafts.length, 1, 'the shipped default leaves one draft without opt-in')
  })

  it('leaves no draft when the run fails', async () => {
    const { ctx, authoringFile } = await mountHost(ENABLED)
    await call(ctx, 'tool_mode_run', { description: 'fails', code: 'throw new Error("nope")', tools: [] })
    assert.deepEqual(storedTools(authoringFile).filter(row => row['status'] === 'draft'), [])
  })

  it('reports the draft as a draft in list output', async () => {
    const { ctx } = await mountHost(ENABLED)
    await call(ctx, 'tool_mode_run', { description: 'double', code: 'return 2', tools: [] })
    const listed = JSON.parse(textOf(await call(ctx, 'tool_mode_tools', { action: 'list' }))) as {
      tools: { name: string; draft?: boolean; expiresAt?: string }[]
      retention?: { draftTtlMs?: number }
    }
    const draft = listed.tools.find(row => row.draft === true)
    assert.ok(draft !== undefined, 'the draft must be listed as draft: true')
    assert.match(draft.name, /^agent_from_draft_/)
    assert.ok(typeof draft.expiresAt === 'string', 'the expiry must be visible')
    assert.equal(listed.retention?.draftTtlMs, 86_400_000, 'the default retention must be visible')
  })

  it('keeps the draft with one from-run call, honouring a readable name', async () => {
    const { ctx, authoringFile } = await mountHost(ENABLED)
    const run = JSON.parse(textOf(await call(ctx, 'tool_mode_run', {
      description: 'double', code: 'return { doubled: input.value * 2 }', tools: [], input: { value: 2 },
    }))) as { runId: string }
    const before = storedTools(authoringFile).filter(row => row['status'] === 'draft')[0]!

    const promoted = JSON.parse(textOf(await call(ctx, 'tool_mode_tools', {
      action: 'from-run', runId: run.runId, name: 'agent_double_value',
    }))) as { tool: { name: string } }
    assert.equal(promoted.tool.name, 'agent_double_value')

    const rows = storedTools(authoringFile)
    const kept = rows.filter(row => row['name'] === 'agent_double_value')
    assert.equal(kept.length, 1, 'the kept artifact exists once')
    assert.notEqual(kept[0]!['status'], 'draft', 'the kept copy is not a draft')
    assert.equal(kept[0]!['digest'], before['digest'], 'promotion copies content: the digest must not change')
    assert.equal(rows.filter(row => row['status'] === 'draft').length, 0, 'the draft was consumed')
  })

  it('updates the same draft when the same program runs again', async () => {
    const { ctx, authoringFile } = await mountHost(ENABLED)
    const program = 'return { doubled: input.value * 2 }'
    await call(ctx, 'tool_mode_run', { description: 'double', code: program, tools: [], input: { value: 1 } })
    await call(ctx, 'tool_mode_run', { description: 'double', code: program, tools: [], input: { value: 2 } })
    const drafts = storedTools(authoringFile).filter(row => row['status'] === 'draft')
    // Identity is the CONTENT digest, not the run: two runs of one program are one draft.
    assert.equal(drafts.length, 1, 'a repeat success refreshes one draft, never accumulates')
  })

  it('disables drafts when captureRunPrograms is off, and says how to enable them', async () => {
    const { ctx, authoringFile } = await mountHost({ ...ENABLED, captureRunPrograms: false })
    await call(ctx, 'tool_mode_run', { description: 'double', code: 'return 2', tools: [] })
    assert.deepEqual(storedTools(authoringFile).filter(row => row['status'] === 'draft'), [])
    // The refusal is a soft tool error whose text must name the flag to turn on.
    const refused = await call(ctx, 'tool_mode_tools', { action: 'from-run', runId: 'rcpt_missing' })
    assert.match(textOf(refused), /captureRunPrograms/)
  })
})

describe('a draft is CALLABLE, not just listed', () => {
  it('executes the auto-drafted tool immediately, with no restart', async () => {
    const { ctx } = await mountHost(ENABLED)
    await call(ctx, 'tool_mode_run', {
      description: 'double',
      code: 'return { doubled: input.value * 2 }',
      tools: [],
      input: { value: 21 },
    })
    const listed = JSON.parse(textOf(await call(ctx, 'tool_mode_tools', { action: 'list' }))) as {
      tools: { name: string; draft?: boolean }[]
    }
    const draft = listed.tools.find(row => row.draft === true)
    assert.ok(draft !== undefined, 'the draft must be listed')
    const executed = await call(ctx, draft.name, { value: 21 })
    const text = textOf(executed)
    assert.doesNotMatch(text, /unknown tool/i, 'a listed draft must be registered')
    assert.match(text, /42/)
  })

  it('executes a promoted tool under its readable name in the same session', async () => {
    const { ctx } = await mountHost(ENABLED)
    const run = JSON.parse(textOf(await call(ctx, 'tool_mode_run', {
      description: 'double', code: 'return { doubled: input.value * 2 }', tools: [], input: { value: 2 },
    }))) as { runId: string }
    const promoted = JSON.parse(textOf(await call(ctx, 'tool_mode_tools', {
      action: 'from-run', runId: run.runId, name: 'agent_double_value',
    }))) as { tool: { name: string } }
    assert.equal(promoted.tool.name, 'agent_double_value')
    const executed = await call(ctx, 'agent_double_value', { value: 21 })
    const text = textOf(executed)
    assert.doesNotMatch(text, /unknown tool/i, 'the promoted tool must be registered')
    assert.match(text, /42/)
  })

  it('promotes a run that had NO input, consuming the draft with an identical digest', async () => {
    const { ctx, authoringFile } = await mountHost(ENABLED)
    const run = JSON.parse(textOf(await call(ctx, 'tool_mode_run', {
      description: 'constant', code: 'return 7', tools: [],
    }))) as { runId: string }
    const before = storedTools(authoringFile).filter(row => row['status'] === 'draft')
    assert.equal(before.length, 1, 'the no-input run still leaves one draft')
    const draftDigest = before[0]!['digest']

    const promoted = JSON.parse(textOf(await call(ctx, 'tool_mode_tools', {
      action: 'from-run', runId: run.runId, name: 'agent_constant_seven',
    }))) as { tool: { name: string; digest?: string } }
    assert.equal(promoted.tool.name, 'agent_constant_seven')

    const rows = storedTools(authoringFile)
    assert.equal(rows.filter(row => row['status'] === 'draft').length, 0, 'the draft was consumed, not duplicated')
    const kept = rows.filter(row => row['name'] === 'agent_constant_seven')
    assert.equal(kept.length, 1)
    assert.equal(kept[0]!['digest'], draftDigest, 'promotion must not change content identity')
    const executed = await call(ctx, 'agent_constant_seven', {})
    assert.match(textOf(executed), /7/)
  })
})
