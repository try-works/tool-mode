/**
 * Artifact scope context (task-63).
 *
 * These are the PURE helpers that turn runtime facts — a leaf session id, a cwd, an
 * optional explicit workspace root, and the scoping config — into the
 * `ArtifactScopeContext` an authored-artifact store resolves with. The only I/O is the
 * filesystem reads needed to find a git root; nothing here writes.
 *
 * Two properties are deliberate:
 *
 * - `resolveRootSessionId` is iterative and cycle-guarded. A cyclic or absurdly deep
 *   parent chain returns the LAST id reached instead of hanging or overflowing the stack.
 * - `workspaceKeyFor` never throws for a missing path: a path that cannot be realpath'd
 *   falls back to the resolved cwd, and a workspace with no `.git` is keyed by its real
 *   cwd. On win32 the key is lowercased so two spellings of one directory share a scope.
 *
 * @module artifact-scope-context
 */

import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { ArtifactScope, ArtifactScopeContext } from './agent-authoring.ts'

/** Every legal scope, in resolution order (nearest first). */
const SCOPES: readonly ArtifactScope[] = ['session', 'workspace', 'global']

/** How many parent links `resolveRootSessionId` follows before it gives up and returns the current id. */
const MAX_PARENT_DEPTH = 1000

/**
 * Whether a value is one of the three artifact scopes.
 * @param value - the value to check.
 * @returns true when the value is a scope.
 */
export function isArtifactScope(value: string | null | undefined): value is ArtifactScope {
  return value === 'session' || value === 'workspace' || value === 'global'
}

/**
 * Resolve a leaf session id to the root of its parent chain.
 *
 * Subagents share their root session's artifacts, so a write is keyed by the ROOT id, not
 * the leaf's. A cycle (a -> b -> a) returns the last id before the repeat (b); an empty
 * leaf returns `'unknown'` without consulting the parent lookup; a chain longer than
 * {@link MAX_PARENT_DEPTH} returns the id reached at the limit.
 * @param leafSessionId - the session the caller is running as.
 * @param parentOf - the parent lookup; undefined means the id is a root.
 * @returns the root session id, or `'unknown'` for an empty leaf.
 */
export function resolveRootSessionId(
  leafSessionId: string,
  parentOf: (id: string) => string | undefined,
): string {
  if (leafSessionId.trim().length === 0) return 'unknown'
  let current = leafSessionId
  const seen = new Set<string>([current])
  for (let depth = 0; depth < MAX_PARENT_DEPTH; depth += 1) {
    const parent = parentOf(current)
    // An absent or empty parent ends the chain: the current id is the root.
    if (parent === undefined || parent.trim().length === 0) return current
    // A repeat means the chain is cyclic; the last distinct id is the best answer available.
    if (seen.has(parent)) return current
    seen.add(parent)
    current = parent
  }
  return current
}

