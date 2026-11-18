/**
 * The PTC sandbox temp root (Windows ACL fix).
 *
 * DSH's `windows-acl` sandbox materializes a PRIVATE temp directory with
 * `os.tmpdir()`, and that is where the Code Mode failure came from: on this host
 * `os.tmpdir()` resolved to `E:\tmp`, where `SetNamedSecurityInfoW` refuses to write the
 * DACL (Win32 5). A directory in the user profile accepts it. `os.tmpdir()` reads
 * `process.env.TEMP`/`TMP` at call time on Windows, so the host can point those at a
 * directory it owns for the lifetime of the process and restore them on teardown.
 *
 * This module is the pure policy plus the install/restore pair, so the resolution table
 * is testable without mounting the plugin. It never decides to override on POSIX:
 * `os.tmpdir()` reads `TMPDIR` there, not TEMP/TMP, so changing TEMP/TMP would be a
 * silent no-op at best and a misleading claim at worst.
 *
 * @module sandbox-temp
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Why a root was chosen; part of the log line and the tests. */
export type SandboxTempRootSource = 'configured' | 'windows-default' | 'disabled'

/** The resolved temp root. */
export interface SandboxTempRoot {
  /** Absolute directory to point TEMP/TMP at, or '' to leave the platform temp alone. */
  readonly root: string
  /** Why this root was chosen. */
  readonly source: SandboxTempRootSource
}

/**
 * Resolve the temp root from configuration and platform.
 *
 * THE RESOLUTION TABLE:
 * - `configured` undefined  -> win32: `<home>/.dsh/tool-mode-sandbox/tmp`; other platforms '' (disabled)
 * - `configured` non-empty  -> that path, resolved to an absolute path (all platforms)
 * - `configured` ''/blank   -> '' (explicitly disabled, even on win32)
 *
 * @param options - configured value, platform and home directory overrides for tests.
 * @returns the root and why it was chosen.
 */
export function resolveSandboxTempRoot(options: {
  readonly configured?: string | undefined
  readonly platform?: NodeJS.Platform
  readonly home?: string
} = {}): SandboxTempRoot {
  const platform = options.platform ?? process.platform
  const configured = options.configured
  if (configured !== undefined) {
    const trimmed = configured.trim()
    if (trimmed.length === 0) return { root: '', source: 'disabled' }
    return { root: resolve(trimmed), source: 'configured' }
  }
  if (platform === 'win32') {
    return {
      root: join(options.home ?? homedir(), '.dsh', 'tool-mode-sandbox', 'tmp'),
      source: 'windows-default',
    }
  }
  return { root: '', source: 'disabled' }
}

/** One installed override: what was set, whether anything changed, and how to undo it. */
export interface SandboxTempInstall {
  /** The directory TEMP/TMP were pointed at ('' when disabled). */
  readonly root: string
  /** Whether TEMP/TMP were actually changed by this install. */
  readonly changed: boolean
  /** Restore the previous TEMP/TMP values exactly; idempotent. */
  restore(): void
}

/**
 * Point TEMP/TMP at `root` and return the undo.
 *
 * The directory is created first (owner-only where the platform honours the mode), so a
 * sandbox that starts immediately after plugin load already has a writable private temp.
 * An unchanged environment is left untouched: re-writing the same values would only
 * churn `os.tmpdir()` caches for no reason.
 *
 * @param root - the resolved root; '' is a no-op.
 * @param options - the environment to mutate (defaults to process.env).
 * @returns the install handle; call `restore()` on teardown.
 * @throws when the directory cannot be created.
 */
export function installSandboxTempRoot(
  root: string,
  options: { readonly env?: NodeJS.ProcessEnv } = {},
): SandboxTempInstall {
  if (root.length === 0) return { root, changed: false, restore: () => {} }
  const env = options.env ?? process.env
  const previousTemp = env['TEMP']
  const previousTmp = env['TMP']
  if (previousTemp === root && previousTmp === root) {
    return { root, changed: false, restore: () => {} }
  }
  mkdirSync(root, { recursive: true, mode: 0o700 })
  env['TEMP'] = root
  env['TMP'] = root
  let restored = false
  return {
    root,
    changed: true,
    restore() {
      if (restored) return
      restored = true
      if (previousTemp === undefined) delete env['TEMP']
      else env['TEMP'] = previousTemp
      if (previousTmp === undefined) delete env['TMP']
      else env['TMP'] = previousTmp
    },
  }
}

/** Default retention for abandoned sandbox temp directories. */
export const DEFAULT_SANDBOX_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * A per-run scope for the sandbox temp override.
 *
 * TEMP/TMP are process-global, so the override cannot safely live for the whole
 * host lifetime: every plugin in the process would inherit the sandbox tree and
 * it would grow forever. This scope installs the override for the duration of a
 * Code Mode run (reference-counted for concurrent/nested runs) and restores the
 * previous values exactly when the last run finishes.
 */
export interface SandboxTempScope {
  /** The root the override points at ('' when disabled). */
  readonly root: string
  /** Run `operation` with TEMP/TMP pointed at the root; restores them afterwards. */
  readonly run: <T>(operation: () => Promise<T>) => Promise<T>
}

/**
 * Build a per-run sandbox temp scope.
 *
 * @param root - the resolved root; '' disables the override entirely.
 * @param options - the environment to mutate (defaults to process.env).
 * @returns the scope; call `run` around each program execution.
 */
export function createSandboxTempScope(
  root: string,
  options: {
    readonly env?: NodeJS.ProcessEnv
    readonly onError?: (error: unknown) => void
  } = {},
): SandboxTempScope {
  if (root.length === 0) {
    return { root, run: operation => operation() }
  }
  let active = 0
  let install: SandboxTempInstall | undefined
  return {
    root,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      if (active === 0) {
        try {
          install = installSandboxTempRoot(root, options)
        } catch (error) {
          // A temp root that cannot be created must not fail the program: the
          // platform temp may still work, and the caller gets the sandbox error.
          install = undefined
          options.onError?.(error)
        }
      }
      active += 1
      try {
        return await operation()
      } finally {
        active -= 1
        if (active === 0) {
          install?.restore()
          install = undefined
        }
      }
    },
  }
}

/**
 * Delete abandoned child directories under the sandbox temp root.
 *
 * The root accumulates one directory per sandbox materialization. A process that
 * was killed cannot remove its own directory, so a later boot prunes children
 * older than the retention window. Active runs are recent, so their directories
 * survive; a background timer (not the boot path) calls this.
 *
 * @param root - the sandbox temp root; '' or a missing directory removes nothing.
 * @param options - retention window and clock override for tests.
 * @returns how many directories were removed.
 */
export function pruneSandboxTempRoot(
  root: string,
  options: { readonly maxAgeMs?: number; readonly now?: number } = {},
): number {
  if (root.length === 0 || !existsSync(root)) return 0
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_SANDBOX_TEMP_MAX_AGE_MS
  const cutoff = (options.now ?? Date.now()) - maxAgeMs
  let removed = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(root, entry.name)
    try {
      if (statSync(path).mtimeMs >= cutoff) continue
      rmSync(path, { recursive: true, force: true })
      removed += 1
    } catch {
      // A directory another process is still using is left for a later pass.
    }
  }
  return removed
}
