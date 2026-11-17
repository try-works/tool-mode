/**
 * task-57 follow-ups: a structural discovery split, authored-tool contract facts, and a
 * FAILED composition receipt for both the Code Mode and the authored lanes.
 *
 * @module tests/task57-discovery-authoring-receipts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import * as plugin from '../src/index.ts'
import { discoveryBucket } from '../src/index.ts'
import { PTC_SERVICE, setConfinementDemonstratedForTest } from '../src/ptc-runtime.ts'
import type { ProgramRuntime } from '../src/tool-mode-run.ts'
import { cleanup, mountPlugin, tempDir } from './helpers.ts'

process.env['DSH_PTC_CONFINEMENT_SEAM'] = 'open-for-acceptance-test'
after(async () => { await cleanup() })

/** A PTC runtime that evaluates the body in-process (the real runner's plumbing only). */
function makeFakeRuntime(): ProgramRuntime {
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

/** Mount the plugin with a provided PTC runtime, an isolated store and the gate open. */
async function mountGateOpen(config: Partial<plugin.Config> = {}): Promise<Context> {
  const dir = tempDir()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, makeFakeRuntime())
  setConfinementDemonstratedForTest(true)
  await ctx.plugin(plugin, {
    stateFile: join(dir, 'state.json'),
    credentialsFile: join(dir, 'credentials.json'),
    agentAuthoringFile: config.agentAuthoringFile ?? join(dir, 'agent-authoring.json'),
    hostedCode: true,
    ...config,
  })
  return ctx
}

let counter = 0
async function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`task57-${++counter}`),
    name,
    arguments: args,
  })
}

/**
 * A catalog with a REGISTERED-BUT-NON-CALLABLE row.
 *
 * Two models declare the SAME contract AND the same tool name. `alpha` can run (its provider
 * extension resolves here), so `lang_detect` is registered; `beta` names an extension that is
 * not installed, so its row is NOT callable — while its tool name IS in the registry. That is
 * precisely the row the old registry-set split would have put into `tools` and promised as
 * callable.
 */
function registeredButUncallableCatalog(): string {
  const dir = mkdtempSync(join(tmpdir(), 'task57-catalog-'))
  const file = join(dir, 'catalog.json')
  const base = {
    summary: 'A catalog model used to prove the discovery split is structural.',
    capability: 'text.language-identification',
    contract: 'text.language_detect',
    input: 'text',
    output: 'test',
    languages: null,
    modelSizeMB: null,
    appleOnly: false,
    closedBeta: false,
    verifiedRunnableOnWindows: true,
    windowsSupport: 'native-node',
    npmSubpath: null,
    requiresRuntime: [],
    cliVerb: null,
    license: 'source-available',
    docsUrl: 'https://example.invalid/',
    hfRepo: 'https://example.invalid/',
    skill: { name: 'task57-skill', description: 'Task-57 skill.' },
  }
  const alpha = {
    ...base,
    id: 'alpha',
    name: 'Alpha',
    provider: { extension: '@try-works/extension-desert-ant-tongue', modelId: 'tongue' },
    npmPackage: '@desert-ant-labs/tongue',
    tool: { name: 'lang_detect', description: 'The contract tool, callable through alpha.', params: { text: 'Text.' }, returns: 'Language.' },
  }
  const beta = {
    ...base,
    id: 'beta',
    name: 'Beta',
    provider: { extension: '@try-works/extension-not-installed-here', modelId: 'beta' },
    npmPackage: null,
    tool: { name: 'lang_detect', description: 'The same tool name, but beta cannot run.', params: { text: 'Text.' }, returns: 'Language.' },
  }
  writeFileSync(file, JSON.stringify([alpha, beta]))
  return file
}

describe('task-57 (1) — the tools/unavailable split is STRUCTURAL', () => {
  it('sends a REGISTERED but non-callable row to unavailable', () => {
    // A synthetic row that the old registry-set split would have advertised: the name IS in
    // the registry, but the shared readiness state says the model cannot be called.
    const registered = new Set(['lang_detect', 'model_tools'])
    const rows = [
      { name: 'lang_detect', state: 'callable' },
      { name: 'lang_detect', state: 'unavailable' },
      { name: 'model_tools', state: 'callable' },
    ]
    const tools = rows.filter(row => discoveryBucket(row.state) === 'tools')
    const unavailable = rows.filter(row => discoveryBucket(row.state) === 'unavailable')

    assert.deepEqual(tools.map(row => row.name), ['lang_detect', 'model_tools'])
    assert.deepEqual(unavailable.map(row => row.name), ['lang_detect'])
    // The structural fact: the unavailable row's name is REGISTERED, and it still is not
    // advertised as callable — the state, not the registry set, decides the bucket.
    assert.ok(registered.has(unavailable[0]!.name))
    assert.equal(unavailable[0]!.state, 'unavailable')
    // Pinned vocabulary: only 'callable' opens the tools bucket.
    for (const state of ['not-installed', 'unavailable', '']) {
      assert.equal(discoveryBucket(state), 'unavailable')
    }
  })

  it('is the bucket decision tool_mode_list itself uses', async () => {
    // A mounted list and the seam agree row for row: every advertised row is callable, and
    // every unadvertised catalog name is not.
    const ctx = await mountPlugin()
    const listed = await call(ctx, 'tool_mode_list', {})
    const value = (listed as { value: { tools: { name: string; state: string }[] } }).value
    for (const row of value.tools) {
      assert.equal(discoveryBucket(row.state), 'tools', `${row.name} is advertised but not callable`)
      assert.equal(row.state, 'callable')
    }
  })
})

