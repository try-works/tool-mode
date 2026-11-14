import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { RuntimeUnavailable } from '../src/errors.ts'
import {
  createLoadLiteRtGuard,
  createNodeLitertBoot,
  type LiteRtRuntimeModule,
} from '../src/model.ts'
import { resolveLitertWasmDir, type LitertShim } from '../src/shim.ts'

interface TensorRecord {
  readonly data: Float32Array | Int32Array
  readonly dims: number[]
  deleted: boolean
}

interface FakeRuntimeState {
  readonly loadCalls: { path: string; options: { jspi?: boolean } | undefined }[]
  readonly compileCalls: { model: Uint8Array; options: unknown }[]
  readonly tensors: TensorRecord[]
  compiledDeleted: number
}

const createRuntime = (options: {
  readonly inputNames?: readonly string[]
  readonly outputs?: Readonly<Record<string, Float32Array>>
  readonly compileError?: Error
} = {}): { runtime: LiteRtRuntimeModule; state: FakeRuntimeState } => {
  const state: FakeRuntimeState = {
    loadCalls: [],
    compileCalls: [],
    tensors: [],
    compiledDeleted: 0,
  }
  const inputNames = options.inputNames ?? ['input']
  const outputs = options.outputs ?? { output: new Float32Array([1, 2, 3]) }

  class FakeTensor {
    readonly data: Float32Array | Int32Array
    readonly dims: number[]
    deleted = false
    constructor(data: Float32Array | Int32Array, dims: readonly number[]) {
      this.data = data
      this.dims = [...dims]
      state.tensors.push(this)
    }
    toTypedArray(): Float32Array | Int32Array {
      return this.data
    }
    delete(): void {
      this.deleted = true
    }
  }

  const createTensor = (data: Float32Array | Int32Array, dims: readonly number[]) =>
    new FakeTensor(data, dims)

  return {
    state,
    runtime: {
      loadLiteRt: async (path: string, loadOptions?: { jspi?: boolean }) => {
        state.loadCalls.push({ path, options: loadOptions })
      },
      loadAndCompile: async (model: Uint8Array, compileOptions?: unknown) => {
        state.compileCalls.push({ model, options: compileOptions })
        if (options.compileError !== undefined) throw options.compileError
        const compiled = {
          getInputDetails: () => inputNames.map((name, index) => ({ name, index })),
          getOutputDetails: () =>
            Object.keys(outputs).map((name, index) => ({ name, index })),
          run: async (input: Readonly<Record<string, { data: Float32Array | Int32Array }>>) => {
            const produced: Record<string, FakeTensor> = {}
            for (const [name, data] of Object.entries(outputs)) {
              produced[name] = createTensor(data, [data.length])
            }
            assert.deepEqual(Object.keys(input).sort(), inputNames.map((name) => name).sort())
            return produced
          },
          delete: () => {
            state.compiledDeleted += 1
          },
        }
        return compiled as never
      },
      Tensor: FakeTensor,
    },
  }
}

const noopInstall = (options: { wasmDir: string }): LitertShim => ({
  wasmDir: options.wasmDir,
  dispose: () => {},
})

const makeBoot = async (options: {
  readonly runtime?: LiteRtRuntimeModule
  readonly compileError?: Error
  readonly guard?: ReturnType<typeof createLoadLiteRtGuard>
  readonly installShim?: (options: { wasmDir: string }) => LitertShim
}) => {
  const wasmDir = path.join(process.cwd(), 'fake-wasm')
  const installed: string[] = []
  const runtime =
    options.runtime ?? createRuntime(options.compileError === undefined ? {} : { compileError: options.compileError }).runtime
  const boot = createNodeLitertBoot({
    wasmDir,
    guard: options.guard ?? createLoadLiteRtGuard(),
    loadRuntime: async () => runtime,
    installShim:
      options.installShim ??
      ((installOptions) => {
        installed.push(installOptions.wasmDir)
        return noopInstall(installOptions)
      }),
  })
  return { boot, installed, wasmDir: path.resolve(wasmDir) }
}

