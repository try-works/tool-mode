import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { RuntimeUnavailable } from '../src/errors.ts'
import { installLitertFetchShim, type LitertShim } from '../src/shim.ts'

interface ScriptElement {
  readonly tagName: string
  src: string
  addEventListener: (event: string, listener: (event?: unknown) => void) => void
}

interface DocumentStub {
  createElement: (tagName: string) => ScriptElement
  body: { appendChild: (element: ScriptElement) => void }
}

const tempDirs: string[] = []
const installedShims: LitertShim[] = []

const makeWasmDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'litert-shim-'))
  tempDirs.push(dir)
  return dir
}

const install = (wasmDir: string): LitertShim => {
  const shim = installLitertFetchShim({ wasmDir })
  installedShims.push(shim)
  return shim
}

const globalScope = globalThis as unknown as Record<string, unknown>

afterEach(async () => {
  while (installedShims.length > 0) installedShims.pop()?.dispose()
  delete globalScope['ModuleFactory']
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

describe('installLitertFetchShim', () => {
  it('serves litert:// wasm files from disk without a socket', async () => {
    const wasmDir = await makeWasmDir()
    const magic = new Uint8Array([0x00, 0x61, 0x73, 0x6d])
    await writeFile(path.join(wasmDir, 'probe.wasm'), magic)
    await writeFile(path.join(wasmDir, 'probe.js'), 'export const value = 1')
    install(wasmDir)

    const wasm = await globalThis.fetch('litert://wasm/probe.wasm')
    assert.equal(wasm.status, 200)
    assert.equal(wasm.headers.get('content-type'), 'application/wasm')
    assert.deepEqual(new Uint8Array(await wasm.arrayBuffer()), magic)

    const js = await globalThis.fetch('litert://wasm/probe.js')
    assert.equal(js.status, 200)
    assert.equal(js.headers.get('content-type'), 'text/javascript')
    assert.equal(await js.text(), 'export const value = 1')

    // Anything that is not litert:// goes to the real fetch.
    const passthrough = await globalThis.fetch('data:text/plain,hello')
    assert.equal(await passthrough.text(), 'hello')
  })

  it('answers 404 for a missing file and for a path outside the wasm dir', async () => {
    const wasmDir = await makeWasmDir()
    install(wasmDir)
    assert.equal((await globalThis.fetch('litert://wasm/missing.wasm')).status, 404)
    assert.equal((await globalThis.fetch('litert://wasm/../escape.wasm')).status, 404)
  })

  it('installs the Emscripten globals and points __dirname at the wasm dir', async () => {
    const wasmDir = await makeWasmDir()
    install(wasmDir)
    const resolved = path.resolve(wasmDir)
    assert.equal(globalScope['__dirname'], resolved)
    assert.equal(globalScope['__filename'], path.join(resolved, 'loader.mjs'))
    assert.equal(globalScope['self'], globalThis)
    assert.equal(typeof globalScope['require'], 'function')
    assert.equal(typeof globalScope['module'], 'object')
    assert.equal(typeof globalScope['document'], 'object')
    assert.equal(typeof globalScope['location'], 'object')

    const documentStub = globalScope['document'] as DocumentStub
    const element = documentStub.createElement('script')
    assert.equal(element.tagName, 'script')
    element.src = 'litert://wasm/probe.js'
    assert.equal(element.src, 'litert://wasm/probe.js')
    assert.equal(typeof element.addEventListener, 'function')
  })

  it('evaluates a script appended through document.body and publishes ModuleFactory', async () => {
    const wasmDir = await makeWasmDir()
    await writeFile(
      path.join(wasmDir, 'factory.js'),
      'globalThis.module.exports = { ModuleFactory: () => 42 }',
    )
    install(wasmDir)
    const documentStub = globalScope['document'] as DocumentStub

    await new Promise<void>((resolve, reject) => {
      const element = documentStub.createElement('script')
      element.addEventListener('load', () => resolve())
      element.addEventListener('error', () => reject(new Error('script load failed')))
      element.src = 'litert://wasm/factory.js'
      documentStub.body.appendChild(element)
    })

    const factory = globalScope['ModuleFactory']
    assert.equal(typeof factory, 'function')
    assert.equal((factory as () => number)(), 42)
  })

  it('is idempotent for one wasm dir and refuses a second one until disposed', async () => {
    const wasmDir = await makeWasmDir()
    const first = install(wasmDir)
    assert.equal(install(wasmDir), first)

    const other = await makeWasmDir()
    assert.throws(
      () => installLitertFetchShim({ wasmDir: other }),
      (error: unknown) => error instanceof RuntimeUnavailable && error.reason.includes('already installed'),
    )
  })

  it('restores the previous fetch on dispose', async () => {
    const wasmDir = await makeWasmDir()
    const before = globalThis.fetch
    const shim = installLitertFetchShim({ wasmDir })
    assert.notEqual(globalThis.fetch, before)
    shim.dispose()
    assert.equal(globalThis.fetch, before)
  })

  it('never opens a listening socket from the source tree', async () => {
    const srcDir = path.resolve(import.meta.dirname, '../src')
    const names = await readdir(srcDir)
    assert.ok(names.length > 0)
    for (const name of names) {
      if (!name.endsWith('.ts')) continue
      const text = await readFile(path.join(srcDir, name), 'utf8')
      for (const forbidden of ['node:http', 'node:https', 'node:net', 'node:dgram', 'createServer(', '.listen(']) {
        assert.equal(text.includes(forbidden), false, `${name} must not contain ${forbidden}`)
      }
    }
  })
})
