/**
 * R6 — persisted durable rows must register across every workspace.
 *
 * Boot registration used to iterate only the GLOBAL rows and the HOST-cwd workspace rows, so
 * a row stored under workspace A was never registered when the host process ran in workspace
 * B — even though the dispatcher resolves the caller's scope at call time. The store now
 * enumerates every durable (workspace/global) row across ALL scope keys; session rows stay
 * private to their root and are never enumerated.
 *
 * The store-API group is green once the API exists. The mount group is the R6 acceptance and
 * needs boot registration wired to `durableToolEntries()`/`durableWorkflowEntries()` in the
 * composition root (Lead-owned index.ts); it fails on a host that still registers only the
 * two legacy entry sets.
 *
 * @module tests/cross-workspace-registration
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this suite is the persisted-JSON/registry boundary; stored rows and tool results are unknown values cast to the row under test. */

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

const OTHER_ROOT = 'other-root-session'
const otherSession: ArtifactScopeContext = { scope: 'session', scopeKey: OTHER_ROOT, sessionId: OTHER_ROOT }

/**
 * The REAL workspace context for a cwd.
 *
 * 'auto' workspace mode walks the cwd to its git root and uses the realpath as the key, so a
 * hand-written relative string can never match the caller's key (the 0.5.106 fixture bug).
 * 'auto' for both sides guarantees the seeded row and the caller resolve to the SAME key.
 */
function workspaceContext(cwd: string): ArtifactScopeContext {
  const key = workspaceKeyFor(cwd)
  return { scope: 'workspace', scopeKey: key, workspaceKey: key }
}

const TEXTS = ['Dziękuję', 'Kiitos']
const EXPECTED = { counts: { pl: 1, fi: 1 }, total: 2 }
const INPUT_SCHEMA = {
  type: 'object',
  properties: { texts: { type: 'array', items: { type: 'string' } } },
  required: ['texts'],
}
const COUNT_PROGRAM = [
  'const counts = { pl: 0, fi: 0 }',
  'for (const text of input.texts) {',
  "  if (text === 'Dziękuję') counts.pl += 1",
  "  if (text === 'Kiitos') counts.fi += 1",
  '}',
  'return { counts, total: counts.pl + counts.fi }',
].join('\n')

/** Seed the durable document exactly as a previous host would have left it. */
function seedStore(file: string, workspaceA: string, workspaceB: string): void {
  const store = createAgentAuthoringStore({ file })
  const A = workspaceContext(workspaceA)
  const B = workspaceContext(workspaceB)
  store.saveTool({
    name: 'agent_counts', description: 'Count languages.', inputSchema: INPUT_SCHEMA, program: COUNT_PROGRAM, tools: [],
  }, A)
  store.saveWorkflow({
    name: 'g1_lang_counts', description: 'Count through agent_counts.',
    inputSchema: INPUT_SCHEMA, program: 'return await agent_counts({ texts: input.texts })', tools: ['agent_counts'],
  }, A)
  // A second durable copy in another workspace proves enumeration is not caller-scoped.
  store.saveTool({
    name: 'agent_elsewhere', description: 'Only in workspace B.', inputSchema: INPUT_SCHEMA, program: 'return 2', tools: [],
  }, B)
  // A session row from ANOTHER root must never be enumerated or registered.
  store.saveTool({
    name: 'agent_other_root', description: 'Private to another root.', inputSchema: INPUT_SCHEMA, program: 'return 3', tools: [],
  }, otherSession)
  store.saveDraft({
    runId: 'run_other_root', program: 'return 4', tools: [], inputSchema: { type: 'object', properties: {} },
  }, otherSession)
}

/** In-process PTC stand-in: the real binding plumbing, no sandbox. */
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

/** Mount the host with its PROCESS cwd in workspace B while the caller's session cwd is A. */
async function mountHost(file: string, dir: string, workspaceA: string, workspaceB: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, fakeRuntime())
  ctx.provide('sessions' as never, {
    get(id: string) {
      return { header: { id, cwd: id === 'session-a' ? workspaceA : workspaceB } }
    },
  } as never)
  setConfinementDemonstratedForTest(true)
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile: file,
    // 'auto' workspace root: the boot scope is the HOST cwd (workspace B); the caller scope
    // is the session cwd (workspace A). That is the R6 shape.
    artifactScopes: { enabled: true, defaultScope: 'session' },
    hostedCode: true,
  } as never)
  contexts.push(ctx)
  return ctx
}

