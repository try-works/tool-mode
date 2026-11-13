/**
 * Profile-scoped durable custom-tool store.
 *
 * The index is the only mutable document; each record version is immutable.
 * Writes use a temp file + rename so a crash cannot leave a half-written active
 * pointer, and an unreadable index fails closed instead of being treated as
 * empty.
 *
 * @module @try-works/dsh-tool-mode/custom-tools/store
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { normalizeCustomToolDraft, CustomToolSchemaError } from './schema.ts'
import type {
  CustomToolDraft,
  CustomToolIndex,
  CustomToolIndexEntry,
  CustomToolRecord,
} from './types.ts'

/** The current store/index schema. */
export const CUSTOM_TOOLS_SCHEMA_VERSION = 1 as const

/** A named refusal from the custom-tool store. */
export class CustomToolStoreError extends Error {
  override readonly name = 'CustomToolStoreError'
  readonly code: 'custom-tool-store-corrupt' | 'custom-tool-not-found' | 'custom-tool-id-invalid'

  constructor(code: CustomToolStoreError['code'], message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

/** Options for the store. */
export interface CustomToolStoreOptions {
  /** Root directory holding the index and one directory per tool. */
  readonly rootDir: string
  /** Clock seam for deterministic tests. */
  readonly now?: () => Date
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function emptyIndex(): CustomToolIndex {
  return { schemaVersion: CUSTOM_TOOLS_SCHEMA_VERSION, tools: {} }
}

function defaultIndexPath(rootDir: string): string {
  return join(rootDir, 'index.json')
}

function idPattern(): RegExp {
  return /^custom\.[a-z0-9][a-z0-9-]*$/
}

function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, file)
}

function parseIndex(raw: unknown, source: string): CustomToolIndex {
  if (!isRecord(raw) || raw['schemaVersion'] !== CUSTOM_TOOLS_SCHEMA_VERSION || !isRecord(raw['tools'])) {
    throw new CustomToolStoreError('custom-tool-store-corrupt', `${source} is not a custom-tool index`)
  }
  const tools: Record<string, CustomToolIndexEntry> = {}
  for (const [id, entry] of Object.entries(raw['tools'])) {
    if (!idPattern().test(id) || !isRecord(entry)) {
      throw new CustomToolStoreError('custom-tool-store-corrupt', `${source} has an invalid tool entry ${JSON.stringify(id)}`)
    }
    const activeVersion = entry['activeVersion']
    const updatedAt = entry['updatedAt']
    if (typeof activeVersion !== 'number' || !Number.isInteger(activeVersion) || activeVersion < 1
      || typeof updatedAt !== 'string' || typeof entry['enabled'] !== 'boolean') {
      throw new CustomToolStoreError('custom-tool-store-corrupt', `${source} has an invalid index entry for ${id}`)
    }
    tools[id] = { activeVersion, enabled: entry['enabled'], updatedAt }
  }
  return { schemaVersion: CUSTOM_TOOLS_SCHEMA_VERSION, tools }
}

/** Durable custom-tool records. */
export class CustomToolStore {
  readonly rootDir: string
  readonly indexPath: string
  private readonly now: () => Date

  constructor(options: CustomToolStoreOptions) {
    this.rootDir = options.rootDir
    this.indexPath = defaultIndexPath(options.rootDir)
    this.now = options.now ?? (() => new Date())
  }

