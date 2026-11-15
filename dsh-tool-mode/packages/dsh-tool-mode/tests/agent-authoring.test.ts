/**
 * Agent-authored workflows and tools (research-gap capability).
 *
 * An agent can run a Code Mode program, but it cannot NAME, SAVE, VERSION or RE-USE it,
 * and it cannot define a new tool at all. This suite pins the two new surfaces:
 *
 * - `tool_mode_workflows`: save/list/get/delete/run versioned programs;
 * - `tool_mode_tools`: define/list/get/delete `agent_*` tools that persist, register
 *   immediately, and execute their stored program through the confined runner.
 *
 * The store tests use a real temp file. The mounted tests provide a FAKE PTC runtime
 * (mounted before the plugin, so the host's guard reports already-provided) and open the
 * CODE-09 seam only where a program must actually run; the fake evaluates the program
 * body in-process so the assertions are about the authoring plumbing, never the sandbox.
 *
 * @module tests/agent-authoring
 */

/*
 * This suite is the JSON/registry BOUNDARY: tool results are `unknown` and are cast to the
 * shape under test, and the fake PTC runtime takes untyped values by design. The rules
 * disabled here are production-boundary guards; these tests are the alternative evidence.
 */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import * as plugin from '../src/index.ts'
import { PTC_SERVICE, setConfinementDemonstratedForTest } from '../src/ptc-runtime.ts'
import type { ProgramRuntime } from '../src/tool-mode-run.ts'
import {
  AGENT_TOOL_NAME_PATTERN,
  AuthoringError,
  WORKFLOW_NAME_PATTERN,
  createAgentAuthoringStore,
  defaultAgentAuthoringFile,
  runAuthoredProgram,
} from '../src/agent-authoring.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

/** The seam is inert without the explicit marker; set it before any gate test. */
process.env['DSH_PTC_CONFINEMENT_SEAM'] = 'open-for-acceptance-test'
setConfinementDemonstratedForTest(false)

/**
 * A PTC runtime that evaluates the program body in-process.
 *
 * The host's runner prefixes `const input = await inputSource.read(null);` and passes one
 * namespace per global. Evaluating the body with those globals bound exercises the SAME
 * runner plumbing a real backend does (bindings, input, result) without the OS sandbox.
 */
type FakeRuntime = ProgramRuntime & { readonly runs: () => number }

function makeFakeRuntime(): FakeRuntime {
  let runs = 0
  return {
    runs: () => runs,
    resolve: request => request,
    async run(spec) {
      runs += 1
      const request = spec as {
        program?: unknown
        bindings?: readonly { global: string; functions: Record<string, (args: unknown) => Promise<unknown>> }[]
      }
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

/** The test file's authoring store path; every mounted host gets its own. */
function authoringFile(): string {
  return join(tempDir(), 'agent-authoring.json')
}

/** Mount the real plugin with an isolated authoring file and a provided PTC runtime. */
async function mountHost(
  config: Partial<plugin.Config> = {},
  options: { readonly gateOpen?: boolean } = {},
): Promise<Context> {
  const dir = tempDir()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, makeFakeRuntime())
  if (options.gateOpen === true) setConfinementDemonstratedForTest(true)
  try {
    await ctx.plugin(plugin, {
      stateFile: join(dir, 'state.json'),
      credentialsFile: join(dir, 'credentials.json'),
      agentAuthoringFile: config.agentAuthoringFile ?? authoringFile(),
      hostedCode: options.gateOpen === true,
      ...config,
    })
  } finally {}
  contexts.push(ctx)
  return ctx
}

/** Contexts mounted here, disposed once after the suite. */
const contexts: Context[] = []

/** Invoke a registered tool through the real registry pipeline. */
let counter = 0
async function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`authoring-${++counter}`),
    name,
    arguments: args,
  })
}