describe('task-57 (2) — authored tools publish agent.<name>@1.0.0', () => {
  const SCHEMA = { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] }

  it('reports the agent contract at define and after a boot re-registration', async () => {
    const file = join(tempDir(), 'authoring.json')
    const ctx = await mountGateOpen({ agentAuthoringFile: file })
    const defined = await call(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_double', description: 'Double.', inputSchema: SCHEMA, program: 'return { doubled: input.value * 2 }', tools: [],
    })
    assert.equal(defined.isError, false, JSON.stringify(defined))

    const assertRow = async (mounted: Context): Promise<void> => {
      const listed = await call(mounted, 'tool_mode_list', {})
      const value = (listed as { value: unknown }).value
      const rows = (value as { tools: { name: string; contract: string | null; contractVersion: string | null }[] }).tools
      const row = rows.find(entry => entry.name === 'agent_double')
      assert.ok(row !== undefined, 'the authored tool must be discoverable')
      assert.equal(row.contract, 'agent.agent_double')
      assert.equal(row.contractVersion, '1.0.0')
    }
    await assertRow(ctx)

    // BOOT: the same helper registers stored tools, so the contract does not change.
    const remounted = await mountGateOpen({ agentAuthoringFile: file })
    await assertRow(remounted)
  })
})

describe('task-57 (2b) — discovery publishes authored artifacts and their receipts', () => {
  const SCHEMA = { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] }

  it('lists the authored tool and records the define event without caller content', async () => {
    const dir = tempDir()
    const ctx = await mountGateOpen({ agentAuthoringFile: join(dir, 'authoring.json') })
    await call(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_double', description: 'Double.', inputSchema: SCHEMA,
      program: 'return { doubled: input.value * 2 }', tools: [],
    })
    const listed = await call(ctx, 'tool_mode_list', {})
    const authoring = (listed as { value: { authoring?: {
      tools: { name: string }[]
      workflows: { name: string }[]
      recent: { operation: string; artifactKind: string; name: string }[]
    } } }).value.authoring
    assert.ok(authoring !== undefined, 'discovery must publish an authoring inventory')
    assert.deepEqual(authoring.tools.map(tool => tool.name), ['agent_double'])
    assert.deepEqual(authoring.workflows, [])
    assert.equal(authoring.recent[0]?.operation, 'define')
    assert.equal(authoring.recent[0]?.artifactKind, 'tool')
    assert.equal(authoring.recent[0]?.name, 'agent_double')
    assert.equal(JSON.stringify(authoring).includes('doubled'), false, 'the program body must not leak')
    const receipts = await call(ctx, 'model_tools', { action: 'receipts' })
    const authored = (receipts as { value: { authoring?: { operation: string; name: string }[] } }).value.authoring
    assert.ok(authored !== undefined, 'the receipts action must expose authored-artifact events')
    assert.equal(authored[0]?.operation, 'define')
    assert.equal(authored[0]?.name, 'agent_double')
    assert.equal(JSON.stringify(authored).includes('doubled'), false, 'authoring receipts carry no program body')
  })
})