/** The real path of an existing path, or undefined when it cannot be resolved. */
function existingRealPath(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/** The platform-normalized scope key: win32 paths are case-insensitive. */
function platformKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/**
 * The workspace key for a cwd.
 *
 * In `'auto'` mode the cwd is walked upward until a `.git` entry is found — a directory
 * for a normal clone, a file for a worktree — and that root's realpath is the key. With no
 * repository the realpath of the cwd is the key. Any other `mode` is an explicit
 * workspace root: it is resolved (relative to `cwd`) and realpath'd without walking.
 *
 * This never throws for a missing path. A cwd that does not exist falls back to the
 * resolved cwd; an explicit root that does not exist also falls back to the resolved cwd.
 * @param cwd - the session's working directory.
 * @param mode - `'auto'` to discover the git root, or an explicit workspace root path.
 * @returns the platform-normalized workspace key.
 */
export function workspaceKeyFor(cwd: string, mode: string = 'auto'): string {
  const resolvedCwd = resolve(cwd)
  const realCwd = existingRealPath(resolvedCwd)

  if (mode !== 'auto') {
    const requested = resolve(cwd, mode)
    const realRequested = existingRealPath(requested)
    return platformKey(realRequested ?? resolvedCwd)
  }

  if (realCwd === undefined) return platformKey(resolvedCwd)

  let current = realCwd
  for (;;) {
    if (existsSync(join(current, '.git'))) return platformKey(current)
    const parent = dirname(current)
    if (parent === current) return platformKey(realCwd)
    current = parent
  }
}

/** The scoping config the context is built from. */
export interface ScopeConfig {
  /** Whether scoped authoring is enabled at all. Disabled means every write is global. */
  readonly enabled: boolean
  /** The scope a write lands at when the caller requests none. */
  readonly defaultScope: ArtifactScope
}

/** Everything {@link buildScopeContext} needs. */
export interface BuildScopeContextInput {
  readonly config: ScopeConfig
  /** The session the caller is running as; absent for a host-level call. */
  readonly sessionId?: string | undefined
  /** A requested scope; when absent the config default is used. */
  readonly requestedScope?: string | undefined
  /** The parent lookup used to resolve the root session. */
  readonly parentOf: (id: string) => string | undefined
  /** The session's working directory, used for the workspace key. */
  readonly cwd: string
  /** An explicit workspace root; when absent the git root is discovered from `cwd`. */
  readonly workspaceRoot?: string | undefined
}

/** What {@link buildScopeContext} produces. */
export interface BuiltScopeContext {
  readonly context: ArtifactScopeContext
  /** Present when a session id was supplied (resolved to its root). */
  readonly rootSessionId?: string | undefined
  /** The resolved scope, also present in `context.scope`. */
  readonly scope: ArtifactScope
  /** The resolved workspace key, also present in `context.workspaceKey`. */
  readonly workspaceKey: string
  /** The scope the caller asked for (or the configured default when it asked for none). */
  readonly requestedScope?: ArtifactScope | undefined
  /** Why the resolved scope differs from the requested/default scope, when it does. */
  readonly scopeReason?: 'no-session-id' | undefined
}

/**
 * A refusal to build a scope context.
 *
 * `code` is the stable part; the message names the offending scope and the allowed set.
 */
export class ArtifactScopeError extends Error {
  /** The stable error code. */
  readonly code: 'E_SCOPE_UNKNOWN'

  /**
   * @param code - the stable error code.
   * @param message - a caller-facing explanation; defaults to the allowed-values message.
   */
  constructor(
    code: 'E_SCOPE_UNKNOWN',
    message: string = `unknown artifact scope; allowed: ${SCOPES.join(', ')}`,
  ) {
    super(message)
    this.name = 'ArtifactScopeError'
    this.code = code
  }
}

/**
 * Build the scope context for one caller.
 *
 * When scoping is disabled the context is global/host and `requestedScope` is ignored;
 * the workspace key is still computed because callers publish it regardless. When enabled,
 * the requested scope (or the config default) selects the key:
 *
 * - `session` uses the ROOT session id and requires a session id;
 * - `workspace` uses the workspace key;
 * - `global` uses `'host'`.
 *
 * An unknown requested scope throws {@link ArtifactScopeError} `E_SCOPE_UNKNOWN` naming the
 * allowed values; a session scope without a session id throws a plain Error.
 * @param input - config, session facts, cwd and the explicit-root override.
 * @returns the context plus the resolved root session, scope and workspace key.
 * @throws {ArtifactScopeError} when the requested scope is not one of the three scopes.
 * @throws {Error} when a session scope is requested without a session id.
 */
export function buildScopeContext(input: BuildScopeContextInput): BuiltScopeContext {
  const workspaceKey = workspaceKeyFor(input.cwd, input.workspaceRoot ?? 'auto')
  const leafSessionId = input.sessionId !== undefined && input.sessionId.trim().length > 0
    ? input.sessionId
    : undefined
  const rootSessionId = leafSessionId === undefined
    ? undefined
    : resolveRootSessionId(leafSessionId, input.parentOf)

  if (!input.config.enabled) {
    const context: ArtifactScopeContext = {
      scope: 'global',
      scopeKey: 'host',
      workspaceKey,
      sessionId: rootSessionId,
    }
    return { context, rootSessionId, scope: 'global', workspaceKey }
  }

  const requested = input.requestedScope ?? input.config.defaultScope
  if (!isArtifactScope(requested)) {
    throw new ArtifactScopeError(
      'E_SCOPE_UNKNOWN',
      `unknown artifact scope "${requested}"; allowed: ${SCOPES.join(', ')}`,
    )
  }

  let scopeKey: string
  if (requested === 'session') {
    if (leafSessionId === undefined) throw new Error('session scope needs a session id')
    scopeKey = rootSessionId ?? 'unknown'
  } else if (requested === 'workspace') {
    scopeKey = workspaceKey
  } else {
    scopeKey = 'host'
  }

  const context: ArtifactScopeContext = {
    scope: requested,
    scopeKey,
    workspaceKey,
    sessionId: rootSessionId,
  }
  return { context, rootSessionId, scope: requested, workspaceKey }
}
