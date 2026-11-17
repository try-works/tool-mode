/**
 * Scoped authoring store: session / workspace / global.
 *
 * The store used to keep every authored artifact in one host-global namespace. This
 * suite pins the scoped contract from
 * `research/plans/2026-11-17-artifact-scoping-spec.md` at the STORE layer:
 *
 * - every artifact has exactly one scope at rest, with a scope key;
 * - resolution is `session > workspace > global`, deterministic, and the row that wins
 *   reports the nearest lower row it hides (`shadowing`) rather than hiding it silently;
 * - two root sessions never see each other's session artifacts under any name;
 * - promotion copies to a target scope (version resets, `promotedFrom` records the source)
 *   and never renames, so callers holding `workflow_x` keep working;
 * - unpromoted session artifacts are removed by `expireSession` and handed back;
 * - a legacy (v1) document migrates to `global`/`host` on read, with no data move;
 * - a context-less call behaves exactly as before: global only.
 *
 * These tests use real temp files: the store's whole job is a durable document, and a
 * mocked filesystem would not exercise the atomic write or the version migration.
 *
 * @module tests/scoped-authoring-store
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  AuthoringError,
  createAgentAuthoringStore,
  type ArtifactScopeContext,
} from '../src/agent-authoring.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

/** A fresh authoring file inside its own throwaway directory. */
function authoringFile(): string {
  return join(tempDir(), 'agent-authoring.json')
}

/** A context for one root session, with the workspace key the host would supply. */
function sessionContext(sessionId: string, workspaceKey = '/repo'): ArtifactScopeContext {
  return { scope: 'session', scopeKey: sessionId, sessionId, workspaceKey }
}

/** A context whose write target is the workspace. */
function workspaceContext(workspaceKey: string): ArtifactScopeContext {
  return { scope: 'workspace', scopeKey: workspaceKey, workspaceKey }
}

/** A context whose write target is the host-global scope. */
function globalContext(): ArtifactScopeContext {
  return { scope: 'global', scopeKey: 'host' }
}

/** The 64-hex digest shape every row carries. */
const DIGEST = /^[0-9a-f]{64}$/

/**
 * Run `fn` and return the AuthoringError it throws.
 *
 * Asserting the CODE (not just the message) is the point: a caller branches on the code,
 * and the spec names six of them. The message must also state observed and allowed values.
 * @param fn - the call expected to refuse.
 * @param code - the expected `AuthoringErrorCode`.
 * @returns the caught error, for message assertions.
 */
function refuse(fn: () => void, code: string): AuthoringError {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof AuthoringError, `expected AuthoringError, got ${String(error)}`)
    assert.equal(error.code, code, `expected code "${code}", got "${error.code}": ${error.message}`)
    return error
  }
  assert.fail(`expected an AuthoringError("${code}") but the call succeeded`)
}

/** The names a list reports, in order. */
function names(rows: readonly { readonly name: string }[]): string[] {
  return rows.map(row => row.name)
}

