/**
 * A DETERMINISTIC fake {@link RuntimeProvider} for the adapter tests.
 *
 * The adapter's job is to drive a runtime provider's lifecycle from the Promise-based
 * `ModelProviderV1` surface. Every test therefore needs a provider whose BUILD, INSPECT,
 * INVOKE and RELEASE are observable, so the test can assert *when* each happened rather
 * than only what came back. Nothing here runs a model.
 *
 * Release is wired through `Effect.acquireRelease`, so a test can prove that `unload` and
 * `dispose` actually close the layer's scope instead of only dropping a reference.
 *
 * @module tests/fake-provider
 */

import { Effect, Layer } from 'effect'

import {
  type InferenceFailed,
  Inspection as InspectionSchema,
  RuntimeProvider,
  RuntimeRequest as RuntimeRequestSchema,
  RuntimeResult as RuntimeResultSchema,
  type RuntimeUnavailable,
} from '@try-works/tool-mode-runtime-core'

/** The service interface, derived from the service itself (PLAN.md models it as `X["Service"]`). */
type ProviderImplementation = RuntimeProvider['Service']

type Inspection = typeof InspectionSchema['Type']
type RuntimeRequest = typeof RuntimeRequestSchema['Type']
type RuntimeResult = typeof RuntimeResultSchema['Type']

/** What the fake observed and produced. */
export interface FakeStats {
  /** How many times the layer was built (one per `ManagedRuntime.make` + force). */
  builds: number
  /** How many times the service was released through the layer's scope. */
  releases: number
  /** How many times `inspect` was evaluated. */
  inspects: number
  /** Every request the provider was asked to run, in order. */
  requests: RuntimeRequest[]
}

/** Knobs that let a test make one step fail on demand. */
export interface FakeOverrides {
  readonly inspect?: () => Effect.Effect<Inspection>
  readonly load?: () => Effect.Effect<void, RuntimeUnavailable>
  readonly invoke?: (request: RuntimeRequest) => Effect.Effect<RuntimeResult, InferenceFailed>
}

/** A fake provider plus its observable state. */
export interface FakeProvider {
  readonly layer: Layer.Layer<RuntimeProvider, RuntimeUnavailable, never>
  readonly stats: FakeStats
}

const SUCCESS_RESULT: RuntimeResult = {
  spans: [{ start: 0, end: 4, label: 'PERSON', text: 'Jane', score: 0.9 }],
  coverage: { complete: true, processedUnits: 1, totalUnits: 1 },
}

/**
 * Build a fake provider.
 *
 * @param overrides - per-step behaviours; omitted steps succeed.
 * @returns the layer to hand to `ProviderSpec.layer` and the stats object to assert on.
 */
export function fakeProvider(overrides: FakeOverrides = {}): FakeProvider {
  const stats: FakeStats = { builds: 0, releases: 0, inspects: 0, requests: [] }

  const implementation: ProviderImplementation = {
    id: 'fake-runtime',
    formats: ['tflite'],
    inspect: Effect.suspend(() => {
      stats.inspects += 1
      return overrides.inspect?.() ?? Effect.succeed({
        readiness: 'ready' as const,
        features: ['redact'],
        missing: [],
      })
    }),
    load: () => Effect.suspend(() => overrides.load?.() ?? Effect.void),
    invoke: (request) =>
      Effect.suspend(() => {
        stats.requests.push(request)
        return overrides.invoke?.(request) ?? Effect.succeed(SUCCESS_RESULT)
      }),
    unload: Effect.void,
  }

  const layer = Layer.effect(
    RuntimeProvider,
    Effect.acquireRelease(
      Effect.sync(() => {
        stats.builds += 1
        return RuntimeProvider.of(implementation)
      }),
      () =>
        Effect.sync(() => {
          stats.releases += 1
        }),
    ),
  )

  return { layer, stats }
}

/** The result the default fake returns, for assertions. */
export const fakeResult: RuntimeResult = SUCCESS_RESULT
