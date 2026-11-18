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
