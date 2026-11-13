/**
 * SEC-09 approval state machine (standalone module).
 *
 * These tests pin the properties a management-sensitive approval flow must have:
 * an explicit pending state, TTL expiry on an INJECTED clock, one-shot commit,
 * idempotent decisions, scope matching (an approval for one extension/tool cannot
 * authorize another), named refusals, plain-JSON durability and — the security
 * property — a caller with no approval UI fails PROMPTLY with a named error instead
 * of hanging on a promise nobody will settle.
 *
 * The module is standalone (no host wiring): the contract at the bottom of this file
 * is what src/index.ts will call.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  ApprovalError,
  ApprovalStore,
  APPROVAL_KINDS,
  type ApprovalKind,
  type ApprovalScope,
} from '../src/approval.ts'

/** A mutable injected clock, so no test depends on wall time. */
function clockAt(start = 1_000) {
  let current = start
  return {
    now: () => current,
    advance: (milliseconds: number) => { current += milliseconds },
    set: (value: number) => { current = value },
  }
}

const MODEL_SCOPE: ApprovalScope = { kind: 'model', id: 'tongue' }
const EXTENSION_SCOPE: ApprovalScope = { kind: 'extension', id: '@try-works/extension-laya' }

function request(overrides: Partial<Parameters<ApprovalStore['request']>[0]> = {}) {
  return {
    kind: 'model-enable' as ApprovalKind,
    scope: MODEL_SCOPE,
    operator: 'operator@example.test',
    reason: 'enable tongue for the review',
    ...overrides,
  }
}

describe('SEC-09 request creation and deterministic identity', () => {
  it('creates a pending, plain-JSON record with the injected timestamp and TTL', () => {
    const clock = clockAt(10_000)
    const store = new ApprovalStore({ now: clock.now, defaultTtlMs: 60_000 })
    const record = store.request(request())
    assert.equal(record.state, 'pending')
    assert.equal(record.requestedAt, 10_000)
    assert.equal(record.expiresAt, 70_000)
    assert.equal(record.operator, 'operator@example.test')
    assert.equal(record.reason, 'enable tongue for the review')
    assert.deepEqual(record.scope, MODEL_SCOPE)
    assert.deepEqual(JSON.parse(JSON.stringify(record)), record, 'the record must be plain JSON')
  })

  it('derives a deterministic id from the request content and the clock', () => {
    const clock = clockAt(5_000)
    const a = new ApprovalStore({ now: clock.now }).request(request())
    const b = new ApprovalStore({ now: clock.now }).request(request())
    assert.equal(a.id, b.id)
    assert.match(a.id, /^apr_[0-9a-f]{16}$/)
    const differentReason = new ApprovalStore({ now: clock.now }).request(request({ reason: 'different reason' }))
    assert.notEqual(a.id, differentReason.id)
    const later = new ApprovalStore({ now: () => 6_000 }).request(request())
    assert.notEqual(a.id, later.id)
  })

  it('returns the SAME record for a repeated request instead of overwriting it', () => {
    const clock = clockAt()
    const store = new ApprovalStore({ now: clock.now })
    const first = store.request(request())
    const again = store.request(request())
    assert.deepEqual(again, first)
    assert.equal(store.list().length, 1)
  })

  it('refuses malformed requests with a named error', () => {
    const store = new ApprovalStore({ now: () => 1_000 })
    const invalid = [
      request({ kind: 'not-a-kind' as ApprovalKind }),
      request({ operator: '' }),
      request({ reason: '   ' }),
      request({ scope: { kind: 'model', id: '' } }),
      request({ ttlMs: 0 }),
      request({ ttlMs: Number.NaN }),
    ]
    for (const candidate of invalid) {
      assert.throws(() => store.request(candidate), (error: unknown) => {
        assert.ok(error instanceof ApprovalError)
        assert.equal(error.code, 'approval/invalid-request')
        return true
      })
    }
  })
})