/** The successful value of one call, or a thrown failure. */
async function callOk(ctx: Context, name: string, args: unknown) {
  const result = await call(ctx, name, args)
  if (result.isError) throw new Error(`${name} failed: ${result.error?.message ?? 'unknown'}`)
  return result.value
}

describe('agent-authoring store', () => {
  it('versions a workflow on update and persists it across instances', () => {
    const file = authoringFile()
    const store = createAgentAuthoringStore({ file })
    const first = store.saveWorkflow({ name: 'double-value', program: 'return { doubled: input.value * 2 }', tools: [], catalogRevision: 'r1' })
    assert.equal(first.version, 1)
    const second = store.saveWorkflow({ name: 'double-value', program: 'return { doubled: input.value * 3 }', tools: [] })
    assert.equal(second.version, 2, 'saving the same name updates it')
    assert.equal(second.id, first.id)
    assert.equal(second.createdAt, first.createdAt)
    assert.equal(store.listWorkflows().length, 1)

    const reopened = createAgentAuthoringStore({ file })
    assert.equal(reopened.issue, undefined)
    assert.equal(reopened.getWorkflow('double-value')?.program, 'return { doubled: input.value * 3 }')
    assert.equal(reopened.getWorkflow('double-value')?.version, 2)
  })

  it('deletes by name or id and reports an unknown delete', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    const entry = store.saveWorkflow({ name: 'temp-flow', program: 'return 1', tools: [] })
    assert.equal(store.deleteWorkflow(entry.id), true)
    assert.equal(store.deleteWorkflow(entry.id), false)
    assert.equal(store.listWorkflows().length, 0)
  })

  it('tolerates a corrupt file without crashing and keeps serving', () => {
    const file = authoringFile()
    writeFileSync(file, '{ not json', 'utf8')
    const store = createAgentAuthoringStore({ file })
    assert.equal(store.listWorkflows().length, 0)
    assert.match(store.issue ?? '', /not valid JSON/)
    // A save repairs the file atomically; the next instance reads it cleanly.
    store.saveWorkflow({ name: 'repaired', program: 'return 1', tools: [] })
    const reopened = createAgentAuthoringStore({ file })
    assert.equal(reopened.issue, undefined)
    assert.equal(reopened.getWorkflow('repaired')?.name, 'repaired')
  })

  it('validates names and refuses reserved or malformed ones', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    assert.equal(WORKFLOW_NAME_PATTERN.test('double-value'), true)
    assert.equal(WORKFLOW_NAME_PATTERN.test('Double Value'), false)
    assert.equal(WORKFLOW_NAME_PATTERN.test('x'), false)
    assert.throws(() => store.saveWorkflow({ name: 'Bad Name', program: 'return 1', tools: [] }), /name/i)
    assert.equal(AGENT_TOOL_NAME_PATTERN.test('agent_double'), true)
    assert.equal(AGENT_TOOL_NAME_PATTERN.test('agent_xy'), true)
    // Two characters after the reserved prefix: the spec's grammar is {2,60}.
    assert.equal(AGENT_TOOL_NAME_PATTERN.test('agent_x'), false)
    assert.equal(AGENT_TOOL_NAME_PATTERN.test('double'), false)
    assert.equal(AGENT_TOOL_NAME_PATTERN.test('agent_'), false)
  })

  it('validates an authored tool schema and forbids self-binding', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    const schema = { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] }
    const entry = store.saveTool({ name: 'agent_double', description: 'Double a number.', inputSchema: schema, program: 'return { doubled: input.value * 2 }', tools: [] })
    assert.equal(entry.version, 1)
    const updated = store.saveTool({ name: 'agent_double', description: 'Double a number.', inputSchema: schema, program: 'return { doubled: input.value * 2 }', tools: [] })
    assert.equal(updated.version, 2, 're-defining the same name updates it')
    assert.throws(
      () => store.saveTool({ name: 'agent_self', description: 'Self.', inputSchema: schema, program: 'return 1', tools: ['agent_self'] }),
      /itself/,
    )
    assert.throws(
      () => store.saveTool({ name: 'agent_bad', description: 'Bad.', inputSchema: { type: 'array', items: { type: 'string' } }, program: 'return 1', tools: [] }),
      /object/i,
    )
    assert.throws(
      () => store.saveTool({ name: 'agent_bad', description: 'Bad.', inputSchema: { type: 'object', properties: {}, required: ['missing'] }, program: 'return 1', tools: [] }),
      /missing|not declared/i,
    )
  })

  it('derives the default file from the state directory', () => {
    const stateFile = join(tempDir(), 'state.json')
    assert.equal(defaultAgentAuthoringFile(stateFile), join(dirname(stateFile), 'agent-authoring.json'))
    assert.match(defaultAgentAuthoringFile(), /agent-authoring\.json$/)
  })
})

