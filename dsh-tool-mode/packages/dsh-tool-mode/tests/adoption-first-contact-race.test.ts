/**
 * Phase 6b — concurrent warms and shutdown.
 *
 * Two callers asking to warm the same model must start ONE preparation and share its outcome;
 * a teardown during a warm must not leave an unhandled rejection behind.
 *
 * LIMITATION (documented, not hidden): the fixture declares no downloadable assets, so a warm
 * fails at the plan step and its in-flight window is sub-millisecond. The coalescing test
 * therefore proves "one attempt" through the reported attempt counter rather than by timing,
 * and the shutdown test proves the rejection is contained — the abort path itself is wired in
 * the warm controller set and exercised whenever a preparation is actually in flight.
 *
 * @module tests/adoption-first-contact-race
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { callTool, cleanup, mountPluginWithTongue } from './helpers.ts'

after(async () => { await cleanup() })

describe('Phase 6b — concurrent warms and shutdown', () => {
  it('coalesces two concurrent warms into ONE preparation', async () => {
    const ctx = await mountPluginWithTongue()
    const [first, second] = await Promise.all([
      callTool(ctx, 'model_tools', { action: 'warm', model: 'tongue' }),
      callTool(ctx, 'model_tools', { action: 'warm', model: 'tongue' }),
    ])
    assert.equal(first.isError, true, JSON.stringify(first))
    assert.equal(second.isError, true, JSON.stringify(second))
    // Both callers observe the SAME attempt count: the second joined the first instead of
    // starting a second preparation.
    assert.match(first.error?.message ?? '', /attempts so far: 1/)
    assert.match(second.error?.message ?? '', /attempts so far: 1/)
    const third = await callTool(ctx, 'model_tools', { action: 'warm', model: 'tongue' })
    assert.equal(third.isError, true)
    assert.match(third.error?.message ?? '', /attempts so far: 2/, 'a later warm is a NEW attempt')
  })

  it('cancels an in-flight warm at shutdown without an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown): void => { unhandled.push(error) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const ctx = await mountPluginWithTongue()
      // Start the warm and tear the plugin down without awaiting first: the controller is
      // tracked, so disposal aborts it and the promise's own catch keeps the rejection in.
      const pending = callTool(ctx, 'model_tools', { action: 'warm', model: 'tongue' })
      await ctx.fiber.dispose()
      const settled = await pending
      assert.equal(settled.isError, true, 'an aborted warm reports its failure')
      await new Promise(resolve => setTimeout(resolve, 50))
      assert.equal(unhandled.length, 0, 'teardown must contain the warm rejection')
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