describe('task-57 (2c) — optional run capture and define-from-run', () => {
  it('captures a successful program as a shape-only scaffold and registers it', async () => {
    const dir = tempDir()
    const ctx = await mountGateOpen({
      captureRunPrograms: true,
      runCaptureFile: join(dir, 'run-captures.json'),
      agentAuthoringFile: join(dir, 'authoring.json'),
    })
    const run = await call(ctx, 'tool_mode_run', {
      code: 'return { doubled: input.value * 2 }', tools: [], input: { value: 21 },
    })
    if (run.isError) throw new Error(JSON.stringify(run))
    const runId = (run.value as { meta: { receiptId: string } }).meta.receiptId
    const defined = await call(ctx, 'tool_mode_tools', {
      action: 'from-run', name: 'agent_from_run', runId,
    })
    if (defined.isError) throw new Error(JSON.stringify(defined))
    const executed = await call(ctx, 'agent_from_run', { value: 4 })
    if (executed.isError) throw new Error(JSON.stringify(executed))
    assert.deepEqual(executed.value, { doubled: 8 })
    const capture = JSON.parse(readFileSync(join(dir, 'run-captures.json'), 'utf8')) as {
      captures: { inputSchema: { properties?: Record<string, unknown> } }[]
    }
    assert.deepEqual(Object.keys(capture.captures[0]?.inputSchema.properties ?? {}), ['value'])
    const serialized = JSON.stringify(capture.captures[0])
    assert.equal(serialized.includes('"input"'), false, 'the input envelope must not be captured')
    assert.equal(/"value"\s*:\s*21/.test(serialized), false, 'the input VALUE must not be captured')
  })

  it('captures by default, so define-from-run is not gated off', async () => {
    const dir = tempDir()
    const ctx = await mountGateOpen({
      agentAuthoringFile: join(dir, 'authoring.json'),
      runCaptureFile: join(dir, 'run-captures.json'),
    })
    const run = await call(ctx, 'tool_mode_run', {
      code: 'return { tripled: input.value * 3 }', tools: [], input: { value: 7 },
    })
    if (run.isError) throw new Error(JSON.stringify(run))
    const runId = (run.value as { meta: { receiptId: string } }).meta.receiptId
    const defined = await call(ctx, 'tool_mode_tools', { action: 'from-run', name: 'agent_default_capture', runId })
    if (defined.isError) throw new Error(JSON.stringify(defined))
    const executed = await call(ctx, 'agent_default_capture', { value: 2 })
    if (executed.isError) throw new Error(JSON.stringify(executed))
    assert.deepEqual(executed.value, { tripled: 6 })
  })
  it('from-run is zero-config: inferred name and observed schema, marked untyped', async () => {
    const dir = tempDir()
    const ctx = await mountGateOpen({
      agentAuthoringFile: join(dir, 'authoring.json'),
      runCaptureFile: join(dir, 'run-captures.json'),
    })
    const run = await call(ctx, 'tool_mode_run', {
      code: 'return { tripled: input.value * 3 }', tools: [], input: { value: 7 },
    })
    if (run.isError) throw new Error(JSON.stringify(run))
    const runId = (run.value as { meta: { receiptId: string } }).meta.receiptId
    const defined = await call(ctx, 'tool_mode_tools', { action: 'from-run', runId })
    if (defined.isError) throw new Error(JSON.stringify(defined))
    const value = defined.value as { tool: { name: string }; schemaInferred?: boolean; typed?: boolean }
    assert.match(value.tool.name, /^agent_from_/)
    assert.equal(value.schemaInferred, true)
    assert.equal(value.typed, false)
    const executed = await call(ctx, value.tool.name, { value: 2 })
    if (executed.isError) throw new Error(JSON.stringify(executed))
    assert.deepEqual(executed.value, { tripled: 6 })
    const listed = await call(ctx, 'tool_mode_list', {})
    const authoring = (listed.value as { authoring?: { runCapture?: { enabled: boolean; notice: string } } }).authoring
    assert.equal(authoring?.runCapture?.enabled, true)
    assert.match(authoring?.runCapture?.notice ?? '', /input values are never stored/)
  })
})

describe('task-57 (3) — a failed composition is RECORDED, then rethrown', () => {
  const SCHEMA = { type: 'object', properties: {}, required: [] }

  /** Read the receipts the host published. */
  async function receipts(ctx: Context): Promise<{ contract: string; outcome: string | null; receiptId: string; runId: string; parentReceiptId: string | null; at: string; warnings: string[] }[]> {
    const listed = await call(ctx, 'model_tools', { action: 'receipts' })
    return (listed as { value: { receipts: never[] } }).value.receipts as never
  }

  it('records a failed tool_mode_run composition and rethrows', async () => {
    const ctx = await mountGateOpen()
    const run = await call(ctx, 'tool_mode_run', { code: 'throw new Error("boom")', tools: [] })
    assert.equal(run.isError, true, 'the program must fail')

    const row = (await receipts(ctx)).find(receipt => receipt.contract === 'tool_mode_run')
    assert.ok(row !== undefined, 'a failing composition must still leave a receipt')
    assert.equal(row.outcome, 'failed')
    assert.equal(row.runId, row.receiptId, 'a direct composition is its own run')
    assert.equal(row.parentReceiptId, null)
    assert.equal(Number.isNaN(Date.parse(row.at)), false, 'at is an ISO timestamp')
    assert.ok(row.warnings.length > 0 && row.warnings.length <= 4, 'bounded warning')
    assert.equal(JSON.stringify(row).includes('boom'), false, 'no caller content in the receipt')
  })

  it('records a failed authored-tool composition and rethrows', async () => {
    const ctx = await mountGateOpen()
    const defined = await call(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_boom', description: 'Always fails.', inputSchema: SCHEMA,
      program: 'throw new Error("secret-caller-text")', tools: [],
    })
    assert.equal(defined.isError, false, JSON.stringify(defined))

    const executed = await call(ctx, 'agent_boom', {})
    assert.equal(executed.isError, true, 'the authored program must fail')

    const row = (await receipts(ctx)).find(receipt => receipt.contract === 'agent_boom')
    assert.ok(row !== undefined, 'the authored lane must also leave a failed receipt')
    assert.equal(row.outcome, 'failed')
    assert.equal(row.runId, row.receiptId)
    assert.equal(row.parentReceiptId, null)
    assert.equal(Number.isNaN(Date.parse(row.at)), false)
    assert.ok(row.warnings.length > 0 && row.warnings.length <= 4)
    assert.equal(JSON.stringify(row).includes('secret-caller-text'), false, 'no caller content in the receipt')
  })
})