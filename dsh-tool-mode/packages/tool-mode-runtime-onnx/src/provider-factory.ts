/**
 * The declarative provider factory for ONNX (Phase 3).
 *
 * A code-free package names this engine in its recipe, and the host — which declares no
 * engine dependency (AT-25) — calls the factory with the parsed recipe and the host-verified
 * asset map. The factory owns the engine and the processor; the recipe supplies the
 * artifact location, the limits and the tool schemas.
 *
 * ONE LIFECYCLE, TWO PIPELINES. The state machine below is shared by every processor:
 * resolve the artifact, build one ManagedRuntime, force it so a broken deployment fails at
 * load time, bind the graph's tensor names, then run one invoke per call under the
 * recipe's timeout. Processors contribute only their descriptor, sidecar, graph binding and
 * pipeline (`uhm/waveform-v1`, `clear/stft-v1`).
 *
 * THE SDK BOUNDARY IS PROMISE-BASED, THE ENGINE IS EFFECT-BASED. This module keeps that
 * mismatch in one place.
 *
 * TYPED FAILURES: internally every failure is InvalidInput, RuntimeUnavailable or
 * InferenceFailed. The SDK declares Promise methods, and a Schema.TaggedError carries an
 * EMPTY Error.message, so the boundary throws a readable Error whose cause is the typed
 * value. The typed error is still inspectable (error.cause) while a host log is not blank.
 *
 * @module provider-factory
 */

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { Effect, ManagedRuntime } from 'effect'

import type {
  InvocationContextV1,
  JsonObject,
  ModelProviderV1,
  PreparedAssetMapV1,
  ProviderInspectionV1,
} from '@try-works/tool-mode-extension-sdk'
import type { ModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'

import { InferenceFailed, InvalidInput, RuntimeUnavailable, describeCause } from './errors.ts'
import { CLEAR_STFT_PROCESSOR, clearProcessor } from './clear-processor.ts'
import { parseAudioPath, prepareSamples, readAudioBytes, resolveAudioPath, type ProcessorDefinition } from './processor.ts'
import { OnnxSession, onnxLayer, type OnnxSessionApi, type OnnxSessionLoader } from './runtime.ts'
import { UHM_WAVEFORM_PROCESSOR, uhmProcessor } from './uhm-processor.ts'

const PROVIDER = 'onnx'

/** Test seams; production callers omit the options object. */
export interface ProviderFactoryOptions {
  /** An injected engine loader, so the unit tests never load the native binding. */
  readonly loader?: OnnxSessionLoader
}

/** One live runtime, or the reason there is none. */
type ProviderState<Sidecar, Binding> =
  | { readonly _tag: 'cold' }
  | {
      readonly _tag: 'ready'
      readonly runtime: ManagedRuntime.ManagedRuntime<OnnxSession, RuntimeUnavailable>
      readonly sidecar: Sidecar
      readonly binding: Binding
    }
  | { readonly _tag: 'failed'; readonly reason: string }
  | { readonly _tag: 'disposed' }

/** Render a typed failure, or any thrown value, as one readable sentence. */
function describeFailure(cause: unknown): string {
  if (cause instanceof InvalidInput) return cause.field + ': ' + cause.message
  if (cause instanceof InferenceFailed) return cause.phase + ': ' + cause.message
  if (cause instanceof RuntimeUnavailable) return cause.reason
  if (cause instanceof Error) return cause.message.length > 0 ? cause.message : cause.name
  return describeCause(cause)
}

/** Wrap a typed failure for the Promise-based SDK boundary. */
function boundaryError(message: string, cause: unknown): Error {
  return new Error(message, { cause })
}

/** The model artifact location resolved from a host-verified asset handle. */
interface ResolvedArtifact {
  readonly modelBytes: Uint8Array
  readonly directory: string
}

/**
 * Resolve the model artifact from the prepared asset map.
 *
 * The host exposes TWO truthful projections: the group id resolves to the group DIRECTORY
 * and each asset id resolves to its FILE. Both are accepted, and a file handle whose name
 * does not match the recipe is refused rather than read as the artifact.
 */
async function readArtifact(
  recipe: ModelRuntimeRecipe,
  primary: Readonly<PreparedAssetMapV1>,
  fallback: Readonly<PreparedAssetMapV1>,
): Promise<ResolvedArtifact> {
  const assetSet = recipe.model.assetSet
  const handle = primary.get(assetSet) ?? fallback.get(assetSet)
  if (handle === undefined) {
    throw new RuntimeUnavailable({
      provider: PROVIDER,
      reason: 'the "' + assetSet + '" asset set is not prepared; load() needs the host-verified asset map',
    })
  }

  const resolved = path.resolve(handle.path)
  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(resolved)
  } catch (cause) {
    throw new RuntimeUnavailable({
      provider: PROVIDER,
      reason: 'the "' + assetSet + '" asset handle cannot be inspected: ' + describeCause(cause),
    })
  }

  let modelPath: string
  let directory: string
  if (stats.isDirectory()) {
    modelPath = path.resolve(resolved, recipe.model.fileName)
    directory = resolved
  } else {
    if (path.basename(resolved) !== recipe.model.fileName) {
      throw new RuntimeUnavailable({
        provider: PROVIDER,
        reason:
          'the "' + assetSet + '" asset handle names "' + path.basename(resolved) + '" but the recipe names "'
          + recipe.model.fileName + '"',
      })
    }
    modelPath = resolved
    directory = path.dirname(resolved)
  }
  if (modelPath !== directory && !modelPath.startsWith(directory + path.sep)) {
    throw new RuntimeUnavailable({
      provider: PROVIDER,
      reason: 'the recipe file name "' + recipe.model.fileName + '" escapes the "' + assetSet + '" asset directory',
    })
  }

  try {
    return { modelBytes: new Uint8Array(await readFile(modelPath)), directory }
  } catch (cause) {
    throw new RuntimeUnavailable({
      provider: PROVIDER,
      reason: 'the "' + assetSet + '" model artifact "' + recipe.model.fileName + '" cannot be read: ' + describeCause(cause),
    })
  }
}

