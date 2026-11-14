/**
 * The injectable LiteRT boot boundary and the real node implementation.
 *
 * The Effect service in runtime.ts depends on `LitertBoot`, not on `@litertjs/core`.
 * Unit tests inject a fake compiled model, so they prove the lifecycle, the Tensor
 * mapping and the serialization without loading Wasm. `createNodeLitertBoot` is the real
 * path: it installs the socket-free shim (shim.ts), loads the Wasm module exactly once per
 * process, compiles one model, and maps feeds to Tensors.
 */

import path from 'node:path'

import { RuntimeUnavailable, describeCause } from './errors.ts'
import {
  LITERT_WASM_PREFIX,
  installLitertFetchShim,
  resolveLitertWasmDir,
  type LitertShim,
} from './shim.ts'

const PROVIDER = 'litert'

/** One named model input: its typed data and its dimensions. */
export interface LitertFeed {
  readonly data: Float32Array | Int32Array
  readonly dims: readonly number[]
}

/** A model output this runtime can hand to processors. */
export type LitertOutput = Float32Array | Int32Array

/** A compiled model, independent of the `@litertjs/core` class shapes. */
export interface CompiledLitertModel {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  readonly run: (feeds: Readonly<Record<string, LitertFeed>>) => Promise<Readonly<Record<string, LitertOutput>>>
  readonly close: () => void
}

/** The injectable boot boundary: load and compile one model. */
export interface LitertBoot {
  readonly load: (options: LitertLoadOptions) => Promise<CompiledLitertModel>
}

/** Options for one boot. */
export interface LitertLoadOptions {
  readonly modelBytes: Uint8Array
  readonly threads?: number
}

/** Compile options passed to `loadAndCompile`; cpu/Wasm only, by contract. */
export interface LiteRtCompileOptions {
  readonly accelerator?: 'wasm' | 'webgpu' | 'webnn'
  readonly cpuOptions?: { readonly numThreads?: number }
}

/** The subset of a `@litertjs/core` Tensor this runtime uses. */
export interface LiteRtTensorLike {
  toTypedArray: () => Float32Array | Int32Array
  delete: () => void
}

/** One model input/output detail as `@litertjs/core` reports it. */
export interface LiteRtTensorDetail {
  readonly name: string
}

/** The subset of a `@litertjs/core` CompiledModel this runtime uses. */
export interface LiteRtCompiledModelLike {
  getInputDetails: () => readonly LiteRtTensorDetail[]
  getOutputDetails: () => readonly LiteRtTensorDetail[]
  run: (input: Record<string, LiteRtTensorLike>) => Promise<Record<string, LiteRtTensorLike>>
  delete: () => void
}

/**
 * The subset of the `@litertjs/core` module this runtime calls. Injected in tests so the
 * real Wasm module is never imported by the unit suite.
 */
export interface LiteRtRuntimeModule {
  loadLiteRt: (path: string, options?: { readonly jspi?: boolean; readonly threads?: boolean }) => Promise<void>
  loadAndCompile: (model: Uint8Array, options?: LiteRtCompileOptions) => Promise<LiteRtCompiledModelLike>
  readonly Tensor: new (data: Float32Array | Int32Array, dims: number[]) => LiteRtTensorLike
}

/** A one-shot guard around `loadLiteRt`. */
export interface LoadLiteRtGuard {
  readonly run: <A>(load: () => Promise<A>) => Promise<A>
}

/**
 * `loadLiteRt` installs a process-global Wasm module and a default environment. Calling it
 * a second time would rebind that state under the first model, so this guard runs the first
 * load and refuses every later one for the life of the process. A failed load also keeps
 * the guard closed: the module state is unknown, and retrying is not safe.
 */
export const createLoadLiteRtGuard = (): LoadLiteRtGuard => {
  let used = false
  return {
    run: async (load) => {
      if (used) {
        throw new RuntimeUnavailable({
          provider: PROVIDER,
          reason:
            'loadLiteRt has already been called in this process; the LiteRT Wasm module keeps process-global state and cannot be loaded twice',
        })
      }
      used = true
      return load()
    },
  }
}