describe('runAuthoredProgram', () => {
  /** A runner whose gate state the test controls. */
  function runnerWith(options: {
    readonly operatorGranted: boolean
    readonly runtime: ProgramRuntime
    readonly grant?: readonly string[]
    readonly visible?: readonly string[]
  }) {
    return {
      prepare: async () => ({ mounted: false, reason: 'already-provided' as const }),
      run: async (request: { program: string; requested: readonly string[]; input?: unknown }) => {
        const allowed = options.grant ?? options.visible ?? []
        const missing = request.requested.filter(name => !allowed.includes(name))
        if (missing.length > 0) return { ok: false as const, code: 'unauthorized' as const, message: `unattainable: ${missing.join(', ')}` }
        return { ok: true as const, value: { doubled: 2 }, logs: [] as string[], toolCalls: 0, calls: [] }
      },
      externalExposurePermitted: () => options.operatorGranted,
      externalExposureReason: () => 'generated-code execution is disabled: the operator has not granted hosted code execution (CODE-10), a separate consent from model-tool access. Operator: set `hostedCode: true` in the tool-mode profile, then restart DSH.',
    }
  }

  it('executes the stored body and reports the receipt facts', async () => {
    const report = await runAuthoredProgram({
      program: 'return { doubled: 2 }',
      tools: [],
      runner: runnerWith({ operatorGranted: true, runtime: makeFakeRuntime() }),
      receiptId: 'rcpt-authored',
      catalogRevision: 'rev-1',
    })
    assert.deepEqual(report.result, { doubled: 2 })
    assert.equal(report.meta.receiptId, 'rcpt-authored')
    assert.equal(report.meta.catalogRevision, 'rev-1')
    assert.equal(report.meta.toolCalls, 0)
  })

  it('refuses execution while the gate is closed, with the actionable message', async () => {
    await assert.rejects(
      runAuthoredProgram({
        program: 'return 1',
        tools: [],
        runner: runnerWith({ operatorGranted: false, runtime: makeFakeRuntime() }),
        receiptId: 'rcpt-closed',
        catalogRevision: 'rev-1',
      }),
      (error: unknown) => error instanceof AuthoringError && /set `hostedCode: true`/.test(error.message),
    )
  })

  it('refuses a tools[] entry the runner cannot attain', async () => {
    await assert.rejects(
      runAuthoredProgram({
        program: 'return 1',
        tools: ['not_granted'],
        runner: runnerWith({ operatorGranted: true, runtime: makeFakeRuntime(), grant: [] }),
        receiptId: 'rcpt-unauth',
        catalogRevision: 'rev-1',
      }),
      /unattainable/,
    )
  })
})

