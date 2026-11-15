/**
 * The ONE model-tool-readiness state both discovery surfaces publish.
 *
 * Two surfaces describe the same catalog: `model_tools` (list/describe rows) and
 * `tool_mode_list` (the permitted tool surface). Before this module each derived its own
 * readiness and they could disagree — one said "runnable", the other "callable", and a
 * model that merely was not installed read as unavailable. The pure function below is the
 * single derivation, so the two surfaces cannot drift.
 *
 * TASK-49 ADDED THE MISSING FACT: the catalog verdict alone cannot say CALLABLE. A model
 * whose route resolves but whose tool is not published is not callable — the caller would
 * look for a tool that does not exist. `toolPublished` is therefore a required input.
 *
 * STATE VOCABULARY (closed):
 * - `callable`     — the route resolves AND the model-facing tool is published now.
 * - `not-installed` — a Tool Mode extension implements it, but that extension/model is not
 *                    installed here yet. Installing is the action that changes this.
 * - `unavailable`   — no route can serve it (Apple-only, closed beta, no SDK), or it is
 *                    installed but its tool is not published: preparation/activation is missing.
 *
 * @module tests/model-surface
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MODEL_TOOL_STATES,
  modelSurface,
  type ModelSurfaceEntry,
  type ModelSurfaceVerdict,
} from '../src/model-surface.ts'

/** A provider-bound catalog entry (a Tool Mode extension implements it). */
const bound: ModelSurfaceEntry = {
  id: 'example',
  provider: { extension: '@try-works/extension-example', modelId: 'example' },
}

/** A catalog entry no Tool Mode extension implements. */
const unbound: ModelSurfaceEntry = { id: 'plain' }

/** A runnable verdict. */
const runnable: ModelSurfaceVerdict = {
  runnable: true,
  reason: 'the model runs through its installed extension',
}

/** A verdict that is not runnable because the extension is absent. */
const needsExtension: ModelSurfaceVerdict = {
  runnable: false,
  reason: 'the model declares the Tool Mode extension @try-works/extension-example, which is not installed or not resolvable from this host.',
}

/** A verdict that is not runnable for a reason installing cannot fix. */
const platformBound: ModelSurfaceVerdict = {
  runnable: false,
  reason: 'the model is Apple-only (Core ML/MLX through the Swift package); there is no JavaScript SDK.',
}

describe('modelSurface', () => {
  it('pins the closed state vocabulary', () => {
    assert.deepEqual([...MODEL_TOOL_STATES], ['callable', 'not-installed', 'unavailable'])
  })

  it('is callable ONLY when the route resolves AND the tool is published', () => {
    assert.deepEqual(modelSurface(bound, runnable, true, true), { state: 'callable', reason: null })
    assert.deepEqual(modelSurface(unbound, runnable, true, true), { state: 'callable', reason: null })
  })

  it('is NOT callable when the route resolves but the tool is not published', () => {
    // Installing alone does not publish a tool; the extension still needs activating/preparing.
    const surface = modelSurface(bound, runnable, true, false)
    assert.equal(surface.state, 'unavailable')
    assert.match(surface.reason ?? '', /not published/)
    assert.match(surface.reason ?? '', /activate|prepar/i)
  })

  it('names ENABLING as the action when the extension is installed but no model record exists', () => {
    const surface = modelSurface(bound, runnable, false, false)
    assert.equal(surface.state, 'unavailable')
    assert.match(surface.reason ?? '', /not enabled/i)
    assert.match(surface.reason ?? '', /enable/i)
  })

  it('is not-installed when an extension implements the model but it is not installed here', () => {
    assert.deepEqual(modelSurface(bound, needsExtension, false, false), {
      state: 'not-installed',
      reason: needsExtension.reason,
    })
  })

  it('is unavailable when the model is installed and still cannot run', () => {
    assert.deepEqual(modelSurface(bound, needsExtension, true, false), {
      state: 'unavailable',
      reason: needsExtension.reason,
    })
  })

  it('is unavailable when no Tool Mode extension implements the model', () => {
    for (const installed of [false, true]) {
      for (const published of [false, true]) {
        assert.deepEqual(modelSurface(unbound, platformBound, installed, published), {
          state: 'unavailable',
          reason: platformBound.reason,
        })
      }
    }
  })

  it('reports the VERDICT reason verbatim for verdict-caused states', () => {
    assert.equal(modelSurface(bound, needsExtension, false, false).reason, needsExtension.reason)
    assert.equal(modelSurface(unbound, platformBound, false, false).reason, platformBound.reason)
  })

  it('never reports callable without a published tool, for any entry/verdict pair', () => {
    const entries = [bound, unbound]
    const verdicts = [runnable, needsExtension, platformBound]
    for (const entry of entries) {
      for (const verdict of verdicts) {
        for (const installed of [false, true]) {
          assert.notEqual(modelSurface(entry, verdict, installed, false).state, 'callable')
        }
      }
    }
  })

  it('does not let a different extension name change the state', () => {
    const other: ModelSurfaceEntry = { id: 'other', provider: { extension: '@try-works/extension-other', modelId: 'other' } }
    assert.deepEqual(modelSurface(other, needsExtension, false, false), modelSurface(bound, needsExtension, false, false))
  })
})
