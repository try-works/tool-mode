/**
 * Runtime registration for custom tools.
 *
 * One active registration per custom id. Saving a new version disposes the old
 * definition before registering the new one; disabling/deleting disposes without
 * touching the immutable record. `sync()` is the restart path.
 *
 * @module @try-works/dsh-tool-mode/custom-tools/registry
 */

import { compileCustomTool, type CustomToolExecutor } from './compile.ts'
import { CustomToolStore, CustomToolStoreError } from './store.ts'
import type { CustomToolRecord } from './types.ts'

/** The registry surface needed; structurally compatible with `ctx.tools`. */
export interface CustomToolRegistryTools {
  get(name: string): unknown
  register(definition: unknown): () => void
}

/** One live registration. */
export interface CustomToolRegistration {
  readonly id: string
  readonly name: string
  readonly version: number
  readonly dispose: () => void
}

/** One per-tool sync outcome. */
export interface CustomToolSyncEntry {
  readonly id: string
  readonly version: number | null
  readonly reason: string
}

/** Full sync result, safe to report from a host service. */
export interface CustomToolSyncResult {
  readonly registered: readonly CustomToolSyncEntry[]
  readonly skipped: readonly CustomToolSyncEntry[]
  readonly errors: readonly CustomToolSyncEntry[]
}

/** Options for the registrar. */
export interface CustomToolRegistrarOptions {
  readonly store: CustomToolStore
  readonly tools: CustomToolRegistryTools
  readonly execute: CustomToolExecutor
}

/** Owns the live definitions for one profile. */
export class CustomToolRegistrar {
  readonly store: CustomToolStore
  private readonly tools: CustomToolRegistryTools
  private readonly execute: CustomToolExecutor
  private readonly active = new Map<string, CustomToolRegistration>()

  constructor(options: CustomToolRegistrarOptions) {
    this.store = options.store
    this.tools = options.tools
    this.execute = options.execute
  }

  /** The live registration for one id, if any. */
  get(id: string): CustomToolRegistration | undefined {
    return this.active.get(id)
  }

  /** Live registrations, sorted by id. */
  list(): readonly CustomToolRegistration[] {
    return [...this.active.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  /**
   * Register or refresh one record. The old definition for the same id is
   * disposed first, so a new version is visible without a host restart.
   */
  register(record: CustomToolRecord): CustomToolRegistration {
    if (!record.enabled) throw new Error(`${record.id} is disabled`)
    if (!record.policy.agentExpose) throw new Error(`${record.id} is not exposed to agents`)
    const existing = this.active.get(record.id)
    if (existing !== undefined) {
      existing.dispose()
      this.active.delete(record.id)
    }
    const occupant = this.tools.get(record.name)
    if (occupant !== undefined) {
      throw new Error(`custom-tool-name-conflict: ${record.name} is already registered`)
    }
    const definition = compileCustomTool(record, this.execute)
    const dispose = this.tools.register(definition)
    const registration: CustomToolRegistration = {
      id: record.id,
      name: record.name,
      version: record.version,
      dispose,
    }
    this.active.set(record.id, registration)
    return registration
  }

  /** Dispose one id; false when it was not live. */
  dispose(id: string): boolean {
    const active = this.active.get(id)
    if (active === undefined) return false
    active.dispose()
    this.active.delete(id)
    return true
  }

  /** Dispose everything (plugin teardown). */
  disposeAll(): void {
    for (const registration of this.active.values()) registration.dispose()
    this.active.clear()
  }

  /**
   * Reconcile the live set with the store. A bad record is reported and does not
   * stop the others; a disabled or agent-hidden record is disposed.
   */
  sync(): CustomToolSyncResult {
    const registered: CustomToolSyncEntry[] = []
    const skipped: CustomToolSyncEntry[] = []
    const errors: CustomToolSyncEntry[] = []
    const wanted = new Set<string>()
    for (const id of this.store.listIds()) {
      let record: CustomToolRecord | undefined
      try {
        record = this.store.read(id)
      } catch (error) {
        errors.push({
          id,
          version: null,
          reason: error instanceof CustomToolStoreError ? error.message : String(error),
        })
        continue
      }
      if (record === undefined) continue
      if (!record.enabled) {
        this.dispose(id)
        skipped.push({ id, version: record.version, reason: 'disabled' })
        continue
      }
      if (!record.policy.agentExpose) {
        this.dispose(id)
        skipped.push({ id, version: record.version, reason: 'not-agent-exposed' })
        continue
      }
      wanted.add(id)
      const live = this.active.get(id)
      if (live?.version === record.version) {
        registered.push({ id, version: record.version, reason: 'already registered' })
        continue
      }
      try {
        const next = this.register(record)
        registered.push({ id, version: next.version, reason: 'registered' })
      } catch (error) {
        errors.push({ id, version: record.version, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    for (const id of [...this.active.keys()]) {
      if (!wanted.has(id)) this.dispose(id)
    }
    return { registered, skipped, errors }
  }
}
