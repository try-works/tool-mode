/**
 * R7 — auto-keep dedupes by normalized program SHAPE.
 *
 * Three successful runs of the same shape used to mint three counting artifacts, so a solver
 * declined to author ("a third copy adds no capability"). Auto-keep now looks up the canonical
 * row for a shape fingerprint first: one durable row, many uses; a genuinely different shape
 * still gets its own row, and a different input schema is a different shape.
 *
 * Store-level tests are green once the store API exists. The mounted acceptance test (one row,
 * uses:3, one digest line) additionally needs the Lead-owned auto-keep call site to call
 * store.saveAutoKeep(); it fails on a host that still mints one draft per run.
 *
 * @module tests/auto-keep-dedupe
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
import { createAgentAuthoringStore, toolShapeFingerprint, type ArtifactScopeContext } from '../src/agent-authoring.ts'
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

const workspaceContext = (key: string): ArtifactScopeContext => ({ scope: 'workspace', scopeKey: key, workspaceKey: key })
const sessionContext = (root: string): ArtifactScopeContext => ({ scope: 'session', scopeKey: root, sessionId: root })

const PROGRAM = [
  'const counts = { pl: 0, fi: 0 }',
  'for (const text of input.texts) {',
  "  if (text === 'Dziękuję') counts.pl += 1",
  "  if (text === 'Kiitos') counts.fi += 1",
  '}',
  'return { counts, total: counts.pl + counts.fi }',
].join('\n')
const SCHEMA = {
  type: 'object',
  properties: { texts: { type: 'array', items: { type: 'string' } } },
  required: ['texts'],
}
const INPUT = { runId: 'run-1', program: PROGRAM, tools: ['agent_counts'] as string[], inputSchema: SCHEMA }

function autoKeepInput(runId: string) {
  return { ...INPUT, runId, purpose: 'Count languages.', verification: 'Fixture note.' }
}

describe('R7 — the shape fingerprint normalizes formatting, not meaning', () => {
  it('treats whitespace, comments, tool order and schema annotations as the same shape', () => {
    const base = toolShapeFingerprint({ program: PROGRAM, tools: ['b_tool', 'a_tool'], inputSchema: SCHEMA })
    const reformatted = toolShapeFingerprint({
      program: PROGRAM.replace(/\n/g, '\n\n') + '\n// trailing comment\n/* block */',
      tools: ['a_tool', 'b_tool'],
      inputSchema: {
        ...SCHEMA,
        description: 'Counts languages.',
        properties: {
          texts: { ...SCHEMA.properties.texts, description: 'The texts.' },
        },
      },
    })
    assert.equal(reformatted, base)
  })

  it('separates a different program, tool set or schema shape', () => {
    const base = toolShapeFingerprint({ program: PROGRAM, tools: ['agent_counts'], inputSchema: SCHEMA })
    assert.notEqual(toolShapeFingerprint({ program: PROGRAM.replace('counts.pl += 1', 'counts.pl += 2'), tools: ['agent_counts'], inputSchema: SCHEMA }), base)
    assert.notEqual(toolShapeFingerprint({ program: PROGRAM, tools: ['agent_other'], inputSchema: SCHEMA }), base)
    assert.notEqual(toolShapeFingerprint({
      program: PROGRAM, tools: ['agent_counts'],
      inputSchema: { ...SCHEMA, properties: { ...SCHEMA.properties, limit: { type: 'number' } } },
    }), base)
  })
})

