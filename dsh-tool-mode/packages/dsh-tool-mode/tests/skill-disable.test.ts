/**
 * The operator kill switch for skill guidance (reuse-evidence plan §9.4).
 *
 * The defect this file prevents: the only way to stop publishing a skill was the global
 * `registerSkills⟫ flag, and the only way to silence one tool's guidance removed the tool
 * itself through `exclude⟫. A disabled skill must disappear from the catalog while its tool
 * stays registered and callable, because the agent should lose the advice, not the ability.
 *
 * @module tests/skill-disable
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { cleanup, mountPlugin } from './helpers.ts'

after(async () => { await cleanup() })

/** The names of the bundled skills a mount publishes. */
async function bundledSkillNames(ctx: Awaited<ReturnType<typeof mountPlugin>>): Promise<readonly string[]> {
  const summaries = await ctx.skills.list({ cwd: process.cwd() })
  return summaries.filter(summary => summary.source === 'bundled').map(summary => summary.name)
}

describe('disabled skill guidance', () => {
  it('drops the named skill but leaves every tool registered', async () => {
    const baseline = await mountPlugin({ exposeUnavailable: true })
    const names = await bundledSkillNames(baseline)
    const target = names[0]
    assert.ok(target !== undefined, 'the catalog must publish at least one bundled skill')
    const toolsBefore = baseline.tools.schemas().map(schema => schema.name).sort()

    const ctx = await mountPlugin({ exposeUnavailable: true, skills: { disabled: [target] } })
    const remaining = await bundledSkillNames(ctx)
    const toolsAfter = ctx.tools.schemas().map(schema => schema.name).sort()

    assert.equal(remaining.includes(target), false, 'the disabled skill must not be published')
    assert.equal(remaining.length, names.length - 1, 'exactly one skill is dropped')
    assert.deepEqual(toolsAfter, toolsBefore, 'disabling a skill must not change the tool set')
  })

  it('honours the environment override', async () => {
    const baseline = await mountPlugin({ exposeUnavailable: true })
    const target = (await bundledSkillNames(baseline))[0]
    assert.ok(target !== undefined, 'the catalog must publish at least one bundled skill')

    const previous = process.env['DSH_TOOL_MODE_DISABLE_SKILLS']
    process.env['DSH_TOOL_MODE_DISABLE_SKILLS'] = ' other-skill , ' + target
    try {
      const ctx = await mountPlugin({ exposeUnavailable: true })
      assert.equal((await bundledSkillNames(ctx)).includes(target), false)
    } finally {
      if (previous === undefined) delete process.env['DSH_TOOL_MODE_DISABLE_SKILLS']
      else process.env['DSH_TOOL_MODE_DISABLE_SKILLS'] = previous
    }
  })

  it('publishes everything when the disabled set names nothing real', async () => {
    const base = await mountPlugin({ exposeUnavailable: true })
    const ctx = await mountPlugin({ exposeUnavailable: true, skills: { disabled: ['not-a-skill'] } })
    assert.deepEqual(await bundledSkillNames(ctx), await bundledSkillNames(base))
  })
})
