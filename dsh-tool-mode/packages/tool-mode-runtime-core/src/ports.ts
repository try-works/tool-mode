/**
 * Control-plane seams, with local implementations.
 *
 * Phase 0 is local only: these ports are the shape a hosted control plane will
 * occupy later, and this module ships the implementations that need no hosted
 * dependency at all. A local implementation must behave like a hosted one from
 * the caller's point of view: missing things fail with {@link PortFailure},
 * never with a defect, and never by silently inventing data.
 *
 * @module ports
 */

/*
 * This module IS the I/O boundary for hand-editable JSON: parsing `unknown`
 * documents is its job, and the schemas below are the parser. Two shapes are
 * also fixed by docs/runtime/PLAN.md — `DeploymentEvent.detail` and the
 * telemetry `record` payload are opaque dictionaries by contract. The generic
 * anti-slop rules assume a typed caller, so they are disabled only here, and
 * every refused document becomes a PortFailure instead of being trusted.
 */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type */

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { Context, Effect, Layer, Schema } from 'effect'

import { ModelFormat } from './contracts.ts'
import { PortFailure } from './errors.ts'

const CATALOG_PORT = 'CatalogSource'
const STORE_PORT = 'DeploymentStore'

/** The compute lanes a catalog entry may declare. */
export const Accelerator = Schema.Literals(['cpu', 'dml', 'webgpu'])
/** The compute lanes a catalog entry may declare. */
export type Accelerator = Schema.Schema.Type<typeof Accelerator>

/** One model the runtime can deploy. */
export interface CatalogEntry {
  readonly id: string
  readonly version: string
  readonly digest: string
  readonly format: ModelFormat
  readonly artifact: {
    readonly assetSet: string
    readonly fileName: string
    readonly sha256: string
    readonly bytes: number
  }
  readonly processor: { readonly id: string; readonly version: string }
  readonly accelerators: readonly ('cpu' | 'dml' | 'webgpu')[]
  readonly limits: { readonly maxInputBytes: number; readonly timeoutMs: number }
}

/**
 * The validating form of {@link CatalogEntry}, used for every document read
 * from disk. The interface above is what callers write; this schema is what the
 * port accepts, so an unknown format or a fractional byte count is refused
 * before a provider ever sees it.
 */
export const CatalogEntrySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  digest: Schema.String,
  format: ModelFormat,
  artifact: Schema.Struct({
    assetSet: Schema.NonEmptyString,
    fileName: Schema.NonEmptyString,
    sha256: Schema.String,
    bytes: Schema.Int,
  }),
  processor: Schema.Struct({ id: Schema.NonEmptyString, version: Schema.NonEmptyString }),
  accelerators: Schema.Array(Accelerator),
  limits: Schema.Struct({ maxInputBytes: Schema.Int, timeoutMs: Schema.Int }),
})

/** The append-only deployment event kinds. */
export type DeploymentEventType = 'requested' | 'prepared' | 'activated' | 'failed' | 'deactivated'

/** One deployment event. */
export interface DeploymentEvent {
  readonly type: DeploymentEventType
  readonly at: string
  readonly modelId: string
  readonly detail?: Record<string, unknown>
}

