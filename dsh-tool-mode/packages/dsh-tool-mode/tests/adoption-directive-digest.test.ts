/**
 * Phase 3: the directive digest names ONE artifact.
 *
 * The neutral bullet list was inert in the internal reports (0/2); a directive naming the
 * artifact was 3/3. The rules: exactly one imperative line, the artifact's purpose, an
 * evidence-backed known failure (never an invented caveat), a compact non-imperative list of
 * the rest, four lines / 600 characters at most, recomputed per assembly, caller-scope
 * isolated, and empty when the flag is off.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import { callTool, mountPluginWithTongue } from './helpers.ts'
import { buildDirectiveDigest } from '../src/library-digest.ts'
import type { AdoptionDigestCandidate } from '../src/adoption-digest-ranking.ts'

const candidate = (overrides: Partial<AdoptionDigestCandidate> & { readonly name: string }): AdoptionDigestCandidate => ({
  callableName: 'workflow_' + overrides.name,
  description: 'Purpose of ' + overrides.name + '.',
  scope: 'workspace',
  uses: 1,
  failures: 0,
  ...overrides,
})

const imperativeCount = (text: string): number => text.split('\n').filter(line => line.startsWith('Use ')).length

describe('directive digest', () => {
  it('with one artifact, names it imperatively with its purpose', () => {
    const text = buildDirectiveDigest([
      candidate({ name: 'lang_counts', callableName: 'workflow_lang_counts', description: 'Counts languages across a text list.' }),
    ])
    assert.match(text, /^Use workflow_lang_counts\b/m)
    assert.match(text, /Counts languages across a text list\./)
    assert.equal(imperativeCount(text), 1)
  })

  it('states an evidence-backed known failure and does not overstate success', () => {
    const text = buildDirectiveDigest([
      candidate({ name: 'flow', uses: 6, failures: 2, knownFailure: 'EXECUTOR_NOT_CONFIGURED' }),
    ])
    assert.match(text, /^Known failure: EXECUTOR_NOT_CONFIGURED\.$/m)
    // Counts are evidence, and a percentage is only allowed from five uses upward.
    assert.match(text, /6 uses/)
    assert.match(text, /2 failures/)
    assert.match(text, /% failed/)
    assert.doesNotMatch(text, /guaranteed|always works|reliable/i)
  })

  it('does not invent a caveat when there is no failure evidence', () => {
    const text = buildDirectiveDigest([candidate({ name: 'flow', uses: 10, failures: 0 })])
    assert.doesNotMatch(text, /Known failure/i)
    assert.doesNotMatch(text, /% failed/)
  })

  it('makes only the highest-ranked candidate imperative; the rest are a compact list', () => {
    const text = buildDirectiveDigest([
      candidate({ name: 'first', callableName: 'workflow_first', lastUsedAt: '2026-06-02T00:00:00.000Z' }),
      candidate({ name: 'second', callableName: 'workflow_second', lastUsedAt: '2026-06-01T00:00:00.000Z' }),
      candidate({ name: 'third', callableName: 'workflow_third', lastUsedAt: '2026-05-01T00:00:00.000Z' }),
    ])
    assert.match(text, /^Use workflow_first\b/m)
    assert.equal(imperativeCount(text), 1)
    assert.match(text, /^Also available: workflow_second, workflow_third\.$/m)
    assert.doesNotMatch(text, /^Use workflow_second/m)
  })

  it('stays under 600 characters and four lines', () => {
    const rows = Array.from({ length: 12 }, (_, index) => candidate({
      name: 'long_' + String(index),
      description: 'A very long purpose sentence that keeps going to exercise the bound. '.repeat(4),
      lastUsedAt: '2026-06-01T00:00:00.000Z',
    }))
    const text = buildDirectiveDigest(rows)
    assert.ok(text.length <= 600, 'length ' + String(text.length))
    assert.ok(text.split('\n').length <= 4, 'lines ' + String(text.split('\n').length))
    assert.match(text, /^Use /)
  })

  it('isolates caller-scope artifacts to the caller session', () => {
    const rows = [
      candidate({ name: 'mine', scope: 'session', sessionId: 'caller-1', callableName: 'workflow_mine', lastUsedAt: '2026-06-03T00:00:00.000Z' }),
      candidate({ name: 'theirs', scope: 'session', sessionId: 'caller-2', callableName: 'workflow_theirs', lastUsedAt: '2026-06-04T00:00:00.000Z' }),
      candidate({ name: 'shared', scope: 'workspace', callableName: 'workflow_shared', lastUsedAt: '2026-06-01T00:00:00.000Z' }),
    ]
    const mine = buildDirectiveDigest(rows, { sessionId: 'caller-1' })
    assert.match(mine, /workflow_mine/)
    assert.doesNotMatch(mine, /workflow_theirs/)
    // Without a caller identity, no session artifact is visible at all.
    const anonymous = buildDirectiveDigest(rows)
    assert.doesNotMatch(anonymous, /workflow_mine|workflow_theirs/)
    assert.match(anonymous, /workflow_shared/)
  })

  it('recomputes per assembly instead of freezing the first answer', () => {
    const before = buildDirectiveDigest([candidate({ name: 'flow', uses: 6, failures: 1, lastUsedAt: '2026-06-01T00:00:00.000Z' })])
    assert.doesNotMatch(before, /Known failure/)
    const after = buildDirectiveDigest([candidate({ name: 'flow', uses: 6, failures: 1, knownFailure: 'TOOL_BINDING_REFUSED', lastUsedAt: '2026-06-02T00:00:00.000Z' })])
    assert.match(after, /Known failure: TOOL_BINDING_REFUSED/)
    // A newly visible caller artifact becomes the imperative candidate.
    const withCaller = buildDirectiveDigest([
      candidate({ name: 'flow' }),
      candidate({ name: 'fresh', scope: 'session', sessionId: 'caller-1', callableName: 'workflow_fresh', lastUsedAt: '2026-06-05T00:00:00.000Z' }),
    ], { sessionId: 'caller-1' })
    assert.match(withCaller, /^Use workflow_fresh\b/m)
  })

  it('emits no text at all when the flag is off', () => {
    assert.equal(buildDirectiveDigest([candidate({ name: 'flow' })], { enabled: false }), '')
    assert.equal(buildDirectiveDigest([], { enabled: true }), '')
  })
})
describe('prompt-section wiring (Phase 3 in index.ts)', () => {
  interface PromptService {
    assemble(): Promise<{ sections: { name: string; text: string }[] }>
  }
  const sectionText = async (ctx: Awaited<ReturnType<typeof mountPluginWithTongue>>): Promise<string> => {
    const service = ctx.get('systemPrompt') as PromptService | undefined
    assert.ok(service)
    const assembly = await service.assemble()
    return assembly.sections.find(section => section.name === 'tool-mode:library')?.text ?? ''
  }

  it('uses the directive digest: one imperative line with both names and the purpose', async () => {
    const ctx = await mountPluginWithTongue()
    await callTool(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'digest-flow', description: 'Counts languages across a list.',
      program: 'return 1', scope: 'workspace',
    })
    const text = await sectionText(ctx)
    assert.match(text, /^Use workflow_digest_flow \(stored digest-flow\) — Counts languages across a list\.$/m)
    assert.equal(text.split('\n').filter(line => line.startsWith('Use ')).length, 1)
    assert.ok(text.length <= 600, 'length ' + String(text.length))
  })

  it('documents the limitation: a SESSION artifact never reaches the prompt (no caller)', async () => {
    const ctx = await mountPluginWithTongue()
    const saved = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('digest-session-1'),
      name: 'tool_mode_workflows',
      arguments: {
        action: 'save', name: 'private-flow', description: 'Private session work.',
        program: 'return 2', scope: 'session',
      },
      agent: { id: 'session-private' } as never,
    } as never)
    assert.equal(saved.isError, false, JSON.stringify(saved))
    const text = await sectionText(ctx)
    assert.doesNotMatch(text, /private-flow|workflow_private_flow/)
    // Not fake isolation: there is genuinely no caller identity at assembly time.
    assert.match(text, /^$|^Use /)
  })

  it('is recomputed per assembly, not frozen at mount', async () => {
    const ctx = await mountPluginWithTongue()
    assert.equal(await sectionText(ctx), '')
    await callTool(ctx, 'tool_mode_workflows', {
      action: 'save', name: 'later-flow', description: 'Saved after the first assembly.',
      program: 'return 3', scope: 'workspace',
    })
    const text = await sectionText(ctx)
    assert.match(text, /workflow_later_flow/)
  })
})
