/**
 * Phase 5b — accepting, ignoring, and refusing the offer.
 *
 * Acceptance is OBSERVED, not asserted by a handshake: once an artifact wrapping the offered
 * tool exists, the offer is accepted (counter incremented, pending cleared). Ignoring it
 * creates NOTHING — no draft, no artifact — and a non-applicable shape never produces an
 * artifact at all.
 *
 * @module tests/adoption-offer-acceptance
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import type { Context } from '@deepseek-ai/cordis'
import { callTool, cleanup, mountPluginWithTongue } from './helpers.ts'

after(async () => { await cleanup() })

let counter = 0

async function callAs(ctx: Context, name: string, args: unknown, sessionId: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('offer-accept-' + (++counter)),
    name,
    arguments: args,
    agent: { id: sessionId } as never,
  } as never)
}

interface AuthoringBlock {
  readonly saveOffersAccepted?: number
  readonly pendingOffers?: {
    readonly toolName: string
    readonly calls: number
    readonly command: { readonly tool: string; readonly arguments: Record<string, unknown> }
  }[]
  readonly tools?: { readonly name: string; readonly status?: string }[]
  readonly workflows?: { readonly name: string; readonly status?: string }[]
}

async function authoringOf(ctx: Context, sessionId: string): Promise<AuthoringBlock> {
  const listed = await callAs(ctx, 'tool_mode_list', {}, sessionId)
  assert.equal(listed.isError, false, JSON.stringify(listed))
  return ((listed as { value?: { authoring?: AuthoringBlock } }).value?.authoring ?? {})
}

async function enableTongue(ctx: Context) {
  const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
  assert.equal(enabled.isError, false, JSON.stringify(enabled))
}

async function triggerOffer(ctx: Context, sessionId: string): Promise<void> {
  await enableTongue(ctx)
  for (let index = 0; index < 3; index += 1) {
    const result = await callAs(ctx, 'lang_detect', { text: 'kann ich das haben' }, sessionId)
    assert.equal(result.isError, false, JSON.stringify(result))
  }
}

describe('Phase 5b — accepting the offer', () => {
  it('accepting with the offered one-call command clears it and increments saveOffersAccepted', async () => {
    const ctx = await mountPluginWithTongue()
    await triggerOffer(ctx, 'session-accept')
    const before = await authoringOf(ctx, 'session-accept')
    assert.equal(before.pendingOffers?.length, 1)
    const pending = before.pendingOffers![0]!
    assert.equal(pending.command.tool, 'tool_mode_workflows')

    // The offered command is directly usable, WITH its captured input schema.
    const saved = await callTool(ctx, 'tool_mode_workflows', {
      ...pending.command.arguments,
      description: 'Reported shape saved once.',
      scope: 'workspace',
    })
    assert.equal(saved.isError, false, JSON.stringify(saved))

    const after = await authoringOf(ctx, 'session-accept')
    assert.equal(after.pendingOffers?.length, 0, 'acceptance clears the pending offer')
    assert.equal(after.saveOffersAccepted, 1, 'acceptance is counted')
  })

  it('ignoring the offer creates no draft and no artifact', async () => {
    const ctx = await mountPluginWithTongue({ adoption: { autoKeep: 'session' } })
    await triggerOffer(ctx, 'session-ignore')
    // Surface it a few times, never accept it.
    let authoring = await authoringOf(ctx, 'session-ignore')
    for (let index = 0; index < 4; index += 1) authoring = await authoringOf(ctx, 'session-ignore')
    assert.equal(authoring.pendingOffers?.length, 0, 'an ignored offer expires, it does not repeat forever')
    assert.equal(authoring.saveOffersAccepted, 0)
    for (const row of [...authoring.tools ?? [], ...authoring.workflows ?? []]) {
      assert.notEqual(row.status, 'draft', 'ignoring must not create a draft')
      assert.equal(row.name.startsWith('draft_'), false, 'ignoring must not create a draft')
    }
    assert.deepEqual(authoring.tools ?? [], [])
    assert.deepEqual(authoring.workflows ?? [], [])
  })

  it('a non-applicable shape never creates an artifact', async () => {
    const ctx = await mountPluginWithTongue()
    for (let index = 0; index < 3; index += 1) await callAs(ctx, 'tool_mode_list', {}, 'session-control')
    const authoring = await authoringOf(ctx, 'session-control')
    assert.equal(authoring.pendingOffers?.length, 0)
    assert.equal(authoring.saveOffersAccepted, 0)
    assert.deepEqual(authoring.tools ?? [], [])
    assert.deepEqual(authoring.workflows ?? [], [])
  })
})