  /** Read the index; a missing file is the only empty store. */
  readIndex(): CustomToolIndex {
    if (!existsSync(this.indexPath)) return emptyIndex()
    try {
      return parseIndex(JSON.parse(readFileSync(this.indexPath, 'utf8')), this.indexPath)
    } catch (error) {
      if (error instanceof CustomToolStoreError) throw error
      throw new CustomToolStoreError('custom-tool-store-corrupt', `${this.indexPath} could not be read: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }

  /** The active record ids, sorted for deterministic UI output. */
  listIds(): readonly string[] {
    return Object.keys(this.readIndex().tools).sort()
  }

  /** Read one active record; absent means the id is not active. */
  read(id: string): CustomToolRecord | undefined {
    this.assertId(id)
    const index = this.readIndex()
    const entry = index.tools[id]
    if (entry === undefined) return undefined
    return this.readVersion(id, entry.activeVersion, entry.enabled)
  }

  /** Read a specific immutable version. */
  readVersion(id: string, version: number, enabledOverride?: boolean): CustomToolRecord {
    this.assertId(id)
    const file = this.versionPath(id, version)
    if (!existsSync(file)) {
      throw new CustomToolStoreError('custom-tool-store-corrupt', `${id}@${version} is referenced but missing at ${file}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      throw new CustomToolStoreError('custom-tool-store-corrupt', `${file} could not be read: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    if (!isRecord(parsed)
      || parsed['schemaVersion'] !== CUSTOM_TOOLS_SCHEMA_VERSION
      || parsed['id'] !== id
      || parsed['version'] !== version
      || typeof parsed['name'] !== 'string'
      || typeof parsed['createdAt'] !== 'string'
      || typeof parsed['updatedAt'] !== 'string') {
      throw new CustomToolStoreError('custom-tool-store-corrupt', `${file} is not a valid ${id}@${version} record`)
    }
    // Validate the persisted draft fields again; a tampered record must not be
    // registered merely because it is syntactically JSON.
    let draft
    try {
      draft = normalizeCustomToolDraft(parsed)
    } catch (error) {
      throw new CustomToolStoreError(
        'custom-tool-store-corrupt',
        `${file} contains an invalid draft: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    const enabled = enabledOverride ?? parsed['enabled'] === true
    return {
      schemaVersion: CUSTOM_TOOLS_SCHEMA_VERSION,
      ...draft,
      version,
      enabled,
      createdAt: parsed['createdAt'],
      updatedAt: parsed['updatedAt'],
    }
  }

  /** All active records, sorted by id. */
  list(): readonly CustomToolRecord[] {
    const index = this.readIndex()
    return this.listIds().map(id => {
      const entry = index.tools[id]
      if (entry === undefined) throw new CustomToolStoreError('custom-tool-store-corrupt', `${id} disappeared from the index`)
      return this.readVersion(id, entry.activeVersion, entry.enabled)
    })
  }

  /**
   * Validate and persist a new version. The previous version is never mutated.
   * @param draft - user-authored draft.
   * @returns the persisted record.
   */
  save(draft: CustomToolDraft): CustomToolRecord {
    const normalized = normalizeCustomToolDraft(draft)
    this.assertId(normalized.id)
    const index = this.readIndex()
    const existing = index.tools[normalized.id]
    const version = existing === undefined ? 1 : existing.activeVersion + 1
    const now = this.now().toISOString()
    const record: CustomToolRecord = {
      schemaVersion: CUSTOM_TOOLS_SCHEMA_VERSION,
      ...normalized,
      version,
      enabled: existing?.enabled ?? true,
      createdAt: existing === undefined ? now : this.readVersion(normalized.id, existing.activeVersion).createdAt,
      updatedAt: now,
    }
    const recordFile = this.versionPath(normalized.id, version)
    writeJsonAtomic(recordFile, record)
    const next: CustomToolIndex = {
      schemaVersion: CUSTOM_TOOLS_SCHEMA_VERSION,
      tools: {
        ...index.tools,
        [normalized.id]: {
          activeVersion: version,
          enabled: record.enabled,
          updatedAt: now,
        },
      },
    }
    writeJsonAtomic(this.indexPath, next)
    return record
  }

  /** Enable or disable one active tool. */
  setEnabled(id: string, enabled: boolean): CustomToolRecord {
    this.assertId(id)
    const index = this.readIndex()
    const entry = index.tools[id]
    if (entry === undefined) throw new CustomToolStoreError('custom-tool-not-found', `${id} is not a custom tool`)
    const now = this.now().toISOString()
    const next: CustomToolIndex = {
      schemaVersion: CUSTOM_TOOLS_SCHEMA_VERSION,
      tools: {
        ...index.tools,
        [id]: { ...entry, enabled, updatedAt: now },
      },
    }
    writeJsonAtomic(this.indexPath, next)
    return this.readVersion(id, entry.activeVersion, enabled)
  }

  /** Remove the active pointer; immutable version files remain for audit. */
  delete(id: string): boolean {
    this.assertId(id)
    const index = this.readIndex()
    if (index.tools[id] === undefined) return false
    const tools = { ...index.tools }
    delete tools[id]
    writeJsonAtomic(this.indexPath, { schemaVersion: CUSTOM_TOOLS_SCHEMA_VERSION, tools } satisfies CustomToolIndex)
    return true
  }

  /** Version files present for one id (diagnostics/history). */
  versions(id: string): readonly number[] {
    this.assertId(id)
    const dir = join(this.rootDir, id)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .map(name => /^(\d+)\.json$/.exec(name)?.[1])
      .filter((value): value is string => value !== undefined)
      .map(Number)
      .filter(version => Number.isInteger(version) && version > 0)
      .sort((a, b) => a - b)
  }

  /** The absolute file for one version. */
  versionPath(id: string, version: number): string {
    return join(this.rootDir, id, `${version}.json`)
  }

  private assertId(id: string): void {
    if (!idPattern().test(id)) {
      throw new CustomToolStoreError('custom-tool-id-invalid', `${JSON.stringify(id)} is not a valid custom tool id`)
    }
  }
}

export { CustomToolSchemaError }