describe('tool_mode_workflows', () => {
  it('registers by default and saves/lists/gets/runs/deletes', async () => {
    const ctx = await mountHost({}, { gateOpen: true })
    const saved = await callOk(ctx, 'tool_mode_workflows', {
      action: 'save',
      name: 'double-value',
      description: 'Double the input value.',
      program: 'return { doubled: input.value * 2 }',
      tools: [],
    }) as { saved: boolean; workflow: { name: string; version: number } }
    assert.equal(saved.saved, true)
    assert.equal(saved.workflow.version, 1)

    const listed = await callOk(ctx, 'tool_mode_workflows', { action: 'list' }) as { workflows: { name: string; program?: string }[] }
    assert.deepEqual(listed.workflows.map(w => w.name), ['double-value'])
    assert.equal('program' in listed.workflows[0]!, false, 'list must not ship the program')

    const got = await callOk(ctx, 'tool_mode_workflows', { action: 'get', name: 'double-value' }) as { workflow: { program: string } }
    assert.equal(got.workflow.program, 'return { doubled: input.value * 2 }')

    const run = await callOk(ctx, 'tool_mode_workflows', { action: 'run', name: 'double-value', input: { value: 21 } }) as {
      workflow: { name: string; version: number }
      result: { doubled: number }
      logs: string[]
      meta: { receiptId: string; toolCalls: number }
    }
    assert.equal(run.result.doubled, 42)
    assert.equal(run.workflow.name, 'double-value')
    assert.ok(run.meta.receiptId.length > 0)
    assert.equal(run.meta.toolCalls, 0)

    const deleted = await callOk(ctx, 'tool_mode_workflows', { action: 'delete', name: 'double-value' }) as { deleted: boolean }
    assert.equal(deleted.deleted, true)
    const after = await callOk(ctx, 'tool_mode_workflows', { action: 'list' }) as { workflows: unknown[] }
    assert.equal(after.workflows.length, 0)
  })

  it('records the run in the receipts surface', async () => {
    const ctx = await mountHost({}, { gateOpen: true })
    await callOk(ctx, 'tool_mode_workflows', { action: 'save', name: 'receipt-flow', program: 'return 1', tools: [] })
    await callOk(ctx, 'tool_mode_workflows', { action: 'run', name: 'receipt-flow' })
    const receipts = await callOk(ctx, 'model_tools', { action: 'receipts' }) as { receipts: { contract: string }[] }
    assert.ok(receipts.receipts.some(receipt => receipt.contract === 'tool_mode_workflows'), 'the run must record a composition receipt')
  })

  it('refuses an unknown workflow with a listed action', async () => {
    const ctx = await mountHost()
    const result = await call(ctx, 'tool_mode_workflows', { action: 'get', name: 'missing' })
    assert.equal(result.isError, true)
    assert.match(JSON.stringify(result), /unknown workflow/)
  })

  it('refuses to RUN while the gate is closed, but still saves the artifact', async () => {
    const ctx = await mountHost()
    const saved = await callOk(ctx, 'tool_mode_workflows', { action: 'save', name: 'gated-flow', program: 'return 1', tools: [] }) as { saved: boolean }
    assert.equal(saved.saved, true, 'saving is not execution and must be allowed')
    const result = await call(ctx, 'tool_mode_workflows', { action: 'run', name: 'gated-flow' })
    assert.equal(result.isError, true)
    assert.match(JSON.stringify(result), /hosted code execution/)
    assert.match(JSON.stringify(result), /set `hostedCode: true`/)
  })
})

