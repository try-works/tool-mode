/**
 * Port tests — the seams a hosted control plane will occupy later.
 *
 * Each port is a service with LOCAL implementations in this package, so Phase 0
 * runs with no hosted dependency at all. These tests pin the local semantics
 * that a future hosted implementation must match: lookups fail with
 * `PortFailure`, deployment events are append-only and per-model, missing files
 * read as empty while corrupt files fail loudly, and the no-op telemetry sink
 * never fails a request.
 *
 * @module tests/ports
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'

import {
  CatalogSource,
  DeploymentStore,
  EntitlementService,
  PortFailure,
  TelemetrySink,
  type CatalogEntry,
  type DeploymentEvent,
  type DeploymentEventType,
} from '../src/index.ts'
import { failureOf, sampleEntry, withTempDir, writeJson } from './support.ts'

/** A catalog layer that cannot fail, for the happy-path assertions. */
type CatalogLayer = Layer.Layer<CatalogSource, PortFailure>
/** A deployment-store layer that cannot fail, for the happy-path assertions. */
type StoreLayer = Layer.Layer<DeploymentStore, PortFailure>

/** Read the whole catalog. */
function listCatalog(layer: CatalogLayer): Promise<readonly CatalogEntry[]> {
  return Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const catalog = yield* CatalogSource
        return yield* catalog.list
      }),
      layer,
    ),
  )
}

/** Read one catalog entry. */
function getCatalogEntry(layer: CatalogLayer, id: string): Promise<CatalogEntry> {
  return Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const catalog = yield* CatalogSource
        return yield* catalog.get(id)
      }),
      layer,
    ),
  )
}

/** Append one deployment event. */
function appendEvent(layer: StoreLayer, event: DeploymentEvent): Promise<void> {
  return Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const store = yield* DeploymentStore
        yield* store.append(event)
      }),
      layer,
    ),
  )
}

/** Read the events recorded for one model. */
function modelEvents(layer: StoreLayer, modelId: string): Promise<readonly DeploymentEvent[]> {
  return Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const store = yield* DeploymentStore
        return yield* store.events(modelId)
      }),
      layer,
    ),
  )
}

/** A deployment event's opaque detail, named by the contract rather than re-spelled. */
type DeploymentDetail = NonNullable<DeploymentEvent['detail']>

/** Build a deployment event, omitting `detail` rather than passing undefined. */
function event(
  type: DeploymentEventType,
  at: string,
  modelId: string,
  detail?: DeploymentDetail,
): DeploymentEvent {
  const base: DeploymentEvent = { type, at, modelId }
  return detail === undefined ? base : { ...base, detail }
}

