/**
 * The ONE model-tool-readiness state both discovery surfaces publish.
 *
 * Two surfaces describe the same catalog: `model_tools` (list/describe rows) and
 * `tool_mode_list` (the permitted tool surface). Before this module each derived its own
 * readiness and they could disagree — one said "runnable", the other "callable", and a
 * model that merely was not installed read as unavailable. The pure function below is the
 * single derivation, so the two surfaces cannot drift.
 *
 * STATE VOCABULARY (closed):
 * - `callable`     — the catalog route resolves on this host; the model can run now.
 * - `not-installed` — a Tool Mode extension implements it, but that extension/model is not
 *                    installed here yet. Installing is the action that changes this.
 * - `unavailable`   — no route on this host can serve it (Apple-only, closed beta, no SDK),
 *                    or it IS installed and still cannot run: installing again would not help.
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
  provider: { extension: '@try-works/extension-example', modelId: 'example' },
}

/** A catalog entry no Tool Mode extension implements. */
const unbound: ModelSurfaceEntry = {}

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

  it('is callable whenever the route resolves, installed or not', () => {
    for (const installed of [false, true]) {
      assert.deepEqual(modelSurface(bound, runnable, installed), { state: 'callable', reason: null })
      assert.deepEqual(modelSurface(unbound, runnable, installed), { state: 'callable', reason: null })
    }
  })

  it('is not-installed when an extension implements the model but it is not installed here', () => {
    assert.deepEqual(modelSurface(bound, needsExtension, false), {
      state: 'not-installed',
      reason: needsExtension.reason,
    })
  })

  it('is unavailable when the model is installed and still cannot run', () => {
    assert.deepEqual(modelSurface(bound, needsExtension, true), {
      state: 'unavailable',
      reason: needsExtension.reason,
    })
  })

  it('is unavailable when no Tool Mode extension implements the model', () => {
    for (const installed of [false, true]) {
      assert.deepEqual(modelSurface(unbound, platformBound, installed), {
        state: 'unavailable',
        reason: platformBound.reason,
      })
    }
  })

  it('always reports the verdict reason verbatim, never a second wording', () => {
    const surface = modelSurface(bound, needsExtension, false)
    assert.equal(surface.reason, needsExtension.reason)
  })

  it('does not let a different extension name change the state', () => {
    const other: ModelSurfaceEntry = { provider: { extension: '@try-works/extension-other', modelId: 'other' } }
    assert.deepEqual(modelSurface(other, needsExtension, false), modelSurface(bound, needsExtension, false))
  })
})
