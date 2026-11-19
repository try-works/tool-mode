/**
 * Phase 4 of docs/auto-keep-plan.md: retention and delete as the only required curation.
 *
 * The store-level cases pin the lifecycle boundaries; the existing verb/scoping suites
 * pin delete's truthfulness.
 *
 * @module tests/auto-keep-retention
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  createAgentAuthoringStore,
  type ArtifactScopeContext,
} from '../src/agent-authoring.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const SESSION: ArtifactScopeContext = { scope: 'session', scopeKey: 'session-a', workspaceKey: 'workspace-a' }
const OTHER_SESSION: ArtifactScopeContext = { scope: 'session', scopeKey: 'session-b', workspaceKey: 'workspace-a' }
const WORKSPACE: ArtifactScopeContext = { scope: 'workspace', scopeKey: 'workspace-a' }

const DRAFT = {
  runId: 'rcpt_000001',
  program: 'return { doubled: input.value * 2 }',
  tools: [],
  inputSchema: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] },
}

describe('auto-keep retention', () => {
  it('expires an unused session draft with its session', () => {
    const store = createAgentAuthoringStore({ file: join(tempDir(), 'authoring.json'), scopeEnabled: true })
    store.saveDraft(DRAFT, SESSION, { ttlMs: 60_000, now: 1_000 })
    store.saveDraft({ ...DRAFT, runId: 'rcpt_000002' }, OTHER_SESSION, { ttlMs: 60_000, now: 1_000 })
    const expired = store.expireSession('session-a')
    assert.equal(expired.tools.length, 1)
    assert.equal(expired.tools[0]?.scopeKey, 'session-a')
    assert.equal(store.toolEntries(OTHER_SESSION).length, 1)
  })

  it('expires an unused workspace auto row after its TTL', () => {
    const store = createAgentAuthoringStore({ file: join(tempDir(), 'authoring.json'), scopeEnabled: true })
    store.saveDraft(DRAFT, WORKSPACE, { ttlMs: 100, now: 1_000 })
    assert.equal(store.expireDrafts({ now: 1_050 }).length, 0)
    assert.equal(store.expireDrafts({ now: 1_200 }).length, 1)
    assert.equal(store.toolEntries(WORKSPACE).length, 0)
  })

  it('never expires a promoted/kept row by the draft TTL', () => {
    const store = createAgentAuthoringStore({ file: join(tempDir(), 'authoring.json'), scopeEnabled: true })
    const draft = store.saveDraft(DRAFT, SESSION, { ttlMs: 100, now: 1_000 })
    store.promoteDraft(draft.name, { from: SESSION, to: WORKSPACE, now: 1_050 })
    assert.equal(store.expireDrafts({ now: 10_000 }).length, 0)
    assert.equal(store.toolEntries(WORKSPACE).length, 1)
  })

  it('does not rewrite the document on a read', () => {
    const file = join(tempDir(), 'authoring.json')
    const store = createAgentAuthoringStore({ file, scopeEnabled: true })
    store.saveDraft(DRAFT, SESSION, { ttlMs: 60_000, now: 1_000 })
    const before = readFileSync(file, 'utf8')
    store.toolEntries(SESSION)
    store.toolEntries(WORKSPACE)
    assert.equal(readFileSync(file, 'utf8'), before)
  })

  it('expires only the caller-visible workspace row when scoped', () => {
    const store = createAgentAuthoringStore({ file: join(tempDir(), 'authoring.json'), scopeEnabled: true })
    store.saveDraft(DRAFT, WORKSPACE, { ttlMs: 100, now: 1_000 })
    assert.equal(store.expireDrafts({ now: 1_200 }, OTHER_SESSION).length, 1)
    assert.equal(store.toolEntries(WORKSPACE).length, 0)
  })
})
