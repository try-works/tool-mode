/**
 * The provider shape every runtime package implements.
 *
 * A provider is an Effect service, not a class hierarchy: the host yields
 * {@link RuntimeProvider}, reads {@link RuntimeProviderShape.inspect}, calls
 * `load` once with the host-verified assets, calls `invoke` per request, and
 * releases the engine through the layer's scope. Real providers acquire the
 * engine with `Effect.acquireRelease` inside `Layer.effect` — Effect 4 has no
 * `Layer.scoped` — so an unloaded provider cannot leak a native handle.
 *
 * @module provider
 */

/*
 * `RuntimeProviderShape` is the name fixed by docs/runtime/PLAN.md for the
 * service value every runtime package implements; renaming it would break the
 * shared contract, so the naming rule is disabled for this one declaration.
 */
/* oxlint-disable anti-slop/no-shape-in-symbol-names */

import { Context, Effect } from 'effect'

import type { ModelFormat, RuntimeRequest, RuntimeResult } from './contracts.ts'
import type { InferenceFailed, InvalidInput, RuntimeUnavailable } from './errors.ts'
import type { Inspection } from './readiness.ts'

/** The host-verified asset set a provider loads from. */
export interface PreparedAssets {
  /** Resolve one staged asset, or `undefined` when it was not prepared. */
  readonly get: (assetId: string) => { readonly path: string; readonly digest: string } | undefined
  /** Every asset id in the set, in a stable order. */
  readonly assetIds: readonly string[]
}

/** What a runtime provider can do and how the host drives it. */
export interface RuntimeProviderShape {
  /** Stable provider id, e.g. `litert`. */
  readonly id: string
  /** The artifact formats this provider executes. */
  readonly formats: readonly ModelFormat[]
  /** A fresh pre-load report; evaluating it again re-inspects. */
  readonly inspect: Effect.Effect<Inspection>
  /** Acquire the engine and load the staged assets. */
  readonly load: (assets: PreparedAssets) => Effect.Effect<void, RuntimeUnavailable>
  /** Run one validated request. */
  readonly invoke: (
    request: RuntimeRequest,
  ) => Effect.Effect<RuntimeResult, InvalidInput | InferenceFailed>
  /** Release the engine; the layer's scope does the same on the way out. */
  readonly unload: Effect.Effect<void>
}

/** The runtime provider service. */
export class RuntimeProvider extends Context.Service<RuntimeProvider, RuntimeProviderShape>()(
  'tool-mode-runtime/Provider',
) {}
