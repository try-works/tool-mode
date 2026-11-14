/**
 * The socket-free LiteRT.js boot shim.
 *
 * WHY THIS EXISTS. `@litertjs/core` loads its Emscripten build by injecting a <script> into a
 * browser document and fetching the Wasm binary from a URL. In node it finds neither, so its
 * loader fails unless a document, a `__dirname`, and a URL scheme that resolves to a local file
 * are supplied. The proven spike
 * (D:/DEV/dsh-model-as-tool/spike/runtime-probe/litert/litert-file-shim.mjs, 2026-11-14)
 * showed that installing those globals plus a `fetch` interceptor for `litert://wasm/` is
 * sufficient — no HTTP server and no copied Wasm.
 *
 * WHAT IT DOES: installs `self/document/module/exports/require/__dirname/__filename` and a
 * `fetch` interceptor that maps `litert://wasm/<file>` to `path.join(wasmDir, <file>)`
 * (application/wasm for .wasm, text/javascript for .js). It never opens a socket and never
 * copies the Wasm files.
 *
 * WHAT IT DOES NOT DO: it does not load or compile a model (see model.ts), and it does not
 * restore itself automatically — keep the handle and call `dispose()` only when the process is
 * done with LiteRT, because the Wasm module is process-global.
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'

import { Schema } from 'effect'

import { RuntimeUnavailable, describeCause } from './errors.ts'

/** The only URL scheme this shim intercepts. */
export const LITERT_WASM_PREFIX = 'litert://wasm/'

/** A handle for the installed shim; `dispose` restores the previous globals and fetch. */
export interface LitertShim {
  readonly wasmDir: string
  readonly dispose: () => void
}

/** The browser globals an Emscripten loader reads through `self`. */
interface ShimGlobals {
  self?: unknown
  location?: unknown
  module?: { exports: unknown }
  exports?: unknown
  require?: unknown
  __dirname?: unknown
  __filename?: unknown
  document?: unknown
  ModuleFactory?: unknown
}

type ShimGlobalKey = keyof ShimGlobals

const SHIM_GLOBALS: readonly ShimGlobalKey[] = [
  'self',
  'location',
  'module',
  'exports',
  'require',
  '__dirname',
  '__filename',
  'document',
]

interface PreviousGlobal {
  readonly present: boolean
  readonly value: unknown
}

// SAFETY: these optional globals exist only in a browser or after this shim installs them;
// node's lib types do not declare them, and no other code reads them through this alias.
const globalScope = globalThis as ShimGlobals

let installed: { readonly wasmDir: string; readonly shim: LitertShim } | undefined

const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  ['.wasm', 'application/wasm'],
  ['.js', 'text/javascript'],
])

/** The only event payloads the Emscripten script loader hands listeners. */
type ScriptEvent = Error

interface ScriptElement {
  readonly tagName: string
  crossOrigin: string
  src: string
  readonly listeners: Record<string, ((event?: ScriptEvent) => void) | undefined>
  addEventListener: (event: string, listener: (event?: ScriptEvent) => void) => void
}

const createScriptElement = (tagName: string): ScriptElement => {
  const listeners: Record<string, ((event?: ScriptEvent) => void) | undefined> = {}
  let source = ''
  return {
    tagName,
    crossOrigin: 'anonymous',
    get src() {
      return source
    },
    set src(value: string) {
      source = value
    },
    listeners,
    addEventListener: (event, listener) => {
      listeners[event] = listener
    },
  }
}

const ScriptExports = Schema.Struct({
  ModuleFactory: Schema.optional(Schema.Unknown),
  default: Schema.optional(Schema.Unknown),
})

/**
 * The minimal document the Emscripten loader expects: `createElement('script')`, an element
 * whose `src` plus `load` listener resolves to evaluating the fetched script, and a body whose
 * `appendChild` starts that load. The evaluated script's `module.exports` (or `default`)
 * becomes `self.ModuleFactory`, as the loader expects.
 */
