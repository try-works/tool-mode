/**
 * Slice 4 — SEC-09 approvals wired into a management mutation.
 *
 * The defect these tests pin: `src/approval.ts` is a complete state machine with ZERO
 * production importers, and a management mutation applies immediately. The chosen
 * mutation is extension ACTIVATION (`extension-activate`): it is the narrowest write
 * that changes what a caller can reach, and it needs only an installed package.
 *
 * The contract under test, once wired:
 * - with an ApprovalStore mounted, `enable()` records a PENDING approval and mutates
 *   nothing; a caller that never approves is refused promptly (no awaiting a UI);
 * - `requestApproval` → `decideApproval(approve)` → `commitApproval(id, extensionId)`
 *   applies the mutation exactly once; a second commit is `approval/already-committed`
 *   and does not activate twice;
 * - an approval for one extension cannot commit another (`approval/scope-mismatch`);
 * - denied and expired requests refuse with their named codes and no mutation.
 *
 * Compatibility: a service constructed WITHOUT an approvals seam keeps today's direct
 * management path, which is the documented pre-approved/legacy composition. That is
 * why the existing extension-service suite stays valid.
 *
 * RED STATE: these tests are written before the wiring. `approvals` is not yet an
 * option, and the service exposes no approval methods, so they fail (the first test
 * fails because `enable()` currently mutates instead of refusing).
 */

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  ExtensionLifecycle,
  ExtensionStore,
  stagedInstallFromDirectory,
  type ContributionRegistrar,
} from '@try-works/tool-mode-extension-sdk'

import { ApprovalError, ApprovalStore } from '../src/approval.ts'
import { createExtensionsService, ExtensionsServiceError } from '../src/extensions-service.ts'
import { cleanup, tempDir } from './helpers.ts'

after(async () => { await cleanup() })

const FIXTURE_DIR = join(process.cwd(), 'packages', 'dsh-tool-mode', 'tests', 'fixtures', 'extensions-service-extension')
const EXTENSION_ID = '@try-works/fixture-ext-service'
/** A different subject: an approval for EXTENSION_ID must never authorize this one. */
const OTHER_ID = '@try-works/fixture-other'
const OPERATOR = 'operator'
const REASON = 'activate the fixture for the approval-wiring integration test'
const APPROVAL_KIND = 'extension-activate' as const

/** An in-memory registrar, so activation publishes without a host registry. */
function recordingRegistrar(): ContributionRegistrar {
  let next = 0
  return {
    publish() {
      return `handle-${++next}`
    },
    withdraw() {},
  }
}

/** A real lifecycle over a real store, with no host registry attached. */
function lifecycleFor(storeDir: string): ExtensionLifecycle {
  return new ExtensionLifecycle({ store: new ExtensionStore(storeDir), profile: 'default', registrar: recordingRegistrar() })
}

/** Install the fixture through the real directory installer (no activation). */
async function installedStore(): Promise<string> {
  const storeDir = tempDir()
  await stagedInstallFromDirectory({ sourceDir: FIXTURE_DIR, storeDir, allowSourceDirectories: true })
  return storeDir
}

/** The service with the approval seam mounted (the seam this slice introduces). */
function serviceWithApprovals(
  storeDir: string,
  lifecycle: ExtensionLifecycle,
  approvals: ApprovalStore,
) {
  return createExtensionsService({
    storeDir,
    lifecycle: () => lifecycle,
    approvals: () => approvals,
  })
}

/** The pending request facts every test uses, unless it needs another subject. */
function requestInput(extensionId = EXTENSION_ID) {
  return {
    kind: APPROVAL_KIND,
    scope: { kind: 'extension' as const, id: extensionId },
    operator: OPERATOR,
    reason: REASON,
  }
}

/**
 * Await a refusal and return it.
 *
 * `assert.rejects` resolves to `void`, so a test that needs the message must catch the
 * error itself; the predicate keeps each expectation explicit.
 * @param promise - the call expected to refuse.
 * @param check - whether the caught value is the expected named refusal.
 * @param expected - the expectation, for the failure message.
 * @returns the refusal.
 */
async function refusal(
  promise: Promise<unknown>,
  check: (candidate: unknown) => boolean,
  expected: string,
): Promise<Error> {
  try {
    await promise
  } catch (error) {
    if (!check(error)) assert.fail(`expected ${expected}, got ${String(error)}`)
    assert.ok(error instanceof Error, `expected an Error, got ${String(error)}`)
    return error
  }
  assert.fail(`expected ${expected}; the call resolved`)
}

