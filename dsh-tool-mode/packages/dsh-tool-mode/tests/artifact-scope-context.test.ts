/**
 * Artifact scope context (task-63).
 *
 * These helpers turn the runtime facts a caller has (a leaf session id, a cwd, an optional
 * workspace root) into the keys `ArtifactScopeContext` resolves with. They are pure apart
 * from the filesystem reads needed to locate a git root; the tests use real temporary
 * directories rather than mocks so the walk and realpath behaviour are the code under test.
 *
 * @module tests/artifact-scope-context
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  ArtifactScopeError,
  buildScopeContext,
  isArtifactScope,
  resolveRootSessionId,
  workspaceKeyFor,
  type BuildScopeContextInput,
} from '../src/artifact-scope-context.ts'

const roots: string[] = []

/** Create a temp directory the suite removes afterwards. */
function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

/** A repository root (with .git) plus a nested subdirectory. */
function makeRepository() {
  const root = makeDir('scope-repo-')
  mkdirSync(join(root, '.git'))
  const sub = join(root, 'src', 'deep')
  mkdirSync(sub, { recursive: true })
  return { root, sub }
}

/** A parent lookup over explicit links. */
function parentMap(links: readonly (readonly [string, string])[]): (id: string) => string | undefined {
  const known = new Map(links)
  return id => known.get(id)
}

/** The key the filesystem should produce for an existing path on this platform. */
function expectedKey(path: string): string {
  const real = realpathSync(path)
  return process.platform === 'win32' ? real.toLowerCase() : real
}

