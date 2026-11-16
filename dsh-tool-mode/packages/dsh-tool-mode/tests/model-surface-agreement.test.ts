/**
 * Cross-surface agreement: `model_tools` and `tool_mode_list` must describe the same
 * model-tool readiness, and `tool_mode_list` must not advertise a name that cannot be bound.
 *
 * The two tools answer different questions — `model_tools` lists the catalog, `tool_mode_list`
 * lists the caller's permitted tool surface — but a caller comparing them must not see one
 * say "callable" and the other "unavailable" for the same model, nor two different tool
 * identities. Both are read from ONE mounted plugin, so they share the same installed set.
 *
 * THE P4 INVARIANT, stated once: every catalog model appears in `tools` OR in `unavailable`,
 * exactly once. `tools` holds only names the registry actually serves (so a program binding
 * them cannot be refused as unattainable), and `unavailable` explains each absence with the
 * SAME state and reason `model_tools` publishes.
 *
 * @module tests/model-surface-agreement
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import { MODEL_TOOL_STATES } from '../src/model-surface.ts'
import { TOOL_MODE_LIST_CONTRACT } from '../src/discovery-contracts.ts'
import { loadCatalog } from '../src/index.ts'
import { buildToolBindings } from '../src/ptc-runtime.ts'
import { callTool, cleanup, mountPlugin, mountPluginWithTongue } from './helpers.ts'

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
  readonly reason: string
  readonly extension: string | null
  readonly runnable: boolean
  readonly installed: boolean
  readonly withheld?: { readonly code: string; readonly message: string }
  readonly provenance: { readonly publishedTool: string | null }
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

/** One `unavailable` row. */
interface UnavailableRow {
  readonly name: string
  readonly model: string
  readonly extension: string | null
  readonly state: string
  readonly reason: string
}

