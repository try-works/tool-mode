import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  InferenceFailed as CoreInferenceFailed,
  RuntimeUnavailable as CoreRuntimeUnavailable,
} from '@try-works/tool-mode-runtime-core'

import { InferenceFailed, RuntimeUnavailable, describeCause } from '../src/errors.ts'

describe('runtime errors', () => {
  it('tags InferenceFailed with its tag and phase', () => {
    const error = new InferenceFailed({ provider: 'litert', phase: 'post', message: 'bad tensor' })
    assert.equal(error._tag, 'InferenceFailed')
    assert.equal(error.provider, 'litert')
    assert.equal(error.phase, 'post')
    assert.equal(error.message, 'bad tensor')
  })

  it('tags RuntimeUnavailable with its tag and reason', () => {
    const error = new RuntimeUnavailable({ provider: 'litert', reason: 'already loaded' })
    assert.equal(error._tag, 'RuntimeUnavailable')
    assert.equal(error.provider, 'litert')
    assert.equal(error.reason, 'already loaded')
  })

  it('re-exports the runtime-core classes rather than private copies', () => {
    assert.equal(InferenceFailed, CoreInferenceFailed)
    assert.equal(RuntimeUnavailable, CoreRuntimeUnavailable)
    assert.ok(
      new InferenceFailed({ provider: 'litert', phase: 'load', message: 'x' }) instanceof CoreInferenceFailed,
    )
  })

  it('describes unknown causes without throwing', () => {
    assert.equal(describeCause(new Error('boom')), 'boom')
    assert.equal(describeCause('plain'), 'plain')
    assert.equal(describeCause({ code: 7 }), '{"code":7}')
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    assert.equal(typeof describeCause(circular), 'string')
  })
})