describe('scoped authoring store', () => {
  it('migrates a legacy v1 document to global/host and writes version 2', () => {
    const file = authoringFile()
    const legacy = {
      version: 1,
      workflows: [{
        id: 'wf_legacy',
        name: 'legacy-flow',
        description: 'saved before scoping existed',
        version: 3,
        program: 'return { ok: true }',
        tools: [],
        inputSchema: { type: 'object', properties: {} },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        catalogRevision: 'r1',
      }],
      tools: [],
    }
    writeFileSync(file, JSON.stringify(legacy, null, 2), 'utf8')

    const store = createAgentAuthoringStore({ file })
    assert.equal(store.issue, undefined, 'a v1 document is readable, not corrupt')
    const migrated = store.getWorkflow('legacy-flow')
    assert.ok(migrated, 'the legacy entry is still resolvable by name')
    assert.equal(migrated.scope, 'global', 'a legacy entry becomes global')
    assert.equal(migrated.scopeKey, 'host')
    assert.equal(migrated.version, 3, 'migration does not reset the version')
    assert.match(migrated.digest, DIGEST, 'migration computes the content digest')

    // Any write upgrades the document; the store never writes v1 again. Asserted on the
    // BYTES rather than through a parse: the claim is about what the file says, and a cast
    // to a shape would be evidence about the cast, not the file.
    store.saveWorkflow({ name: 'after-migration', program: 'return 1', tools: [] })
    const written = readFileSync(file, 'utf8')
    // The DOCUMENT version is the first field of the serialized document. Per-entry versions
    // appear later, and a brand-new entry legitimately starts at version 1, so the whole-file
    // text cannot answer this question — only the document header can.
    assert.match(written.slice(0, 64), /"version": 2/, 'the document header is rewritten as v2')
  })

  it('keeps two root sessions isolated under the same workflow name', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    const a = store.saveWorkflow({ name: 'session-flow', program: 'return "a"', tools: [] }, sessionContext('session-a'))
    const b = store.saveWorkflow({ name: 'session-flow', program: 'return "b"', tools: [] }, sessionContext('session-b'))

    assert.notEqual(a.id, b.id, 'each session owns its own row')
    assert.equal(a.scope, 'session')
    assert.equal(a.scopeKey, 'session-a')
    assert.equal(store.getWorkflow('session-flow', sessionContext('session-a'))?.program, 'return "a"')
    assert.equal(store.getWorkflow('session-flow', sessionContext('session-b'))?.program, 'return "b"')
    // Neither session resolves the other's row by name, and nothing leaked to global.
    assert.equal(store.getWorkflow('session-flow'), undefined, 'a session row is invisible without a context')
    assert.equal(store.getWorkflow('session-flow', sessionContext('session-c')), undefined)
    assert.equal(store.listWorkflows(sessionContext('session-c')).length, 0)
  })

  it('resolves session over workspace over global and reports the shadowing row', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    const globalRow = store.saveWorkflow({ name: 'layered', description: 'global', program: 'return "g"', tools: [] }, globalContext())
    const workspaceRow = store.saveWorkflow({ name: 'layered', description: 'workspace', program: 'return "w"', tools: [] }, workspaceContext('/repo'))
    const sessionRow = store.saveWorkflow({ name: 'layered', description: 'session', program: 'return "s"', tools: [] }, sessionContext('session-a', '/repo'))

    const resolved = store.listWorkflows(sessionContext('session-a', '/repo'))
    assert.deepEqual(names(resolved), ['layered'], 'one row per name is reported')
    assert.equal(resolved[0]?.scope, 'session')
    assert.equal(resolved[0]?.version, sessionRow.version)
    assert.deepEqual(resolved[0]?.shadowing, { scope: 'workspace', version: workspaceRow.version })

    const atWorkspace = store.listWorkflows(workspaceContext('/repo'))
    assert.equal(atWorkspace[0]?.scope, 'workspace')
    assert.deepEqual(atWorkspace[0]?.shadowing, { scope: 'global', version: globalRow.version })

    const atGlobal = store.listWorkflows(globalContext())
    assert.equal(atGlobal[0]?.scope, 'global')
    assert.equal(atGlobal[0]?.shadowing, null, 'nothing is hidden below global')

    // all:true reports every visible row, not only the winners.
    assert.deepEqual(names(store.listWorkflows(sessionContext('session-a', '/repo'), { all: true })), ['layered', 'layered', 'layered'])
    assert.equal(store.listWorkflows(sessionContext('session-a', '/repo'), { all: true }).length, 3)
  })

  it('keys workspace scope by workspaceKey and falls back to scopeKey', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    const entry = store.saveWorkflow({ name: 'ws-flow', program: 'return 1', tools: [] }, { scope: 'workspace', scopeKey: '/repo/packages/x', workspaceKey: '/repo' })
    assert.equal(entry.scope, 'workspace')
    assert.equal(entry.scopeKey, '/repo', 'the workspace key wins when both are supplied')

    // The same repo reached from a subdirectory resolves the same row.
    assert.equal(store.getWorkflow('ws-flow', { scope: 'session', scopeKey: 'session-a', workspaceKey: '/repo' })?.id, entry.id)
    // A different workspace does not.
    assert.equal(store.getWorkflow('ws-flow', { scope: 'session', scopeKey: 'session-a', workspaceKey: '/other' }), undefined)

    // With no workspaceKey, scopeKey IS the workspace key (one-key callers stay usable).
    const fallback = store.saveWorkflow({ name: 'ws-fallback', program: 'return 1', tools: [] }, { scope: 'workspace', scopeKey: '/one-key' })
    assert.equal(fallback.scopeKey, '/one-key')
    assert.equal(store.getWorkflow('ws-fallback', { scope: 'session', scopeKey: 'session-b', workspaceKey: '/one-key' })?.id, fallback.id)
  })

  it('deleting the nearer row unshadows the lower one instead of deleting it', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    store.saveWorkflow({ name: 'unshadow', description: 'global', program: 'return "g"', tools: [] }, globalContext())
    store.saveWorkflow({ name: 'unshadow', description: 'session', program: 'return "s"', tools: [] }, sessionContext('session-a'))

    assert.equal(store.deleteWorkflow('unshadow', sessionContext('session-a')), true)
    const after = store.getWorkflow('unshadow', sessionContext('session-a'))
    assert.ok(after, 'the global row is still there')
    assert.equal(after.scope, 'global')
    assert.equal(after.description, 'global', 'the lower row was never touched')
    assert.equal(store.deleteWorkflow('unshadow', sessionContext('session-a')), false, 'nothing left in session scope')
  })

  it('promotes to a target scope: version resets, digest is copied, promotedFrom records the source', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    store.saveWorkflow({ name: 'promote-me', description: 'worth keeping', program: 'return { ok: true }', tools: [] }, sessionContext('session-a'))
    store.saveWorkflow({ name: 'promote-me', description: 'worth keeping', program: 'return { ok: true }', tools: [] }, sessionContext('session-a'))
    const updated = store.getWorkflow('promote-me', sessionContext('session-a'))
    assert.ok(updated)
    assert.equal(updated.version, 2)

    const promoted = store.promote('promote-me', sessionContext('session-a'), workspaceContext('/repo'), { sessionId: 'session-a' })
    assert.equal(promoted.kind, 'workflow')
    const copy = promoted.kind === 'workflow' ? promoted.workflow : undefined
    assert.ok(copy)
    assert.equal(copy.name, 'promote-me', 'promotion never renames')
    assert.equal(copy.version, 1, 'the version restarts at the target scope')
    assert.equal(copy.program, updated.program)
    assert.equal(copy.digest, updated.digest, 'the content digest travels with the copy')
    assert.deepEqual(copy.inputSchema, updated.inputSchema)
    assert.equal(copy.scope, 'workspace')
    assert.equal(copy.scopeKey, '/repo')
    assert.ok(copy.promotedFrom, 'the copy records where it came from')
    assert.equal(copy.promotedFrom.scope, 'session')
    assert.equal(copy.promotedFrom.version, 2, 'promotedFrom.version is the SOURCE version')
    assert.equal(copy.promotedFrom.sessionId, 'session-a')
    assert.ok(copy.promotedFrom.at.length > 0)
    assert.deepEqual(copy.promotedFrom.tools, [])

    // Both rows survive: promotion copies unless asked to move.
    assert.ok(store.getWorkflow('promote-me', sessionContext('session-a')))
    assert.equal(store.getWorkflow('promote-me', workspaceContext('/repo'))?.version, 1)
    // A promoted row is now the winner for a caller at the target scope.
    assert.equal(store.getWorkflow('promote-me', { scope: 'session', scopeKey: 'other', workspaceKey: '/repo' })?.scope, 'workspace')
  })

  it('keepSource:false moves the artifact, and a duplicate target refuses with scope-conflict', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    store.saveWorkflow({ name: 'move-me', program: 'return 1', tools: [] }, sessionContext('session-a'))

    refuse(
      () => {
        // Seed the target so the copy has somewhere to collide.
        store.saveWorkflow({ name: 'move-me', program: 'return 2', tools: [] }, workspaceContext('/repo'))
        return store.promote('move-me', sessionContext('session-a'), workspaceContext('/repo'))
      },
      'scope-conflict',
    )

    // A different target is free; keepSource:false removes the session row.
    const promoted = store.promote('move-me', sessionContext('session-a'), globalContext(), undefined, false)
    assert.equal(promoted.kind, 'workflow')
    // The SESSION row is gone. The workspace row seeded above is untouched and still
    // resolves from that session's context: keepSource:false removes the source only.
    assert.deepEqual(store.sessionWorkflows('session-a').map(row => row.name), [], 'the source row is gone')
    assert.equal(store.getWorkflow('move-me', sessionContext('session-a'))?.scope, 'workspace')
    assert.equal(store.getWorkflow('move-me', globalContext())?.scope, 'global', 'the copy lives at global now')
    assert.equal(store.getWorkflow('move-me')?.scope, 'global', 'and a context-less caller finds it')
  })

  it('demotes the resolved row and hands resolution back to the lower scope', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    store.saveWorkflow({ name: 'demote-me', description: 'global', program: 'return "g"', tools: [] }, globalContext())
    store.saveWorkflow({ name: 'demote-me', description: 'workspace', program: 'return "w"', tools: [] }, workspaceContext('/repo'))

    assert.equal(store.getWorkflow('demote-me', workspaceContext('/repo'))?.description, 'workspace')
    assert.equal(store.demote('demote-me', workspaceContext('/repo')), true)
    assert.equal(store.getWorkflow('demote-me', workspaceContext('/repo'))?.description, 'global')
    // demote removes the RESOLVED row, so a second call walks one layer further down.
    assert.equal(store.demote('demote-me', workspaceContext('/repo')), true, 'the global row is next')
    assert.equal(store.getWorkflow('demote-me', workspaceContext('/repo')), undefined)
    refuse(() => store.demote('never-existed', workspaceContext('/repo')), 'artifact-not-found')

    // delete is different on purpose: it is scope-EXACT, so it never reaches through.
    store.saveWorkflow({ name: 'exact-flow', description: 'global', program: 'return 1', tools: [] }, globalContext())
    store.saveWorkflow({ name: 'exact-flow', description: 'session', program: 'return 2', tools: [] }, sessionContext('session-a'))
    assert.equal(store.deleteWorkflow('exact-flow', sessionContext('session-a')), true)
    assert.equal(store.deleteWorkflow('exact-flow', sessionContext('session-a')), false, 'delete did not reach global')
    assert.equal(store.getWorkflow('exact-flow', sessionContext('session-a'))?.scope, 'global')
  })

  it('expires exactly one session\'s rows, returns them, and leaves other sessions alone', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    store.saveWorkflow({ name: 'doomed-flow', program: 'return 1', tools: [] }, sessionContext('session-a'))
    store.saveTool({ name: 'agent_doomed', description: 'd', inputSchema: { type: 'object', properties: {} }, program: 'return 1', tools: [] }, sessionContext('session-a'))
    store.saveWorkflow({ name: 'survivor-flow', program: 'return 2', tools: [] }, sessionContext('session-b'))
    store.saveWorkflow({ name: 'global-flow', program: 'return 3', tools: [] }, globalContext())

    assert.deepEqual(names(store.sessionWorkflows('session-a')), ['doomed-flow'])
    assert.deepEqual(names(store.sessionTools('session-a')), ['agent_doomed'])

    const expired = store.expireSession('session-a')
    assert.deepEqual(names(expired.workflows), ['doomed-flow'])
    assert.deepEqual(names(expired.tools), ['agent_doomed'])
    assert.equal(expired.workflows[0]?.scope, 'session')
    assert.equal(expired.workflows[0]?.scopeKey, 'session-a')

    assert.equal(store.getWorkflow('doomed-flow', sessionContext('session-a')), undefined)
    assert.equal(store.getTool('agent_doomed', sessionContext('session-a')), undefined)
    assert.equal(store.sessionWorkflows('session-a').length, 0)
    // Other scopes and other sessions are untouched.
    assert.equal(store.getWorkflow('survivor-flow', sessionContext('session-b'))?.version, 1)
    assert.equal(store.getWorkflow('global-flow', globalContext())?.version, 1)
    assert.deepEqual(store.expireSession('no-such-session'), { workflows: [], tools: [] })
  })

  it('digests the canonical content, so key order and version do not change it', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    const first = store.saveWorkflow({
      name: 'digest-flow',
      description: 'same',
      program: 'return 1',
      tools: ['text.lang_detect'],
      inputSchema: { type: 'object', properties: { alpha: { type: 'string' }, beta: { type: 'number' } } },
    }, workspaceContext('/repo'))
    assert.match(first.digest, DIGEST)

    // Re-saving bumps the version; identical content must keep the digest.
    const second = store.saveWorkflow({
      name: 'digest-flow',
      description: 'same',
      program: 'return 1',
      tools: ['text.lang_detect'],
      inputSchema: { type: 'object', properties: { beta: { type: 'number' }, alpha: { type: 'string' } } },
    }, workspaceContext('/repo'))
    assert.equal(second.version, 2)
    assert.equal(second.digest, first.digest, 'property order is canonicalised out of the digest')

    const changed = store.saveWorkflow({ name: 'digest-flow', description: 'different', program: 'return 1', tools: ['text.lang_detect'] }, workspaceContext('/repo'))
    assert.notEqual(changed.digest, first.digest, 'a changed description changes the digest')

    const changedProgram = store.saveWorkflow({ name: 'digest-flow', description: 'different', program: 'return 2', tools: ['text.lang_detect'] }, workspaceContext('/repo'))
    assert.notEqual(changedProgram.digest, changed.digest, 'a changed program changes the digest')
  })

  it('stays byte-compatible for a context-less caller (global only)', () => {
    const file = authoringFile()
    const store = createAgentAuthoringStore({ file })
    const first = store.saveWorkflow({ name: 'plain-flow', program: 'return 1', tools: [] })
    assert.equal(first.scope, 'global', 'no context means global')
    assert.equal(first.scopeKey, 'host')
    assert.equal(first.version, 1)
    const second = store.saveWorkflow({ name: 'plain-flow', program: 'return 2', tools: [] })
    assert.equal(second.version, 2, 'the name still updates in place')
    assert.equal(second.id, first.id)
    assert.equal(second.createdAt, first.createdAt)
    assert.equal(store.listWorkflows().length, 1)
    assert.equal(store.listWorkflows()[0]?.scope, 'global')
    assert.equal(store.listWorkflows()[0]?.shadowing, null)
    assert.equal(store.getWorkflow('plain-flow')?.program, 'return 2')
    assert.equal(store.deleteWorkflow(first.id), true, 'deleting by id still works')
    assert.equal(store.listWorkflows().length, 0)

    // And a reopened store reads the same thing.
    store.saveWorkflow({ name: 'persisted', program: 'return 3', tools: [] })
    const reopened = createAgentAuthoringStore({ file })
    assert.equal(reopened.issue, undefined)
    assert.equal(reopened.getWorkflow('persisted')?.scope, 'global')
  })

  it('refuses an unknown scope or a missing artifact with an actionable message', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    // The scope is INTENTIONALLY invalid: this test proves the store validates at runtime
    // instead of trusting its own type. Carrying the lie through a `string` field keeps the
    // overrule in one place.
    const invalidScope: string = 'galaxy'
    // SAFETY: `invalidScope` is a string by construction, so this assertion only states the
    // test's intent (bypass the scope union); the STORE is what rejects the value.
    const bad = { scope: invalidScope, scopeKey: 'x' } as ArtifactScopeContext
    const unknown = refuse(() => store.saveWorkflow({ name: 'bad-scope', program: 'return 1', tools: [] }, bad), 'scope-unknown')
    assert.match(unknown.message, /galaxy/, 'the message states the observed value')
    assert.match(unknown.message, /session/, 'the message states the allowed values')

    const missing = refuse(() => store.promote('absent', undefined, globalContext()), 'artifact-not-found')
    assert.match(missing.message, /absent/)
  })

  it('refuses scoped writes when scoping is disabled', () => {
    const store = createAgentAuthoringStore({ file: authoringFile(), scopeEnabled: false })
    // The global default still works: that is exactly today's behaviour.
    assert.equal(store.saveWorkflow({ name: 'legacy-only', program: 'return 1', tools: [] }).scope, 'global')
    const refused = refuse(() => store.saveWorkflow({ name: 'session-only', program: 'return 1', tools: [] }, sessionContext('session-a')), 'scope-disabled')
    assert.match(refused.message, /scope/i)
    refuse(() => store.promote('legacy-only', undefined, workspaceContext('/repo')), 'scope-disabled')
  })

  it('reports scope and digest on tool summaries too', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    store.saveTool({
      name: 'agent_scoped',
      description: 'a scoped tool',
      inputSchema: { type: 'object', properties: {} },
      program: 'return 1',
      tools: [],
    }, workspaceContext('/repo'))
    store.saveTool({
      name: 'agent_scoped',
      description: 'the global one',
      inputSchema: { type: 'object', properties: {} },
      program: 'return 2',
      tools: [],
    }, globalContext())

    const resolved = store.listTools(workspaceContext('/repo'))
    assert.deepEqual(names(resolved), ['agent_scoped'])
    assert.equal(resolved[0]?.scope, 'workspace')
    assert.deepEqual(resolved[0]?.shadowing, { scope: 'global', version: 1 })
    assert.match(resolved[0]?.digest ?? '', DIGEST)
    assert.equal(store.listTools(workspaceContext('/repo'), { all: true }).length, 2)
    assert.equal(store.getTool('agent_scoped', workspaceContext('/repo'))?.description, 'a scoped tool')
    assert.equal(store.getTool('agent_scoped')?.description, 'the global one')
  })

  it('promotes an agent tool with the same rules as a workflow', () => {
    const store = createAgentAuthoringStore({ file: authoringFile() })
    store.saveTool({
      name: 'agent_promotable',
      description: 'worth keeping',
      inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      program: 'return input.value',
      tools: [],
    }, sessionContext('session-a'))

    const promoted = store.promote('agent_promotable', sessionContext('session-a'), workspaceContext('/repo'))
    assert.equal(promoted.kind, 'tool')
    const copy = promoted.kind === 'tool' ? promoted.tool : undefined
    assert.ok(copy)
    assert.equal(copy.version, 1)
    assert.equal(copy.promotedFrom?.scope, 'session')
    assert.equal(store.getTool('agent_promotable', workspaceContext('/repo'))?.description, 'worth keeping')
    assert.equal(store.getTool('agent_promotable', sessionContext('session-a'))?.scope, 'session')
  })
})