describe('model_tools and tool_mode_list agree on model-tool readiness', () => {
  it('publishes one state and one tool/model identity for every catalog model', async () => {
    const ctx = await mountPlugin()
    const models = ((await call(ctx, 'model_tools', { action: 'list' })) as { models: ModelRow[] }).models
    const list = (await call(ctx, 'tool_mode_list', {})) as { tools: CatalogRow[]; unavailable: UnavailableRow[] }
    const catalogRows = list.tools.filter(row => row.model !== null)

    // Both surfaces carry the WHOLE catalog, read from the same mounted plugin (so the
    // same installed set): one row per catalog entry on each side.
    const catalog = loadCatalog()
    assert.equal(models.length, catalog.length, 'model_tools must list every catalog model')
    assert.equal(catalogRows.length + list.unavailable.length, catalog.length,
      'every catalog model must appear exactly once in tools or unavailable')

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
      // P4: a name advertised in `tools` is a name a program can bind.
      assert.equal(row.state, 'callable', `${model.id}: only a callable model may sit in tools`)

      // readiness is kept for compatibility; it must not contradict state.
      assert.equal(row.readiness, 'callable', `${model.id}: a callable state must read callable`)
    }
  })

  it('explains every absent catalog model once, with the same state and reason as model_tools', async () => {
    const ctx = await mountPlugin()
    const models = ((await call(ctx, 'model_tools', { action: 'list' })) as { models: ModelRow[] }).models
    const list = (await call(ctx, 'tool_mode_list', {})) as { tools: CatalogRow[]; unavailable: UnavailableRow[] }
    const byId = new Map(models.map(model => [model.id, model]))

    assert.ok(list.unavailable.length > 0, 'a default mount must have at least one unavailable catalog model')
    const seen = new Set<string>()
    for (const row of list.unavailable) {
      assert.equal(seen.has(row.model), false, `${row.model} must be explained once`)
      seen.add(row.model)
      const model = byId.get(row.model)
      assert.ok(model !== undefined, `unavailable names ${row.model}, which model_tools does not`)
      // SAME state and reason: one readiness derivation, copied — never re-worded.
      assert.equal(row.state, model.state, `${row.model}: unavailable state must equal model_tools`)
      assert.equal(row.reason, model.reason, `${row.model}: unavailable reason must equal model_tools`)
      assert.ok(row.reason.length > 0, `${row.model}: an unavailable row must explain itself`)
      assert.equal(row.extension, model.extension, `${row.model}: the extension binding must match`)
      // And the catalog's tool identity is the row's name.
      assert.equal(row.name, model.tool, `${row.model}: the unavailable name must be the registered tool name`)
    }
  })

  it('advertises only names the registry serves, so a program can bind every listed tool', async () => {
    const ctx = await mountPlugin()
    const list = (await call(ctx, 'tool_mode_list', {})) as { tools: CatalogRow[] }
    const registry = new Set(ctx.tools.schemas().map(schema => schema.name))

    for (const row of list.tools) {
      assert.ok(registry.has(row.name), `${row.name} is listed in tools but the registry does not serve it`)
    }

    // THE GATE ITSELF, over the CATALOG tools: the five Tool Mode control tools are
    // callable directly but deliberately excluded from programs, so the P4
    // invariant is about the catalog names this list advertises.
    const advertised = list.tools.filter(row => row.model !== null).map(row => row.name)
    const granted = new Set(advertised)
    const bound = buildToolBindings({
      requested: advertised,
      authority: { granted, visible: [...registry], confidential: [] },
      resolve: () => async () => 'ok',
    })
    assert.equal(bound.ok, true, `binding every advertised tool must not refuse the whole request: ${bound.ok ? '' : bound.message}`)

    // And an unavailable catalog name IS refused, which is why it is not in `tools`.
    const unavailable = (await call(ctx, 'tool_mode_list', {}) as { unavailable: UnavailableRow[] }).unavailable
    const refused = buildToolBindings({
      requested: [unavailable[0]!.name],
      authority: { granted: new Set([unavailable[0]!.name]), visible: [...registry], confidential: [] },
      resolve: () => undefined,
    })
    assert.equal(refused.ok, false, 'an unattainable name must still refuse the whole request')
  })

  it('keeps the MCP published/withheld split consistent with the same state', async () => {
    const ctx = await mountPlugin()
    const models = ((await call(ctx, 'model_tools', { action: 'list' })) as { models: ModelRow[] }).models
    const list = (await call(ctx, 'tool_mode_list', {})) as { tools: CatalogRow[]; unavailable: UnavailableRow[] }
    const callable = new Set(list.tools.map(row => row.name))
    const absent = new Set(list.unavailable.map(row => row.name))

    for (const model of models) {
      // MCP publishes exactly the tools the registry serves, so a published model tool is
      // a callable name — and a withheld one is explained in `unavailable`.
      if (model.provenance.publishedTool !== null) {
        assert.ok(callable.has(model.provenance.publishedTool),
          `${model.id}: MCP publishes ${model.provenance.publishedTool}, so it must be in tools`)
      }
      if (model.withheld !== undefined) {
        assert.ok(absent.has(model.tool), `${model.id}: a withheld tool must be explained in unavailable`)
      }
      assert.equal(callable.has(model.tool), !absent.has(model.tool), `${model.id}: exactly one side owns the tool name`)
    }
  })
})
describe('tool_mode_describe explains what cannot be called', () => {
  it('returns the reason and the clearing action for a non-callable catalog name, not a schema', async () => {
    const ctx = await mountPlugin()
    const models = ((await call(ctx, 'model_tools', { action: 'list' })) as { models: ModelRow[] }).models
    const list = (await call(ctx, 'tool_mode_list', {})) as { unavailable: UnavailableRow[] }
    const absent = list.unavailable[0]!
    const model = models.find(row => row.id === absent.model)
    assert.ok(model !== undefined)

    const described = ((await call(ctx, 'tool_mode_describe', { tools: [absent.name] })) as {
      tools: {
        name: string
        callable: boolean
        state: string
        reason: string
        action: string
        description?: string
        parameters?: unknown
        examples?: unknown
        typescript?: unknown
      }[]
    }).tools[0]!

    assert.equal(described.name, absent.name)
    assert.equal(described.callable, false, 'a name the registry does not serve is not callable')
    assert.equal(described.state, model!.state, 'the readiness state must match model_tools')
    assert.equal(described.reason, model!.reason, 'the reason must be the verdict\'s own wording')
    assert.ok(described.action.length > 0, 'the clearing action must be stated')
    // NOT a fabricated schema: no parameters, no examples, no generated bindings.
    assert.equal(described.parameters, undefined, 'an uncallable tool must not advertise parameters')
    assert.equal(described.examples, undefined, 'an uncallable tool must not advertise examples')
    assert.equal(described.typescript, undefined, 'no bindings can be generated for an uncallable tool')
  })

  it('still refuses an unknown name and still describes a callable one', async () => {
    const ctx = await mountPlugin()
    await assert.rejects(call(ctx, 'tool_mode_describe', { tools: ['no_such_tool'] }), /unknown tool/)

    const described = ((await call(ctx, 'tool_mode_describe', { tools: ['tool_mode_list'] })) as {
      tools: { callable: boolean; parameters: unknown }[]
    }).tools[0]!
    assert.equal(described.callable, true)
    assert.notEqual(described.parameters, undefined)
  })
})
/**
 * TASK-49: the catalog verdet CANNOT make a model callable on its own.
 *
 * The live host reported `installed=1, runnable=0` while `tool_mode_list` advertised the
 * extension's tools: the capability route was decided by resolving a package from the
 * PLUGIN's node_modules (never true for a store-installed extension), and the surface said
 * "callable" from the verdict alone. These tests pin both halves of the fix at the level the
 * caller can see.
 */