/** The validating form of {@link DeploymentEvent}, for logs read from disk. */
export const DeploymentEventSchema = Schema.Struct({
  type: Schema.Literals(['requested', 'prepared', 'activated', 'failed', 'deactivated']),
  at: Schema.String,
  modelId: Schema.NonEmptyString,
  detail: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

/** Where catalog entries come from. */
export class CatalogSource extends Context.Service<
  CatalogSource,
  {
    readonly get: (id: string) => Effect.Effect<CatalogEntry, PortFailure>
    readonly list: Effect.Effect<readonly CatalogEntry[]>
  }
>()('tool-mode-runtime/CatalogSource') {}

/** Where deployment events are appended and read back. */
export class DeploymentStore extends Context.Service<
  DeploymentStore,
  {
    readonly append: (event: DeploymentEvent) => Effect.Effect<void, PortFailure>
    readonly events: (modelId: string) => Effect.Effect<readonly DeploymentEvent[], PortFailure>
  }
>()('tool-mode-runtime/DeploymentStore') {}

/** Whether a model may be deployed at all. */
export class EntitlementService extends Context.Service<
  EntitlementService,
  {
    readonly check: (modelId: string) => Effect.Effect<'allowed' | 'denied', PortFailure>
  }
>()('tool-mode-runtime/EntitlementService') {}

/** Where runtime telemetry goes. */
export class TelemetrySink extends Context.Service<
  TelemetrySink,
  {
    readonly record: (event: Record<string, unknown>) => Effect.Effect<void>
  }
>()('tool-mode-runtime/TelemetrySink') {}

/** Local catalog implementations. */
export namespace CatalogSource {
  /**
   * A catalog from entries already in memory.
   *
   * Duplicate ids are refused: a last-one-wins lookup would make the deployed
   * artifact depend on document order.
   */
  export const fromEntries = (entries: readonly CatalogEntry[]): Layer.Layer<CatalogSource, PortFailure> =>
    Layer.effect(
      CatalogSource,
      Effect.gen(function* () {
        const byId = yield* indexCatalog(entries)
        return CatalogSource.of(catalogSourceOf(byId, entries))
      }),
    )

  /**
   * A catalog from a JSON file.
   *
   * Accepts either a bare array of entries or the `{ "entries": [...] }`
   * envelope a control plane publishes. A missing file is a {@link PortFailure}:
   * an empty catalog is a real thing to have, and a missing one is not it.
   */
  export const fromJsonFile = (path: string): Layer.Layer<CatalogSource, PortFailure> =>
    Layer.effect(
      CatalogSource,
      Effect.gen(function* () {
        const entries = yield* readJson(path, CATALOG_PORT, (document) => decodeCatalog(document, path))
        const byId = yield* indexCatalog(entries)
        return CatalogSource.of(catalogSourceOf(byId, entries))
      }),
    )
}

/** Local deployment-store implementations. */
export namespace DeploymentStore {
  /** An in-memory, per-build event log. */
  export const fromMemory = (): Layer.Layer<DeploymentStore> =>
    Layer.effect(
      DeploymentStore,
      Effect.sync(() => {
        const events: DeploymentEvent[] = []
        return DeploymentStore.of({
          append: (event) =>
            Effect.sync(() => {
              events.push(event)
            }),
          events: (modelId) => Effect.succeed(events.filter((event) => event.modelId === modelId)),
        })
      }),
    )

  /**
   * A JSON-file-backed event log, read at build time and rewritten on append.
   *
   * A missing file is a fresh log. A file that exists but does not parse is a
   * {@link PortFailure}: resetting a corrupt history would destroy the record of
   * what was deployed.
   */
  export const fromJsonFile = (path: string): Layer.Layer<DeploymentStore, PortFailure> =>
    Layer.effect(
      DeploymentStore,
      Effect.gen(function* () {
        const existing = yield* readDeploymentLog(path)
        const events: DeploymentEvent[] = [...existing]
        const persist = (): Effect.Effect<void, PortFailure> =>
          Effect.tryPromise({
            try: async () => {
              await mkdir(dirname(path), { recursive: true })
              await writeFile(path, `${JSON.stringify(events, null, 2)}\n`, 'utf8')
            },
            catch: (cause) =>
              new PortFailure({ port: STORE_PORT, message: `cannot write ${path}: ${describe(cause)}` }),
          })
        return DeploymentStore.of({
          append: (event) =>
            Effect.gen(function* () {
              events.push(event)
              yield* persist()
            }),
          events: (modelId) => Effect.succeed(events.filter((event) => event.modelId === modelId)),
        })
      }),
    )
}

/** Local entitlement implementations. */
export namespace EntitlementService {
  /** The local-only policy: every catalogued model may run. */
  export const allowAll: Layer.Layer<EntitlementService> = Layer.succeed(
    EntitlementService,
    EntitlementService.of({ check: () => Effect.succeed('allowed' as const) }),
  )
}

/** Local telemetry implementations. */
export namespace TelemetrySink {
  /** Drop every event. A telemetry outage must never fail a request. */
  export const noop: Layer.Layer<TelemetrySink> = Layer.succeed(
    TelemetrySink,
    TelemetrySink.of({ record: () => Effect.void }),
  )
}

/**
 * A JSON value exactly as parsed from disk, before any schema has validated it.
 *
 * Named so the read helpers expose a real contract instead of `unknown`: the
 * only thing a caller may do with one is hand it to a decoder.
 */
export type JsonDocument =
  | string
  | number
  | boolean
  | null
  | readonly JsonDocument[]
  | { readonly [key: string]: JsonDocument }

/** Read a JSON document and hand it straight to the parser for that document. */
function readJson<A>(
  path: string,
  port: string,
  decode: (document: JsonDocument) => Effect.Effect<A, PortFailure>,
): Effect.Effect<A, PortFailure> {
  const parsed = Effect.tryPromise({
    try: async (): Promise<JsonDocument> => JSON.parse(await readFile(path, 'utf8')),
    catch: (cause) => new PortFailure({ port, message: `cannot read ${path}: ${describe(cause)}` }),
  })
  return Effect.flatMap(parsed, decode)
}

/** Decode a catalog document in either accepted shape. */
function decodeCatalog(document: unknown, path: string): Effect.Effect<readonly CatalogEntry[], PortFailure> {
  const invalid = (cause: unknown): PortFailure =>
    new PortFailure({ port: CATALOG_PORT, message: `invalid catalog ${path}: ${describe(cause)}` })

  if (Array.isArray(document)) {
    return Effect.mapError(Schema.decodeUnknownEffect(Schema.Array(CatalogEntrySchema))(document), invalid)
  }
  return Effect.mapError(
    Schema.decodeUnknownEffect(Schema.Struct({ entries: Schema.Array(CatalogEntrySchema) }))(document),
    invalid,
  ).pipe(Effect.map((envelope) => envelope.entries))
}

/** Index catalog entries by id, refusing duplicates. */
function indexCatalog(entries: readonly CatalogEntry[]): Effect.Effect<ReadonlyMap<string, CatalogEntry>, PortFailure> {
  return Effect.suspend(() => {
    const byId = new Map<string, CatalogEntry>()
    for (const entry of entries) {
      if (byId.has(entry.id)) {
        return Effect.fail(
          new PortFailure({ port: CATALOG_PORT, message: `duplicate catalog id: ${entry.id}` }),
        )
      }
      byId.set(entry.id, entry)
    }
    return Effect.succeed<ReadonlyMap<string, CatalogEntry>>(byId)
  })
}

/** Build the catalog service shape around an index. */
function catalogSourceOf(
  byId: ReadonlyMap<string, CatalogEntry>,
  entries: readonly CatalogEntry[],
): CatalogSource['Service'] {
  return {
    get: (id) => {
      const entry = byId.get(id)
      return entry === undefined
        ? Effect.fail(new PortFailure({ port: CATALOG_PORT, message: `no catalog entry for model id: ${id}` }))
        : Effect.succeed(entry)
    },
    list: Effect.succeed(entries),
  }
}

/** Read a deployment log; a missing file is an empty log. */
function readDeploymentLog(path: string): Effect.Effect<readonly DeploymentEvent[], PortFailure> {
  return Effect.flatMap(readOptionalJson(path), (document) =>
    document.found ? toDeploymentEvents(document.document) : Effect.succeed<readonly DeploymentEvent[]>([]),
  )
}

/** A parsed document, or the fact that the file was not there. */
interface OptionalDocument {
  readonly found: boolean
  readonly document: unknown
}

/** Read and parse a JSON file, treating ENOENT as absence rather than failure. */
function readOptionalJson(path: string): Effect.Effect<OptionalDocument, PortFailure> {
  return Effect.tryPromise({
    try: async (): Promise<OptionalDocument> => {
      try {
        return { found: true, document: JSON.parse(await readFile(path, 'utf8')) }
      } catch (cause) {
        if (isNotFound(cause)) {
          return { found: false, document: undefined }
        }
        throw cause
      }
    },
    catch: (cause) => new PortFailure({ port: STORE_PORT, message: `cannot read ${path}: ${describe(cause)}` }),
  })
}

/** Decode a deployment log and drop an absent `detail` instead of passing undefined. */
function toDeploymentEvents(document: unknown): Effect.Effect<readonly DeploymentEvent[], PortFailure> {
  return Effect.map(
    Effect.mapError(
      Schema.decodeUnknownEffect(Schema.Array(DeploymentEventSchema))(document),
      (cause) => new PortFailure({ port: STORE_PORT, message: `invalid deployment log: ${describe(cause)}` }),
    ),
    (events) =>
      events.map((event) => {
        const normalised: DeploymentEvent = { type: event.type, at: event.at, modelId: event.modelId }
        return event.detail === undefined ? normalised : { ...normalised, detail: event.detail }
      }),
  )
}

/** True when a filesystem failure means "the file is not there". */
function isNotFound(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false
  if (!('code' in cause)) return false
  return cause.code === 'ENOENT'
}

/** A human-readable one-line form of an unknown failure. */
function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
