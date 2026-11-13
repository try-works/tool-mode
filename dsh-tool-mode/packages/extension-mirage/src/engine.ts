/**
 * The pinned Cactus 4.1.0 WASM engine and the Sharp RGB decode.
 *
 * The engine is downloaded code executed in-process as WebAssembly. It is not the
 * Cactus CLI and not a native addon. Calls are serialized because the C ABI keeps
 * one loaded model in module-global state; there is no thread-safe reentrancy
 * contract in the published header.
 */

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'

import { MIRAGE_LIMITS } from './pure.ts'

/** Where the three executable/data artifacts are. */
export interface MirageAssets {
  readonly loaderPath: string
  readonly wasmPath: string
  readonly weightsPath: string
}

/** Expected identity of each downloaded artifact. */
export const MIRAGE_ARTIFACT_SHA256: Readonly<Record<keyof MirageAssets, string>> = {
  loaderPath: '707341e44776ab0eb8dfc8f6a579ed5ac41e2ffc6419a18012f61619a6dfc70c',
  wasmPath: '6fb6cb41145cd51fd8af97644cd684fbdd434d4d3ce261881df58cbaef5b67f7',
  weightsPath: '4249a0f7515272ff76b9414bec17d7e7daf84b15b66c7fb4f17fce1e66f9f237',
}

/** The shape of the Emscripten module this extension uses. */
interface CactusModule {
  readonly HEAPU8: Uint8Array
  _malloc(size: number): number
  _free(pointer: number): void
  UTF8ToString(pointer: number): string
  _cactus_load(pointer: number, length: bigint): number
  _cactus_models(): number
  _cactus_last_error(): number
  _cactus_set_threads(threads: number): void
  _cactus_describe(rgb: number, width: number, height: number, options: number, language: number, keywords: number, out: number, capacity: number): number
}

type CreateCactus = (options: { readonly wasmBinary: Uint8Array }) => Promise<CactusModule>

/** Decode one image to packed sRGB RGB bytes. */
export async function decodeImage(path: string): Promise<{ width: number; height: number; rgb: Uint8Array }> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error('MIRAGE_IMAGE_INVALID: the image path is not a regular file')
  if (info.size > MIRAGE_LIMITS.maxImageBytes) {
    throw new Error(`MIRAGE_IMAGE_INVALID: the image is ${info.size} bytes, over the ${MIRAGE_LIMITS.maxImageBytes}-byte limit`)
  }
  const sharpModule = await import('sharp')
  const sharp = sharpModule.default
  const decoded = await sharp(path, { limitInputPixels: MIRAGE_LIMITS.maxPixels, failOn: 'error' })
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (decoded.info.width <= 0 || decoded.info.height <= 0) throw new Error('MIRAGE_IMAGE_INVALID: the image has no pixels')
  if (decoded.info.channels !== 3) throw new Error(`MIRAGE_IMAGE_INVALID: decoded ${decoded.info.channels} channels, expected RGB`)
  if (decoded.data.length !== decoded.info.width * decoded.info.height * 3) {
    throw new Error('MIRAGE_IMAGE_INVALID: decoded byte length does not match width × height × 3')
  }
  return { width: decoded.info.width, height: decoded.info.height, rgb: Uint8Array.from(decoded.data) }
}

/** Verify one file's exact size and digest before it is executed. */
async function verifyFile(path: string, expectedSha256: string, label: string): Promise<void> {
  const bytes = await readFile(path)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== expectedSha256) {
    throw new Error(`MIRAGE_ASSET_MISMATCH: ${label} has sha256 ${digest}, expected ${expectedSha256}`)
  }
}

/** A loaded Mirage engine. */
export interface MirageEngine {
  describe(rgb: Uint8Array, width: number, height: number, options: Readonly<Record<string, unknown>>, language?: string): Promise<Record<string, unknown>>
  dispose(): void
}

