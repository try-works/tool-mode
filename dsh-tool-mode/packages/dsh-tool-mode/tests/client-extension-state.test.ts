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
  /** The stable Remote service key, when the namespace exposes one. */
  serviceKey?: string
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
function countingNamespace(answer: () => Promise<Snapshot>, serviceKey?: string): FakeNamespace {
  const namespace: FakeNamespace = {
    calls: 0,
    async describe() {
      namespace.calls += 1
      return answer()
    },
    ...serviceKey === undefined ? {} : { serviceKey },
  }
  return namespace
}

/** A namespace that answers one fixed snapshot. */
function fixedNamespace(snapshot: Snapshot, serviceKey?: string): FakeNamespace {
  return countingNamespace(async () => snapshot, serviceKey)
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
  assert.equal(internals.REMOTE_SNAPSHOT_TTL_MS, 300000, 'the TTL is the documented five minutes')
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

test('a snapshot outlives the old five-second window (Settings reopened a minute later)', async () => {
  const internals = loadInternals()
  const describe = describeOf(internals)
  const namespace = fixedNamespace(SNAPSHOT)
  const realNow = Date.now
  let now = 1_000
  Date.now = () => now
  try {
    await describe(namespace)
    now += 60_000
    assert.deepEqual(await describe(namespace), SNAPSHOT)
    assert.equal(namespace.calls, 1, 'reopening inside the five-minute window must not read the host again')
  } finally {
    Date.now = realNow
  }
})

test('a fresh namespace object reuses the snapshot through its service key (remount)', async () => {
  const internals = loadInternals()
  const describe = describeOf(internals)
  const first = fixedNamespace(SNAPSHOT, 'modelTools')
  const second = fixedNamespace(SNAPSHOT, 'modelTools')
  await describe(first)
  await describe(second)
  assert.equal(first.calls, 1)
  assert.equal(second.calls, 0, 'the page mounting a fresh proxy must hit the cache, not the host')
})

test('a stale snapshot is served immediately and refreshed in the background', async () => {
  const internals = loadInternals()
  const describe = describeOf(internals)
  const refreshed: Snapshot = { store: 'store-1', writable: true, extensions: [{ id: 'ext-2' }] }
  let answer = SNAPSHOT
  const namespace = countingNamespace(async () => answer)
  const realNow = Date.now
  let now = 1_000
  Date.now = () => now
  try {
    await describe(namespace)
    answer = refreshed
    now += internals.REMOTE_SNAPSHOT_TTL_MS! + 1
    // The stale answer comes back without waiting for the host...
    assert.deepEqual(await describe(namespace), SNAPSHOT)
    // ...and the background read updates the cache for the next open.
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(namespace.calls, 2, 'the stale read must have started one background refresh')
    assert.deepEqual(await describe(namespace), refreshed)
    assert.equal(namespace.calls, 2, 'the refreshed snapshot must be served without another host call')
  } finally {
    Date.now = realNow
  }
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

test('a config toggle commits immediately instead of waiting for Save', () => {
  const template = readFileSync(TEMPLATE, 'utf8')
  const bundle = readFileSync(BUNDLE, 'utf8')
  for (const [name, source] of [['template', template], ['bundle', bundle]] as const) {
    assert.match(source, /const saveToggle = async/, name + ' must carry the immediate toggle commit')
    assert.match(
      source,
      /field\.kind === 'toggle' \? saveToggle : edit/,
      name + ' must route toggle fields through the immediate commit',
    )
    assert.match(source, /await form\.set\(key, next\)/, name + ' must write the toggle value to the host form')
  }
})

test('installing an extension prepares and enables it automatically', () => {
  const template = readFileSync(TEMPLATE, 'utf8')
  const bundle = readFileSync(BUNDLE, 'utf8')
  for (const [name, source] of [['template', template], ['bundle', bundle]] as const) {
    assert.match(source, /const followThroughInstall = async/, name + ' must carry the install follow-through')
    assert.match(source, /await followThroughInstall\(namespace, id\)/, name + ' must run it after install')
    const start = source.indexOf('const followThroughInstall = async')
    assert.ok(start >= 0)
    const body = source.slice(start, start + 2400)
    const enableAt = body.indexOf("action: 'enable'")
    const prepareAt = body.indexOf("action: 'prepare'")
    assert.ok(enableAt >= 0, name + ' must activate the extension')
    assert.ok(prepareAt >= 0, name + ' must prepare its assets when the host says so')
    assert.ok(prepareAt < enableAt, name + ' must prepare before activation')
    assert.match(body, /extensionNeedsPreparation\(state\)/, name + ' must prepare only when readiness names it')
  }
})

test('one row’s action does not disable the rest of the extension page', () => {
  const template = readFileSync(TEMPLATE, 'utf8')
  const bundle = readFileSync(BUNDLE, 'utf8')
  const scoped = /busy: extBusy && extPending !== null && extPending\.id === entry\.id/
  for (const [name, source] of [['template', template], ['bundle', bundle]] as const) {
    assert.match(source, scoped, name + ' must scope the busy state to the acting row')
    assert.ok(!/busy: extBusy,/.test(source), name + ' must not disable every row while one action runs')
  }
})

test('the template invalidates at every post-action and Recheck re-read', () => {
  const template = readFileSync(TEMPLATE, 'utf8')
  const calls = template.split('invalidateExtensionState(').length - 1
  // One is the definition; the other four are Recheck, the post-action re-read,
  // its 500 ms settle re-read (namespace: settled) and the failure-path re-read.
  assert.ok(calls >= 5, 'expected the definition plus four invalidation sites, found ' + calls)
})