const createDocumentStub = () => {
  const evaluateScript = async (element: ScriptElement): Promise<void> => {
    try {
      const response = await globalThis.fetch(element.src)
      if (!response.ok) throw new Error(`script fetch failed with HTTP ${response.status}`)
      const code = await response.text()
      const moduleGlobal = { exports: {} }
      globalScope.module = moduleGlobal
      globalScope.exports = moduleGlobal.exports
      vm.runInThisContext(code, { filename: element.src })
      const exportsValue = moduleGlobal.exports
      const parsed = Schema.decodeUnknownOption(ScriptExports)(exportsValue)
      globalScope.ModuleFactory =
        parsed._tag === 'Some' ? (parsed.value.ModuleFactory ?? parsed.value.default ?? exportsValue) : exportsValue
      element.listeners['load']?.()
    } catch (error) {
      element.listeners['error']?.(error instanceof Error ? error : new Error(describeCause(error)))
    }
  }
  return {
    currentScript: null,
    createElement: (tagName: string) => createScriptElement(tagName),
    body: {
      appendChild: (element: ScriptElement) => {
        void evaluateScript(element)
      },
    },
    head: { appendChild: () => {} },
  }
}

const readUrl = (input: Parameters<typeof globalThis.fetch>[0]): string => {
  if (Schema.is(Schema.String)(input)) return input
  return input instanceof URL ? input.href : input.url
}

/**
 * Intercepts `litert://wasm/<file>` and serves the bytes from `wasmDir`. Every other URL is
 * forwarded to the real fetch, unchanged.
 */
const interceptLitertFetch = (
  wasmDir: string,
  realFetch: typeof globalThis.fetch,
): typeof globalThis.fetch => {
  const intercepted: typeof globalThis.fetch = async (input, init) => {
    let url: string
    try {
      url = readUrl(input)
    } catch {
      return new Response(null, { status: 400 })
    }
    if (!url.startsWith(LITERT_WASM_PREFIX)) return realFetch(input, init)

    let file: string
    try {
      const relative = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''))
      file = path.resolve(wasmDir, relative)
    } catch {
      return new Response(null, { status: 404 })
    }
    // A request may not escape the wasm directory.
    if (file !== wasmDir && !file.startsWith(wasmDir + path.sep)) {
      return new Response(null, { status: 404 })
    }
    try {
      const bytes = await readFile(file)
      const contentType = CONTENT_TYPES.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream'
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { 'content-type': contentType },
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  }
  return intercepted
}

/**
 * Installs the globals and fetch interceptor LiteRT.js needs in node.
 *
 * Idempotent for one wasm directory; refuses a second directory in the same process with
 * `RuntimeUnavailable` because the Wasm module is process-global. Call `dispose()` to restore
 * the globals and fetch.
 */
export const installLitertFetchShim = (options: { wasmDir: string }): LitertShim => {
  const wasmDir = path.resolve(options.wasmDir)
  if (installed !== undefined) {
    if (installed.wasmDir === wasmDir) return installed.shim
    throw new RuntimeUnavailable({
      provider: 'litert',
      reason: `the LiteRT fetch shim is already installed for ${installed.wasmDir}; it cannot target ${wasmDir} in the same process`,
    })
  }

  const realFetch = globalThis.fetch
  const previous = new Map<ShimGlobalKey, PreviousGlobal>()
  for (const key of SHIM_GLOBALS) {
    previous.set(key, { present: key in globalThis, value: globalScope[key] })
  }

  globalScope.self = globalThis
  globalScope.location = new URL(LITERT_WASM_PREFIX)
  globalScope.module = { exports: {} }
  globalScope.exports = globalScope.module.exports
  globalScope.require = createRequire(import.meta.url)
  globalScope.__dirname = wasmDir
  globalScope.__filename = path.join(wasmDir, 'loader.mjs')
  globalScope.document = createDocumentStub()
  globalThis.fetch = interceptLitertFetch(wasmDir, realFetch)

  let disposed = false
  const shim: LitertShim = {
    wasmDir,
    dispose: () => {
      if (disposed) return
      disposed = true
      globalThis.fetch = realFetch
      for (const [key, entry] of previous) {
        if (entry.present) Object.assign(globalThis, { [key]: entry.value })
        else delete globalScope[key]
      }
      installed = undefined
    },
  }
  installed = { wasmDir, shim }
  return shim
}

/**
 * The directory of Emscripten files shipped inside the installed `@litertjs/core`.
 *
 * Resolution is relative to this module, so it works from the built `lib/` output in any host
 * that installed the dependency (the package has no `exports` map restricting deep paths).
 */
export const resolveLitertWasmDir = (): string => {
  const require = createRequire(import.meta.url)
  const packageJson = require.resolve('@litertjs/core/package.json')
  return path.join(path.dirname(packageJson), 'wasm')
}
