/**
 * SEC-09 — the approval state machine for management-sensitive changes.
 *
 * A management-sensitive mutation (enabling a model, installing/replacing an
 * extension, revoking a credential, changing a model URL or provider, …) must pass an
 * EXPLICIT operator decision before it happens. This module is the standalone state
 * machine for that flow; it deliberately owns no host wiring and no I/O:
 *
 *   pending ──approve──▶ approved ──commit()──▶ committed   (terminal)
 *      │                     │
 *      ├──deny──▶ denied    └── TTL ──▶ expired              (terminal)
 *      └── TTL ──▶ expired
 *
 * Properties this module guarantees:
 * - **No commit without an approval.** `commit()` on a pending request throws
 *   `approval/pending` SYNCHRONOUSLY; there is no promise to await, so a deployment
 *   with no approval UI fails promptly instead of hanging.
 * - **One-shot commit.** The first successful commit moves the record to
 *   `committed`; every later commit throws `approval/already-committed`.
 * - **Idempotent decisions.** Repeating the SAME decision returns the unchanged
 *   record (including its original decision timestamp); the opposite decision after a
 *   decision is `approval/already-decided`.
 * - **Scope-bound.** The request stores the exact decision scope; a commit must name
 *   exactly that scope. An approval for one extension or one tool cannot authorize
 *   another.
 * - **TTL on an injected clock.** Expiry is evaluated lazily on every read/mutation
 *   against `now()`; tests never depend on wall time.
 * - **Plain-JSON durable-safe state.** Records contain only strings, numbers, nulls,
 *   booleans and one nested scope object. Unknown caller fields are dropped, so a
 *   token or API key passed by mistake is never stored or re-serialized.
 * - **Deterministic ids.** By default the id is a hash of the request content and the
 *   injected request time, so the same request at the same instant has the same id.
 *
 * @module @try-works/dsh-tool-mode/approval
 */

import { createHash } from 'node:crypto'

/** Every management-sensitive request kind this module admits. */
export const APPROVAL_KINDS = [
  'model-enable',
  'model-disable',
  'model-reset',
  'extension-install',
  'extension-activate',
  'extension-deactivate',
  'extension-uninstall',
  'extension-prepare',
  'extension-commit',
  'extension-rollback',
  'credential-revoke',
  'model-url-change',
  'model-provider-change',
] as const

/** The management-sensitive request kind. */
export type ApprovalKind = (typeof APPROVAL_KINDS)[number]

/** The terminal/non-terminal states a record can be in. */
export const APPROVAL_STATES = ['pending', 'approved', 'denied', 'committed', 'expired'] as const

/** One state of an approval record. */
export type ApprovalState = (typeof APPROVAL_STATES)[number]

/** What an approval is scoped to. */
export const APPROVAL_SCOPE_KINDS = ['model', 'extension', 'tool', 'credential', 'provider'] as const

/** The kind of subject an approval covers. */
export type ApprovalScopeKind = (typeof APPROVAL_SCOPE_KINDS)[number]

/** The exact subject an approval covers. */
export interface ApprovalScope {
  /** The subject kind (model, extension, tool, credential or provider). */
  readonly kind: ApprovalScopeKind
  /** The subject identity, for example `@try-works/extension-laya` or `lang_detect`. */
  readonly id: string
}

/** The caller-supplied part of a request. */
export interface ApprovalRequestInput {
  /** What management operation the approval would allow. */
  readonly kind: ApprovalKind
  /** The exact subject the approval is bound to. */
  readonly scope: ApprovalScope
  /** Operator identity recorded with the request (never a secret). */
  readonly operator: string
  /** Why the operator wants the change; recorded verbatim (never a secret). */
  readonly reason: string
  /** Optional lifetime; defaults to the store's `defaultTtlMs`. */
  readonly ttlMs?: number
}

/** One explicit operator decision. */
export interface ApprovalDecision {
  /** `true` approves, `false` denies. */
  readonly approve: boolean
  /** Who decided. */
  readonly decidedBy: string
  /** Optional decision note. */
  readonly reason?: string
}