describe('createLoadLiteRtGuard', () => {
  it('runs the first load and refuses the second in the same process', async () => {
    const guard = createLoadLiteRtGuard()
    const calls: number[] = []
    await guard.run(async () => {
      calls.push(1)
    })
    await assert.rejects(
      () =>
        guard.run(async () => {
          calls.push(2)
        }),
      (error: unknown) => error instanceof RuntimeUnavailable && error.reason.includes('already'),
    )
    assert.deepEqual(calls, [1])
  })

  it('refuses a retry after a failed load, because the module state is unknown', async () => {
    const guard = createLoadLiteRtGuard()
    await assert.rejects(
      () =>
        guard.run(async () => {
          throw new Error('wasm exploded')
        }),
      /wasm exploded/,
    )
    await assert.rejects(() => guard.run(async () => 'ok'), RuntimeUnavailable)
  })
})

describe('createNodeLitertBoot', () => {
  it('installs the shim, loads LiteRT once with jspi off and compiles a wasm model', async () => {
    const { runtime, state } = createRuntime({ inputNames: ['tokens'] })
    const { boot, installed, wasmDir } = await makeBoot({ runtime })
    const modelBytes = new Uint8Array([1, 2, 3])
    const model = await boot.load({ modelBytes, threads: 2 })

    assert.deepEqual(installed, [wasmDir])
    const [loadCall] = state.loadCalls
    assert.ok(loadCall !== undefined)
    assert.equal(loadCall.path, 'litert://wasm/')
    assert.equal(loadCall.options?.jspi, false)
    const [compileCall] = state.compileCalls
    assert.ok(compileCall !== undefined)
    assert.deepEqual(Array.from(compileCall.model), [1, 2, 3])
    assert.deepEqual(compileCall.options, {
      accelerator: 'wasm',
      cpuOptions: { numThreads: 2 },
    })
    assert.deepEqual(model.inputNames, ['tokens'])
  })

  it('maps feeds to Tensors and returns typed outputs, then closes the model', async () => {
    const { runtime, state } = createRuntime({ outputs: { logits: new Float32Array([4, 5]) } })
    const { boot } = await makeBoot({ runtime })
    const model = await boot.load({ modelBytes: new Uint8Array() })
    const outputs = await model.run({
      input: { data: new Float32Array([0.5, 0.25]), dims: [1, 2] },
    })

    assert.deepEqual(Array.from(outputs['logits'] ?? new Float32Array()), [4, 5])
    const created = state.tensors[0]
    assert.ok(created !== undefined)
    assert.deepEqual(created.dims, [1, 2])
    assert.deepEqual(Array.from(created.data), [0.5, 0.25])
    // Input tensors are released once the run completes.
    assert.equal(state.tensors.filter((tensor) => tensor.deleted).length, state.tensors.length)

    model.close()
    assert.equal(state.compiledDeleted, 1)
  })

  it('rejects a feed for an input the model does not have', async () => {
    const { runtime } = createRuntime()
    const { boot } = await makeBoot({ runtime })
    const model = await boot.load({ modelBytes: new Uint8Array() })
    await assert.rejects(
      () => model.run({ missing: { data: new Float32Array([1]), dims: [1] } }),
      /no input named missing/,
    )
  })

  it('maps boot failures to RuntimeUnavailable', async () => {
    const { boot } = await makeBoot({ compileError: new Error('bad model') })
    await assert.rejects(
      () => boot.load({ modelBytes: new Uint8Array() }),
      (error: unknown) => error instanceof RuntimeUnavailable && error.reason.includes('bad model'),
    )
  })

  it('refuses a second boot in the same process with the default guard', async () => {
    const first = createNodeLitertBoot({
      wasmDir: path.join(process.cwd(), 'fake-wasm'),
      loadRuntime: async () => createRuntime().runtime,
      installShim: noopInstall,
    })
    await first.load({ modelBytes: new Uint8Array() })
    const second = createNodeLitertBoot({
      wasmDir: path.join(process.cwd(), 'fake-wasm'),
      loadRuntime: async () => createRuntime().runtime,
      installShim: noopInstall,
    })
    await assert.rejects(() => second.load({ modelBytes: new Uint8Array() }), RuntimeUnavailable)
  })

  it('resolves the installed LiteRT wasm directory', () => {
    const wasmDir = resolveLitertWasmDir()
    assert.equal(existsSync(path.join(wasmDir, 'litert_wasm_internal.wasm')), true)
    assert.equal(existsSync(path.join(wasmDir, 'litert_wasm_jspi_internal.wasm')), true)
  })
})