/** The platform-normalized form of a resolved path. */
function expectedResolvedKey(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

describe('isArtifactScope', () => {
  it('accepts exactly the three scopes', () => {
    for (const scope of ['session', 'workspace', 'global'] as const) {
      assert.equal(isArtifactScope(scope), true)
    }
    for (const value of ['gallery', 'SESSION', '', undefined, null]) {
      assert.equal(isArtifactScope(value), false, `${String(value)} is not a scope`)
    }
  })
})

describe('resolveRootSessionId', () => {
  it('walks parent links to the root', () => {
    const parentOf = parentMap([['leaf', 'mid'], ['mid', 'root']])
    assert.equal(resolveRootSessionId('leaf', parentOf), 'root')
    assert.equal(resolveRootSessionId('mid', parentOf), 'root')
    assert.equal(resolveRootSessionId('root', parentOf), 'root')
  })

  it('returns an orphan as its own root', () => {
    assert.equal(resolveRootSessionId('orphan', () => undefined), 'orphan')
  })

  it('returns unknown for an empty leaf without asking for a parent', () => {
    const parentOf = () => {
      throw new Error('an empty leaf has no parent to resolve')
    }
    assert.equal(resolveRootSessionId('', parentOf), 'unknown')
    assert.equal(resolveRootSessionId('   ', parentOf), 'unknown')
  })

  it('stops at a cycle and returns the last id before the repeat', () => {
    assert.equal(resolveRootSessionId('a', parentMap([['a', 'b'], ['b', 'a']])), 'b')
    assert.equal(resolveRootSessionId('a', parentMap([['a', 'c'], ['c', 'b'], ['b', 'a']])), 'b')
    assert.equal(resolveRootSessionId('self', parentMap([['self', 'self']])), 'self')
  })

  it('treats an empty parent id as the root', () => {
    assert.equal(resolveRootSessionId('leaf', parentMap([['leaf', '']])), 'leaf')
  })
})

describe('workspaceKeyFor', () => {
  it('finds the git root from the repository root', () => {
    const { root } = makeRepository()
    assert.equal(workspaceKeyFor(root), expectedKey(root))
  })

  it('finds the git root from a subdirectory', () => {
    const { root, sub } = makeRepository()
    assert.equal(workspaceKeyFor(sub), expectedKey(root))
  })

  it('recognizes a .git file (worktrees)', () => {
    const root = makeDir('scope-worktree-')
    writeFileSync(join(root, '.git'), 'gitdir: C:/elsewhere/.git/worktrees/example\n')
    assert.equal(workspaceKeyFor(root), expectedKey(root))
  })

  it('falls back to the cwd outside a repository', () => {
    const plain = makeDir('scope-plain-')
    assert.equal(workspaceKeyFor(plain), expectedKey(plain))
  })

  it('uses an explicit workspace root instead of walking', () => {
    const { root, sub } = makeRepository()
    assert.equal(workspaceKeyFor(sub, root), expectedKey(root))
  })

  it('falls back to the resolved cwd when the cwd does not exist', () => {
    const base = makeDir('scope-missing-')
    const missing = join(base, 'not-here')
    assert.equal(workspaceKeyFor(missing), expectedResolvedKey(missing))
  })

  it('falls back to the resolved cwd when an explicit root does not exist', () => {
    const base = makeDir('scope-missing-root-')
    assert.equal(workspaceKeyFor(base, join(base, 'gone')), expectedResolvedKey(base))
  })

  it('lowercases the key on win32', { skip: process.platform !== 'win32' }, () => {
    const { root } = makeRepository()
    const key = workspaceKeyFor(root)
    assert.equal(key, key.toLowerCase())
    assert.equal(key, expectedKey(root))
  })
})

describe('buildScopeContext', () => {
  const { root, sub } = makeRepository()
  const parentOf = parentMap([['leaf', 'mid'], ['mid', 'root']])
  const workspace = expectedKey(root)

  /** Build with sensible defaults, overriding only what a case pins. */
  function build(overrides: Partial<BuildScopeContextInput>): ReturnType<typeof buildScopeContext> {
    return buildScopeContext({
      config: { enabled: true, defaultScope: 'workspace' },
      parentOf,
      cwd: sub,
      ...overrides,
    })
  }

  it('returns global/host when scoping is disabled and ignores the requested scope', () => {
    const built = build({
      config: { enabled: false, defaultScope: 'session' },
      sessionId: 'leaf',
      requestedScope: 'gallery',
    })
    assert.equal(built.scope, 'global')
    assert.equal(built.context.scope, 'global')
    assert.equal(built.context.scopeKey, 'host')
    assert.equal(built.workspaceKey, workspace)
    assert.equal(built.context.workspaceKey, workspace)
    assert.equal(built.rootSessionId, 'root')
    assert.equal(built.context.sessionId, 'root')
  })

  it('does not resolve a session when disabled and no session id is supplied', () => {
    const built = build({
      config: { enabled: false, defaultScope: 'workspace' },
      parentOf: () => {
        throw new Error('no session id to resolve')
      },
    })
    assert.equal(built.scope, 'global')
    assert.equal(built.rootSessionId, undefined)
    assert.equal(built.context.sessionId, undefined)
  })

  it('uses the configured default scope when nothing is requested', () => {
    const built = build({ sessionId: 'leaf' })
    assert.equal(built.scope, 'workspace')
    assert.equal(built.context.scopeKey, workspace)
    assert.equal(built.context.workspaceKey, workspace)
    assert.equal(built.rootSessionId, 'root')
  })

  it('uses the explicit workspace root', () => {
    const built = build({ workspaceRoot: root })
    assert.equal(built.scope, 'workspace')
    assert.equal(built.context.scopeKey, workspace)
    assert.equal(built.workspaceKey, workspace)
  })

  it('lands a session-scope write on the root session id', () => {
    const built = build({ config: { enabled: true, defaultScope: 'workspace' }, sessionId: 'leaf', requestedScope: 'session' })
    assert.equal(built.scope, 'session')
    assert.equal(built.context.scopeKey, 'root')
    assert.equal(built.rootSessionId, 'root')
    assert.equal(built.context.sessionId, 'root')
  })

  it('lands a requested workspace write on the workspace key', () => {
    const built = build({ config: { enabled: true, defaultScope: 'session' }, sessionId: 'leaf', requestedScope: 'workspace' })
    assert.equal(built.scope, 'workspace')
    assert.equal(built.context.scopeKey, workspace)
    assert.equal(built.context.workspaceKey, workspace)
  })

  it('lands a requested global write on the host key', () => {
    const built = build({ requestedScope: 'global' })
    assert.equal(built.scope, 'global')
    assert.equal(built.context.scopeKey, 'host')
    assert.equal(built.context.workspaceKey, workspace)
  })

  it('refuses an unknown requested scope with the allowed values', () => {
    let error: unknown
    try {
      build({ requestedScope: 'gallery' })
    } catch (caught) {
      error = caught
    }
    assert.ok(error instanceof ArtifactScopeError)
    assert.equal(error.code, 'E_SCOPE_UNKNOWN')
    assert.match(error.message, /allowed: session, workspace, global/)
  })

  it('refuses a session write without a session id', () => {
    assert.throws(
      () => build({ config: { enabled: true, defaultScope: 'session' } }),
      /session scope needs a session id/,
    )
  })
})