function callAs(ctx: Context, name: string, args: unknown, sessionId = 'session-a') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`cross-workspace-${++counter}`),
    name,
    arguments: args,
    agent: { id: sessionId } as never,
  } as never)
}

async function ok(ctx: Context, name: string, args: unknown, sessionId = 'session-a') {
  const result = await callAs(ctx, name, args, sessionId)
  if (result.isError) throw new Error(`${name} failed: ${result.error?.message ?? 'unknown'}`)
  return (result as { value: unknown }).value
}

async function runProgram(ctx: Context, tools: readonly string[], code: string): Promise<unknown> {
  const result = await callAs(ctx, 'tool_mode_run', { tools, code }) as { value?: { result?: unknown } }
  return result.value?.result
}

async function probeNames(ctx: Context, names: readonly string[]): Promise<{ name: string; resolved: boolean; reason?: string }[]> {
  const listed = await ok(ctx, 'tool_mode_run', { probe: true, tools: names }) as {
    preflight?: { name: string; resolved: boolean; reason?: string }[]
  }
  return listed.preflight ?? []
}

function registeredNames(ctx: Context): string[] {
  return ctx.tools.schemas().map(schema => schema.name)
}

describe('R6 — the store enumerates DURABLE rows across every workspace key', () => {
  it('returns every workspace/global tool row, unresolved and across keys, never a session row', async () => {
    const dir = tempDir()
    const file = join(dir, 'agent-authoring.json')
    const workspaceA = join(dir, 'workspace-a')
    const workspaceB = join(dir, 'workspace-b')
    seedStore(file, workspaceA, workspaceB)
    const store = createAgentAuthoringStore({ file })

    const names = store.durableToolEntries().map(row => row.name)
    assert.equal(names.includes('agent_counts'), true, 'workspace-A row must be enumerated')
    assert.equal(names.includes('agent_elsewhere'), true, 'workspace-B row must be enumerated')
    assert.equal(names.includes('agent_other_root'), false, 'another root\'s session row must stay private')
    assert.equal(names.some(name => name.startsWith('agent_from_draft_')), false, 'session drafts are not durable')

    // The full row (program included) is what boot registration needs to validate + register.
    const row = store.durableToolEntries().find(entry => entry.name === 'agent_counts')
    assert.ok(row !== undefined)
    assert.equal(row.program, COUNT_PROGRAM)
    assert.equal(row.scope, 'workspace')
    assert.equal(row.scopeKey, workspaceKeyFor(workspaceA))
  })

  it('returns every workspace/global workflow row and never a session row', async () => {
    const dir = tempDir()
    const file = join(dir, 'agent-authoring.json')
    const workspaceA = join(dir, 'workspace-a')
    const workspaceB = join(dir, 'workspace-b')
    seedStore(file, workspaceA, workspaceB)
    const store = createAgentAuthoringStore({ file })
    store.saveWorkflow({
      name: 'g_session_only', description: 'Private.', inputSchema: { type: 'object', properties: {} },
      program: 'return 9', tools: [],
    }, otherSession)

    const words = store.durableWorkflowEntries().map(row => row.name)
    assert.deepEqual([...words].sort(), ['g1_lang_counts'])
    const row = store.durableWorkflowEntries()[0]
    assert.ok(row !== undefined)
    assert.equal(row.program, 'return await agent_counts({ texts: input.texts })')
    assert.equal(row.scope, 'workspace')
    assert.equal(row.scopeKey, workspaceKeyFor(workspaceA))
  })

  it('keeps same-name rows from different workspace keys as separate durable entries', async () => {
    const dir = tempDir()
    const file = join(dir, 'agent-authoring.json')
    const workspaceA = join(dir, 'workspace-a')
    const workspaceB = join(dir, 'workspace-b')
    const store = createAgentAuthoringStore({ file })
    store.saveTool({ name: 'agent_dup', description: 'A copy.', inputSchema: { type: 'object', properties: {} }, program: 'return 1', tools: [] }, workspaceContext(workspaceA))
    store.saveTool({ name: 'agent_dup', description: 'B copy.', inputSchema: { type: 'object', properties: {} }, program: 'return 2', tools: [] }, workspaceContext(workspaceB))

    const rows = createAgentAuthoringStore({ file }).durableToolEntries().filter(row => row.name === 'agent_dup')
    assert.deepEqual(rows.map(row => [row.scopeKey, row.program]).sort(), [
      [workspaceKeyFor(workspaceA), 'return 1'],
      [workspaceKeyFor(workspaceB), 'return 2'],
    ])
  })
})