/**
 * Build the shared provider around one processor definition.
 *
 * @param recipe - the parsed, frozen recipe
 * @param assets - the asset map captured at creation
 * @param options - test seams
 * @param processor - the pipeline this build implements
 * @returns the SDK provider
 */
function createProvider<Sidecar, Binding>(
  recipe: ModelRuntimeRecipe,
  assets: Readonly<PreparedAssetMapV1>,
  options: ProviderFactoryOptions,
  processor: ProcessorDefinition<Sidecar, Binding>,
): ModelProviderV1 {
  const label = recipe.tool.name
  let state: ProviderState<Sidecar, Binding> = { _tag: 'cold' }

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
          features: [processor.id],
          missing: [],
          reason: label + ' has not been loaded yet; load() must run before the first call',
        }
      case 'ready':
        return { readiness: 'ready', features: [processor.id], missing: [] }
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
      const artifact = await readArtifact(recipe, request.assets, assets)
      const sidecar = await processor.loadSidecar(artifact.directory)
      const layerOptions = { modelBytes: artifact.modelBytes, accelerators: recipe.provider.accelerators }
      const layer = options.loader === undefined
        ? onnxLayer(layerOptions)
        : onnxLayer({ ...layerOptions, loader: options.loader })
      const candidate = ManagedRuntime.make(layer)
      try {
        // The runtime is lazy; force the layer to build AND read the graph names, so a
        // broken deployment fails HERE and not at the first caller's expense.
        const names = await candidate.runPromise(
          Effect.gen(function* () {
            const session = yield* OnnxSession
            return { inputs: session.inputNames, outputs: session.outputNames }
          }),
          { signal: request.signal },
        )
        const bound = processor.bindGraph(names)
        if (!bound.ok) throw new RuntimeUnavailable({ provider: PROVIDER, reason: bound.reason })
        state = { _tag: 'ready', runtime: candidate, sidecar, binding: bound.value }
      } catch (cause) {
        await candidate.dispose().catch(() => undefined)
        throw cause
      }
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
    if (state._tag === 'disposed') throw new Error('the provider has been disposed')
    if (state._tag === 'failed') throw new Error('the "' + label + '" runtime is not loaded: ' + state.reason)
    if (state._tag === 'cold') throw new Error('the "' + label + '" runtime is not loaded: load() must be called before invoke()')

    const runtime = state.runtime
    const sidecar = state.sidecar
    const binding = state.binding
    const controller = new AbortController()
    const relayAbort = () => controller.abort(request.context.signal.reason)
    request.context.signal.addEventListener('abort', relayAbort, { once: true })
    const timer = setTimeout(() => {
      controller.abort(new Error('the "' + label + '" invocation timed out after ' + String(recipe.limits.timeoutMs) + 'ms'))
    }, recipe.limits.timeoutMs)
    try {
      const program = Effect.gen(function* () {
        const audioPath = yield* parseAudioPath(request.input, recipe)
        const resolved = yield* resolveAudioPath(request.context, audioPath)
        const bytes = yield* readAudioBytes(resolved)
        const audio = yield* prepareSamples(bytes, processor.sampleRate)
        const session: OnnxSessionApi = yield* OnnxSession
        return yield* processor.invoke({
          engine: session,
          sidecar,
          binding,
          recipe,
          input: request.input,
          context: request.context,
          audio,
        })
      })
      return await runtime.runPromise(program, { signal: controller.signal })
    } catch (cause) {
      if (request.context.signal.aborted) {
        throw boundaryError('the "' + label + '" invocation was aborted', cause)
      }
      if (controller.signal.aborted) {
        const message = 'the "' + label + '" inference timed out after ' + String(recipe.limits.timeoutMs) + 'ms'
        throw boundaryError(message, new InferenceFailed({ provider: PROVIDER, phase: 'run', message }))
      }
      throw boundaryError('the "' + label + '" invocation failed: ' + describeFailure(cause), cause)
    } finally {
      clearTimeout(timer)
      request.context.signal.removeEventListener('abort', relayAbort)
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
 * @param options - test seams (a fake engine loader); production callers omit it.
 * @returns the SDK's Promise-based provider.
 */
export function createProviderFromRecipe(
  recipe: ModelRuntimeRecipe,
  assets: Readonly<PreparedAssetMapV1>,
  options: ProviderFactoryOptions = {},
): ModelProviderV1 {
  const label = recipe.tool.name
  if (recipe.model.format !== 'onnx') {
    throw new Error(
      'the onnx provider factory executes only onnx artifacts; the recipe "' + label + '" declares "' + recipe.model.format + '"',
    )
  }
  switch (recipe.processor.id) {
    case UHM_WAVEFORM_PROCESSOR:
      return createProvider(recipe, assets, options, uhmProcessor())
    case CLEAR_STFT_PROCESSOR:
      return createProvider(recipe, assets, options, clearProcessor())
    default:
      throw new Error(
        'the onnx provider factory does not implement processor "' + recipe.processor.id + '"; this build implements "'
        + UHM_WAVEFORM_PROCESSOR + '" and "' + CLEAR_STFT_PROCESSOR + '"',
      )
  }
}
