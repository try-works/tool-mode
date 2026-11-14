/**
 * Cross-surface agreement: `model_tools` and `tool_mode_list` must describe the same
 * model-tool readiness.
 *
 * The two tools answer different questions — `model_tools` lists the catalog, `tool_mode_list`
 * lists the caller's permitted tool surface — but a caller comparing them must not see one
 * say "callable" and the other "unavailable" for the same model, nor two different tool
 * identities. Both are read from ONE mounted plugin, so they share the same installed set.
 *
 * @module tests/model-surface-agreement
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import { MODEL_TOOL_STATES } from '../src/model-surface.ts'
import { loadCatalog } from '../src/index.ts'
import { cleanup, mountPlugin } from './helpers.ts'

after(async () => { await cleanup() })

let counter = 0

/** Invoke one registered tool through the real pipeline. */
async function call(ctx: Awaited<ReturnType<typeof mountPlugin>>, name: string, args: unknown): Promise<never> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`agreement-${++counter}`),
    name,
    arguments: args,
  })
  if (result.isError) throw new Error(`${name} failed: ${result.error?.message ?? 'unknown'}`)
  return result.value as never
}

/** One `model_tools` catalog row, as far as this test reads it. */
interface ModelRow {
  readonly id: string
  readonly tool: string
  readonly toolName: string
  readonly state: string
  readonly extension: string | null
  readonly runnable: boolean
  readonly installed: boolean
  readonly reason: string
}

/** One `tool_mode_list` row, as far as this test reads it. */
interface CatalogRow {
  readonly name: string
  readonly model: string | null
  readonly toolName: string
  readonly state: string
  readonly readiness: string
  readonly extension: string | null
}

describe('model_tools and tool_mode_list agree on model-tool readiness', () => {
  it('publishes one state and one tool/model identity for every catalog model', async () => {
    const ctx = await mountPlugin()
    const models = ((await call(ctx, 'model_tools', { action: 'list' })) as { models: ModelRow[] }).models
    const tools = ((await call(ctx, 'tool_mode_list', {})) as { tools: CatalogRow[] }).tools
    const catalogRows = tools.filter(row => row.model !== null)

    // Both surfaces carry the WHOLE catalog, read from the same mounted plugin (so the
    // same installed set): one row per catalog entry on each side.
    const catalog = loadCatalog()
    assert.equal(models.length, catalog.length, 'model_tools must list every catalog model')
    assert.equal(catalogRows.length, catalog.length, 'tool_mode_list must list every catalog model')

    const byId = new Map(models.map(model => [model.id, model]))
    assert.equal(byId.size, models.length, 'a model id must appear once')

    for (const row of catalogRows) {
      const model = byId.get(row.model ?? '')
      assert.ok(model !== undefined, `tool_mode_list names ${String(row.model)}, which model_tools does not`)

      // ONE readiness derivation, one vocabulary.
      assert.equal(model.state, row.state, `${model.id}: the surfaces must report the same state`)
      assert.ok((MODEL_TOOL_STATES as readonly string[]).includes(model.state), `${model.id}: ${model.state} is not a state`)
      if (model.runnable) assert.equal(model.state, 'callable', `${model.id}: a runnable model must be callable`)

      // ONE tool identity and ONE model identity.
      assert.equal(model.toolName, row.toolName, `${model.id}: the catalog tool identity must match`)
      assert.equal(model.id, row.model, `${model.id}: the model identity must match`)
      assert.equal(model.extension, row.extension, `${model.id}: the extension binding must match`)
      // The name actually callable on the tool surface is the one model_tools reports
      // as registered (the same record on both sides).
      assert.equal(model.tool, row.name, `${model.id}: the registered tool name must match`)

      // readiness is kept for compatibility; it must not contradict state.
      if (model.state === 'callable') {
        assert.equal(row.readiness, 'callable', `${model.id}: a callable state must read callable`)
      } else {
        assert.equal(row.readiness, `unavailable: ${model.reason}`, `${model.id}: readiness must keep the verdict reason`)
      }
    }
  })
})
