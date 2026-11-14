/**
 * The declarative provider factory (Phase 2, docs/runtime/PHASE2.md).
 *
 * A code-free package names this engine in its recipe, and the host -- which declares no
 * engine dependency (AT-25) -- calls the factory with the parsed recipe and the host-verified
 * asset map. The factory owns the engine and the PROCESSORS; the recipe supplies the artifact
 * location, the limits, the tool schemas and the processor id.
 *
 * PROCESSORS IMPLEMENTED HERE (the models live in their own modules):
 * - shapes/points-v1    -> src/shapes.ts    (stroke -> 128 points -> 13 classes)
 * - moderator/crops-v1  -> src/moderator.ts (PNG -> Pillow crops -> 5 NSFW heads)
 *
 * THE SDK BOUNDARY IS PROMISE-BASED, THE ENGINE IS EFFECT-BASED. This module keeps that
 * mismatch in one place: a ManagedRuntime wraps the LiteRT session, load() forces the lazy
 * runtime into existence so a broken deployment is reported at load time, and invoke() runs
 * the selected processor, which maps the recipe's JSON contract onto serialized inference.
 *
 * TYPED FAILURES: internally every failure is InvalidInput, RuntimeUnavailable or
 * InferenceFailed. The SDK declares Promise methods, and a Schema.TaggedError carries an EMPTY
 * Error.message, so the boundary throws a readable Error whose cause is the typed value. The
 * typed error is therefore still inspectable (error.cause) while a host log is not blank.
 */

/*
 * This file imports the shapes processor whose domain names contain "shape" (the 2D geometric
 * shapes the model recognizes and the tool schema's "shape" field). The vendored anti-slop
 * no-shape rule targets structural placeholders, so it is disabled for this file only.
 */
/* oxlint-disable anti-slop/no-shape-in-symbol-names */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { Effect, ManagedRuntime } from 'effect'

