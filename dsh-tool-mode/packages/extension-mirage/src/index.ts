/**
 * Cactus Mirage first-party extension.
 *
 * Four bounded tools over one pinned 2-bit vision model. The tools are ordinary
 * model capabilities, not a chat endpoint: each call asks the engine for a named
 * section or form, and the package normalizes the JSON without inventing fields.
 */

import type {
  ExtensionContextV1,
  ExtensionInstanceV1,
  JsonObject,
  ModelProviderV1,
  PreparedAssetMapV1,
  ProviderInspectionV1,
} from '@try-works/tool-mode-extension-sdk'
import { defineExtension } from '@try-works/tool-mode-extension-sdk'

import { decodeImage, loadMirageEngine, type MirageAssets, type MirageEngine } from './engine.ts'
import {
  describeOptions,
  detectOptions,
  extractOptions,
  invalid,
  MIRAGE_IMPLEMENTATION_IDS,
  MIRAGE_LIMITS,
  MIRAGE_MODEL_ID,
  normalizeDescribe,
  normalizeDetect,
  normalizeExtract,
  normalizeOcr,
  ocrOptions,
  readFields,
  readImagePath,
  readLanguage,
} from './pure.ts'

const FEATURES = ['image-description', 'object-detection', 'ocr', 'segmentation', 'form-extraction', 'local-inference']

interface MirageConfiguration {
  readonly loaderPath?: string
  readonly wasmPath?: string
  readonly weightsPath?: string
  readonly threads?: number
}

function readPath(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) throw new Error(`configuration ${name} must be a non-empty path`)
  return value
}

function readConfiguration(raw: Readonly<JsonObject>): MirageConfiguration {
  const threads = raw.threads
  if (threads !== undefined && (typeof threads !== 'number' || !Number.isInteger(threads) || threads < 1 || threads > 64)) {
    throw new Error('configuration threads must be an integer in [1, 64]')
  }
  return {
    ...readPath(raw.loaderPath, 'loaderPath') === undefined ? {} : { loaderPath: raw.loaderPath as string },
    ...readPath(raw.wasmPath, 'wasmPath') === undefined ? {} : { wasmPath: raw.wasmPath as string },
    ...readPath(raw.weightsPath, 'weightsPath') === undefined ? {} : { weightsPath: raw.weightsPath as string },
    ...threads === undefined ? {} : { threads: threads as number },
  }
}

function configuredAssets(configuration: MirageConfiguration): MirageAssets | undefined {
  return configuration.loaderPath !== undefined && configuration.wasmPath !== undefined && configuration.weightsPath !== undefined
    ? { loaderPath: configuration.loaderPath, wasmPath: configuration.wasmPath, weightsPath: configuration.weightsPath }
    : undefined
}

function preparedAssets(assets: Readonly<PreparedAssetMapV1>): MirageAssets | undefined {
  const loader = assets.get('mirage-engine-loader')
  const wasm = assets.get('mirage-engine-wasm')
  const weights = assets.get('mirage-weights')
  return loader === undefined || wasm === undefined || weights === undefined
    ? undefined
    : { loaderPath: loader.path, wasmPath: wasm.path, weightsPath: weights.path }
}

function implementationContract(id: string): 'describe' | 'detect' | 'ocr' | 'extract' | undefined {
  switch (id) {
    case MIRAGE_IMPLEMENTATION_IDS.describe: return 'describe'
    case MIRAGE_IMPLEMENTATION_IDS.detect: return 'detect'
    case MIRAGE_IMPLEMENTATION_IDS.ocr: return 'ocr'
    case MIRAGE_IMPLEMENTATION_IDS.extract: return 'extract'
    default: return undefined
  }
}

function throwIfAborted(signal: AbortSignal, label: string): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error(`${label} was aborted`)
}

