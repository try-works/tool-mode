/**
 * Receipt enrichment (task-53): every receipt carries a run identity and a timestamp,
 * and a composed run is recoverable from data alone.
 *
 * - `runId` is the COMPOSITION identity: a direct call is its own run, and every nested
 *   call of a composed run carries the composition receipt's id.
 * - `at` is the host clock when the receipt was authored (ISO 8601).
 * - `outcome` is honest: 'ok'/'failed' from the trace, or null when the lane cannot know.
 *
 * The composed cases drive the REAL tool_mode_run / authored-tool path with the fake PTC
 * runner the harness supplies (mounted as the PTC service before the plugin), and open the
 * CODE-09 seam only for those runs.
 *
 * @module tests/receipt-enrichment
 */

/*
 * This suite is the registry/receipt BOUNDARY: tool results are `unknown` and are cast to
 * the row under test, and the fake PTC runtime takes untyped values by design. The rules
 * disabled here are production-boundary guards; these tests are the alternative evidence.
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
import { PTC_SERVICE, setConfinementDemonstratedForTest } from '../src/ptc-runtime.ts'
import { MAX_RETAINED_RECEIPTS } from '../src/receipt.ts'
import type { ProgramRuntime } from '../src/tool-mode-run.ts'
import { callTool, cleanup, isolatedStateFile, mountPluginWithTongue, tempDir } from './helpers.ts'

process.env['DSH_PTC_CONFINEMENT_SEAM'] = 'open-for-acceptance-test'
setConfinementDemonstratedForTest(false)

const contexts: Context[] = []
after(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  setConfinementDemonstratedForTest(false)
  await cleanup()
})

/** A receipt row as the receipts action reports it (the subset these tests read). */
interface ReceiptRow {
  readonly receiptId: string
  readonly contract: string
  readonly kind: string
  readonly at: string
  readonly runId: string
  readonly parentReceiptId: string | null
  readonly outcome: string | null
}

/** Every row the receipts action returns. */
async function receiptsOf(ctx: Context): Promise<ReceiptRow[]> {
  const result = await callTool(ctx, 'model_tools', { action: 'receipts' })
  if (result.isError) throw new Error(`receipts failed: ${result.error?.message ?? 'unknown'}`)
  return (result.value as { receipts: ReceiptRow[] }).receipts
}

/** Assert the fields every row must carry, whatever lane produced it. */
function assertEnriched(rows: readonly ReceiptRow[]): void {
  assert.ok(rows.length > 0, 'expected at least one receipt')
  for (const row of rows) {
    assert.match(row.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, `${row.receiptId}: at must be ISO`)
    assert.equal(Number.isNaN(Date.parse(row.at)), false)
    assert.equal(typeof row.runId, 'string')
    assert.ok(row.runId.length > 0, `${row.receiptId}: runId must be non-empty`)
  }
}

/**
 * A PTC runtime that evaluates the program body in-process with the host's binding
 * namespaces (the same fake the authoring suite uses; never a real sandbox).
 */
function makeFakeRuntime(): ProgramRuntime {
  return {
    resolve: request => request,
    async run(spec) {
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

/** Mount the plugin with the fake PTC runtime provided and the gate OPEN. */
async function mountComposed(config: Partial<plugin.Config> = {}): Promise<Context> {
  const dir = tempDir()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.provide(PTC_SERVICE, makeFakeRuntime())
  setConfinementDemonstratedForTest(true)
  try {
    await ctx.plugin(plugin, {
      stateFile: join(dir, 'state.json'),
      credentialsFile: join(dir, 'credentials.json'),
      agentAuthoringFile: join(dir, 'agent-authoring.json'),
      hostedCode: true,
      ...config,
    } as never)
  } finally {
    setConfinementDemonstratedForTest(false)
  }
  contexts.push(ctx)
  return ctx
}

/** Invoke a registered tool through the real registry pipeline. */
let counter = 0
async function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`receipt-enrichment-${++counter}`),
    name,
    arguments: args,
  })
}