import type {
  InvocationContextV1,
  JsonObject,
  ModelProviderV1,
  PreparedAssetMapV1,
  ProviderInspectionV1,
} from '@try-works/tool-mode-extension-sdk'
import {
  InferenceFailed,
  RuntimeUnavailable,
} from '@try-works/tool-mode-runtime-core'
import type { ModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'

import { EAR_PROCESSOR, earMelProcessor } from './ear.ts'
import { EMO_PROCESSOR, emoTextProcessor } from './emo.ts'
import { describeCause } from './errors.ts'
import type { LitertBoot } from './model.ts'
import { MODERATOR_PROCESSOR, moderatorCropsProcessor } from './moderator.ts'
import { describeFailure, type RecipeProcessor } from './processor.ts'
import { LitertSession, litertLayer } from './runtime.ts'
import { SHAPES_POINTS_PROCESSOR, shapesPointsProcessor } from './shapes.ts'
import { resolveLitertWasmDir } from './shim.ts'

/** The processors this engine package implements, keyed by the recipe's processor id. */
const PROCESSORS: ReadonlyMap<string, RecipeProcessor> = new Map([
  [shapesPointsProcessor.id, shapesPointsProcessor],
  [moderatorCropsProcessor.id, moderatorCropsProcessor],
  [earMelProcessor.id, earMelProcessor],
  [emoTextProcessor.id, emoTextProcessor],
])

/** The ids a recipe may name, in a stable order for refusal messages. */
const PROCESSOR_IDS = [SHAPES_POINTS_PROCESSOR, MODERATOR_PROCESSOR, EAR_PROCESSOR, EMO_PROCESSOR]

/** Test seam: a fake engine boot; production callers never pass it. */
export interface ProviderFactoryOptions {
  readonly boot?: LitertBoot
}

const PROVIDER = 'litert'

/** One live runtime, or the reason there is none. */
type ProviderState =
  | { readonly _tag: 'cold' }
  | {
      readonly _tag: 'ready'
      readonly runtime: ManagedRuntime.ManagedRuntime<LitertSession, RuntimeUnavailable>
      readonly assetDirectory: string
    }
  | { readonly _tag: 'failed'; readonly reason: string }
  | { readonly _tag: 'disposed' }

/** Wrap a typed failure for the Promise-based SDK boundary. */
function boundaryError(message: string, cause: unknown): Error {
  return new Error(message, { cause })
}

/** The first asset map that resolves the recipe's asset set wins. */
function resolveAssetSet(
  primary: Readonly<PreparedAssetMapV1>,
  fallback: Readonly<PreparedAssetMapV1>,
  assetSet: string,
): { readonly path: string; readonly digest: string } | undefined {
  return primary.get(assetSet) ?? fallback.get(assetSet)
}

/**
 * Read the recipe's model artifact from the verified asset set.
 *
 * The verified handle is the GROUP directory (the host projects a group id to its directory
 * and each asset id to its file), so the recipe's bare fileName is joined to it. The parser
 * already proved the name is bare; the containment check is the belt to that braces.
 */
interface ResolvedArtifact {
  readonly bytes: Uint8Array
  /** The verified asset-set directory; sibling files the processor owns live here. */
  readonly directory: string
}

async function readModelArtifact(
  recipe: ModelRuntimeRecipe,
  primary: Readonly<PreparedAssetMapV1>,
  fallback: Readonly<PreparedAssetMapV1>,
): Promise<ResolvedArtifact> {
  const assetSet = recipe.model.assetSet
  const entry = resolveAssetSet(primary, fallback, assetSet)
  if (entry === undefined) {
    throw new RuntimeUnavailable({
      provider: PROVIDER,
      reason: 'the "' + assetSet + '" asset set is not prepared; load() needs the host-verified asset map',
    })
  }
  const directory = path.resolve(entry.path)
  const file = path.resolve(directory, recipe.model.fileName)
  if (file !== directory && !file.startsWith(directory + path.sep)) {
    throw new RuntimeUnavailable({
      provider: PROVIDER,
      reason: 'the recipe file name "' + recipe.model.fileName + '" escapes the "' + assetSet + '" asset directory',
    })
  }
  try {
    return { bytes: new Uint8Array(await readFile(file)), directory }
  } catch (cause) {
    throw new RuntimeUnavailable({
      provider: PROVIDER,
      reason: 'the "' + assetSet + '" model artifact "' + recipe.model.fileName + '" cannot be read: ' + describeCause(cause),
    })
  }
}

/**
 * Build the SDK provider for one validated, code-free model-runtime recipe.
 *
 * Creation is lightweight (EXT-19): it validates what can be validated statically and reads
 * nothing. Assets are resolved at load() time, preferring the map the SDK hands to load()
 * over the map captured at creation, because the host may build the factory before a
 * preparation completes.
 *
 * @param recipe - the parsed, frozen model-runtime recipe.
 * @param assets - the host-verified asset map captured at creation.
 * @param options - test seams (a fake engine boot); production callers omit it.
 * @returns the SDK's Promise-based provider.
 */
export function createProviderFromRecipe(
  recipe: ModelRuntimeRecipe,
  assets: Readonly<PreparedAssetMapV1>,
  options: ProviderFactoryOptions = {},
): ModelProviderV1 {
  const label = recipe.tool.name
  if (recipe.model.format !== 'tflite') {
    throw new Error(
      'the litert provider factory executes only tflite artifacts; the recipe "' + label + '" declares "' + recipe.model.format + '"',
    )
  }
  const processor = PROCESSORS.get(recipe.processor.id)
  if (processor === undefined) {
    throw new Error(
      'the litert provider factory does not implement processor "' + recipe.processor.id + '"; this build implements ' + PROCESSOR_IDS.join(', '),
    )
  }

  let state: ProviderState = { _tag: 'cold' }

  const inspect = async (signal: AbortSignal): Promise<ProviderInspectionV1> => {
    if (signal.aborted) throw new Error('the "' + label + '" inspection was aborted before it started')
    switch (state._tag) {
      case 'disposed':
        return { readiness: 'unavailable', features: [], missing: [], reason: 'the provider has been disposed' }
      case 'failed':
        return { readiness: 'failed', features: [], missing: [], reason: state.reason }
      case 'cold':
        return {
          readiness: 'prepared-cold',
          features: processor.features,
          missing: [],
          reason: label + ' has not been loaded yet; load() must run before the first call',
        }
      case 'ready':
        return { readiness: 'ready', features: processor.features, missing: [] }
    }
  }

  const load = async (request: {
    readonly assets: Readonly<PreparedAssetMapV1>
    readonly signal: AbortSignal
  }): Promise<void> => {
    if (request.signal.aborted) throw new Error('the "' + label + '" load was aborted before it started')
    if (state._tag === 'disposed') throw new Error('the provider has been disposed')
    if (state._tag === 'ready') return
    try {
      const artifact = await readModelArtifact(recipe, request.assets, assets)
      const wasmDir = resolveLitertWasmDir()
      const layer =
        options.boot === undefined
          ? litertLayer({ wasmDir, modelBytes: artifact.bytes })
          : litertLayer({ wasmDir, modelBytes: artifact.bytes, boot: options.boot })
      const candidate = ManagedRuntime.make(layer)
      try {
        // The runtime is lazy; force the layer to build so a broken deployment fails HERE.
        await candidate.runPromise(Effect.void, { signal: request.signal })
      } catch (cause) {
        await candidate.dispose().catch(() => undefined)
        throw cause
      }
      state = { _tag: 'ready', runtime: candidate, assetDirectory: artifact.directory }
    } catch (cause) {
      const reason = describeFailure(cause)
      state = { _tag: 'failed', reason }
      throw boundaryError('the "' + label + '" model failed to load: ' + reason, cause)
    }
  }

  const invoke = async (request: {
    readonly implementationId: string
    readonly input: Readonly<JsonObject>
    readonly context: InvocationContextV1
  }): Promise<JsonObject> => {
    if (request.context.signal.aborted) throw new Error('the "' + label + '" invocation was aborted before it started')
    switch (state._tag) {
      case 'disposed':
        throw new Error('the provider has been disposed')
      case 'failed':
        throw new Error('the "' + label + '" runtime is not loaded: ' + state.reason)
      case 'cold':
        throw new Error('the "' + label + '" runtime is not loaded: load() must be called before invoke()')
      case 'ready': {
        const runtime = state.runtime
        const controller = new AbortController()
        const relayAbort = () => controller.abort(request.context.signal.reason)
        request.context.signal.addEventListener('abort', relayAbort, { once: true })
        const timer = setTimeout(() => {
          controller.abort(new Error('the "' + label + '" invocation timed out after ' + String(recipe.limits.timeoutMs) + 'ms'))
        }, recipe.limits.timeoutMs)
        try {
          const program = processor.invoke({
            input: request.input,
            context: request.context,
            limits: recipe.limits,
            assetDirectory: state.assetDirectory,
          })
          return await runtime.runPromise(program, { signal: controller.signal })
        } catch (cause) {
          if (request.context.signal.aborted) {
            throw boundaryError('the "' + label + '" invocation was aborted', cause)
          }
          if (controller.signal.aborted) {
            const message = 'the "' + label + '" inference timed out after ' + String(recipe.limits.timeoutMs) + 'ms'
            throw boundaryError(
              message,
              new InferenceFailed({ provider: PROVIDER, phase: 'run', message }),
            )
          }
          throw boundaryError('the "' + label + '" invocation failed: ' + describeFailure(cause), cause)
        } finally {
          clearTimeout(timer)
          request.context.signal.removeEventListener('abort', relayAbort)
        }
      }
    }
  }

  const unload = async (_signal: AbortSignal): Promise<void> => {
    if (state._tag !== 'ready') return
    const runtime = state.runtime
    state = { _tag: 'cold' }
    await runtime.dispose()
  }

  const dispose = async (): Promise<void> => {
    if (state._tag === 'disposed') return
    const runtime = state._tag === 'ready' ? state.runtime : undefined
    state = { _tag: 'disposed' }
    if (runtime !== undefined) await runtime.dispose()
  }

  return { inspect, load, invoke, unload, dispose }
}
