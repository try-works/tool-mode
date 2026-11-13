/**
 * Host-release trusted built-ins (EXT-03).
 *
 * The lock is read from the HOST package, never from an extension manifest, so a
 * package cannot grant itself built-in status or extra trust by declaring it.
 * A missing/malformed lock fails closed with an empty protected set.
 */

import { readFileSync } from 'node:fs'

/** One trusted built-in entry. */
export interface BuiltinEntry {
  readonly extensionId: string
  readonly package?: string
  readonly protected: boolean
}

/** The host-release built-ins lock. */
export interface BuiltinsLock {
  readonly version: number
  readonly builtins: readonly BuiltinEntry[]
}

/** Read and validate the lock next to this module. */
export function loadBuiltinsLock(url: URL = new URL('../builtins.lock.json', import.meta.url)): BuiltinsLock {
  const parsed = JSON.parse(readFileSync(url, 'utf8')) as Partial<BuiltinsLock>
  if (parsed.version !== 1 || !Array.isArray(parsed.builtins)) {
    throw new Error('builtins.lock.json must carry version 1 and a builtins array')
  }
  const builtins = parsed.builtins.map((entry, index) => {
    if (entry === null || typeof entry !== 'object') {
      throw new Error(`builtins.lock.json builtins[${index}] is not an object`)
    }
    if (typeof entry.extensionId !== 'string' || entry.extensionId.length === 0) {
      throw new Error(`builtins.lock.json builtins[${index}].extensionId must be a non-empty string`)
    }
    if (typeof entry.protected !== 'boolean') {
      throw new Error(`builtins.lock.json builtins[${index}].protected must be a boolean`)
    }
    return { ...entry }
  })
  return { version: 1, builtins }
}

/** The lock shipped with this host release. */
export const BUILTINS_LOCK: BuiltinsLock = loadBuiltinsLock()

/** Extension ids the host release protects from uninstall. */
export const PROTECTED_BUILTIN_IDS: readonly string[] = Object.freeze(
  BUILTINS_LOCK.builtins.filter(entry => entry.protected).map(entry => entry.extensionId),
)

/** Whether an extension is a protected built-in of THIS host release. */
export function isProtectedBuiltin(extensionId: string): boolean {
  return PROTECTED_BUILTIN_IDS.includes(extensionId)
}
