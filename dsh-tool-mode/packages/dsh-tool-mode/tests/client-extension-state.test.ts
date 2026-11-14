/**
 * The extension-state read path: coalescing, TTL reuse and explicit invalidation.
 *
 * The page issues describeExtensions() from four places (mount, Recheck, the
 * post-action re-read and its bounded follow-up) and each call round-trips the
 * host's describe, which can take minutes on a large store. This exercises the
 * SHIPPED bundle (like plugin-package.test.ts): the helper behaviour is what the
 * page actually runs, and a template marker alone cannot prove it.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const PACKAGE_DIR = join(process.cwd(), 'packages', 'dsh-tool-mode')
const BUNDLE = join(PACKAGE_DIR, 'client', 'index.js')
const TEMPLATE = join(PACKAGE_DIR, 'client', 'index.template.js')

/** A normalized describe() snapshot, as normalizeDescribe returns it. */
interface Snapshot {
  readonly store: string | null
  readonly writable: boolean
  readonly extensions: readonly unknown[]
}

/** The host namespace this page reads; describe() is the slow host round-trip. */
interface FakeNamespace {
  describe: () => Promise<Snapshot>
  calls: number
}

/** The client bundle's require surface: only 'react' is requested. */
interface ReactStub {
  createElement: () => null
  useState: () => [null, () => void]
  useEffect: () => void
}

/** The internals this test needs, as the bundle exposes them. */
interface Internals {
  readonly describeExtensions?: (namespace: FakeNamespace) => Promise<Snapshot>
  readonly invalidateExtensionState?: (namespace: FakeNamespace) => void
  readonly REMOTE_SNAPSHOT_TTL_MS?: number
}

/** The bundle's exported module, typed only as far as this test reads it. */
interface BundleExports {
  readonly __internals: Internals
}

/** One registration the loader captures. */
interface Registration {
  factory: (request: (id: string) => ReactStub) => BundleExports
}

/** A namespace whose describe() counts host calls and can be gated or failed. */
function countingNamespace(answer: () => Promise<Snapshot>): FakeNamespace {
  const namespace: FakeNamespace = {
    calls: 0,
    async describe() {
      namespace.calls += 1
      return answer()
    },
  }
  return namespace
}

/** A namespace that answers one fixed snapshot. */
function fixedNamespace(snapshot: Snapshot): FakeNamespace {
  return countingNamespace(async () => snapshot)
}

/** Load the generated bundle the way the web shell does. */
function loadInternals(): Internals {
  const source = readFileSync(BUNDLE, 'utf8')
  let registration: Registration | undefined
  const window = { __ModuleLoader__: { load(value: Registration) { registration = value } } }
  const react: ReactStub = {
    createElement: () => null,
    useState: () => [null, () => {}],
    useEffect: () => {},
  }
  const request = (id: string): ReactStub => {
    assert.equal(id, 'react', 'the client bundle may require only "react"')
    return react
  }
  new Function('window', 'require', source)(window, request)
  assert.ok(registration !== undefined, 'the client bundle must register through __ModuleLoader__.load')
  return registration.factory(request).__internals
}

/** The describe function, with its presence checked. */
function describeOf(internals: Internals): (namespace: FakeNamespace) => Promise<Snapshot> {
  const describe = internals.describeExtensions
  assert.equal(typeof describe, 'function', 'the bundle must expose describeExtensions')
  assert.ok(describe !== undefined)
  return describe
}

/** The invalidation function, with its presence checked. */
function invalidateOf(internals: Internals): (namespace: FakeNamespace) => void {
  const invalidate = internals.invalidateExtensionState
  assert.equal(typeof invalidate, 'function', 'the bundle must expose invalidateExtensionState')
  assert.ok(invalidate !== undefined)
  return invalidate
}

const SNAPSHOT: Snapshot = { store: 'store-1', writable: true, extensions: [{ id: 'ext-1' }] }

test('two concurrent reads share ONE in-flight host call', async () => {
  const internals = loadInternals()
  const describe = describeOf(internals)
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  const namespace = countingNamespace(async () => {
    await gate
    return SNAPSHOT
  })
  const first = describe(namespace)
  const second = describe(namespace)
  assert.ok(release !== undefined, 'the gate must be armed before releasing it')
  release()
  const [a, b] = await Promise.all([first, second])
  assert.equal(namespace.calls, 1, 'two concurrent reads must collapse to one host call')
  assert.deepEqual(a, SNAPSHOT)
  assert.deepEqual(b, SNAPSHOT)
})

test('a second read within the TTL is served from the snapshot', async () => {
  const internals = loadInternals()
  const describe = describeOf(internals)
  const namespace = fixedNamespace(SNAPSHOT)
  assert.deepEqual(await describe(namespace), SNAPSHOT)
  assert.deepEqual(await describe(namespace), SNAPSHOT)
  assert.equal(namespace.calls, 1, 'a fresh snapshot must be reused inside the TTL')
  assert.equal(internals.REMOTE_SNAPSHOT_TTL_MS, 5000, 'the TTL is the documented five seconds')
})

test('an explicit invalidation forces the next read to the host', async () => {
  const internals = loadInternals()
  const describe = describeOf(internals)
  const invalidate = invalidateOf(internals)
  const namespace = fixedNamespace(SNAPSHOT)
  await describe(namespace)
  invalidate(namespace)
  await describe(namespace)
  assert.equal(namespace.calls, 2, 'a post-action read must not be served from the stale snapshot')
})

test('a rejection clears the in-flight entry so a retry works', async () => {
  const internals = loadInternals()
  const describe = describeOf(internals)
  let failing = true
  const namespace = countingNamespace(async () => {
    if (failing) throw new Error('host describe failed')
    return SNAPSHOT
  })
  await assert.rejects(describe(namespace), /host describe failed/)
  failing = false
  assert.deepEqual(await describe(namespace), SNAPSHOT)
  assert.equal(namespace.calls, 2, 'the failed call must not be cached as an answer')
})

test('namespaces do not share an in-flight read or a snapshot', async () => {
  const internals = loadInternals()
  const describe = describeOf(internals)
  const first = fixedNamespace(SNAPSHOT)
  const second = fixedNamespace({ store: 'store-2', writable: false, extensions: [] })
  const [a, b] = await Promise.all([describe(first), describe(second)])
  assert.equal(first.calls, 1)
  assert.equal(second.calls, 1)
  assert.equal(a.store, 'store-1')
  assert.equal(b.store, 'store-2')
})

test('the generated bundle inlines the coalescing layer (no chunk fetch)', () => {
  const bundle = readFileSync(BUNDLE, 'utf8')
  assert.ok(bundle.includes('function describeExtensions'), 'the bundle must carry the coalesced read')
  assert.ok(bundle.includes('function invalidateExtensionState'), 'the bundle must carry the invalidation hook')
  assert.ok(bundle.includes('REMOTE_SNAPSHOT_TTL_MS'), 'the bundle must carry the TTL')
})

test('the template invalidates at every post-action and Recheck re-read', () => {
  const template = readFileSync(TEMPLATE, 'utf8')
  const calls = template.split('invalidateExtensionState(').length - 1
  // One is the definition; the other four are Recheck, the post-action re-read,
  // its 500 ms settle re-read (namespace: settled) and the failure-path re-read.
  assert.ok(calls >= 5, 'expected the definition plus four invalidation sites, found ' + calls)
})