describe('SEC-09 no approval UI never hangs', () => {
  it('a pending request cannot be committed and fails synchronously with a name', () => {
    const store = new ApprovalStore({ now: () => 1_000 })
    const record = store.request(request())
    let threw = false
    try {
      store.commit(record.id, MODEL_SCOPE)
    } catch (error) {
      threw = true
      assert.ok(error instanceof ApprovalError)
      assert.equal(error.code, 'approval/pending')
      assert.match(error.message, /no operator has approved/)
    }
    assert.equal(threw, true, 'commit must refuse without waiting for a decision')
  })

  it('an unknown id is a named refusal, not undefined behaviour', () => {
    const store = new ApprovalStore({ now: () => 1_000 })
    assert.throws(() => store.describe('apr_0000000000000000'), (error: unknown) => {
      assert.ok(error instanceof ApprovalError)
      assert.equal(error.code, 'approval/unknown-id')
      return true
    })
    assert.throws(() => store.commit('apr_0000000000000000', MODEL_SCOPE), (error: unknown) => {
      assert.ok(error instanceof ApprovalError)
      assert.equal(error.code, 'approval/unknown-id')
      return true
    })
  })
})

describe('SEC-09 decisions are explicit and idempotent', () => {
  it('approve moves pending to approved and records the decider', () => {
    const clock = clockAt(2_000)
    const store = new ApprovalStore({ now: clock.now, defaultTtlMs: 60_000 })
    const record = store.request(request())
    clock.advance(500)
    const approved = store.decide(record.id, { approve: true, decidedBy: 'lead@example.test', reason: 'reviewed' })
    assert.equal(approved.state, 'approved')
    assert.equal(approved.decidedAt, 2_500)
    assert.equal(approved.decidedBy, 'lead@example.test')
    assert.equal(approved.decisionReason, 'reviewed')
  })

  it('repeating the same decision is idempotent, including the decision timestamp', () => {
    const clock = clockAt()
    const store = new ApprovalStore({ now: clock.now, defaultTtlMs: 60_000 })
    const record = store.request(request())
    const first = store.decide(record.id, { approve: true, decidedBy: 'lead' })
    clock.advance(10_000)
    const second = store.decide(record.id, { approve: true, decidedBy: 'lead' })
    assert.deepEqual(second, first)
  })

  it('a conflicting decision is refused by name', () => {
    const store = new ApprovalStore({ now: () => 1_000, defaultTtlMs: 60_000 })
    const record = store.request(request())
    store.decide(record.id, { approve: true, decidedBy: 'lead' })
    assert.throws(() => store.decide(record.id, { approve: false, decidedBy: 'lead' }), (error: unknown) => {
      assert.ok(error instanceof ApprovalError)
      assert.equal(error.code, 'approval/already-decided')
      return true
    })
  })

  it('a denial is final and cannot be committed', () => {
    const store = new ApprovalStore({ now: () => 1_000, defaultTtlMs: 60_000 })
    const record = store.request(request())
    const denied = store.decide(record.id, { approve: false, decidedBy: 'lead', reason: 'not needed' })
    assert.equal(denied.state, 'denied')
    assert.throws(() => store.commit(record.id, MODEL_SCOPE), (error: unknown) => {
      assert.ok(error instanceof ApprovalError)
      assert.equal(error.code, 'approval/denied')
      return true
    })
  })
})

