/**
 * Phase 6 — first contact.
 *
 * A cold first call is not a reason to abandon the tools. list/describe stay READ-ONLY and
 * say the row is cold with the first-call expectation; warming exists only on the management
 * surface, warms one model, and the optional post-enable prewarm is bounded, fire-and-forget
 * and logged — a failed warm never claims the model is ready.
 *
 * @module tests/adoption-first-contact
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import type { Context } from '@deepseek-ai/cordis'
import { callTool, cleanup, mountPluginWithTongue } from './helpers.ts'

after(async () => { await cleanup() })

let counter = 0

async function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('first-contact-' + (++counter)),
    name,
    arguments: args,
  } as never)
}

interface Row {
  readonly id: string
  readonly state: string
  readonly readiness: string
  readonly cold?: boolean
  readonly firstCall?: string
}

async function rows(ctx: Context): Promise<Row[]> {
  const listed = await call(ctx, 'model_tools', { action: 'list' })
  assert.equal(listed.isError, false, JSON.stringify(listed))
  return ((listed as { value?: { models?: Row[] } }).value?.models ?? [])
}

describe('Phase 6 — first contact', () => {
  it('keeps list and describe side-effect free and identical across reads', async () => {
    const ctx = await mountPluginWithTongue()
    const first = await rows(ctx)
    const second = await rows(ctx)
    assert.deepEqual(second, first, 'list must not change state between reads')

    const described = await call(ctx, 'model_tools', { action: 'describe', model: 'tongue' })
    assert.equal(described.isError, false, JSON.stringify(described))
    const describeRows = (described as { value?: { models?: Row[] } }).value?.models ?? []
    const describedAgain = await call(ctx, 'model_tools', { action: 'describe', model: 'tongue' })
    assert.deepEqual((describedAgain as { value?: { models?: Row[] } }).value?.models, describeRows)
    // Read-only: no warm fields may appear in a discovery answer.
    assert.equal(JSON.stringify(describeRows).includes('warmed'), false)
  })

  it('marks a prepared-cold row cold, with the first-call expectation', async () => {
    const ctx = await mountPluginWithTongue()
    const tongue = (await rows(ctx)).find(row => row.id === 'tongue')
    assert.ok(tongue !== undefined)
    assert.equal(tongue.readiness, 'prepared-cold')
    assert.equal(tongue.cold, true)
    assert.match(tongue.firstCall ?? '', /first call loads the model/)
    // Callability is a separate fact: a cold row can still be callable.
    assert.equal(tongue.state, 'callable')
  })

  it('warms exactly ONE model, and only through the management surface', async () => {
    const readOnly = await mountPluginWithTongue({ managementGrant: false })
    // Without the grant the management tool does not EXIST: warming has no read-only door.
    const absent = await call(readOnly, 'model_tools_manage', { action: 'warm', model: 'tongue' })
    assert.equal(absent.isError, true)
    assert.match(absent.error?.message ?? '', /unknown tool|not registered/i)

    const ctx = await mountPluginWithTongue()
    const warm = await callTool(ctx, 'model_tools', { action: 'warm', model: 'tongue' })
    // The fixture declares no downloadable assets, so the preparation has no plan: that is
    // the deterministic failure this assertion uses, and it names the ONE model asked for.
    assert.equal(warm.isError, true)
    assert.match(warm.error?.message ?? '', /no preparation plan for tongue/)
    assert.equal((warm.error?.message ?? '').includes('voz'), false)
  })

  it('runs the prewarm once after enable, bounded and logged, without marking the model ready', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown): void => { unhandled.push(error) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const ctx = await mountPluginWithTongue({ adoption: { prewarmAfterEnable: true } })
      const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
      assert.equal(enabled.isError, false, JSON.stringify(enabled))
      assert.equal((enabled as { value?: { prewarm?: string } }).value?.prewarm, 'started')
      // The prewarm fails (no plan); give it a turn to settle, then prove the row is not
      // marked ready by a failed warm and nothing rejected unhandled.
      await new Promise(resolve => setTimeout(resolve, 50))
      const tongue = (await rows(ctx)).find(row => row.id === 'tongue')
      assert.ok(tongue !== undefined)
      assert.equal(tongue.readiness, 'prepared-cold', 'a failed warm must not mark the model ready')
      assert.equal(tongue.cold, true)
      assert.equal(unhandled.length, 0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('reports a SKIPPED prewarm when the flag is off', async () => {
    const ctx = await mountPluginWithTongue()
    const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
    assert.equal(enabled.isError, false, JSON.stringify(enabled))
    assert.equal((enabled as { value?: { prewarm?: string } }).value?.prewarm, 'skipped')
  })
})
