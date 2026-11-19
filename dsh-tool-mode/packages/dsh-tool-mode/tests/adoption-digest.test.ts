import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { callTool, cleanup, mountPluginWithTongue } from './helpers.ts'

after(async () => { await cleanup() })

interface PromptService {
  assemble(): Promise<{ sections: { name: string; text: string }[] }>
}

function prompt(ctx: Awaited<ReturnType<typeof mountPluginWithTongue>>): PromptService {
  const service = ctx.get('systemPrompt') as PromptService | undefined
  assert.ok(service)
  return service
}

describe('library digest', () => {
  it('is absent when the flag is off', async () => {
    const ctx = await mountPluginWithTongue({ adoption: { digest: false } })
    const assembly = await prompt(ctx).assemble()
    assert.equal(assembly.sections.some(section => section.name === 'tool-mode:library'), false)
  })

  it('shows workspace artifacts with both names when enabled', async () => {
    const ctx = await mountPluginWithTongue()
    await callTool(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'digest-flow', description: 'Counts languages.',
      program: 'return 1', scope: 'workspace',
    })
    const assembly = await prompt(ctx).assemble()
    const section = assembly.sections.find(candidate => candidate.name === 'tool-mode:library')
    assert.ok(section)
    assert.match(section.text, /workflow_digest_flow/)
    assert.match(section.text, /digest-flow/)
    assert.match(section.text, /Counts languages/)
    assert.ok(section.text.length <= 600)
  })
})
describe('digest mode — the neutral G arm (Phase 8)', () => {
  async function sectionOf(ctx: Awaited<ReturnType<typeof mountPluginWithTongue>>): Promise<string> {
    const assembly = await prompt(ctx).assemble()
    return assembly.sections.find(section => section.name === 'tool-mode:library')?.text ?? ''
  }

  async function saveFlow(ctx: Awaited<ReturnType<typeof mountPluginWithTongue>>): Promise<void> {
    const saved = await callTool(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'digest-mode-flow', description: 'Counts languages.',
      program: 'return 1', scope: 'workspace',
    })
    assert.equal(saved.isError, false, JSON.stringify(saved))
  }

  it('neutral emits the old neutral list and NO imperative', async () => {
    const ctx = await mountPluginWithTongue({ adoption: { digestMode: 'neutral' } as never })
    await saveFlow(ctx)
    const text = await sectionOf(ctx)
    assert.ok(text.length > 0, 'the neutral arm must still emit a section')
    assert.match(text, /^- /m)
    assert.match(text, /workflow_digest_mode_flow/)
    assert.doesNotMatch(text, /^Use /m)
  })

  it('directive is the default and is the only arm with the imperative', async () => {
    const explicit = await mountPluginWithTongue({ adoption: { digestMode: 'directive' } as never })
    await saveFlow(explicit)
    assert.match(await sectionOf(explicit), /^Use workflow_digest_mode_flow/m)

    const byDefault = await mountPluginWithTongue()
    await saveFlow(byDefault)
    const text = await sectionOf(byDefault)
    assert.match(text, /^Use /m)
    assert.doesNotMatch(text, /^- /m)
  })

  it('flag-off emits nothing in either mode', async () => {
    for (const digestMode of ['neutral', 'directive'] as const) {
      const ctx = await mountPluginWithTongue({ adoption: { digest: false, digestMode } as never })
      await saveFlow(ctx)
      assert.equal(await sectionOf(ctx), '')
    }
  })
})