/** The plain-JSON record every method returns and the snapshot stores. */
export interface ApprovalRecord {
  readonly id: string
  readonly kind: ApprovalKind
  readonly scope: ApprovalScope
  readonly operator: string
  readonly reason: string
  readonly requestedAt: number
  readonly expiresAt: number
  readonly state: ApprovalState
  readonly decidedAt: number | null
  readonly decidedBy: string | null
  readonly decisionReason: string | null
  readonly committedAt: number | null
}

/** The durable snapshot produced by {@link ApprovalStore.toJSON}. */
export interface ApprovalSnapshot {
  readonly version: 1
  readonly defaultTtlMs: number
  readonly records: readonly ApprovalRecord[]
}

/** The call-time dependencies, all injectable for tests. */
export interface ApprovalStoreOptions {
  /** The clock; defaults to `Date.now`. */
  readonly now?: () => number
  /** Lifetime used when a request carries no `ttlMs`; defaults to five minutes. */
  readonly defaultTtlMs?: number
  /** Deterministic id derivation; defaults to a sha256 of the request and time. */
  readonly idFactory?: (input: {
    readonly kind: ApprovalKind
    readonly scope: ApprovalScope
    readonly operator: string
    readonly reason: string
  }, requestedAt: number) => string
}

/** The named refusals this module can raise. */
export type ApprovalErrorCode =
  | 'approval/invalid-request'
  | 'approval/invalid-serialization'
  | 'approval/unknown-id'
  | 'approval/pending'
  | 'approval/denied'
  | 'approval/expired'
  | 'approval/already-decided'
  | 'approval/already-committed'
  | 'approval/scope-mismatch'

/** A refusal with a stable machine-readable code. */
export class ApprovalError extends Error {
  /** The stable refusal code. */
  readonly code: ApprovalErrorCode

  /**
   * @param code - the stable refusal code.
   * @param message - the concrete explanation (the code is prefixed).
   */
  constructor(code: ApprovalErrorCode, message: string) {
    super(`approval/${code.replace(/^approval\//, '')}: ${message}`)
    this.name = 'ApprovalError'
    this.code = code
  }
}

/** The scope kinds each request kind may cover. */
const SCOPE_BY_KIND: Readonly<Record<ApprovalKind, readonly ApprovalScopeKind[]>> = Object.freeze({
  'model-enable': ['model', 'tool'],
  'model-disable': ['model', 'tool'],
  'model-reset': ['model', 'tool'],
  'model-url-change': ['model', 'tool'],
  'model-provider-change': ['model', 'provider', 'tool'],
  'extension-install': ['extension', 'tool'],
  'extension-activate': ['extension', 'tool'],
  'extension-deactivate': ['extension', 'tool'],
  'extension-uninstall': ['extension', 'tool'],
  'extension-prepare': ['extension', 'tool'],
  'extension-commit': ['extension', 'tool'],
  'extension-rollback': ['extension', 'tool'],
  'credential-revoke': ['credential'],
})

/** Five minutes: long enough for an operator, short enough to age out. */
const DEFAULT_TTL_MS = 5 * 60 * 1000
/** Seven days: an absurd TTL is a configuration mistake, not a longer approval. */
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ID_LENGTH = 200
const MAX_OPERATOR_LENGTH = 200
const MAX_REASON_LENGTH = 2000
const MAX_SCOPE_ID_LENGTH = 200
const ID_PATTERN = /^apr_[0-9a-f]{16}$/

/** A plain object (arrays and null excluded). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A finite timestamp. */
function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Trim and bound one required text field. */
function requireText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new ApprovalError('approval/invalid-request', `${field} must be a string`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new ApprovalError('approval/invalid-request', `${field} must not be empty`)
  }
  if (trimmed.length > maxLength) {
    throw new ApprovalError('approval/invalid-request', `${field} must be at most ${String(maxLength)} characters`)
  }
  return trimmed
}

/** Validate and normalise one scope. */
function normalizeScope(value: unknown, field = 'scope'): ApprovalScope {
  if (!isRecord(value)) {
    throw new ApprovalError('approval/invalid-request', `${field} must be an object`)
  }
  const kind = value['kind']
  // SAFETY: the value is a plain string and the membership test below proves it is
  // one of the literal scope kinds before the assertion is reached.
  const scopeKinds: readonly string[] = APPROVAL_SCOPE_KINDS
  if (typeof kind !== 'string' || !scopeKinds.includes(kind)) {
    throw new ApprovalError('approval/invalid-request', `${field}.kind must be one of ${APPROVAL_SCOPE_KINDS.join(', ')}`)
  }
  const id = requireText(value['id'], `${field}.id`, MAX_SCOPE_ID_LENGTH)
  // SAFETY: membership in APPROVAL_SCOPE_KINDS was established immediately above.
  return { kind: kind as ApprovalScopeKind, id }
}