function createMirageProvider(context: ExtensionContextV1): ModelProviderV1 {
  const configuration = readConfiguration(context.configuration)
  let prepared: MirageAssets | undefined
  let enginePromise: Promise<MirageEngine> | undefined
  let disposed = false

  const assetsNow = (): MirageAssets | undefined => prepared ?? configuredAssets(configuration)

  const engine = async (): Promise<MirageEngine> => {
    const assets = assetsNow()
    if (assets === undefined) {
      throw new Error(
        'MIRAGE_NOT_PREPARED: the pinned Cactus loader, WASM engine and mirage.cact were not prepared. '
        + 'Prepare the mirage-wasm asset group, or set the loaderPath/wasmPath/weightsPath configuration hints.',
      )
    }
    enginePromise ??= loadMirageEngine(assets, configuration.threads)
    return enginePromise
  }

  return {
    async inspect(signal): Promise<ProviderInspectionV1> {
      throwIfAborted(signal, 'inspect')
      const assets = assetsNow()
      if (assets === undefined) {
        return {
          readiness: 'needs-preparation',
          features: [],
          missing: [
            { name: 'mirage-engine-loader', reason: 'not prepared' },
            { name: 'mirage-engine-wasm', reason: 'not prepared' },
            { name: 'mirage-weights', reason: 'not prepared' },
          ],
          reason: 'needs preparation: the pinned Cactus WASM loader, engine and Mirage archive were not found',
        }
      }
      return {
        readiness: enginePromise === undefined ? 'prepared-cold' : 'ready',
        features: [...FEATURES],
        missing: [],
        runtimeVersion: `cactus 4.1.0 WASM; loader ${assets.loaderPath}, weights ${assets.weightsPath}`,
      }
    },

    async load(request: { readonly assets: Readonly<PreparedAssetMapV1>; readonly signal: AbortSignal }) {
      throwIfAborted(request.signal, 'load')
      prepared = preparedAssets(request.assets)
      enginePromise = undefined
      await engine()
      context.logger.log('info', 'mirage engine loaded')
    },

    async invoke({ implementationId, input, context: invocation }): Promise<JsonObject> {
      throwIfAborted(invocation.signal, 'invoke')
      if (disposed) throw new Error('MIRAGE_DISPOSED: the provider has been disposed')
      const contract = implementationContract(implementationId)
      if (contract === undefined) {
        throw new Error(`MIRAGE_IMPLEMENTATION_UNKNOWN: this extension does not implement ${JSON.stringify(implementationId)}`)
      }
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        invalid('input must be an object')
      }
      const args = input as Record<string, unknown>
      const path = invocation.resolvePath(readImagePath(args.image))
      const image = await decodeImage(path)
      throwIfAborted(invocation.signal, 'invoke')
      const loaded = await engine()
      const language = readLanguage(args.language) ?? 'en'
      if (contract === 'describe') {
        const selected = describeOptions(args)
        const parsed = await loaded.describe(image.rgb, image.width, image.height, selected.options, selected.language)
        throwIfAborted(invocation.signal, 'invoke')
        return normalizeDescribe(parsed, selected.language ?? 'en') as unknown as JsonObject
      }
      if (contract === 'detect') {
        const maskFormat = (args.maskFormat ?? 'none') as 'none' | 'bitmap' | 'polygons'
        const parsed = await loaded.describe(image.rgb, image.width, image.height, detectOptions(args))
        throwIfAborted(invocation.signal, 'invoke')
        return normalizeDetect(parsed, maskFormat) as JsonObject
      }
      if (contract === 'ocr') {
        const parsed = await loaded.describe(image.rgb, image.width, image.height, ocrOptions(args))
        throwIfAborted(invocation.signal, 'invoke')
        return normalizeOcr(parsed) as unknown as JsonObject
      }
      const form = readFields(args.fields)
      const parsed = await loaded.describe(image.rgb, image.width, image.height, extractOptions(form.form), language)
      throwIfAborted(invocation.signal, 'invoke')
      return normalizeExtract(parsed, form.fields.map(field => field.name), language) as JsonObject
    },

    async unload(signal) {
      throwIfAborted(signal, 'unload')
      prepared = undefined
      enginePromise?.then(engine => engine.dispose(), () => undefined)
      enginePromise = undefined
    },

    async dispose() {
      disposed = true
      prepared = undefined
      const current = enginePromise
      enginePromise = undefined
      if (current !== undefined) {
        try {
          (await current).dispose()
        } catch {
          // A failed load owns no resident engine.
        }
      }
      context.logger.log('debug', 'mirage provider disposed')
    },
  }
}

export default defineExtension({
  apiVersion: 1,
  async create(context: ExtensionContextV1): Promise<ExtensionInstanceV1> {
    return {
      async createProvider({ modelId }) {
        if (modelId !== MIRAGE_MODEL_ID) throw new Error(`this extension implements "${MIRAGE_MODEL_ID}", not "${modelId}"`)
        return createMirageProvider(context)
      },
      async dispose(reason) {
        context.logger.log('debug', `mirage extension disposed: ${reason}`)
      },
    }
  },
})

export { MIRAGE_LIMITS, MIRAGE_MODEL_ID }
export type { MirageEngine } from './engine.ts'
export type { MirageField, MirageLanguage, MirageSection } from './pure.ts'
