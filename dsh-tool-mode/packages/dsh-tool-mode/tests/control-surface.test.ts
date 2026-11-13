/**
 * BASE-07 / SEC-09 — discovery is read-only; mutations need a separate tool and
 * an explicit operator grant, and the management tool is excluded from Code Mode.
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EXCLUDED_BINDINGS } from '../src/ptc-authority.ts'
import { cleanup, mountPlugin } from './helpers.ts'

after(async () => { await cleanup() })

function actionEnum(ctx: Awaited<ReturnType<typeof mountPlugin>>): readonly string[] {
  const schema = ctx.tools.schemas().find(candidate => candidate.name === 'model_tools')
  assert.ok(schema !== undefined, 'model_tools must be registered')
  const parameters = schema.parameters as { properties?: Record<string, { enum?: readonly string[] }> }
  return parameters.properties?.['action']?.enum ?? []
}

describe('BASE-07 read-only discovery surface', () => {
  it('does not advertise or accept mutations on model_tools', async () => {
    const ctx = await mountPlugin({ managementGrant: false })
    const actions = actionEnum(ctx)
    for (const mutation of ['enable', 'disable', 'reset', 'extensions-prepare', 'extensions-commit']) {
      assert.equal(actions.includes(mutation), false, `${mutation} must not be on the read-only tool`)
    }
    assert.equal(actions.includes('list'), true)
    assert.equal(ctx.tools.get('model_tools_manage'), undefined, 'no management grant means no management tool')
    const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: 'control-read-only' as never, name: 'model_tools', arguments: { action: 'enable', model: 'tongue' } })
    assert.equal(result.isError, true, 'the read-only tool must refuse a mutation')
    assert.match(result.error?.message ?? '', /read-only|managementGrant/i)
  })

  it('registers a separate management tool only with the explicit grant', async () => {
    const ctx = await mountPlugin({ managementGrant: true })
    assert.notEqual(ctx.tools.get('model_tools_manage'), undefined)
    assert.deepEqual(actionEnum(ctx).filter(action => ['enable', 'disable', 'reset'].includes(action)), [])
    const manage = ctx.tools.schemas().find(candidate => candidate.name === 'model_tools_manage')
    assert.ok(manage !== undefined)
    const parameters = manage.parameters as { properties?: Record<string, { enum?: readonly string[] }> }
    assert.ok((parameters.properties?.['action']?.enum ?? []).includes('enable'))
    assert.equal(EXCLUDED_BINDINGS.includes('model_tools_manage'), true)
  })
})