/**
 * Load and verify the pinned artifacts, then initialize the model.
 * @param assets - local paths the host prepared or the operator configured.
 * @param threads - optional worker threads.
 * @returns a loaded engine.
 */
export async function loadMirageEngine(assets: MirageAssets, threads?: number): Promise<MirageEngine> {
  await verifyFile(assets.loaderPath, MIRAGE_ARTIFACT_SHA256.loaderPath, 'cactus.js')
  await verifyFile(assets.wasmPath, MIRAGE_ARTIFACT_SHA256.wasmPath, 'cactus.wasm')
  await verifyFile(assets.weightsPath, MIRAGE_ARTIFACT_SHA256.weightsPath, 'mirage.cact')

  const require = createRequire(import.meta.url)
  // The published loader is a CommonJS Emscripten module. Requiring the verified
  // absolute path avoids an ESM import of a .js file in a "type":"module" package.
  const create = require(assets.loaderPath) as CreateCactus
  const module = await create({ wasmBinary: Uint8Array.from(await readFile(assets.wasmPath)) })
  if (typeof threads === 'number' && Number.isInteger(threads) && threads > 0) module._cactus_set_threads(threads)
  const weights = await readFile(assets.weightsPath)
  const pointer = module._malloc(weights.byteLength)
  module.HEAPU8.set(weights, pointer)
  const loaded = module._cactus_load(pointer, BigInt(weights.byteLength))
  module._free(pointer)
  if (loaded < 0) throw new Error(`MIRAGE_ENGINE_FAILED: ${module.UTF8ToString(module._cactus_last_error())}`)
  if ((module._cactus_models() & 4) === 0) throw new Error('MIRAGE_ENGINE_FAILED: the archive is not a vision model')
  let disposed = false
  let queue: Promise<unknown> = Promise.resolve()

  const describe = async (
    rgb: Uint8Array,
    width: number,
    height: number,
    options: Readonly<Record<string, unknown>>,
    language?: string,
  ): Promise<Record<string, unknown>> => {
    if (disposed) throw new Error('MIRAGE_ENGINE_DISPOSED: the engine has been disposed')
    if (rgb.byteLength !== width * height * 3) throw new Error('MIRAGE_IMAGE_INVALID: RGB length does not match width × height × 3')
    const run = async (): Promise<Record<string, unknown>> => {
      const rgbPointer = module._malloc(rgb.byteLength)
      const optionsBytes = Buffer.from(JSON.stringify(options), 'utf8')
      const optionsPointer = module._malloc(optionsBytes.byteLength + 1)
      const languagePointer = language === undefined ? 0 : (() => {
        const bytes = Buffer.from(language, 'utf8')
        const pointer = module._malloc(bytes.byteLength + 1)
        module.HEAPU8.set(bytes, pointer)
        module.HEAPU8[pointer + bytes.byteLength] = 0
        return pointer
      })()
      const out = module._malloc(MIRAGE_LIMITS.maxOutputBytes)
      try {
        module.HEAPU8.set(rgb, rgbPointer)
        module.HEAPU8.set(optionsBytes, optionsPointer)
        module.HEAPU8[optionsPointer + optionsBytes.byteLength] = 0
        const code = module._cactus_describe(rgbPointer, width, height, optionsPointer, languagePointer, 0, out, MIRAGE_LIMITS.maxOutputBytes)
        if (code < 0) throw new Error(`MIRAGE_ENGINE_FAILED: ${module.UTF8ToString(module._cactus_last_error())}`)
        const text = module.UTF8ToString(out)
        const parsed: unknown = JSON.parse(text)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('MIRAGE_ENGINE_OUTPUT: the engine returned no JSON object')
        }
        return parsed as Record<string, unknown>
      } finally {
        module._free(rgbPointer)
        module._free(optionsPointer)
        if (languagePointer !== 0) module._free(languagePointer)
        module._free(out)
      }
    }
    const result = queue.then(run, run)
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    describe,
    dispose() {
      disposed = true
    },
  }
}
