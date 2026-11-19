/**
 * Phase 5 — the offer channel for a one-shot solver.
 *
 * A finished subagent cannot accept a message, so the offer must reach the caller in a TOOL
 * RESULT. The DSH registry exposes `tools/post-execute`, whose accept decision may replace the
 * rendered content — this suite pins that channel: exactly one bounded line at the threshold,
 * never repeated, suppressed when an equivalent artifact exists, and untouched when the flag
 * is off.
 *
 * @module tests/adoption-offer-channel
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import type { Context } from '@deepseek-ai/cordis'
import { callTool, cleanup, mountPluginWithTongue } from './helpers.ts'

after(async () => { await cleanup() })

let counter = 0

/** One tool call carrying an agent identity (session id). */
async function callAs(ctx: Context, name: string, args: unknown, sessionId: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('offer-channel-' + (++counter)),
    name,
    arguments: args,
    agent: { id: sessionId } as never,
  } as never)
}

async function enableTongue(ctx: Context) {
  const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
  assert.equal(enabled.isError, false, JSON.stringify(enabled))
}

/** The rendered text blocks of one result. */
function contentText(result: { content?: readonly { type: string; text?: string }[] }): string[] {
  return (result.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '')
}

/** Three calls with the SAME argument shape (the tracker counts shape, not values). */
async function repeatShape(ctx: Context, sessionId: string) {
  for (let index = 0; index < 3; index += 1) {
    const result = await callAs(ctx, 'lang_detect', { text: 'kann ich das haben' }, sessionId)
    assert.equal(result.isError, false, JSON.stringify(result))
    if (index === 2) return result
  }
  throw new Error('unreachable')
}

/** Save a single-tool wrapper so an equivalent artifact already exists. */
async function saveEquivalent(ctx: Context, toolName: string) {
  const saved = await callTool(ctx, 'tool_mode_workflows', {
    action: 'save',
    name: 'existing-wrap',
    description: 'Already wraps the tool.',
    program: 'return await ' + toolName + '(input)',
    tools: [toolName],
    scope: 'workspace',
  })
  assert.equal(saved.isError, false, JSON.stringify(saved))
}

describe('Phase 5 — one bounded offer in the tool result', () => {
  it('appends exactly one offer line at the threshold, with the callable name and a one-call command', async () => {
    const ctx = await mountPluginWithTongue()
    await enableTongue(ctx)
    const result = await repeatShape(ctx, 'session-a')
    const lines = contentText(result as never)
    const offers = lines.filter(line => line.startsWith('Offer: '))
    assert.equal(offers.length, 1, 'exactly one offer line: ' + JSON.stringify(lines))
    const offer = offers[0] as string
    assert.match(offer, /^Offer: lang_detect repeated 3× with the same shape\./)
    assert.match(offer, /tool_mode_workflows/)
    assert.match(offer, /repeat_lang_detect/, 'the offer names the callable workflow to create')
    assert.match(offer, /"action":"save"/)
    assert.ok(offer.length <= 300, 'the offer line is bounded; length ' + String(offer.length))
  })

  it('is byte-identical to the baseline: flag off renders the untouched result, flag on adds ONE block', async () => {
    const baselineCtx = await mountPluginWithTongue({ adoption: { saveOffer: false } })
    await enableTongue(baselineCtx)
    const baseline = await repeatShape(baselineCtx, 'session-b')
    const baselineLines = contentText(baseline as never)
    assert.equal(baselineLines.some(line => line.startsWith('Offer: ')), false, 'flag off must not augment')

    const offerCtx = await mountPluginWithTongue()
    await enableTongue(offerCtx)
    const offered = await repeatShape(offerCtx, 'session-b')
    const offeredLines = contentText(offered as never)
    assert.deepEqual(offeredLines.slice(0, baselineLines.length), baselineLines, 'everything before the offer is unchanged')
    assert.equal(offeredLines.length, baselineLines.length + 1, 'the offer is exactly one extra block')
  })

  it('does not repeat the offer in the next result', async () => {
    const ctx = await mountPluginWithTongue()
    await enableTongue(ctx)
    await repeatShape(ctx, 'session-c')
    const next = await callAs(ctx, 'lang_detect', { text: 'kann ich das haben' }, 'session-c')
    assert.equal(next.isError, false)
    assert.equal(contentText(next as never).some(line => line.startsWith('Offer: ')), false)
  })

  it('surfaces the same offer in the next tool_mode_list authoring block', async () => {
    const ctx = await mountPluginWithTongue()
    await enableTongue(ctx)
    await repeatShape(ctx, 'session-d')
    const listed = await callAs(ctx, 'tool_mode_list', {}, 'session-d')
    assert.equal(listed.isError, false)
    const authoring = (listed as { value?: { authoring?: { pendingOffers?: { toolName: string; calls: number; command: { tool: string; arguments: Record<string, unknown> } }[] } } }).value?.authoring
    const pending = authoring?.pendingOffers ?? []
    assert.equal(pending.length, 1, 'the offer persists for the next list')
    assert.equal(pending[0]?.toolName, 'lang_detect')
    assert.equal(pending[0]?.calls, 3)
    assert.equal(pending[0]?.command.tool, 'tool_mode_workflows')
    assert.equal(pending[0]?.command.arguments['action'], 'save')
  })

  it('is suppressed when an equivalent single-tool artifact already exists', async () => {
    const ctx = await mountPluginWithTongue()
    await saveEquivalent(ctx, 'lang_detect')
    await enableTongue(ctx)
    const result = await repeatShape(ctx, 'session-e')
    assert.equal(contentText(result as never).some(line => line.startsWith('Offer: ')), false)
    const listed = await callAs(ctx, 'tool_mode_list', {}, 'session-e')
    const pending = (listed as { value?: { authoring?: { pendingOffers?: unknown[] } } }).value?.authoring?.pendingOffers ?? []
    assert.equal(pending.length, 0)
  })

  it('never offers for a discovery or management shape', async () => {
    const ctx = await mountPluginWithTongue()
    for (let index = 0; index < 3; index += 1) {
      const listed = await callAs(ctx, 'tool_mode_list', {}, 'session-f')
      assert.equal(listed.isError, false)
      assert.equal(contentText(listed as never).some(line => line.startsWith('Offer: ')), false)
    }
    const listed = await callAs(ctx, 'tool_mode_list', {}, 'session-f')
    const pending = (listed as { value?: { authoring?: { pendingOffers?: unknown[] } } }).value?.authoring?.pendingOffers ?? []
    assert.equal(pending.length, 0)
  })
})
