/**
 * Error-channel tests for the runtime's tagged errors.
 *
 * The errors ARE the contract: a caller routes on `_tag` and reads named
 * fields. A test that only checked `instanceof Error` would pass for a typo'd
 * tag, so these tests pin the tags, the fields, and that a failure raised while
 * a layer is being BUILT survives into the error channel instead of becoming a
 * defect.
 *
 * @module tests/errors
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Effect, Layer } from 'effect'

import {
  InferenceFailed,
  InvalidInput,
  PortFailure,
  RuntimeUnavailable,
} from '../src/errors.ts'
import { failureOf } from './support.ts'

describe('errors', () => {
  describe('InvalidInput', () => {
    it('carries the tag and the offending field', () => {
      const error = new InvalidInput({ field: 'input.text', message: 'text is required' })
      assert.equal(error._tag, 'InvalidInput')
      assert.equal(error.field, 'input.text')
      assert.equal(error.message, 'text is required')
      assert.ok(error instanceof Error)
      assert.ok(error instanceof InvalidInput)
    })
  })

  describe('RuntimeUnavailable', () => {
    it('names the provider that cannot run', () => {
      const error = new RuntimeUnavailable({ provider: 'litert', reason: 'no wasm build for win32-x64' })
      assert.equal(error._tag, 'RuntimeUnavailable')
      assert.equal(error.provider, 'litert')
      assert.equal(error.reason, 'no wasm build for win32-x64')
      assert.ok(error instanceof Error)
    })
  })

  describe('InferenceFailed', () => {
    it('records which phase failed', () => {
      for (const phase of ['load', 'run', 'post'] as const) {
        const error = new InferenceFailed({ provider: 'litert', phase, message: `${phase} broke` })
        assert.equal(error._tag, 'InferenceFailed')
        assert.equal(error.phase, phase)
        assert.equal(error.provider, 'litert')
        assert.ok(error instanceof Error)
      }
    })
  })

  describe('PortFailure', () => {
    it('names the port that failed', () => {
      const error = new PortFailure({ port: 'CatalogSource', message: 'no entry for redact' })
      assert.equal(error._tag, 'PortFailure')
      assert.equal(error.port, 'CatalogSource')
      assert.equal(error.message, 'no entry for redact')
      assert.ok(error instanceof Error)
    })
  })

  describe('routing', () => {
    it('narrows on _tag like any discriminated union', () => {
      const describeFailure = (error: InvalidInput | RuntimeUnavailable | InferenceFailed | PortFailure): string => {
        switch (error._tag) {
          case 'InvalidInput':
            return `invalid:${error.field}`
          case 'RuntimeUnavailable':
            return `unavailable:${error.provider}`
          case 'InferenceFailed':
            return `failed:${error.phase}`
          case 'PortFailure':
            return `port:${error.port}`
        }
      }
      assert.equal(describeFailure(new InvalidInput({ field: 'text', message: 'm' })), 'invalid:text')
      assert.equal(describeFailure(new RuntimeUnavailable({ provider: 'litert', reason: 'r' })), 'unavailable:litert')
      assert.equal(describeFailure(new InferenceFailed({ provider: 'litert', phase: 'run', message: 'm' })), 'failed:run')
      assert.equal(describeFailure(new PortFailure({ port: 'CatalogSource', message: 'm' })), 'port:CatalogSource')
    })
  })

  describe('composition', () => {
    it('surfaces a failure raised while building a layer on the error channel, not as a defect', async () => {
      class Broken extends Context.Service<Broken, { readonly ok: true }>()('test/Broken') {}

      const layer = Layer.effect(
        Broken,
        Effect.fail(new RuntimeUnavailable({ provider: 'litert', reason: 'engine missing' })),
      )
      const program = Effect.gen(function* () {
        const broken = yield* Broken
        return broken.ok
      })

      const error = await failureOf(Effect.runPromise(Effect.provide(program, layer)))
      assert.ok(error instanceof RuntimeUnavailable)
      assert.equal(error.reason, 'engine missing')
    })

    it('keeps the typed error when a failing effect is mapped to another tag', async () => {
      const mapped = Effect.mapError(
        Effect.fail(new PortFailure({ port: 'CatalogSource', message: 'gone' })),
        (cause) => new InvalidInput({ field: 'model', message: cause.message }),
      )
      const error = await failureOf(Effect.runPromise(mapped))
      assert.ok(error instanceof InvalidInput)
      assert.equal(error.field, 'model')
    })
  })
})
