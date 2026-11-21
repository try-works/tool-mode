/**
 * R8 wiring: the host digest must receive the stored verifiability claim. The pure digest
 * tests prove the renderer; this test proves index.ts copies the row into the candidate.
 *
 * @module tests/verifiability-digest-wiring
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { mountPluginWithTongue, callTool, resultText } from './helpers.ts'

describe('R8 — the host digest renders the stored aggregate claim', () => {
  it('passes verifiability from define through the store into the prompt digest', async () => {
    const ctx = await mountPluginWithTongue()
    const defined = await callTool(ctx, 'tool_mode_tools', {
      action: 'define',
      name: 'agent_aggregate_live',
      description: 'Counts languages in one batch.',
      purpose: 'Count languages across a batch.',
      verifiability: 'aggregate',
      inputSchema: { type: 'object', properties: { texts: { type: 'array', items: { type: 'string' } } } },
      program: 'return { total: input.texts.length }',
      tools: [],
      scope: 'workspace',
    })
    assert.equal(defined.isError, false, resultText(defined))
    const service = ctx.get('systemPrompt') as {
      assemble(context?: { agent?: { id: string } }): Promise<{ sections: { name: string; text: string }[] }>
    } | undefined
    assert.ok(service)
    const assembly = await service.assemble({ agent: { id: 'session-r8-wiring' } } as never)
    const text = assembly.sections.find(section => section.name === 'tool-mode:library')?.text ?? ''
    assert.match(text, /Aggregate-only output \(not per-item verifiable\)/)
    assert.match(text, /no per-item route is declared/)
  })
})
