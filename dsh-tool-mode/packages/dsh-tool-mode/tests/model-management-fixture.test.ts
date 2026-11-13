/**
 * The management split with the extension-first catalogue (BASE-07 / SEC-09).
 *
 * Legacy model-management tests mount against the default catalogue, whose Tongue
 * row now binds to `@try-works/extension-desert-ant-tongue`. Without an installed
 * provider extension the host correctly reports readiness `failed` and refuses the
 * enable. These tests prove the two halves of the contract together:
 *
 * 1. with NO extension store the refusal stands (production is not weakened); and
 * 2. with the deterministic Tongue fixture installed, the CATALOGUE enable path
 *    works end to end, and the read-only `model_tools` still refuses a mutation
 *    while `model_tools_manage` performs it.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  callTool,
  cleanup,
  installTongueFixture,
  isolatedStateFile,
  mountPlugin,
  mountPluginWithTongue,
  tempDir,
} from './helpers.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

const signal = new AbortController().signal
let counter = 0

after(async () => { await cleanup() })

const hasTool = (ctx: Awaited<ReturnType<typeof mountPlugin>>, name: string): boolean =>
  ctx.tools.schemas().some(schema => schema.name === name)

/** Execute a tool directly, bypassing the harness's management routing. */
function raw(ctx: Awaited<ReturnType<typeof mountPlugin>>, name: string, args: unknown) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`fixture-${++counter}`),
    name,
    arguments: args,
  })
}

describe('model-management fixture — enable / disable / reset through the split', () => {
  it('enable installs the catalogue tool through the installed fixture provider', async () => {
    const ctx = await mountPluginWithTongue({ stateFile: isolatedStateFile(), models: ['title'] })
    assert.equal(hasTool(ctx, 'lang_detect'), false, 'the fixture is inactive at mount, so nothing owns the tool')

    const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
    assert.equal(enabled.isError, false, JSON.stringify(enabled))
    if (enabled.isError) throw new Error('expected success')
    assert.equal((enabled.value as { changed: boolean }).changed, true)
    assert.equal(hasTool(ctx, 'lang_detect'), true)

    const detected = await callTool(ctx, 'lang_detect', { text: 'kann ich das haben' })
    assert.equal(detected.isError, false, JSON.stringify(detected))
    if (detected.isError) throw new Error('expected success')
    assert.equal((detected.value as { language: string }).language, 'de')

    const disabled = await callTool(ctx, 'model_tools', { action: 'disable', model: 'tongue' })
    assert.equal(disabled.isError, false, JSON.stringify(disabled))
    assert.equal(hasTool(ctx, 'lang_detect'), false)
  })

  it('keeps model_tools read-only while model_tools_manage mutates', async () => {
    // Without the grant the management tool does not exist and the read-only clone
    // must refuse a mutation. The harness only routes management calls when the
    // grant is on, so this mount exercises the production split exactly.
    const noGrant = await mountPluginWithTongue({ stateFile: isolatedStateFile(), managementGrant: false })
    assert.equal(noGrant.tools.get('model_tools_manage'), undefined, 'no grant means no management tool')
    const rejected = await raw(noGrant, 'model_tools', { action: 'enable', model: 'tongue' })
    assert.equal(rejected.isError, true)
    assert.match(JSON.stringify(rejected), /read-only.*model_tools_manage/s)

    // With the grant, the same action succeeds on the management tool.
    const granted = await mountPluginWithTongue({ stateFile: isolatedStateFile() })
    const enabled = await raw(granted, 'model_tools_manage', { action: 'enable', model: 'tongue' })
    assert.equal(enabled.isError, false, JSON.stringify(enabled))
  })

  it('reset forgets the choice and re-applies the configuration immediately', async () => {
    // No explicit `models`, so Tongue is configured by default and enabled at mount
    // once the fixture makes its provider ready.
    const ctx = await mountPluginWithTongue({ stateFile: isolatedStateFile() })
    assert.equal(hasTool(ctx, 'lang_detect'), true, 'the configured model is enabled at mount')

    const disabled = await callTool(ctx, 'model_tools', { action: 'disable', model: 'tongue' })
    assert.equal(disabled.isError, false, JSON.stringify(disabled))
    assert.equal(hasTool(ctx, 'lang_detect'), false)

    const reset = await callTool(ctx, 'model_tools', { action: 'reset', model: 'tongue' })
    assert.equal(reset.isError, false, JSON.stringify(reset))
    assert.equal(hasTool(ctx, 'lang_detect'), true, 'reset re-applies the configured selection now')
  })
})

describe('fixture helper', () => {
  it('entry satisfies the extension loader contract (default export + apiVersion + create)', async () => {
    // The store loader inspects the DEFAULT export: a named `create` alone is
    // refused, which surfaces as readiness `failed` and a correct enable refusal.
    const fixture = await import('./fixtures/tongue-extension/lib/index.js') as {
      default?: { apiVersion?: number; create?: unknown }
    }
    assert.equal(fixture.default?.apiVersion, 1)
    assert.equal(typeof fixture.default?.create, 'function')
  })

  it('installs once per store and reuses the installed record', async () => {
    const storeDir = await installTongueFixture(tempDir())
    const again = await installTongueFixture(storeDir)
    assert.equal(again, storeDir)
    assert.equal(await installTongueFixture(storeDir), storeDir)
  })
})