describe('R7 — saveAutoKeep reuses the canonical row for a shape', () => {
  it('three same-shape runs across sessions keep ONE durable row', () => {
    const dir = tempDir()
    const store = createAgentAuthoringStore({ file: join(dir, 'agent-authoring.json') })
    const workspace = workspaceContext('workspace-r7')

    const first = store.saveAutoKeep(autoKeepInput('run-1'), workspace)
    const second = store.saveAutoKeep(autoKeepInput('run-2'), workspace)
    const third = store.saveAutoKeep(autoKeepInput('run-3'), workspace)
    assert.equal(first.reused, false)
    assert.equal(second.reused, true)
    assert.equal(third.reused, true)
    assert.equal(second.tool.id, first.tool.id)
    assert.equal(third.tool.id, first.tool.id)
    assert.equal(store.durableToolEntries().length, 1, 'one canonical row, not three copies')
  })

  it('a genuinely different shape becomes a second row', () => {
    const dir = tempDir()
    const store = createAgentAuthoringStore({ file: join(dir, 'agent-authoring.json') })
    const workspace = workspaceContext('workspace-r7')
    const first = store.saveAutoKeep(autoKeepInput('run-1'), workspace)
    const different = store.saveAutoKeep({
      ...autoKeepInput('run-2'),
      program: PROGRAM.replace('counts.pl += 1', 'counts.pl += 2'),
    }, workspace)
    assert.equal(different.reused, false)
    assert.notEqual(different.tool.id, first.tool.id)
    assert.equal(store.durableToolEntries().length, 2)
  })

  it('different input schemas are different shapes and are labelled by theirs', () => {
    const dir = tempDir()
    const store = createAgentAuthoringStore({ file: join(dir, 'agent-authoring.json') })
    const workspace = workspaceContext('workspace-r7')
    const first = store.saveAutoKeep(autoKeepInput('run-1'), workspace)
    const wider = store.saveAutoKeep({
      ...autoKeepInput('run-2'),
      inputSchema: { ...SCHEMA, properties: { ...SCHEMA.properties, limit: { type: 'number' } } },
    }, workspace)
    assert.equal(wider.reused, false)
    assert.notEqual(wider.tool.id, first.tool.id)
    assert.deepEqual(Object.keys(store.durableToolEntries()[1]?.inputSchema['properties'] ?? {}).sort(), ['limit', 'texts'])
  })

  it('does not reuse a durable row from a different workspace', () => {
    const dir = tempDir()
    const store = createAgentAuthoringStore({ file: join(dir, 'agent-authoring.json') })
    const first = store.saveAutoKeep(autoKeepInput('run-1'), workspaceContext('workspace-a'))
    const other = store.saveAutoKeep(autoKeepInput('run-2'), workspaceContext('workspace-b'))
    assert.equal(first.reused, false)
    assert.equal(other.reused, false, 'another workspace row is not visible to this caller')
    assert.notEqual(other.tool.id, first.tool.id)
    assert.equal(store.durableToolEntries().length, 2)
  })

  it('reuses ONE session draft per shape and root, never another root\'s row', () => {
    const dir = tempDir()
    const store = createAgentAuthoringStore({ file: join(dir, 'agent-authoring.json') })
    const rootA = sessionContext('root-a')
    const rootB = sessionContext('root-b')

    const a1 = store.saveAutoKeep(autoKeepInput('run-1'), rootA)
    const a2 = store.saveAutoKeep(autoKeepInput('run-2'), rootA)
    assert.equal(a2.reused, true)
    assert.equal(a2.tool.id, a1.tool.id)
    assert.equal(store.sessionTools('root-a').length, 1, 'one draft per shape per root')

    const b1 = store.saveAutoKeep(autoKeepInput('run-3'), rootB)
    assert.equal(b1.reused, false, 'another root\'s session draft is never reused')
    assert.notEqual(b1.tool.id, a1.tool.id)
    assert.equal(store.durableToolEntries().length, 0, 'session rows stay out of the durable enumeration')
  })
})

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

describe('R7 — mounted acceptance: one row, uses:3, one digest line', () => {
  it('three same-shape successful runs across sessions produce ONE canonical row with uses:3', async () => {
    const dir = tempDir()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    ctx.provide(PTC_SERVICE, fakeRuntime())
    ctx.provide('sessions' as never, {
      get(id: string) { return { header: { id, cwd: dir } } },
    } as never)
    setConfinementDemonstratedForTest(true)
    await ctx.plugin(plugin, {
      stateFile: join(dir, 'state.json'),
      credentialsFile: join(dir, 'credentials.json'),
      agentAuthoringFile: join(dir, 'agent-authoring.json'),
      artifactScopes: { enabled: true, defaultScope: 'session', workspaceRoot: dir },
      adoption: { autoKeep: 'workspace' },
      hostedCode: true,
    } as never)
    contexts.push(ctx)

    const call = (name: string, args: unknown, sessionId: string) => ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId(`dedupe-${++counter}`),
      name,
      arguments: args,
      agent: { id: sessionId } as never,
    } as never)
    // Three FORMAT variants of the same shape: the content-digest name differs today, so a
    // host that still calls saveDraft mints three rows; the fingerprint sees one shape.
    const variants = ['return 1', '\n  return 1 // same shape\n', 'return 1 /* same shape */']
    for (const [index, sessionId] of ['run-a', 'run-b', 'run-c'].entries()) {
      const run = await call('tool_mode_run', { code: variants[index], tools: [] }, sessionId)
      assert.equal(run.isError, false, JSON.stringify(run))
    }

    const listed = await call('tool_mode_list', {}, 'run-a') as { value?: { authoring?: { tools?: { name: string; uses?: number }[] } } }
    const rows = listed.value?.authoring?.tools ?? []
    const canonical = rows.filter(row => row.name.startsWith('agent_from_draft_'))
    assert.equal(canonical.length, 1, `expected ONE canonical auto-keep row, saw ${canonical.length}: ${JSON.stringify(rows.map(row => ({ name: row.name, uses: row.uses })))}`)
    assert.equal(canonical[0]?.uses, 3, 'the canonical row carries the three uses')
  })
})
