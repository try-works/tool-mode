/**
 * A reference test host for authors (EXT-17).
 *
 * The SDK's install/lifecycle code is what a host runs; this module is the smallest
 * supported way to exercise an extension OUTSIDE DSH: point it at the package entry,
 * get an activated instance, create a provider and call it. It deliberately provides
 * no DSH surface and no credentials — an author's fake provider belongs in the
 * author's test, and this host never invents one.
 *
 * @module @try-works/tool-mode-extension-sdk/test-host
 */

import { activateExtension, loadExtensionModule } from './load.ts'
import type { DisposeReason, ExtensionContextV1, ExtensionInstanceV1, JsonValue } from './runtime.ts'

/** Options for {@link createAuthorTestHost}. */
export interface AuthorTestHostOptions {
  /** Absolute path of the installed package entry (the package's exports entry). */
  readonly entryPath: string
  /**
   * Override any host-issued context field. Unspecified fields get a minimal,
   * in-memory, no-network context that performs no work at import time.
   */
  readonly context?: Partial<ExtensionContextV1>
}

/** An activated extension plus a disposal helper. */
export interface AuthorTestHost {
  /** The activated instance, exactly what a host would receive. */
  readonly instance: ExtensionInstanceV1
  /** The host-issued context the instance saw. */
  readonly context: ExtensionContextV1
  /**
   * Dispose the instance (idempotent at the SDK contract level).
   * @param reason - the disposal reason.
   */
  dispose(reason?: string): Promise<void>
}

/**
 * Load and activate an extension entry with a minimal host-issued context.
 * @param options - the entry path and optional context overrides.
 * @returns the activated instance.
 */
export async function createAuthorTestHost(options: AuthorTestHostOptions): Promise<AuthorTestHost> {
  const storage = new Map<string, JsonValue>()
  const context: ExtensionContextV1 = {
    extensionId: 'author-test-host',
    extensionVersion: '0.0.0',
    activationGeneration: 1,
    storage: {
      directory: '',
      async read(key: string): Promise<JsonValue | undefined> {
        return storage.get(key)
      },
      async write(key: string, value: JsonValue): Promise<void> {
        storage.set(key, value)
      },
    },
    logger: {
      log(): void {
        // Silent by default: an author's test asserts behavior, not log lines.
      },
    },
    signal: new AbortController().signal,
    configuration: {},
    ...options.context,
  }
  const extension = await loadExtensionModule(options.entryPath)
  const instance = await activateExtension(extension, context)
  return {
    instance,
    context,
    dispose(reason: DisposeReason = 'shutdown'): Promise<void> {
      return instance.dispose(reason)
    },
  }
}