describe('SEC-09 commit is one-shot and scope-bound', () => {
  it('commits an approved request exactly once', () => {
    const clock = clockAt()
    const store = new ApprovalStore({ now: clock.now, defaultTtlMs: 60_000 })
    const record = store.request(request())
    store.decide(record.id, { approve: true, decidedBy: 'lead' })
    clock.advance(100)
    const committed = store.commit(record.id, MODEL_SCOPE)
    assert.equal(committed.state, 'committed')
    assert.equal(committed.committedAt, 1_100)
    assert.throws(() => store.commit(record.id, MODEL_SCOPE), (error: unknown) => {
      assert.ok(error instanceof ApprovalError)
      assert.equal(error.code, 'approval/already-committed')
      return true
    })
  })

  it('refuses a commit whose scope differs from the approved scope', () => {
    const store = new ApprovalStore({ now: () => 1_000, defaultTtlMs: 60_000 })
    const extensionRequest = store.request(request({
      kind: 'extension-install',
      scope: EXTENSION_SCOPE,
      reason: 'install laya',
    }))
    store.decide(extensionRequest.id, { approve: true, decidedBy: 'lead' })
    assert.throws(
      () => store.commit(extensionRequest.id, { kind: 'extension', id: '@try-works/extension-embeddinggemma' }),
      (error: unknown) => {
        assert.ok(error instanceof ApprovalError)
        assert.equal(error.code, 'approval/scope-mismatch')
        return true
      },
    )
    assert.equal(store.describe(extensionRequest.id).state, 'approved', 'a refused commit must not consume the approval')
    const committed = store.commit(extensionRequest.id, EXTENSION_SCOPE)
    assert.equal(committed.state, 'committed')
  })

  it('supports per-tool scoping, so a tool approval cannot authorize a sibling tool', () => {
    const store = new ApprovalStore({ now: () => 1_000, defaultTtlMs: 60_000 })
    const toolRequest = store.request(request({
      kind: 'model-enable',
      scope: { kind: 'tool', id: 'lang_detect' },
      reason: 'enable one tool',
    }))
    store.decide(toolRequest.id, { approve: true, decidedBy: 'lead' })
    assert.throws(
      () => store.commit(toolRequest.id, { kind: 'tool', id: 'text_embed' }),
      (error: unknown) => error instanceof ApprovalError && error.code === 'approval/scope-mismatch',
    )
    assert.equal(store.commit(toolRequest.id, { kind: 'tool', id: 'lang_detect' }).state, 'committed')
  })

  it('a commit cannot invent a scope the request kind does not admit', () => {
    const store = new ApprovalStore({ now: () => 1_000, defaultTtlMs: 60_000 })
    assert.throws(
      () => store.request(request({ kind: 'credential-revoke', scope: MODEL_SCOPE })),
      (error: unknown) => error instanceof ApprovalError && error.code === 'approval/invalid-request',
    )
  })
})

describe('SEC-09 TTL expiry on the injected clock', () => {
  it('a pending request expires and cannot be approved or committed afterwards', () => {
    const clock = clockAt(1_000)
    const store = new ApprovalStore({ now: clock.now, defaultTtlMs: 100 })
    const record = store.request(request())
    assert.equal(store.describe(record.id).state, 'pending')
    clock.advance(100)
    assert.equal(store.describe(record.id).state, 'expired')
    assert.throws(() => store.commit(record.id, MODEL_SCOPE), (error: unknown) => {
      assert.ok(error instanceof ApprovalError)
      assert.equal(error.code, 'approval/expired')
      return true
    })
    assert.throws(() => store.decide(record.id, { approve: true, decidedBy: 'lead' }), (error: unknown) => {
      assert.ok(error instanceof ApprovalError)
      assert.equal(error.code, 'approval/expired')
      return true
    })
  })

  it('an APPROVED request that expires before commit cannot be committed', () => {
    const clock = clockAt(1_000)
    const store = new ApprovalStore({ now: clock.now, defaultTtlMs: 100 })
    const record = store.request(request())
    store.decide(record.id, { approve: true, decidedBy: 'lead' })
    clock.advance(100)
    assert.equal(store.describe(record.id).state, 'expired')
    assert.throws(() => store.commit(record.id, MODEL_SCOPE), (error: unknown) => {
      assert.ok(error instanceof ApprovalError)
      assert.equal(error.code, 'approval/expired')
      return true
    })
  })

  it('a committed request is terminal and never expires', () => {
    const clock = clockAt(1_000)
    const store = new ApprovalStore({ now: clock.now, defaultTtlMs: 100 })
    const record = store.request(request())
    store.decide(record.id, { approve: true, decidedBy: 'lead' })
    store.commit(record.id, MODEL_SCOPE)
    clock.advance(10_000)
    assert.equal(store.describe(record.id).state, 'committed')
  })
})