/** Validate one request kind and its scope together. */
function normalizeKindAndScope(kindValue: unknown, scopeValue: unknown) {
  const kind = kindValue
  // SAFETY: the value is a plain string and the membership test below proves it is
  // one of the literal approval kinds before any assertion is reached.
  const approvalKinds: readonly string[] = APPROVAL_KINDS
  if (typeof kind !== 'string' || !approvalKinds.includes(kind)) {
    throw new ApprovalError('approval/invalid-request', `kind must be one of ${APPROVAL_KINDS.join(', ')}`)
  }
  const scope = normalizeScope(scopeValue)
  // SAFETY: membership in APPROVAL_KINDS was established immediately above.
  const permitted = SCOPE_BY_KIND[kind as ApprovalKind]
  if (!permitted.includes(scope.kind)) {
    throw new ApprovalError(
      'approval/invalid-request',
      `${kind} cannot be scoped to ${scope.kind}; permitted scope kinds are ${permitted.join(', ')}`,
    )
  }
  // SAFETY: membership in APPROVAL_KINDS was established immediately above.
  return { kind: kind as ApprovalKind, scope }
}

/** Validate a TTL, or return undefined when absent. */
function normalizeTtl(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!isTimestamp(value) || value <= 0 || value > MAX_TTL_MS) {
    throw new ApprovalError('approval/invalid-request', `ttlMs must be a positive number no greater than ${String(MAX_TTL_MS)}`)
  }
  return Math.floor(value)
}

/** The deterministic default id: request content + request time. */
function defaultIdFactory(
  input: { readonly kind: ApprovalKind; readonly scope: ApprovalScope; readonly operator: string; readonly reason: string },
  requestedAt: number,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([input.kind, input.scope.kind, input.scope.id, input.operator, input.reason, requestedAt]))
    .digest('hex')
  return `apr_${digest.slice(0, 16)}`
}

/** A record whose state fields are internally mutable. */
type MutableRecord = {
  -readonly [Key in keyof ApprovalRecord]: ApprovalRecord[Key]
}

