/**
 * RC3 — the Extensions-page state derivation (extension-page-state.ts).
 *
 * The derivation the client bundle implements: a row the host reports blocked
 * (or with an unmet requirement that blocks THIS row) is never rendered as
 * plainly "active"/ON. Pinned here in Node so the bundle's inline rule and
 * this module cannot drift unnoticed.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  extensionPageState,
  requirementBlocksRow,
  type ExtensionPageRow,
} from '../src/extension-page-state.ts'

describe('RC3 — extension-page-state derivation', () => {
  it('active + blocked readiness: badge "active · blocked", toggle OFF, blocker kept', () => {
    const row: ExtensionPageRow = {
      installed: true,
      active: true,
      blocked: true,
      reason: 'activation blocked: embeddinggemma-2 needs its model assets prepared — run prepare for this extension',
      requirements: [
        { kind: 'assets', satisfied: false, reason: 'activation blocked: embeddinggemma-2 needs its model assets prepared — run prepare for this extension' },
      ],
    }
    const state = extensionPageState(row)
    assert.equal(state.badge, 'active-blocked')
    assert.equal(state.toggleOn, false)
    assert.equal(state.active, true, 'the lifecycle fact is preserved for the aria/title')
    assert.deepEqual(state.blockingReasons, [row.requirements[0]?.reason])
  })

  it('installed + not prepared (host blocked flag absent): the unmet assets requirement still blocks', () => {
    const row: ExtensionPageRow = {
      installed: true,
      active: true,
      blocked: false,
      reason: 'activation blocked: x needs its model assets prepared',
      requirements: [
        { kind: 'assets', satisfied: false, reason: 'activation blocked: x needs its model assets prepared' },
      ],
    }
    const state = extensionPageState(row)
    assert.equal(state.badge, 'active-blocked')
    assert.equal(state.toggleOn, false)
    assert.equal(state.blocked, true)
  })

  it('dependency refusal present on a not-installed row: dependencies blocks, assets is only a note', () => {
    const row: ExtensionPageRow = {
      installed: false,
      active: false,
      blocked: true,
      reason: 'the dependency graph exceeds the 3-level depth bound at define-data-property',
      requirements: [
        { kind: 'dependencies', satisfied: false, reason: '[DEPENDENCY_UNSATISFIED] the dependency graph exceeds the 3-level depth bound at define-data-property' },
        { kind: 'assets', satisfied: false, reason: 'not installed; laya needs model assets prepared after installation' },
      ],
    }
    assert.equal(requirementBlocksRow(false, row.requirements[0] as never), true)
    assert.equal(requirementBlocksRow(false, row.requirements[1] as never), false)
    const state = extensionPageState(row)
    assert.equal(state.badge, 'not-installed')
    assert.deepEqual(state.blockingReasons, [row.requirements[0]?.reason])
    assert.deepEqual(state.noteReasons, [row.requirements[1]?.reason])
  })

  it('an active, unblocked row keeps the plain active/ON rendering', () => {
    const row: ExtensionPageRow = {
      installed: true,
      active: true,
      blocked: false,
      reason: null,
      requirements: [],
    }
    const state = extensionPageState(row)
    assert.equal(state.badge, 'active')
    assert.equal(state.toggleOn, true)
  })

  it('an inactive, installed row renders inactive/OFF', () => {
    const row: ExtensionPageRow = {
      installed: true,
      active: false,
      blocked: false,
      reason: null,
      requirements: [],
    }
    const state = extensionPageState(row)
    assert.equal(state.badge, 'inactive')
    assert.equal(state.toggleOn, false)
  })

  it('satisfied requirements never block or note', () => {
    assert.equal(requirementBlocksRow(false, { kind: 'assets', satisfied: true, reason: 'x' }), false)
    assert.equal(requirementBlocksRow(true, { kind: 'assets', satisfied: true, reason: 'x' }), false)
  })
})
