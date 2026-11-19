/**
 * Draft retention: drafts expire, kept artifacts do not.
 *
 * Phase 4 of docs/adoption-improvement-plan.md makes an unsuccessful-but-preserved
 * authoring attempt a DRAFT: callable, but not a library member, and bounded in time.
 * These cases pin the STORE half of that contract at a real temp file, because the
 * store's whole job is a durable document: a mocked filesystem would not exercise the
 * atomic write, the reload path, or the schema-2 migration.
 *
 * RED-FIRST NOTE: this suite is the first caller of a brand-new store surface
 * (`saveDraft` / `expireDrafts` / `promoteDraft`), so its first red is an explicit
 * not-implemented stub rather than a behavioural miss. That is the honest Skeleton red
 * for an API that does not exist yet; every case below fails on the missing behaviour,
 * not on a setup mistake.
 *
 * @module tests/adoption-draft-retention
 */

/*
 * This suite is the JSON boundary: rows loaded from disk are `unknown` values cast to the
 * shape under test. The rules disabled here are production-boundary guards; these tests
 * are the alternative evidence.
 */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  DEFAULT_DRAFT_TTL_MS,
  createAgentAuthoringStore,
  draftNameForContent,
  type AgentToolDefinition,
  type ArtifactScopeContext,
} from '../src/agent-authoring.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

/** A fresh authoring file inside its own throwaway directory. */
function authoringFile(): string {
  return join(tempDir(), 'agent-authoring.json')
}

/** A context for one root session. */
function sessionContext(sessionId: string, workspaceKey = '/repo'): ArtifactScopeContext {
  return { scope: 'session', scopeKey: sessionId, sessionId, workspaceKey }
}

/** A draft shaped like a distilled run: program, bindings and an observed schema. */
function draftInput(runId: string) {
  return {
    runId,
    program: 'return { doubled: input.value * 2 }',
    tools: [] as string[],
    inputSchema: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] },
    description: 'Distilled from successful run ' + runId + '.',
  }
}

describe('draft identity', () => {
  it('derives a deterministic, pattern-valid name from the CONTENT', () => {
    const content = { program: 'return 1', tools: [], inputSchema: { type: 'object', properties: {} } }
    const first = draftNameForContent(content)
    assert.match(first, /^agent_from_draft_[0-9a-f]{8}$/)
    assert.equal(first.length <= 64, true, 'the name must fit the host cap')
    assert.equal(draftNameForContent(content), first, 'the same content must derive the same name')
    assert.notEqual(
      draftNameForContent({ ...content, program: 'return 2' }),
      first,
      'different content must not collide by construction',
    )
  })
})

describe('draft storage', () => {
  it('stores a draft with status and expiry, visible in list output', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    const now = Date.parse('2026-11-19T00:00:00.000Z')
    const saved = store.saveDraft(draftInput('rcpt_1'), sessionContext('s1'), { now })
    assert.equal(saved.status, 'draft')
    assert.equal(saved.expiresAt, new Date(now + DEFAULT_DRAFT_TTL_MS).toISOString())

    const listed = store.listTools(sessionContext('s1'))
    const row = listed.find(entry => entry.name === saved.name)
    assert.ok(row !== undefined, 'the draft must be visible to its own session')
    assert.equal(row.status, 'draft')
    assert.equal(row.expiresAt, saved.expiresAt)
  })

  it('survives a reload: a new store over the same file still sees a draft', () => {
    const file = authoringFile()
    const now = Date.parse('2026-11-19T00:00:00.000Z')
    const first = createAgentAuthoringStore({ file })
    const saved = first.saveDraft(draftInput('rcpt_reload'), sessionContext('s1'), { now })

    const second = createAgentAuthoringStore({ file })
    const reloaded = second.getTool(saved.name, sessionContext('s1'))
    assert.ok(reloaded !== undefined, 'the draft must reload from disk')
    assert.equal(reloaded.status, 'draft', 'status must not be dropped by the loader')
    assert.equal(reloaded.expiresAt, saved.expiresAt, 'expiry must not be dropped by the loader')
    assert.equal(second.issue, undefined, 'draft fields must not be reported as invalid entries')
  })

  it('updates the same draft when the same run succeeds again', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    const context = sessionContext('s1')
    const now = Date.parse('2026-11-19T00:00:00.000Z')
    const first = store.saveDraft(draftInput('rcpt_repeat'), context, { now })
    // Same CONTENT, later capture: identity must be the content, not the attempt.
    const second = store.saveDraft(draftInput('rcpt_repeat'), context, { now: now + 1000 })
    assert.equal(second.name, first.name, 'the identity must be derived from the run, not the attempt')
    const drafts = store.sessionTools('s1').filter(row => row.status === 'draft')
    assert.equal(drafts.length, 1, 'a repeat success must update, never duplicate')
    assert.equal(second.expiresAt, new Date(now + 1000 + DEFAULT_DRAFT_TTL_MS).toISOString(), 'expiry refreshes')
  })
})