describe('ports', () => {
  describe('service keys', () => {
    it('keeps the documented keys, because the key string IS the runtime identity', () => {
      assert.equal(CatalogSource.key, 'tool-mode-runtime/CatalogSource')
      assert.equal(DeploymentStore.key, 'tool-mode-runtime/DeploymentStore')
      assert.equal(EntitlementService.key, 'tool-mode-runtime/EntitlementService')
      assert.equal(TelemetrySink.key, 'tool-mode-runtime/TelemetrySink')
    })
  })

  describe('CatalogSource.fromEntries', () => {
    it('lists entries in insertion order and returns them by id', async () => {
      const redact = sampleEntry()
      const uhm = sampleEntry({ id: 'uhm', processor: { id: 'uhm-wordpiece', version: '1.0.0' } })
      const layer = CatalogSource.fromEntries([redact, uhm])

      assert.deepEqual(await listCatalog(layer), [redact, uhm])
      assert.deepEqual(await getCatalogEntry(layer, 'redact'), redact)
      assert.deepEqual(await getCatalogEntry(layer, 'uhm'), uhm)
    })

    it('fails an unknown id with a PortFailure that names the id', async () => {
      const layer = CatalogSource.fromEntries([sampleEntry()])
      const error = await failureOf(getCatalogEntry(layer, 'nope'))
      assert.ok(error instanceof PortFailure)
      assert.equal(error.port, 'CatalogSource')
      assert.match(error.message, /nope/)
    })

    it('refuses duplicate ids instead of letting the last one win silently', async () => {
      const layer = CatalogSource.fromEntries([sampleEntry(), sampleEntry({ version: '2.0.0' })])
      const error = await failureOf(listCatalog(layer))
      assert.ok(error instanceof PortFailure)
      assert.equal(error.port, 'CatalogSource')
      assert.match(error.message, /redact/)
    })
  })

  describe('CatalogSource.fromJsonFile', () => {
    it('reads a JSON array of entries', async () => {
      await withTempDir(async (dir) => {
        const path = join(dir, 'catalog.json')
        await writeJson(path, [sampleEntry()])
        const layer = CatalogSource.fromJsonFile(path)
        assert.deepEqual(await getCatalogEntry(layer, 'redact'), sampleEntry())
      })
    })

    it('reads the { entries: [...] } envelope a control plane would publish', async () => {
      await withTempDir(async (dir) => {
        const path = join(dir, 'catalog.json')
        await writeJson(path, { entries: [sampleEntry({ id: 'clear' })] })
        const layer = CatalogSource.fromJsonFile(path)
        assert.deepEqual(await listCatalog(layer), [sampleEntry({ id: 'clear' })])
      })
    })

    it('fails loudly when the file is missing — an empty catalog is not a catalog', async () => {
      await withTempDir(async (dir) => {
        const layer = CatalogSource.fromJsonFile(join(dir, 'missing.json'))
        const error = await failureOf(listCatalog(layer))
        assert.ok(error instanceof PortFailure)
        assert.equal(error.port, 'CatalogSource')
      })
    })

    it('fails a malformed document with a PortFailure, not a defect', async () => {
      await withTempDir(async (dir) => {
        const path = join(dir, 'catalog.json')
        await writeJson(path, { nope: true })
        const error = await failureOf(listCatalog(CatalogSource.fromJsonFile(path)))
        assert.ok(error instanceof PortFailure)
        assert.equal(error.port, 'CatalogSource')
      })
    })

    it('validates every entry, so an unknown format never reaches a provider', async () => {
      await withTempDir(async (dir) => {
        const path = join(dir, 'catalog.json')
        await writeJson(path, [{ ...sampleEntry(), format: 'safetensors' }])
        const error = await failureOf(listCatalog(CatalogSource.fromJsonFile(path)))
        assert.ok(error instanceof PortFailure)
        assert.equal(error.port, 'CatalogSource')
      })
    })
  })

  describe('DeploymentStore.fromMemory', () => {
    it('appends events and filters them by model, preserving order, inside one runtime scope', async () => {
      // An in-memory store is scoped like every Effect layer: its log lives exactly as
      // long as the scope that built it, so both the append and the read happen inside
      // the same provided program. That is how a real runtime holds it (one ManagedRuntime
      // per deployment), not one layer value shared across separate provides.
      const layer = DeploymentStore.fromMemory()
      const seen = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const store = yield* DeploymentStore
            yield* store.append(event('requested', '2026-11-14T00:00:00.000Z', 'redact'))
            yield* store.append(event('prepared', '2026-11-14T00:01:00.000Z', 'redact', { bytes: 1024 }))
            yield* store.append(event('requested', '2026-11-14T00:02:00.000Z', 'uhm'))
            return {
              redact: yield* store.events('redact'),
              uhm: yield* store.events('uhm'),
              unknown: yield* store.events('nope'),
            }
          }),
          layer,
        ),
      )

      assert.deepEqual(seen.redact, [
        event('requested', '2026-11-14T00:00:00.000Z', 'redact'),
        event('prepared', '2026-11-14T00:01:00.000Z', 'redact', { bytes: 1024 }),
      ])
      assert.deepEqual(seen.uhm, [event('requested', '2026-11-14T00:02:00.000Z', 'uhm')])
      assert.deepEqual(seen.unknown, [])
    })

    it('does not leak its log into another scope', async () => {
      const layer = DeploymentStore.fromMemory()
      await appendEvent(layer, event('activated', '2026-11-14T00:00:00.000Z', 'redact'))
      assert.deepEqual(await modelEvents(layer, 'redact'), [])
    })
  })

  describe('DeploymentStore.fromJsonFile', () => {
    it('persists across layer builds, so a restarted process still knows what it deployed', async () => {
      await withTempDir(async (dir) => {
        const path = join(dir, 'deployments.json')
        const first = DeploymentStore.fromJsonFile(path)
        await appendEvent(first, event('requested', '2026-11-14T00:00:00.000Z', 'redact'))
        await appendEvent(first, event('prepared', '2026-11-14T00:01:00.000Z', 'redact', { bytes: 1024 }))

        const second = DeploymentStore.fromJsonFile(path)
        assert.deepEqual(await modelEvents(second, 'redact'), [
          event('requested', '2026-11-14T00:00:00.000Z', 'redact'),
          event('prepared', '2026-11-14T00:01:00.000Z', 'redact', { bytes: 1024 }),
        ])

        const onDisk: unknown = JSON.parse(await readFile(path, 'utf8'))
        assert.ok(Array.isArray(onDisk))
        assert.equal(onDisk.length, 2)
      })
    })

    it('starts empty when the file does not exist yet and creates it on first append', async () => {
      await withTempDir(async (dir) => {
        const path = join(dir, 'deployments.json')
        const layer = DeploymentStore.fromJsonFile(path)
        assert.deepEqual(await modelEvents(layer, 'redact'), [])
        await appendEvent(layer, event('requested', '2026-11-14T00:00:00.000Z', 'redact'))
        const onDisk: unknown = JSON.parse(await readFile(path, 'utf8'))
        assert.deepEqual(onDisk, [event('requested', '2026-11-14T00:00:00.000Z', 'redact')])
      })
    })

    it('fails a corrupt log loudly instead of resetting the history', async () => {
      await withTempDir(async (dir) => {
        const path = join(dir, 'deployments.json')
        await writeJson(path, { truncated: 'yes' })
        const error = await failureOf(modelEvents(DeploymentStore.fromJsonFile(path), 'redact'))
        assert.ok(error instanceof PortFailure)
        assert.equal(error.port, 'DeploymentStore')
      })
    })
  })

  describe('EntitlementService.allowAll', () => {
    it('allows every model, which is the local-only policy', async () => {
      const verdict = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const entitlements = yield* EntitlementService
            return yield* entitlements.check('redact')
          }),
          EntitlementService.allowAll,
        ),
      )
      assert.equal(verdict, 'allowed')
    })
  })

  describe('TelemetrySink.noop', () => {
    it('records without failing the request, even when the event carries little detail', async () => {
      await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const telemetry = yield* TelemetrySink
            yield* telemetry.record({ kind: 'load', modelId: 'redact', detail: { bytes: 1024 } })
            yield* telemetry.record({})
          }),
          TelemetrySink.noop,
        ),
      )
    })
  })
})
