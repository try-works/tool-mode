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
describe('purpose metadata in the neutral digest (Phase 8)', () => {
  const PURPOSE = 'Computes the amount due from a base and a proportional assessment rate, rounded to cents.'

  it('neutral lists the PURPOSE, never the opaque description', async () => {
    const ctx = await mountPluginWithTongue({ adoption: { digestMode: 'neutral' } as never })
    const defined = await callTool(ctx, 'tool_mode_tools', {
      action: 'define', name: 'agent_a7f3', description: 'A helper.', purpose: PURPOSE,
      inputSchema: { type: 'object', properties: { base: { type: 'number' }, rate: { type: 'number' } } },
      program: 'return { due: input.base * input.rate }', tools: [],
    })
    assert.equal(defined.isError, false, JSON.stringify(defined))
    const text = await sectionOf2(ctx)
    assert.match(text, /agent_a7f3/)
    assert.ok(text.includes(PURPOSE), 'the neutral digest shows the purpose')
    assert.equal(text.includes('A helper.'), false, 'the opaque description must not be the digest purpose')
    assert.doesNotMatch(text, /^Use /m)
  })

  async function sectionOf2(ctx: Awaited<ReturnType<typeof mountPluginWithTongue>>): Promise<string> {
    const service = ctx.get('systemPrompt') as { assemble(): Promise<{ sections: { name: string; text: string }[] }> } | undefined
    assert.ok(service)
    const assembly = await service.assemble()
    return assembly.sections.find(section => section.name === 'tool-mode:library')?.text ?? ''
  }
})