/** Validate a restored record; unknown keys are dropped by construction. */
function restoreRecord(value: unknown, index: number): MutableRecord {
  const where = `records[${String(index)}]`
  if (!isRecord(value)) throw new ApprovalError('approval/invalid-serialization', `${where} must be an object`)
  const id = value['id']
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) {
    throw new ApprovalError('approval/invalid-serialization', `${where}.id must be a non-empty bounded string`)
  }
  const { kind, scope } = (() => {
    try {
      return normalizeKindAndScope(value['kind'], value['scope'])
    } catch (error) {
      throw new ApprovalError('approval/invalid-serialization', `${where} has an invalid kind/scope: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
  const operator = (() => {
    try { return requireText(value['operator'], `${where}.operator`, MAX_OPERATOR_LENGTH) } catch (error) {
      throw new ApprovalError('approval/invalid-serialization', error instanceof Error ? error.message : String(error))
    }
  })()
  const reason = (() => {
    try { return requireText(value['reason'], `${where}.reason`, MAX_REASON_LENGTH) } catch (error) {
      throw new ApprovalError('approval/invalid-serialization', error instanceof Error ? error.message : String(error))
    }
  })()
  const requestedAt = value['requestedAt']
  const expiresAt = value['expiresAt']
  if (!isTimestamp(requestedAt) || !isTimestamp(expiresAt) || expiresAt <= requestedAt) {
    throw new ApprovalError('approval/invalid-serialization', `${where} has invalid timestamps`)
  }
  const state = value['state']
  // SAFETY: the value is a plain string and the membership test below proves it is a
  // declared approval state before the assertion is reached.
  const states: readonly string[] = APPROVAL_STATES
  if (typeof state !== 'string' || !states.includes(state)) {
    throw new ApprovalError('approval/invalid-serialization', `${where}.state must be one of ${APPROVAL_STATES.join(', ')}`)
  }
  const decidedAt = value['decidedAt']
  const decidedBy = value['decidedBy']
  const decisionReason = value['decisionReason']
  const committedAt = value['committedAt']
  if (!(decidedAt === null || isTimestamp(decidedAt))) {
    throw new ApprovalError('approval/invalid-serialization', `${where}.decidedAt must be a timestamp or null`)
  }
  if (!(decidedBy === null || (typeof decidedBy === 'string' && decidedBy.length > 0))) {
    throw new ApprovalError('approval/invalid-serialization', `${where}.decidedBy must be a non-empty string or null`)
  }
  if ((decidedAt === null) !== (decidedBy === null)) {
    throw new ApprovalError('approval/invalid-serialization', `${where} must carry decidedAt and decidedBy together`)
  }
  if (!(decisionReason === null || typeof decisionReason === 'string')) {
    throw new ApprovalError('approval/invalid-serialization', `${where}.decisionReason must be a string or null`)
  }
  if (!(committedAt === null || isTimestamp(committedAt))) {
    throw new ApprovalError('approval/invalid-serialization', `${where}.committedAt must be a timestamp or null`)
  }
  if (state === 'committed' && committedAt === null) {
    throw new ApprovalError('approval/invalid-serialization', `${where} is committed without a commit time`)
  }
  if (state !== 'committed' && committedAt !== null) {
    throw new ApprovalError('approval/invalid-serialization', `${where} has a commit time but is not committed`)
  }
  if ((state === 'approved' || state === 'denied' || state === 'committed') && decidedAt === null) {
    throw new ApprovalError('approval/invalid-serialization', `${where} is ${state} without a decision`)
  }
  if (state === 'pending' && decidedAt !== null) {
    throw new ApprovalError('approval/invalid-serialization', `${where} is pending but already has a decision`)
  }
  // SAFETY: membership in APPROVAL_STATES was established above; the state-dependent
  // invariants below are checked before this record is returned.
  return {
    id,
    kind,
    scope,
    operator,
    reason,
    requestedAt,
    expiresAt,
    state: state as ApprovalState,
    decidedAt,
    decidedBy,
    decisionReason,
    committedAt,
  }
}

/**
 * The in-memory approval store. One instance per host process, restored from its
 * snapshot at boot (see the wiring contract in the task report).
 */
export class ApprovalStore {
  readonly #now: () => number
  readonly #defaultTtlMs: number
  readonly #idFactory: NonNullable<ApprovalStoreOptions['idFactory']>
  readonly #records = new Map<string, MutableRecord>()

  /**
   * @param options - clock, default TTL and id derivation (all injectable).
   */
  constructor(options: ApprovalStoreOptions = {}) {
    const now = options.now ?? Date.now
    if (typeof now !== 'function') throw new ApprovalError('approval/invalid-request', 'now must be a function')
    this.#now = now
    const ttl = options.defaultTtlMs ?? DEFAULT_TTL_MS
    if (!isTimestamp(ttl) || ttl <= 0 || ttl > MAX_TTL_MS) {
      throw new ApprovalError('approval/invalid-request', `defaultTtlMs must be positive and no greater than ${String(MAX_TTL_MS)}`)
    }
    this.#defaultTtlMs = Math.floor(ttl)
    this.#idFactory = options.idFactory ?? defaultIdFactory
  }

  /** The default lifetime new requests receive. */
  get defaultTtlMs(): number {
    return this.#defaultTtlMs
  }

  /**
   * Record a pending request.
   *
   * A repeated request (same content at the same injected instant) returns the
   * EXISTING record rather than resetting its TTL or decision.
   * @param input - the request facts (kind, scope, operator, reason, optional TTL).
   * @returns the pending record (a plain-JSON copy).
   */
  request(input: ApprovalRequestInput): ApprovalRecord {
    if (!isRecord(input)) throw new ApprovalError('approval/invalid-request', 'a request must be an object')
    const { kind, scope } = normalizeKindAndScope(input.kind, input.scope)
    const operator = requireText(input.operator, 'operator', MAX_OPERATOR_LENGTH)
    const reason = requireText(input.reason, 'reason', MAX_REASON_LENGTH)
    const ttl = normalizeTtl(input.ttlMs) ?? this.#defaultTtlMs
    const requestedAt = this.#now()
    if (!isTimestamp(requestedAt)) throw new ApprovalError('approval/invalid-request', 'now() must return a finite timestamp')
    const id = this.#idFactory({ kind, scope, operator, reason }, requestedAt)
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) {
      throw new ApprovalError('approval/invalid-request', 'the id factory must return a non-empty bounded string')
    }
    const existing = this.#records.get(id)
    if (existing !== undefined) return this.#view(existing)
    const record: MutableRecord = {
      id,
      kind,
      scope,
      operator,
      reason,
      requestedAt,
      expiresAt: requestedAt + ttl,
      state: 'pending',
      decidedAt: null,
      decidedBy: null,
      decisionReason: null,
      committedAt: null,
    }
    this.#records.set(id, record)
    return this.#view(record)
  }

  /**
   * Read one record, applying lazy TTL expiry.
   * @param id - the approval id.
   * @returns the record (a plain-JSON copy).
   */
  describe(id: string): ApprovalRecord {
    return this.#view(this.#require(id))
  }

  /** Every record, oldest first (expiry applied). */
  list(): readonly ApprovalRecord[] {
    return [...this.#records.values()]
      .map(record => this.#view(record))
      .sort((left, right) => left.requestedAt - right.requestedAt || left.id.localeCompare(right.id))
  }

  /**
   * Apply an explicit operator decision.
   *
   * Repeating the SAME decision is idempotent and returns the unchanged record; the
   * opposite decision after a decision is `approval/already-decided`.
   * @param id - the approval id.
   * @param decision - approve/deny, the decider and an optional note.
   * @returns the decided record.
   */
  decide(id: string, decision: ApprovalDecision): ApprovalRecord {
    const record = this.#require(id)
    this.#expire(record)
    if (!isRecord(decision) || typeof decision.approve !== 'boolean') {
      throw new ApprovalError('approval/invalid-request', 'a decision must carry a boolean approve')
    }
    if (record.state === 'expired') {
      throw new ApprovalError('approval/expired', `request ${record.id} expired at ${String(record.expiresAt)}; it cannot be decided`)
    }
    if (record.state === 'committed') {
      throw new ApprovalError('approval/already-committed', `request ${record.id} was already committed at ${String(record.committedAt)}; it cannot be decided`)
    }
    const wanted: ApprovalState = decision.approve ? 'approved' : 'denied'
    if (record.state === wanted) return this.#copy(record)
    if (record.state === 'approved' || record.state === 'denied') {
      throw new ApprovalError(
        'approval/already-decided',
        `request ${record.id} is already ${record.state}; the opposite decision is refused`,
      )
    }
    const decidedBy = requireText(decision.decidedBy, 'decidedBy', MAX_OPERATOR_LENGTH)
    const decisionReason = decision.reason === undefined ? null : requireText(decision.reason, 'decision reason', MAX_REASON_LENGTH)
    const decidedAt = this.#now()
    if (!isTimestamp(decidedAt)) throw new ApprovalError('approval/invalid-request', 'now() must return a finite timestamp')
    record.state = wanted
    record.decidedAt = decidedAt
    record.decidedBy = decidedBy
    record.decisionReason = decisionReason
    return this.#copy(record)
  }

  /**
   * Consume an approved request for exactly its recorded scope.
   *
   * One-shot: the first successful call commits; every later call (and any call on a
   * pending, denied or expired record) throws a named error WITHOUT waiting.
   * @param id - the approval id.
   * @param scope - the exact subject the caller is about to mutate.
   * @returns the committed record.
   */
  commit(id: string, scope: ApprovalScope): ApprovalRecord {
    const record = this.#require(id)
    this.#expire(record)
    if (record.state === 'pending') {
      throw new ApprovalError('approval/pending', `request ${record.id} is pending; no operator has approved it`)
    }
    if (record.state === 'denied') {
      throw new ApprovalError('approval/denied', `request ${record.id} was denied by ${String(record.decidedBy)}`)
    }
    if (record.state === 'expired') {
      throw new ApprovalError('approval/expired', `request ${record.id} expired at ${String(record.expiresAt)}; it cannot be committed`)
    }
    if (record.state === 'committed') {
      throw new ApprovalError('approval/already-committed', `request ${record.id} was already committed at ${String(record.committedAt)}`)
    }
    const requested = normalizeScope(scope, 'commit scope')
    if (requested.kind !== record.scope.kind || requested.id !== record.scope.id) {
      throw new ApprovalError(
        'approval/scope-mismatch',
        `request ${record.id} is approved for ${record.scope.kind} ${record.scope.id}, not ${requested.kind} ${requested.id}`,
      )
    }
    const committedAt = this.#now()
    if (!isTimestamp(committedAt)) throw new ApprovalError('approval/invalid-request', 'now() must return a finite timestamp')
    record.state = 'committed'
    record.committedAt = committedAt
    return this.#copy(record)
  }

  /**
   * The durable snapshot. Only the declared fields are serialized, so a caller that
   * passed a token by mistake cannot leak it through this channel.
   * @returns a plain-JSON snapshot.
   */
  toJSON(): ApprovalSnapshot {
    return {
      version: 1,
      defaultTtlMs: this.#defaultTtlMs,
      records: this.list().map(record => this.#copy(record)),
    }
  }

  /**
   * Restore a store from {@link toJSON} output.
   * @param value - the parsed snapshot.
   * @param options - clock, optional TTL override and optional id factory.
   * @returns the restored store.
   */
  static fromJSON(value: unknown, options: ApprovalStoreOptions = {}): ApprovalStore {
    if (!isRecord(value)) {
      throw new ApprovalError('approval/invalid-serialization', 'snapshot must be an object with version 1 and a records array')
    }
    const version = value['version']
    const rawRecords = value['records']
    const snapshotTtl = value['defaultTtlMs']
    if (version !== 1 || !Array.isArray(rawRecords)) {
      throw new ApprovalError('approval/invalid-serialization', 'snapshot must be an object with version 1 and a records array')
    }
    if (!isTimestamp(snapshotTtl) || snapshotTtl <= 0 || snapshotTtl > MAX_TTL_MS) {
      throw new ApprovalError('approval/invalid-serialization', 'snapshot defaultTtlMs must be a valid TTL')
    }
    let store: ApprovalStore
    try {
      store = new ApprovalStore({ ...options, defaultTtlMs: options.defaultTtlMs ?? snapshotTtl })
    } catch (error) {
      throw new ApprovalError('approval/invalid-serialization', error instanceof Error ? error.message : String(error))
    }
    for (const [index, raw] of rawRecords.entries()) {
      const record = restoreRecord(raw, index)
      if (store.#records.has(record.id)) {
        throw new ApprovalError('approval/invalid-serialization', `duplicate record id ${record.id}`)
      }
      store.#records.set(record.id, record)
    }
    return store
  }

  /** Look up a record or throw the named unknown-id refusal. */
  #require(id: string): MutableRecord {
    if (typeof id !== 'string' || id.length === 0) {
      throw new ApprovalError('approval/invalid-request', 'an approval id must be a non-empty string')
    }
    const record = this.#records.get(id)
    if (record === undefined) throw new ApprovalError('approval/unknown-id', `no approval record has id ${id}`)
    return record
  }

  /** Apply lazy TTL expiry to pending/approved records. */
  #expire(record: MutableRecord): void {
    if (record.state !== 'pending' && record.state !== 'approved') return
    const now = this.#now()
    if (isTimestamp(now) && now >= record.expiresAt) record.state = 'expired'
  }

  /** A plain-JSON view, with expiry applied. */
  #view(record: MutableRecord): ApprovalRecord {
    this.#expire(record)
    return this.#copy(record)
  }

  /** A deep, plain-JSON copy of one record. */
  #copy(record: MutableRecord): ApprovalRecord {
    return {
      id: record.id,
      kind: record.kind,
      scope: { kind: record.scope.kind, id: record.scope.id },
      operator: record.operator,
      reason: record.reason,
      requestedAt: record.requestedAt,
      expiresAt: record.expiresAt,
      state: record.state,
      decidedAt: record.decidedAt,
      decidedBy: record.decidedBy,
      decisionReason: record.decisionReason,
      committedAt: record.committedAt,
    }
  }
}

/** Whether a restored/default id has the module's deterministic shape. */
export function isDeterministicApprovalId(id: unknown): boolean {
  return typeof id === 'string' && ID_PATTERN.test(id)
}