describe('task-53 — a direct contract call records an enriched receipt', () => {
  it('carries an ISO at, runId === receiptId, outcome ok and a null parent', async () => {
    const ctx = await mountPluginWithTongue({ stateFile: isolatedStateFile() })
    const called = await callTool(ctx, 'lang_detect', { text: 'hallo wereld' })
    assert.equal(called.isError, false, JSON.stringify(called))

    const rows = await receiptsOf(ctx)
    const direct = rows.find(row => row.contract === 'text.language_detect')
    assert.ok(direct, 'the direct call must record a receipt')
    assert.match(direct.at, /^\d{4}-\d{2}-\d{2}T/, 'at must be an ISO timestamp')
    assert.equal(direct.runId, direct.receiptId, 'a direct call is its own composition run')
    assert.equal(direct.parentReceiptId, null)
    assert.equal(direct.outcome, 'ok')
    assertEnriched(rows)
  })
})

describe('task-53 — a composed run is recoverable from data alone', () => {
  it('parents every nested receipt to the composition and gives them its runId', async () => {
    const ctx = await mountComposed()
    // An authored tool is a real, program-callable tool (control tools are excluded from
    // Code Mode by CODE-07), so it can supply both the successful and the failing sub-call.
    const defined = await call(ctx, 'tool_mode_tools', {
      action: 'define',
      name: 'agent_nested_echo',
      description: 'Echo a value for a composed run.',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      program: 'return input.value',
      tools: [],
    })
    assert.equal(defined.isError, false, JSON.stringify(defined))
    const result = await call(ctx, 'tool_mode_run', {
      code: [
        "await tools.agent_nested_echo({ value: 'a' })",
        'let failed = false',
        'try { await tools.agent_nested_echo({}) } catch { failed = true }',
        'return { failed }',
      ].join('\n'),
      tools: ['agent_nested_echo'],
    })
    assert.equal(result.isError, false, JSON.stringify(result))

    const rows = await receiptsOf(ctx)
    const composition = rows.find(row => row.contract === 'tool_mode_run')
    assert.ok(composition, 'the composition receipt must exist')
    assert.equal(composition.runId, composition.receiptId, 'the composition is its own run')
    assert.equal(composition.parentReceiptId, null)
    assert.equal(composition.outcome, 'ok')
    assert.match(composition.at, /^\d{4}-\d{2}-\d{2}T/)

    // Only the outer run's trace rows: the authored tool records its own composition too.
    const nested = rows.filter(row => row.kind === 'nested' && row.parentReceiptId === composition.receiptId)
    assert.ok(nested.length >= 2, `expected both traced sub-calls, saw ${nested.length}`)
    for (const row of nested) {
      assert.equal(row.parentReceiptId, composition.receiptId)
      assert.equal(row.runId, composition.receiptId, 'a nested call belongs to the composition run')
      assert.match(row.at, /^\d{4}-\d{2}-\d{2}T/)
    }
    assert.deepEqual(
      nested.map(row => row.outcome).sort(),
      ['failed', 'ok'],
      'the trace reports the sub-call outcome honestly, both directions',
    )
    // The trace rows are recorded before the composition that owns them.
    assert.ok(rows.indexOf(nested[0]!) < rows.indexOf(composition))
    assertEnriched(rows)
  })
})

describe('task-53 — a bare-string-output authored tool still records a receipt', () => {
  it('records an enriched receipt for a tool whose value is a bare string, not an envelope', async () => {
    const ctx = await mountComposed()
    const defined = await call(ctx, 'tool_mode_tools', {
      action: 'define',
      name: 'agent_echo_text',
      description: 'Return the input value as-is.',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      program: 'return input.value',
      tools: [],
    })
    assert.equal(defined.isError, false, JSON.stringify(defined))

    const executed = await call(ctx, 'agent_echo_text', { value: 'plain string' })
    assert.equal(executed.isError, false, JSON.stringify(executed))
    assert.equal(executed.value, 'plain string', 'the authored tool returns its value, not JSON text')

    const rows = await receiptsOf(ctx)
    const receipt = rows.find(row => row.contract === 'agent_echo_text')
    assert.ok(receipt, 'a bare-string-output tool must still record a receipt')
    assert.equal(receipt.runId, receipt.receiptId)
    assert.equal(receipt.parentReceiptId, null)
    assert.equal(receipt.outcome, 'ok')
    assertEnriched(rows)
  })
})

describe('task-53 — retention is unchanged', () => {
  it('keeps the same bounded retention constant', () => {
    assert.equal(MAX_RETAINED_RECEIPTS, 200)
  })
})