describe('task-49 — capability truth for store-installed extensions', () => {
  it('never reports a callable row whose model-facing tool is not registered', async () => {
    const ctx = await mountPlugin()
    const models = ((await call(ctx, 'model_tools', { action: 'list' })) as { models: ModelRow[] }).models
    const registry = new Set(ctx.tools.schemas().map(schema => schema.name))

    for (const model of models) {
      if (model.state !== 'callable') continue
      assert.ok(
        registry.has(model.tool),
        `${model.id}: model_tools reports callable, but ${model.tool} is not registered — a caller would find no tool`,
      )
    }
  })

  it('counts a STORE-INSTALLED provider extension as runnable, and its tool as callable once enabled', async () => {
    const ctx = await mountPluginWithTongue()
    const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
    assert.equal(enabled.isError, false, `enabling the fixture must succeed: ${JSON.stringify(enabled).slice(0, 300)}`)

    const summary = (await call(ctx, 'model_tools', { action: 'list' })) as {
      models: ModelRow[]
      installed: number
      runnable: number
    }
    const tongue = summary.models.find(model => model.id === 'tongue')
    assert.ok(tongue !== undefined, 'the catalog must still list tongue')

    // THE DEFECT: this was runnable=false / state=unavailable with "not installed or not
    // resolvable" even though the fixture package IS installed in the store.
    assert.equal(tongue.installed, true)
    assert.equal(tongue.runnable, true, 'an installed provider extension must be runnable')
    assert.equal(tongue.state, 'callable')
    assert.ok(summary.runnable >= 1, `runnable count must reflect the installed extension; got ${summary.runnable}`)

    const registry = new Set(ctx.tools.schemas().map(schema => schema.name))
    assert.ok(registry.has(tongue.tool), `the callable tool ${tongue.tool} must be registered`)

    // And the two surfaces still agree about it.
    const list = (await call(ctx, 'tool_mode_list', {})) as { tools: CatalogRow[] }
    const listed = list.tools.find(row => row.model === 'tongue')
    assert.ok(listed !== undefined, 'the registered extension tool must appear in tool_mode_list tools')
    assert.equal(listed.name, tongue.tool)
    assert.equal(listed.state, tongue.state)
  })
})
/**
 * TASK-52: a discovery artifact must be able to PIN the contract each row was built on.
 *
 * The report observed list rows with no `contractVersion`, so a consumer had to make a second
 * `tool_mode_describe` call per tool to learn it — and the same report saw rows in `tools`
 * that were not callable. Both are pinned here: every `tools` row is callable AND registered,
 * every unregistered name lives only in `unavailable`, and each row carries the contract facts.
 */