describe('Slice 4 — an unapproved activation is refused promptly, with a pending record', () => {
  it('enable() records a pending approval and mutates nothing', async () => {
    const storeDir = await installedStore()
    const lifecycle = lifecycleFor(storeDir)
    const approvals = new ApprovalStore()
    const service = serviceWithApprovals(storeDir, lifecycle, approvals)

    const error = await refusal(
      service.enable(EXTENSION_ID),
      candidate => candidate instanceof ExtensionsServiceError && /approval\/pending/.test(candidate.message),
      'a named approval/pending refusal',
    )
    assert.match(error.message, /approval\/pending/)

    // The approval EXISTS, scoped to this activation, and is still pending.
    const records = approvals.list()
    assert.equal(records.length, 1)
    assert.equal(records[0]?.kind, APPROVAL_KIND)
    assert.deepEqual(records[0]?.scope, { kind: 'extension', id: EXTENSION_ID })
    assert.equal(records[0]?.state, 'pending')

    // Nothing was activated: no lifecycle state, and the row is still inactive.
    assert.equal(lifecycle.stateOf(EXTENSION_ID), undefined)
    const row = (await service.describe()).extensions.find(candidate => candidate.id === EXTENSION_ID)
    assert.equal(row?.active, false)
  })

  it('a caller that never approves fails promptly instead of hanging', async () => {
    const storeDir = await installedStore()
    const lifecycle = lifecycleFor(storeDir)
    const service = serviceWithApprovals(storeDir, lifecycle, new ApprovalStore())

    /**
     * The race is the assertion: a design that WAITED for an operator decision would
     * never settle here, and 250 ms is far longer than the synchronous refusal needs.
     */
    const outcome = await Promise.race([
      service.enable(EXTENSION_ID).then(
        () => 'resolved' as const,
        (candidate: unknown) => candidate instanceof ExtensionsServiceError ? 'refused' as const : 'other-error' as const,
      ),
      new Promise<'hung'>(resolve => { setTimeout(() => resolve('hung'), 250) }),
    ])
    assert.equal(outcome, 'refused')
    assert.equal(lifecycle.stateOf(EXTENSION_ID), undefined)
  })
})

describe('Slice 4 — approve then commit applies exactly once', () => {
  it('commits the approved activation once, and a second commit is refused without a second activation', async () => {
    const storeDir = await installedStore()
    const lifecycle = lifecycleFor(storeDir)
    const approvals = new ApprovalStore()
    const service = serviceWithApprovals(storeDir, lifecycle, approvals)

    const requested = service.requestApproval(requestInput())
    assert.equal(requested.state, 'pending')
    const approved = service.decideApproval(requested.id, { approve: true, decidedBy: OPERATOR })
    assert.equal(approved.state, 'approved')

    const generationBefore = lifecycle.generation
    const first = await service.commitApproval(requested.id, EXTENSION_ID)
    assert.deepEqual(first, { id: EXTENSION_ID, active: true, disabled: false })
    assert.equal(lifecycle.stateOf(EXTENSION_ID)?.observedActivation, 'active')
    // The generation starts at 1 in the SDK; exactly-once means one ADVANCE, not
    // one absolute value.
    assert.equal(lifecycle.generation, generationBefore + 1)

    const second = await refusal(
      service.commitApproval(requested.id, EXTENSION_ID),
      candidate => candidate instanceof ApprovalError && candidate.code === 'approval/already-committed',
      'approval/already-committed',
    )
    assert.match(second.message, /already committed/)
    assert.equal(lifecycle.generation, generationBefore + 1, 'a replayed commit must not activate a second time')
    assert.equal(approvals.describe(requested.id).state, 'committed')
  })

  it('an approval for one extension cannot commit another', async () => {
    const storeDir = await installedStore()
    const lifecycle = lifecycleFor(storeDir)
    const approvals = new ApprovalStore()
    const service = serviceWithApprovals(storeDir, lifecycle, approvals)

    const requested = service.requestApproval(requestInput())
    service.decideApproval(requested.id, { approve: true, decidedBy: OPERATOR })

    const error = await refusal(
      service.commitApproval(requested.id, OTHER_ID),
      candidate => candidate instanceof ApprovalError && candidate.code === 'approval/scope-mismatch',
      'approval/scope-mismatch',
    )
    assert.match(error.message, /approved for extension @try-works\/fixture-ext-service/)
    // The refusal happens BEFORE any mutation and does not consume the approval.
    assert.equal(approvals.describe(requested.id).state, 'approved')
    assert.equal(lifecycle.stateOf(EXTENSION_ID), undefined, 'the approved subject must not be activated by a mismatched commit')
  })
})

describe('Slice 4 — denied and expired requests refuse with their named codes', () => {
  it('a denied request cannot commit and does not mutate', async () => {
    const storeDir = await installedStore()
    const lifecycle = lifecycleFor(storeDir)
    const approvals = new ApprovalStore()
    const service = serviceWithApprovals(storeDir, lifecycle, approvals)

    const requested = service.requestApproval(requestInput())
    const denied = service.decideApproval(requested.id, { approve: false, decidedBy: OPERATOR, reason: 'not now' })
    assert.equal(denied.state, 'denied')

    const error = await refusal(
      service.commitApproval(requested.id, EXTENSION_ID),
      candidate => candidate instanceof ApprovalError && candidate.code === 'approval/denied',
      'approval/denied',
    )
    assert.match(error.message, /denied by operator/)
    assert.equal(lifecycle.stateOf(EXTENSION_ID), undefined)
  })

  it('an expired request cannot commit and does not mutate', async () => {
    const storeDir = await installedStore()
    const lifecycle = lifecycleFor(storeDir)
    let now = 1_000
    const approvals = new ApprovalStore({ now: () => now, defaultTtlMs: 100 })
    const service = serviceWithApprovals(storeDir, lifecycle, approvals)

    const requested = service.requestApproval({ ...requestInput(), ttlMs: 10 })
    service.decideApproval(requested.id, { approve: true, decidedBy: OPERATOR })
    now += 11

    const error = await refusal(
      service.commitApproval(requested.id, EXTENSION_ID),
      candidate => candidate instanceof ApprovalError && candidate.code === 'approval/expired',
      'approval/expired',
    )
    assert.match(error.message, /expired at/)
    assert.equal(lifecycle.stateOf(EXTENSION_ID), undefined)
  })
})
