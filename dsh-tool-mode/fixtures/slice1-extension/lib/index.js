/**
 * Slice 1 fixture extension entry — a DETERMINISTIC tool with no inference.
 *
 * Plain JavaScript on purpose: this stands in for a BUILT artifact, which is what an
 * installed extension actually contains. A `.ts` fixture would prove the loader works
 * under a TypeScript loader, which is not the path a host takes.
 *
 * It implements the REAL SDK shape (apiVersion + create(context) + createProvider)
 * so the host's dispatch chain can reach it end to end: install, activate, publish,
 * invoke through the authorized pipeline. It performs no inference, reads no file and
 * opens no socket, so a passing run proves the HOSTING and DISPATCH path and cannot be
 * confused with evidence about a model.
 *
 * Every result is reproducible: the same input always produces the same output.
 */

/** The extension's declared identity, matched against its own manifest by the host. */
export const extensionId = '@try-works/fixture-slice1'

/** The largest token the contract admits. */
const MAX_TOKEN_CHARS = 256

/**
 * Echo a token back, optionally upper-cased.
 * @param {object} input - the caller's arguments.
 * @returns {{ echoed: string, length: number }} the echoed token and its length.
 */
export function echo(input) {
  const token = input.token
  // Refused rather than coerced: silently stringifying a number would let a caller
  // believe it sent text, and the contract declares `token` as a string.
  if (typeof token !== 'string') {
    throw new Error('fixture_echo requires a string token')
  }
  if (token.length > MAX_TOKEN_CHARS) {
    throw new Error(`the token is ${token.length} characters, over the ${MAX_TOKEN_CHARS} the contract states`)
  }
  // TEST SENTINEL, used by host-restore tests to exercise the host's OUTPUT
  // enforcement: the provider returns a value that violates its own declared
  // output schema, and the host must refuse it before a caller sees it.
  if (token === '__violate_output__') {
    return { echoed: 42, length: 'not-a-number' }
  }
  const echoed = input.upper === true ? token.toUpperCase() : token
  return { echoed, length: echoed.length }
}

/**
 * The extension in the SDK's ToolModeExtensionV1 shape.
 *
 * `create` is lightweight and `createProvider` creates a handle; the work happens in
 * `invoke`, exactly as the host's dispatch expects.
 */
export default {
  apiVersion: 1,
  async create(context) {
    void context
    return {
      async createProvider() {
        return {
          async inspect() {
            // No assets exist, and the manifest declares none; the tool is always ready.
            return { readiness: 'ready', modelId: 'fixture-echo-model', summary: 'deterministic echo fixture' }
          },
          async load() {
            // Nothing to load: no weights, no files, no network.
          },
          async invoke(request) {
            // The dispatch contract: the provider answers in terms of the model it
            // serves, so this returns the deterministic echo.
            return echo(request.input)
          },
          async unload() {},
          async dispose() {},
        }
      },
      async dispose() {},
    }
  },
}