describe('tool_mode_tools', () => {
  const SCHEMA = { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] }

  it('defines an agent_* tool, registers it immediately, executes and deletes it', async () => {
    const ctx = await mountHost({}, { gateOpen: true })
    const defined = await callOk(ctx, 'tool_mode_tools', {
      action: 'define',
      name: 'agent_double',
      description: 'Double a number.',
      inputSchema: SCHEMA,
      program: 'return { doubled: input.value * 2 }',
      tools: [],
    }) as { defined: boolean; tool: { name: string; version: number } }
    assert.equal(defined.defined, true)
    assert.ok(ctx.tools.schemas().some(schema => schema.name === 'agent_double'), 'define must register the tool immediately')

    const executed = await callOk(ctx, 'agent_double', { value: 7 })
    assert.equal(typeof executed, 'string', 'an authored tool returns JSON text')
    assert.deepEqual(JSON.parse(executed as string), { doubled: 14 })

    const listed = await callOk(ctx, 'tool_mode_tools', { action: 'list' }) as { tools: { name: string; program?: string }[] }
    assert.deepEqual(listed.tools.map(tool => tool.name), ['agent_double'])
    assert.equal('program' in listed.tools[0]!, false, 'list must not ship the program')

    await callOk(ctx, 'tool_mode_tools', { action: 'delete', name: 'agent_double' })
    assert.equal(ctx.tools.schemas().some(schema => schema.name === 'agent_double'), false, 'delete must unregister it')
  })

  it('re-registers stored authored tools on the next mount', async () => {
    const file = authoringFile()
    const first = await mountHost({ agentAuthoringFile: file })
    await callOk(first, 'tool_mode_tools', {
      action: 'define', name: 'agent_persist', description: 'Persist.', inputSchema: SCHEMA, program: 'return { doubled: input.value * 2 }', tools: [],
    })
    const second = await mountHost({ agentAuthoringFile: file }, { gateOpen: true })
    assert.ok(second.tools.schemas().some(schema => schema.name === 'agent_persist'), 'a remount must register the stored tool')
    const executed = await callOk(second, 'agent_persist', { value: 4 })
    assert.deepEqual(JSON.parse(executed as string), { doubled: 8 })
  })

  it('refuses a name that collides with a registered tool', async () => {
    const ctx = await mountHost()
    ctx.tools.register(defineTool({
      name: 'agent_taken',
      description: 'A foreign tool.',
      parameters: {},
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'foreign' }] },
      async execute() { return 'foreign' as never },
    }))
    const result = await call(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_taken', description: 'Collide.', inputSchema: SCHEMA, program: 'return 1', tools: [],
    })
    assert.equal(result.isError, true)
    assert.match(JSON.stringify(result), /already registered|collides|taken/i)
  })

  it('refuses a self-binding tools[] list and a bad input schema', async () => {
    const ctx = await mountHost()
    const self = await call(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_self', description: 'Self.', inputSchema: SCHEMA, program: 'return 1', tools: ['agent_self'],
    })
    assert.equal(self.isError, true)
    assert.match(JSON.stringify(self), /itself/)

    const bad = await call(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_bad', description: 'Bad.', inputSchema: { type: 'array', items: { type: 'string' } }, program: 'return 1', tools: [],
    })
    assert.equal(bad.isError, true)
    assert.match(JSON.stringify(bad), /object/i)
  })

  it('refuses to EXECUTE while the gate is closed, though define still persists', async () => {
    const ctx = await mountHost()
    const defined = await callOk(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_gated', description: 'Gated.', inputSchema: SCHEMA, program: 'return 1', tools: [],
    }) as { defined: boolean }
    assert.equal(defined.defined, true)
    const result = await call(ctx, 'agent_gated', { value: 1 })
    assert.equal(result.isError, true)
    assert.match(JSON.stringify(result), /hosted code execution/)
  })
})

describe('allowAgentAuthoring:false', () => {
  it('registers neither authoring tool nor any stored authored tool', async () => {
    const file = authoringFile()
    const store = createAgentAuthoringStore({ file })
    store.saveTool({ name: 'agent_hidden', description: 'Hidden.', inputSchema: { type: 'object', properties: {} }, program: 'return 1', tools: [] })
    const ctx = await mountHost({ agentAuthoringFile: file, allowAgentAuthoring: false })
    const names = ctx.tools.schemas().map(schema => schema.name)
    assert.equal(names.includes('tool_mode_workflows'), false)
    assert.equal(names.includes('tool_mode_tools'), false)
    assert.equal(names.includes('agent_hidden'), false, 'the whole surface is off')
  })
})