describe('expiry', () => {
  it('removes an unkept draft once its bound passes and returns it', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    const context = sessionContext('s1')
    const now = Date.parse('2026-11-19T00:00:00.000Z')
    const saved = store.saveDraft(draftInput('rcpt_expire'), context, { now })

    const notYet = store.expireDrafts({ now: now + DEFAULT_DRAFT_TTL_MS - 1 })
    assert.deepEqual(notYet.map(row => row.name), [], 'nothing may expire before its bound')

    const expired = store.expireDrafts({ now: now + DEFAULT_DRAFT_TTL_MS + 1 })
    assert.deepEqual(expired.map(row => row.name), [saved.name])
    assert.equal(store.getTool(saved.name, context), undefined, 'the expired row is gone')
  })

  it('never expires a kept or promoted row', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    const context = sessionContext('s1')
    const now = Date.parse('2026-11-19T00:00:00.000Z')
    const draft = store.saveDraft(draftInput('rcpt_keep'), context, { now })

    const promoted = store.promoteDraft(draft.name, { name: 'agent_kept_one', from: context, to: context, now })
    const tool: AgentToolDefinition = promoted.tool
    assert.equal(tool.name, 'agent_kept_one')
    assert.equal(tool.digest, draft.digest, 'promotion must copy content, not rewrite it')
    assert.notEqual(tool.status, 'draft', 'a promoted artifact is not a draft')

    const expired = store.expireDrafts({ now: now + DEFAULT_DRAFT_TTL_MS * 10 })
    assert.equal(expired.some(row => row.name === 'agent_kept_one'), false, 'a promoted row must never expire')
    assert.ok(store.getTool('agent_kept_one', context) !== undefined, 'the promoted copy survives')
  })

  it('does not leak across caller scopes', () => {
    const file = authoringFile()
    const store = createAgentAuthoringStore({ file })
    const now = Date.parse('2026-11-19T00:00:00.000Z')
    const mine = store.saveDraft(draftInput('rcpt_scope'), sessionContext('session-a'), { now })

    assert.equal(store.getTool(mine.name, sessionContext('session-b')), undefined, 'another session must not see it')
    const expiredFromB = store.expireDrafts({ now: now + DEFAULT_DRAFT_TTL_MS + 1 }, sessionContext('session-b'))
    assert.deepEqual(expiredFromB.map(row => row.name), [], 'expiry in one scope must not touch another')
    assert.ok(store.getTool(mine.name, sessionContext('session-a')) !== undefined, 'the owner still sees its draft')
  })

  it('persists expiry as data, not by rewriting every row on read', () => {
    const file = authoringFile()
    const now = Date.parse('2026-11-19T00:00:00.000Z')
    const store = createAgentAuthoringStore({ file })
    store.saveDraft(draftInput('rcpt_bytes'), sessionContext('s1'), { now })
    const before = readFileSync(file, 'utf8')
    store.listTools(sessionContext('s1'))
    assert.equal(readFileSync(file, 'utf8'), before, 'a read must not rewrite the document')
  })
})
