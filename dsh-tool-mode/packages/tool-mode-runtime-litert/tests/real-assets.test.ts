/**
 * The gated real-assets test.
 *
 * It runs REAL LiteRT.js inference over a real shapes.tflite through the socket-free shim.
 * It skips with a stated reason unless:
 *   1. TOOL_MODE_REAL_ASSETS=1, and
 *   2. .assets/shapes/shapes.tflite exists at the repository root.
 *
 * Assets are never downloaded here and never committed: .assets/ is gitignored. Without the
 * asset, every claim about real inference in this package is unproven, and this test says so
 * instead of passing silently on a fixture.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Effect } from 'effect'

import { resolveLitertWasmDir } from '../src/shim.ts'
import { LitertSession, litertLayer } from '../src/runtime.ts'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const modelPath = path.join(repoRoot, '.assets', 'shapes', 'shapes.tflite')

const skipReason =
  process.env['TOOL_MODE_REAL_ASSETS'] !== '1'
    ? 'TOOL_MODE_REAL_ASSETS is not 1; real LiteRT inference not requested'
    : !existsSync(modelPath)
      ? `real assets are not prepared: ${modelPath} is missing (see scripts/ for the fetch step)`
      : false

describe('real LiteRT inference over the socket-free shim', () => {
  it(
    'loads shapes.tflite and runs one batch without opening a socket',
    { skip: skipReason },
    async () => {
      const modelBytes = new Uint8Array(await readFile(modelPath))
      const layer = litertLayer({ wasmDir: resolveLitertWasmDir(), modelBytes })
      const program = Effect.gen(function* () {
        const session = yield* LitertSession
        const inputName = session.inputNames[0]
        assert.ok(inputName !== undefined, 'the model must report at least one input')
        return yield* session.run({
          [inputName]: { data: new Float32Array(128 * 2).fill(0.25), dims: [1, 128, 2] },
        })
      })
      const outputs = await Effect.runPromise(Effect.provide(program, layer))
      const names = Object.keys(outputs)
      assert.ok(names.length > 0)
      for (const name of names) {
        const output = outputs[name]
        assert.ok(output instanceof Float32Array, `${name} must be a Float32Array`)
        assert.ok(output.length > 0, `${name} must contain data`)
        for (const value of output) assert.equal(Number.isFinite(value), true)
      }
    },
  )
})
