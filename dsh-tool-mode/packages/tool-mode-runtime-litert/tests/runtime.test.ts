import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Cause, Context, Effect, Exit, Layer, Scope } from 'effect'

import { InferenceFailed, RuntimeUnavailable } from '../src/errors.ts'
import type { LitertFeed } from '../src/model.ts'
import { LitertSession, litertLayer } from '../src/runtime.ts'
import { createFakeBoot } from './fakes.ts'

const feed: LitertFeed = { data: new Float32Array([1, 2]), dims: [1, 2] }

const layerFor = (boot: ReturnType<typeof createFakeBoot>) =>
  litertLayer({ wasmDir: 'unused-in-fake-boot', modelBytes: new Uint8Array([1]), boot })

const failureOf = (exit: Exit.Exit<unknown, unknown>): unknown => {
  assert.equal(Exit.isFailure(exit), true)
  if (Exit.isSuccess(exit)) return undefined
  return Cause.squash(exit.cause)
}

describe('LitertSession', () => {
  it('exposes the compiled model input names', async () => {
    const boot = createFakeBoot({ inputNames: ['tokens', 'mask'] })
    const program = LitertSession.use((session) => Effect.succeed(session.inputNames))
    const names = await Effect.runPromise(Effect.provide(program, layerFor(boot)))
    assert.deepEqual(names, ['tokens', 'mask'])
    assert.equal(boot.state.loads, 1)
  })

  it('runs feeds and returns Float32Array outputs, converting Int32Array', async () => {
    const boot = createFakeBoot({ outputs: { output: new Int32Array([7, 8]) } })
    const program = LitertSession.use((session) => session.run({ input: feed }))
    const outputs = await Effect.runPromise(Effect.provide(program, layerFor(boot)))
    const output = outputs['output']
    assert.ok(output instanceof Float32Array)
    assert.deepEqual(Array.from(output), [7, 8])
    assert.equal(boot.state.runFeeds.length, 1)
    assert.deepEqual(boot.state.runFeeds[0], { input: feed })
  })

  it('serializes concurrent runs with a one-permit semaphore', async () => {
    const boot = createFakeBoot({ runDelayMs: 15 })
    const program = Effect.gen(function* () {
      const session = yield* LitertSession
      return yield* Effect.all([session.run({ input: feed }), session.run({ input: feed })], {
        concurrency: 'unbounded',
      })
    })
    const results = await Effect.runPromise(Effect.provide(program, layerFor(boot)))
    assert.equal(results.length, 2)
    assert.equal(boot.state.maxActiveRuns, 1)
    assert.equal(boot.state.runFeeds.length, 2)
  })

  it('maps a run failure to InferenceFailed phase run', async () => {
    const boot = createFakeBoot({ runError: new Error('kernel panic') })
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        LitertSession.use((session) => session.run({ input: feed })),
        layerFor(boot),
      ),
    )
    const error = failureOf(exit)
    assert.ok(error instanceof InferenceFailed)
    assert.equal(error._tag, 'InferenceFailed')
    assert.equal(error.provider, 'litert')
    assert.equal(error.phase, 'run')
    assert.match(error.message, /kernel panic/)
  })

  it('maps a non-tensor output to InferenceFailed phase post', async () => {
    const boot = createFakeBoot({
      outputs: { output: 'not-a-tensor' as unknown as Float32Array },
    })
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        LitertSession.use((session) => session.run({ input: feed })),
        layerFor(boot),
      ),
    )
    const error = failureOf(exit)
    assert.ok(error instanceof InferenceFailed)
    assert.equal(error.phase, 'post')
  })

  it('fails layer construction with RuntimeUnavailable when the model will not load', async () => {
    const boot = createFakeBoot({ loadError: new Error('corrupt tflite') })
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        LitertSession.use(() => Effect.void),
        layerFor(boot),
      ),
    )
    const error = failureOf(exit)
    assert.ok(error instanceof RuntimeUnavailable)
    assert.equal(error.provider, 'litert')
    assert.match(error.reason, /corrupt tflite/)
    assert.equal(boot.state.closes, 0)
  })

  it('closes the compiled model when the layer scope closes, exactly once', async () => {
    const boot = createFakeBoot()
    const program = Effect.gen(function* () {
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(layerFor(boot), scope)
      const session = Context.get(context, LitertSession)
      const names = session.inputNames
      yield* Scope.close(scope, Exit.void)
      return names
    })
    const names = await Effect.runPromise(program)
    assert.deepEqual(names, ['input'])
    assert.equal(boot.state.loads, 1)
    assert.equal(boot.state.closes, 1)
  })
})
