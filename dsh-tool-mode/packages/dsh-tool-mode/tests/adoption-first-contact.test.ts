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

/*
 * This suite is the registry/logger BOUNDARY: tool results are `unknown` and are cast to
 * the row under test, and the logger spy patches a prototype method to observe the host's
 * log line. The rules disabled here are production-boundary guards; these assertions are
 * the alternative evidence.
 */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters -- SAFETY: registry values are validated by the host and cast here for assertions; the logger spy takes untyped arguments by design. */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import type { Context } from '@deepseek-ai/cordis'
import { callTool, cleanup, mountPlugin, mountPluginWithTongue } from './helpers.ts'

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

/**
 * Invoke a tool DIRECTLY on the read-only surface.
 *
 * `callTool` deliberately reroutes management actions to `model_tools_manage` in the test
 * harness; a read-only refusal test must reach the actual `model_tools` clone, so it bypasses
 * that ergonomic rewrite.
 */
async function direct(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('first-contact-direct-' + (++counter)),
    name,
    arguments: args,
  } as never)
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


  it('reports an UNAVAILABLE prewarm when the deployment has no preparation surface (F6)', async () => {
    // No extension store means there is nothing to prepare: claiming 'started' would be a
    // lie about work that never began.
    const ctx = await mountPlugin({ adoption: { prewarmAfterEnable: true } })
    const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
    assert.equal(enabled.isError, false, JSON.stringify(enabled))
    assert.equal((enabled as { value?: { prewarm?: string } }).value?.prewarm, 'unavailable')
  })

  it('LOGS a failed prewarm and never marks the model ready (F6)', async () => {
    const ctx = await mountPluginWithTongue({ adoption: { prewarmAfterEnable: true } })
    // The logger's methods live on the prototype; patch it for the duration of this case and
    // prove the spy works with a sentinel before trusting it for the host's log line.
    const proto = Object.getPrototypeOf(ctx.logger) as {
      warn(...args: unknown[]): void
    } // SAFETY: cordis's logger exposes warn on the prototype; this is the observable the host writes to.
    const logs: string[] = []
    const original = proto.warn
    proto.warn = function (this: unknown, ...args: unknown[]) {
      logs.push(args.map(String).join(' '))
      return original.apply(this, args)
    }
    try {
      ctx.logger.warn('sentinel prewarm spy')
      assert.deepEqual(logs, ['sentinel prewarm spy'], 'the logger spy must observe a direct call')

      // `voz` has no installed implementation, so its preparation deterministically FAILS
      // (no plan); `tongue` declares no assets, so its restore legitimately reports ready.
      const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'voz' })
      assert.equal(enabled.isError, false, JSON.stringify(enabled))
      assert.equal((enabled as { value?: { prewarm?: string } }).value?.prewarm, 'started')
      // The prewarm is fire-and-forget: poll briefly for its log instead of guessing a delay.
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline
        && !logs.some(line => line.includes('prewarm after enable failed'))) {
        await new Promise(resolve => setTimeout(resolve, 25))
      }

      const failure = logs.find(line => line.includes('prewarm after enable failed') && line.includes('voz'))
      assert.ok(failure !== undefined, `expected a logged prewarm failure, saw ${JSON.stringify(logs)}`)
      assert.match(failure, /no preparation plan for @try-works\/extension-desert-ant-voz/, 'the log names the bounded reason')

      const voz = (await rows(ctx)).find(row => row.id === 'voz')
      assert.ok(voz !== undefined)
      assert.equal(voz.readiness, 'prepared-cold', 'a failed prewarm must not mark the model ready')
      assert.equal(voz.cold, true)
      // ONE prewarm per enable call: a single call must not log the failure twice.
      const failures = (): number => logs.filter(line => line.includes('prewarm after enable failed for voz')).length
      assert.equal(failures(), 1, 'exactly one prewarm attempt per enable')

      // A SECOND enable is a separate call: it truthfully reports its own attempt (started)
      // and logs its own failure once, rather than silently inheriting the first outcome.
      const again = await callTool(ctx, 'model_tools', { action: 'enable', model: 'voz' })
      assert.equal(again.isError, false, JSON.stringify(again))
      assert.equal((again as { value?: { prewarm?: string } }).value?.prewarm, 'started')
      const deadline2 = Date.now() + 5_000
      while (Date.now() < deadline2 && failures() < 2) {
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      assert.equal(failures(), 2, 'the second enable logs exactly one more failure')
    } finally {
      proto.warn = original
    }
  })

  it('refuses warm on the READ-ONLY model_tools surface, with no state change (F7)', async () => {
    const ctx = await mountPluginWithTongue({ managementGrant: false })
    const before = await direct(ctx, 'model_tools', { action: 'list' })
    assert.equal(before.isError, false, JSON.stringify(before))

    const refused = await direct(ctx, 'model_tools', { action: 'warm', model: 'tongue' })
    assert.equal(refused.isError, true, 'warm is a MUTATION and must not be served by the read-only tool')
    const message = refused.error?.message ?? ''
    assert.match(message, /model_tools_manage/, 'the refusal points at the management tool')
    assert.match(message, /managementGrant|read-only/, 'and at the missing grant')
    assert.equal(message.includes('"warm"'), true, 'the refusal names the refused action')

    const afterward = await direct(ctx, 'model_tools', { action: 'list' })
    assert.deepEqual(afterward.value, before.value, 'a refused warm must not change model state')
  })

  it('reports a SKIPPED prewarm when the flag is off', async () => {
    const ctx = await mountPluginWithTongue()
    const enabled = await callTool(ctx, 'model_tools', { action: 'enable', model: 'tongue' })
    assert.equal(enabled.isError, false, JSON.stringify(enabled))
    assert.equal((enabled as { value?: { prewarm?: string } }).value?.prewarm, 'skipped')
  })
})