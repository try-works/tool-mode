/**
 * Artifact-specific verification metadata.
 *
 * Counters record exceptions, not correctness. An author can persist a bounded
 * verification note that the digest renders instead of the generic unverified warning.
 *
 * @module tests/adoption-verification
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type */

import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { join } from 'node:path'

import { buildDirectiveDigest } from '../src/library-digest.ts'
import { createAgentAuthoringStore } from '../src/agent-authoring.ts'
import { callTool, cleanup, mountPluginWithTongue, resultText, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const CONTEXT = { scope: 'global' as const, scopeKey: '_global' }

describe('artifact-specific verification', () => {
  it('persists and lists a verification note', () => {
    const store = createAgentAuthoringStore({ file: join(tempDir(), 'agent-authoring.json'), scopeEnabled: true })
    const saved = store.saveTool({
      name: 'agent_verify_me',
      description: 'Count languages.',
      verification: 'Fails on short 3-record language blocks; verify counts against the index.',
      inputSchema: { type: 'object', properties: { texts: { type: 'array', items: { type: 'string' } } } },
      program: 'return { total: input.texts.length }',
      tools: [],
    }, CONTEXT)
    assert.equal(saved.verification, 'Fails on short 3-record language blocks; verify counts against the index.')
    assert.equal(store.getTool('agent_verify_me', CONTEXT)?.verification, saved.verification)
    assert.equal(store.listTools(CONTEXT)[0]?.verification, saved.verification)
  })

  it('renders the note instead of the generic verify warning and suppresses Evidence', () => {
    const text = buildDirectiveDigest([{
      name: 'agent_verify_me',
      callableName: 'agent_verify_me',
      description: 'Count languages.',
      verification: 'Fails on short 3-record language blocks; verify counts against the index.',
      uses: 61,
      failures: 0,
      sessions: 1,
      unverified: true,
    } as never])
    assert.match(text, /Verify: Fails on short 3-record language blocks/)
    assert.doesNotMatch(text, /Verify its output on edge cases/)
    assert.doesNotMatch(text, /Evidence:/)
  })

  it('accepts verification on define and renders it in the prompt digest', async () => {
    const ctx = await mountPluginWithTongue()
    const defined = await callTool(ctx, 'tool_mode_tools', {
      action: 'define',
      name: 'agent_verified',
      description: 'Count languages.',
      verification: 'Fails on short 3-record language blocks; verify counts against the index.',
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
    const assembly = await service.assemble({ agent: { id: 'session-verification' } } as never)
    const text = assembly.sections.find(section => section.name === 'tool-mode:library')?.text ?? ''
    assert.match(text, /agent_verified/)
    assert.match(text, /Verify: Fails on short 3-record language blocks/)
    assert.doesNotMatch(text, /Verify its output on edge cases/)
  })
})