describe('SEC-09 plain-JSON durability', () => {
  it('round-trips pending, approved and committed records through JSON', () => {
    const clock = clockAt(1_000)
    const store = new ApprovalStore({ now: clock.now, defaultTtlMs: 60_000 })
    const pending = store.request(request({ reason: 'still pending' }))
    const approved = store.request(request({ reason: 'approved one' }))
    store.decide(approved.id, { approve: true, decidedBy: 'lead' })
    const committed = store.request(request({ reason: 'done one' }))
    store.decide(committed.id, { approve: true, decidedBy: 'lead' })
    store.commit(committed.id, MODEL_SCOPE)

    const snapshot = JSON.parse(JSON.stringify(store.toJSON()))
    const restored = ApprovalStore.fromJSON(snapshot, { now: clock.now })
    assert.equal(restored.describe(pending.id).state, 'pending')
    assert.equal(restored.describe(approved.id).state, 'approved')
    assert.equal(restored.describe(committed.id).state, 'committed')
    assert.deepEqual(restored.describe(pending.id), store.describe(pending.id))
    // A restored approval is still one-shot.
    assert.equal(restored.commit(approved.id, MODEL_SCOPE).state, 'committed')
    assert.throws(() => restored.commit(approved.id, MODEL_SCOPE), (error: unknown) => {
      assert.ok(error instanceof ApprovalError)
      assert.equal(error.code, 'approval/already-committed')
      return true
    })
  })

  it('restores an expired record as expired using the injected clock', () => {
    const clock = clockAt(1_000)
    const store = new ApprovalStore({ now: clock.now, defaultTtlMs: 100 })
    const record = store.request(request())
    const snapshot = JSON.parse(JSON.stringify(store.toJSON()))
    clock.set(2_000)
    const restored = ApprovalStore.fromJSON(snapshot, { now: clock.now })
    assert.equal(restored.describe(record.id).state, 'expired')
  })

  it('refuses a malformed snapshot with a named error', () => {
    assert.throws(() => ApprovalStore.fromJSON(null, { now: () => 0 }), (error: unknown) => {
      assert.ok(error instanceof ApprovalError)
      assert.equal(error.code, 'approval/invalid-serialization')
      return true
    })
    assert.throws(() => ApprovalStore.fromJSON({ version: 99, records: [] }, { now: () => 0 }), (error: unknown) => {
      assert.ok(error instanceof ApprovalError)
      assert.equal(error.code, 'approval/invalid-serialization')
      return true
    })
    assert.throws(
      () => ApprovalStore.fromJSON({ version: 1, defaultTtlMs: 10, records: [{ id: 'x' }] }, { now: () => 0 }),
      (error: unknown) => error instanceof ApprovalError && error.code === 'approval/invalid-serialization',
    )
  })
})

describe('SEC-09 state carries no secrets', () => {
  it('serialised state contains only the declared fields, even if the caller passes extras', () => {
    const store = new ApprovalStore({ now: () => 1_000, defaultTtlMs: 60_000 })
    const hostile = {
      ...request(),
      token: 'Bearer super-secret-value',
      apiKey: 'sk-secret',
    } as unknown as Parameters<ApprovalStore['request']>[0]
    const record = store.request(hostile)
    const serialized = JSON.stringify(store.toJSON())
    assert.equal(serialized.includes('super-secret-value'), false)
    assert.equal(serialized.includes('sk-secret'), false)
    const allowed = [
      'committedAt', 'decidedAt', 'decidedBy', 'decisionReason', 'expiresAt',
      'id', 'kind', 'operator', 'reason', 'requestedAt', 'scope', 'state',
    ].sort()
    assert.deepEqual(Object.keys(record).sort(), allowed)
  })
})

describe('SEC-09 request-kind coverage', () => {
  it('accepts every required management kind with its admitted scope', () => {
    const required: ApprovalKind[] = [
      'model-enable', 'model-disable', 'model-reset',
      'extension-install', 'extension-activate', 'extension-deactivate', 'extension-uninstall',
      'extension-prepare', 'extension-commit', 'extension-rollback',
      'credential-revoke', 'model-url-change', 'model-provider-change',
    ]
    for (const kind of required) {
      assert.ok(APPROVAL_KINDS.includes(kind), `${kind} must be a supported approval kind`)
      const store = new ApprovalStore({ now: () => 1_000, defaultTtlMs: 60_000 })
      const scope: ApprovalScope = kind === 'credential-revoke'
        ? { kind: 'credential', id: 'client-alpha' }
        : kind.startsWith('extension-')
          ? EXTENSION_SCOPE
          : MODEL_SCOPE
      const record = store.request(request({ kind, scope, reason: `request ${kind}` }))
      assert.equal(record.kind, kind)
      assert.equal(record.state, 'pending')
    }
  })
})