describe('R6 — a host in workspace B registers workspace-A artifacts for a workspace-A caller', () => {
  async function seededHost(): Promise<{ ctx: Context; file: string; dir: string; workspaceA: string; workspaceB: string }> {
    const dir = tempDir()
    const file = join(dir, 'agent-authoring.json')
    // Real absolute temp dirs: the caller's workspace key is derived from the session cwd, so
    // a hand-written relative key could never match it (the fixture bug this test guards).
    const workspaceA = join(dir, 'workspace-a')
    const workspaceB = join(dir, 'workspace-b')
    seedStore(file, workspaceA, workspaceB)
    const ctx = await mountHost(file, dir, workspaceA, workspaceB)
    return { ctx, file, dir, workspaceA, workspaceB }
  }

  it('lists the row bindable, resolves it in a probe, and runs all three call forms', async () => {
    const { ctx } = await seededHost()
    const listed = await ok(ctx, 'tool_mode_list', {}) as {
      tools: { name: string; bindable: boolean }[]
      authoring?: { tools?: { name: string }[] }
    }
    const row = listed.tools.find(tool => tool.name === 'agent_counts')
    assert.ok(row !== undefined, 'the workspace-A tool must be advertised after boot registration')
    assert.equal(row.bindable, true, 'advertised means BINDABLE (no dead end)')

    const rows = await probeNames(ctx, ['agent_counts', 'workflow_g1_lang_counts', 'g1_lang_counts'])
    assert.deepEqual(rows.map(entry => [entry.name, entry.resolved]), [
      ['agent_counts', true],
      ['workflow_g1_lang_counts', true],
      ['g1_lang_counts', true],
    ])

    assert.deepEqual(await runProgram(ctx, ['agent_counts'], `return await agent_counts({ texts: ${JSON.stringify(TEXTS)} })`), EXPECTED)
    assert.deepEqual(await runProgram(ctx, ['g1_lang_counts'], `return await g1_lang_counts({ texts: ${JSON.stringify(TEXTS)} })`), EXPECTED)
    assert.deepEqual(await runProgram(ctx, ['workflow_g1_lang_counts'], `return await workflow_g1_lang_counts({ texts: ${JSON.stringify(TEXTS)} })`), EXPECTED)
  })

  it('never registers or advertises another root\'s session rows', async () => {
    const { ctx } = await seededHost()
    const names = registeredNames(ctx)
    assert.equal(names.includes('agent_other_root'), false, 'another root\'s session tool must not register')
    assert.equal(names.some(name => name.startsWith('agent_from_draft_')), false, 'another root\'s draft must not register')

    const listed = await ok(ctx, 'tool_mode_list', {}) as { tools: { name: string }[] }
    assert.equal(listed.tools.some(tool => tool.name === 'agent_other_root'), false)
    const rows = await probeNames(ctx, ['agent_other_root'])
    assert.equal(rows[0]?.resolved, false)
  })

  it('keeps the registration across a restart-shaped remount of the same store', async () => {
    const { ctx, file, dir, workspaceA, workspaceB } = await seededHost()
    await ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(ctx), 1)

    const remounted = await mountHost(file, dir, workspaceA, workspaceB)
    const rows = await probeNames(remounted, ['agent_counts', 'workflow_g1_lang_counts'])
    assert.deepEqual(rows.map(entry => [entry.name, entry.resolved]), [
      ['agent_counts', true],
      ['workflow_g1_lang_counts', true],
    ])
    assert.deepEqual(
      await runProgram(remounted, ['agent_counts'], `return await agent_counts({ texts: ${JSON.stringify(TEXTS)} })`),
      EXPECTED,
    )
  })
})