/** The guard shared by every real boot in this process. */
export const processLoadLiteRtGuard: LoadLiteRtGuard = createLoadLiteRtGuard()

/** Test seams for `createNodeLitertBoot`; production callers omit all of them. */
export interface NodeLitertBootOptions {
  /** Defaults to `resolveLitertWasmDir()`, resolved lazily on load. */
  readonly wasmDir?: string
  /** Default thread count for `loadAndCompile` when a load does not pass one. */
  readonly threads?: number
  /** Inject a fake module instead of importing `@litertjs/core`. */
  readonly loadRuntime?: () => Promise<LiteRtRuntimeModule>
  /** Inject a fake shim installer. */
  readonly installShim?: (options: { wasmDir: string }) => LitertShim
  /** Inject a fresh guard so a test does not consume the process default. */
  readonly guard?: LoadLiteRtGuard
}

const defaultLoadRuntime = async (): Promise<LiteRtRuntimeModule> => {
  const loaded: unknown = await import('@litertjs/core')
  // SAFETY: the real module exposes Tensor, loadLiteRt and loadAndCompile with wider
  // overloads; this narrows the value to the surface used here, with identical runtime values.
  return loaded as LiteRtRuntimeModule
}

const wrapCompiledModel = (
  runtime: LiteRtRuntimeModule,
  compiled: LiteRtCompiledModelLike,
): CompiledLitertModel => {
  const inputDetails = compiled.getInputDetails()
  const outputDetails = compiled.getOutputDetails()
  const inputNames = inputDetails.map((detail) => detail.name)
  const outputNames = outputDetails.map((detail) => detail.name)

  return {
    inputNames,
    outputNames,
    run: async (feeds) => {
      const tensors: Record<string, LiteRtTensorLike> = {}
      try {
        for (const [name, feed] of Object.entries(feeds)) {
          if (!inputNames.includes(name)) {
            throw new Error(`the compiled model has no input named ${name}`)
          }
          tensors[name] = new runtime.Tensor(feed.data, [...feed.dims])
        }
        const produced = await compiled.run(tensors)
        const outputs: Record<string, LitertOutput> = {}
        for (const [name, tensor] of Object.entries(produced)) {
          outputs[name] = tensor.toTypedArray()
          tensor.delete()
        }
        return outputs
      } finally {
        for (const tensor of Object.values(tensors)) tensor.delete()
      }
    },
    close: () => {
      compiled.delete()
    },
  }
}

/**
 * The real boot: shim → `loadLiteRt` (once) → `loadAndCompile` (one model) → a Tensor
 * mapping. Every failure is reported as `RuntimeUnavailable`, including the refusal of a
 * second `loadLiteRt` in the same process.
 */
export const createNodeLitertBoot = (options: NodeLitertBootOptions = {}): LitertBoot => {
  const guard = options.guard ?? processLoadLiteRtGuard
  const loadRuntime = options.loadRuntime ?? defaultLoadRuntime
  const installShim = options.installShim ?? installLitertFetchShim

  return {
    load: async ({ modelBytes, threads }) => {
      const effectiveThreads = threads ?? options.threads
      try {
        const wasmDir = path.resolve(options.wasmDir ?? resolveLitertWasmDir())
        installShim({ wasmDir })
        const runtime = await guard.run(async () => {
          const loaded = await loadRuntime()
          await loaded.loadLiteRt(LITERT_WASM_PREFIX, { jspi: false })
          return loaded
        })
        const compileOptions =
          effectiveThreads === undefined
            ? { accelerator: 'wasm' as const }
            : { accelerator: 'wasm' as const, cpuOptions: { numThreads: effectiveThreads } }
        const compiled = await runtime.loadAndCompile(modelBytes, compileOptions)
        return wrapCompiledModel(runtime, compiled)
      } catch (cause) {
        if (cause instanceof RuntimeUnavailable) throw cause
        throw new RuntimeUnavailable({ provider: PROVIDER, reason: describeCause(cause) })
      }
    },
  }
}