interface ToolsRow {
  readonly name: string
  readonly state: string
  readonly contract: string | null
  readonly contractVersion: string | null
  readonly schemaAvailable: boolean
}

describe('task-52 — tools rows are callable and pin their contract', () => {
  it('lists only callable, registered rows, each with contract facts', async () => {
    const ctx = await mountPluginWithTongue()
    const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
    assert.equal(enabled.isError, false, `the extension fixture must enable: ${JSON.stringify(enabled).slice(0, 200)}`)

    // SAFETY: tool_mode_list's declared output is validated against its contract; this test
    // reads only the fields it asserts on, which the contract now declares.
    const list = (await call(ctx, 'tool_mode_list', {})) as {
      tools: ToolsRow[]
      unavailable: UnavailableRow[]
    }
    const registry = new Set(ctx.tools.schemas().map(schema => schema.name))

    for (const row of list.tools) {
      assert.equal(row.state, 'callable', `${row.name} is in tools but state is ${row.state}`)
      assert.ok(registry.has(row.name), `${row.name} is in tools but the registry does not serve it`)
      assert.ok(row.contract === null || row.contract.length > 0, `${row.name}: contract must be an id or null`)
      assert.ok(
        row.contractVersion === null || row.contractVersion.length > 0,
        `${row.name}: contractVersion must be a version or null`,
      )
      assert.ok(
        row.schemaAvailable === true || row.schemaAvailable === false,
        `${row.name}: schemaAvailable must be a boolean`,
      )
    }

    // A name the registry does not serve is explained, never advertised as callable.
    for (const row of list.unavailable) {
      assert.equal(registry.has(row.name), false, `${row.name} is unregistered, so it must only appear in unavailable`)
      assert.notEqual(row.state, 'callable')
    }
  })

  it('pins the host discovery contract, and reports null where no contract exists', async () => {
    const ctx = await mountPlugin()
    // SAFETY: same contract-declared shape as above.
    const list = (await call(ctx, 'tool_mode_list', {})) as { tools: ToolsRow[] }
    const discovery = list.tools.find(row => row.name === 'tool_mode_list')
    assert.ok(discovery !== undefined, 'tool_mode_list must list itself')
    assert.equal(discovery.contract, 'host.tool_mode_list')
    assert.equal(discovery.contractVersion, '1.2.0')
    assert.equal(discovery.schemaAvailable, true, 'describe can return its schemas')
    assert.equal(discovery.bindable, false, 'a control tool is callable but not program-bindable')

    // A host tool with no published ToolContract reports null rather than inventing a version.
    const modelTools = list.tools.find(row => row.name === 'model_tools')
    assert.ok(modelTools !== undefined)
    assert.equal(modelTools.contract, null)
    assert.equal(modelTools.contractVersion, null)
  })

  it('declares the new fields in the MCP-advertised output schema', () => {
    // Asserted over the serialized contract, not a hand-typed mirror of its shape: a mirror
    // would pass while the advertised schema stayed wrong.
    const advertised = JSON.stringify(TOOL_MODE_LIST_CONTRACT.outputSchema)
    assert.match(advertised, /"contract":\{"type":\["string","null"\]\}/)
    assert.match(advertised, /"contractVersion":\{"type":\["string","null"\]\}/)
    assert.match(advertised, /"schemaAvailable":\{"type":"boolean"\}/)
    assert.match(advertised, /"bindable":\{"type":"boolean"\}/)
  })
})
