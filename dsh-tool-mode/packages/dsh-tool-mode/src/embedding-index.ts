/**
 * AT-52 — a persistent embedding index that records its space and model identity.
 *
 * There was no vector store in this repository, so a consumer had no safe way to
 * persist vectors across an upgrade. This index is deliberately small but it makes
 * the compatibility rule structural instead of documentary:
 *   - the space id, dimensions, model id and model generation are persisted;
 *   - a record whose space differs is refused (no 384→768 reuse);
 *   - an upgrade bumps the index schema and keeps every vector and its space;
 *   - a memory-only index is explicit and never writes.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

export interface EmbeddingSpaceIdentity {
  readonly spaceId: string
  readonly dimensions: number
  readonly modelId: string
  readonly modelGeneration: number | string
}

export interface EmbeddingRecord {
  readonly id: string
  readonly vector: readonly number[]
  readonly metadata?: Readonly<Record<string, string | number | boolean>>
}

export interface EmbeddingIndexFile {
  readonly schemaVersion: number
  readonly space: EmbeddingSpaceIdentity
  readonly records: Readonly<Record<string, EmbeddingRecord>>
}

export class IncompatibleEmbeddingSpace extends Error {
  readonly code = 'INCOMPATIBLE_EMBEDDING_SPACE'
  constructor(message: string) {
    super(message)
    this.name = 'IncompatibleEmbeddingSpace'
  }
}

const INDEX_SCHEMA_VERSION = 2

function sameSpace(left: EmbeddingSpaceIdentity, right: EmbeddingSpaceIdentity): boolean {
  return left.spaceId === right.spaceId
    && left.dimensions === right.dimensions
    && left.modelId === right.modelId
    && String(left.modelGeneration) === String(right.modelGeneration)
}

function validateSpace(space: EmbeddingSpaceIdentity): void {
  if (space.spaceId.trim() === '') throw new IncompatibleEmbeddingSpace('the embedding space id is empty')
  if (!Number.isInteger(space.dimensions) || space.dimensions <= 0) {
    throw new IncompatibleEmbeddingSpace(`invalid embedding dimensions: ${space.dimensions}`)
  }
  if (space.modelId.trim() === '') throw new IncompatibleEmbeddingSpace('the model id is empty')
}

function validateRecord(record: EmbeddingRecord, space: EmbeddingSpaceIdentity): void {
  if (record.id.trim() === '') throw new IncompatibleEmbeddingSpace('the record id is empty')
  if (record.vector.length !== space.dimensions) {
    throw new IncompatibleEmbeddingSpace(
      `record ${record.id} has ${record.vector.length} dimensions, but space ${space.spaceId} is ${space.dimensions}-dimensional`,
    )
  }
  if (!record.vector.every(value => Number.isFinite(value))) {
    throw new IncompatibleEmbeddingSpace(`record ${record.id} contains a non-finite value`)
  }
}

/**
 * A file-backed embedding index. `open` adopts the persisted space; it never
 * silently reinterprets existing vectors in a different space.
 */
export class EmbeddingIndex {
  #file: string | null
  #space: EmbeddingSpaceIdentity
  #schemaVersion: number
  #records = new Map<string, EmbeddingRecord>()

  private constructor(file: string | null, space: EmbeddingSpaceIdentity, schemaVersion = INDEX_SCHEMA_VERSION) {
    validateSpace(space)
    this.#file = file
    this.#space = space
    this.#schemaVersion = schemaVersion
  }

  static open(file: string | null, expected?: EmbeddingSpaceIdentity): EmbeddingIndex {
    if (file === null) {
      if (expected === undefined) throw new IncompatibleEmbeddingSpace('a memory-only index needs an explicit space')
      return new EmbeddingIndex(null, expected)
    }
    if (!existsSync(file)) {
      if (expected === undefined) throw new IncompatibleEmbeddingSpace(`the index ${file} does not exist and no space was given`)
      return new EmbeddingIndex(file, expected)
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<EmbeddingIndexFile>
    if (parsed.space === undefined) throw new IncompatibleEmbeddingSpace(`the index ${file} has no recorded embedding space`)
    if (expected !== undefined && !sameSpace(parsed.space, expected)) {
      throw new IncompatibleEmbeddingSpace(
        `the index ${file} records space ${parsed.space.spaceId}/${parsed.space.dimensions} model ${parsed.space.modelId}#${parsed.space.modelGeneration}, `
        + `not ${expected.spaceId}/${expected.dimensions} model ${expected.modelId}#${expected.modelGeneration}`,
      )
    }
    const index = new EmbeddingIndex(file, parsed.space, parsed.schemaVersion ?? 1)
    for (const [id, record] of Object.entries(parsed.records ?? {})) {
      validateRecord(record, parsed.space)
      index.#records.set(id, record)
    }
    return index
  }

  get space(): EmbeddingSpaceIdentity { return this.#space }
  get size(): number { return this.#records.size }

  upsert(record: EmbeddingRecord): void {
    validateRecord(record, this.#space)
    this.#records.set(record.id, record)
  }

  get(id: string): EmbeddingRecord | undefined { return this.#records.get(id) }
  all(): readonly EmbeddingRecord[] { return [...this.#records.values()] }

  /** Persist with the current schema version and the SAME space. */
  save(): void {
    if (this.#file === null) return
    const payload: EmbeddingIndexFile = {
      schemaVersion: this.#schemaVersion,
      space: this.#space,
      records: Object.fromEntries(this.#records),
    }
    const temporary = `${this.#file}.tmp`
    writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`)
    renameSync(temporary, this.#file)
  }

  /**
   * Upgrade the index schema without touching the space or the vectors.
   * A target space is refused unless it is identical.
   */
  upgrade(targetSchemaVersion: number, targetSpace: EmbeddingSpaceIdentity = this.#space): void {
    if (!sameSpace(targetSpace, this.#space)) {
      throw new IncompatibleEmbeddingSpace(
        `refusing to upgrade a ${this.#space.spaceId}/${this.#space.dimensions} index to ${targetSpace.spaceId}/${targetSpace.dimensions}`,
      )
    }
    if (!Number.isInteger(targetSchemaVersion) || targetSchemaVersion < 1) {
      throw new IncompatibleEmbeddingSpace(`invalid index schema version: ${targetSchemaVersion}`)
    }
    this.#schemaVersion = targetSchemaVersion
    this.save()
  }
}

/** A memory-only index: explicit, bounded to the process, never writes. */
export function openMemoryEmbeddingIndex(space: EmbeddingSpaceIdentity): EmbeddingIndex {
  return EmbeddingIndex.open(null, space)
}
