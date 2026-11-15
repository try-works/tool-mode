/**
 * The Settings page must paint its STATIC inventory immediately and never hang
 * on the host extension-state read.
 *
 * The bundle is loaded the way the shell loads it, and the pure helpers are
 * asserted directly: kind -> view copy, synchronous persisted seeding, the
 * bounded read, and a static render while the host has not answered.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const BUNDLE = join(process.cwd(), 'packages', 'dsh-tool-mode', 'client', 'index.js')

/** One extRemote value as the page carries it. */
interface RemoteValue {
  readonly kind?: string
  readonly text?: string
  readonly store?: string | null
  readonly writable?: boolean
  readonly extensions?: readonly unknown[]
  readonly namespace?: unknown
}

/** The derived view of one extRemote value. */
interface RemoteView {
  checking: boolean
  note: string | null
  actionEnabled: boolean
  canRetry: boolean
}

/** The subset of localStorage the seeding helper reads. */
interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Props the render stub reads back. */
interface ElementProps {
  className?: string
  disabled?: boolean
  type?: string
  title?: string
  role?: string
  'aria-pressed'?: boolean
  'aria-busy'?: boolean
  'data-on'?: string
  onClick?: () => void
  key?: string
}

/** One element the stub built. */
interface ElementNode {
  type: unknown
  props: ElementProps
  children: RenderChild[]
}

/** Anything a stub element may contain. */
type RenderChild = string | number | boolean | null | undefined | ElementNode | readonly RenderChild[]

/** The form snapshot the page reads. */
interface PageSnapshot {
  status: string
  writable: boolean
  value: { readonly exclude?: readonly string[] }
}

/** The config draft the page keeps: field key -> a pending string value. */
interface DraftState {
  readonly [field: string]: string | undefined
}

/** One in-flight action label per extension id. */
interface PendingState {
  readonly [extensionId: string]: string
}

/** One per-row action error. */
interface RowState {
  readonly id: string
  readonly text: string
}

/** The page state queue: one value per useState call, in declaration order. */
type PageState = PageSnapshot | DraftState | null | RemoteValue | PendingState | RowState

/** The React surface the page factory needs. */
interface ReactStub {
  createElement: (type: string, props?: ElementProps | null, ...children: RenderChild[]) => ElementNode
  useState: (initial: PageState) => [PageState, (next: PageState) => void]
  useEffect: () => void
}

/** The form the page reads. */
interface FormStub {
  getSnapshot: () => PageSnapshot
  subscribe: () => () => void
  set: () => Promise<boolean>
}

/** The props the page component takes. */
interface PageProps {
  form: FormStub
  ctx: { readonly configForms: { get: () => FormStub }; readonly get: () => undefined }
  remoteSlot: { get: () => null; subscribe: () => () => void }
}

/** The internals these tests exercise. */
interface Internals {
  extensionRemoteView?: (remote: RemoteValue | null) => RemoteView
  initialExtensionRemote?: (namespace: { serviceKey: string } | null, storage: StorageLike | null) => RemoteValue
  extensionReadTimeout?: (promise: Promise<string>, timeoutMs: number) => Promise<{ timedOut: boolean; value?: string }>
  EXTENSION_READ_TIMEOUT_MS?: number
  ModelToolsSettings?: (props: PageProps) => ElementNode
}

/** The bundle's exported module. */
interface BundleExports {
  readonly __internals: Internals
}

/** One loader registration. */
interface Registration {
  factory: (request: (id: string) => ReactStub) => BundleExports
}

/** Load the generated bundle like the shell does, with a stub React. */
function loadInternals(): Internals {
  const source = readFileSync(BUNDLE, 'utf8')
  let registration: Registration | undefined
  const window = { __ModuleLoader__: { load(value: Registration) { registration = value } } }
  const queue: PageState[] = [
    { status: 'ready', writable: true, value: {} },
    {},
    null,
    null,
    null,
    { kind: 'loading' },
    {},
    null,
    null,
    null,
    null,
  ]
  const react: ReactStub = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: initial => [queue.length > 0 ? queue.shift() ?? initial : initial, () => {}],
    useEffect: () => {},
  }
  const request = (id: string): ReactStub => {
    assert.equal(id, 'react', 'the client bundle may require only react')
    return react
  }
  new Function('window', 'require', source)(window, request)
  assert.ok(registration !== undefined, 'the bundle must register through __ModuleLoader__.load')
  return registration.factory(request).__internals
}

/** A real ElementNode guard without a typeof narrowing. */
function isElement(node: RenderChild): node is ElementNode {
  return Object.prototype.toString.call(node) === '[object Object]'
}

/** Flatten every text node of a rendered tree. */
function flattenText(node: RenderChild): string[] {
  if (node === null || node === undefined || node === false) return []
  if (Array.isArray(node)) return node.flatMap(flattenText)
  if (isElement(node)) return flattenText(node.children)
  return [String(node)]
}

/** Collect every stub element in the tree. */
function elementsOf(node: RenderChild): ElementNode[] {
  if (node === null || node === undefined || node === false) return []
  if (Array.isArray(node)) return node.flatMap(elementsOf)
  if (isElement(node)) return [node, ...elementsOf(node.children)]
  return []
}

/** A storage double backed by a Map. */
function fakeStorage(entries: Readonly<Record<string, string>>): StorageLike {
  const map = new Map(Object.entries(entries))
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
    removeItem: key => { map.delete(key) },
  }
}

test('kind -> view: loading is CHECKING, never absent; ready enables actions; error/timeout explain and retry', () => {
  const internals = loadInternals()
  const view = internals.extensionRemoteView
  assert.ok(view !== undefined)
  const loading = view({ kind: 'loading' })
  assert.equal(loading.checking, true)
  assert.ok((loading.note ?? '').includes('Checking the host for extension state'))
  assert.equal(loading.actionEnabled, false)
  assert.equal(loading.canRetry, false)
  const ready = view({ kind: 'ready' })
  assert.equal(ready.checking, false)
  assert.equal(ready.note, null)
  assert.equal(ready.actionEnabled, true)
  const absent = view({ kind: 'absent' })
  assert.equal(absent.checking, false)
  assert.ok((absent.note ?? '').includes('does not expose'))
  assert.equal(absent.canRetry, true)
  assert.notEqual(loading.note, absent.note, 'a slow host must not read as an absent Remote')
  const timeout = view({ kind: 'timeout', text: 'The host is taking too long to report extension state.' })
  assert.ok((timeout.note ?? '').includes('taking too long'))
  assert.equal(timeout.canRetry, true)
  const failed = view({ kind: 'error', text: 'host exploded' })
  assert.equal(failed.note, 'host exploded')
  assert.equal(failed.canRetry, true)
})

test('the persisted snapshot seeds a READY extRemote synchronously, with no loading gate', () => {
  const internals = loadInternals()
  const seed = internals.initialExtensionRemote
  assert.ok(seed !== undefined)
  const key = 'dsh.tool-mode.extension-state.v1:service:modelTools'
  const snapshot = JSON.stringify({
    at: 1234,
    snapshot: { store: 'store', writable: true, extensions: [{ id: 'ext-1' }] },
  })
  const seeded = seed({ serviceKey: 'modelTools' }, fakeStorage({ [key]: snapshot }))
  assert.equal(seeded.kind, 'ready')
  assert.equal(seeded.store, 'store')
  assert.equal(seeded.extensions?.length, 1)
  // The last-used key lets a fresh page seed before the Remote namespace mounts.
  const lastKey = 'dsh.tool-mode.extension-state.v1:last'
  const byLast = seed(null, fakeStorage({ [key]: snapshot, [lastKey]: 'service:modelTools' }))
  assert.equal(byLast.kind, 'ready')
  const cold = seed({ serviceKey: 'modelTools' }, fakeStorage({}))
  assert.equal(cold.kind, 'loading')
})

test('the read is bounded: a slow host resolves the timeout marker, a fast one passes the value', async () => {
  const internals = loadInternals()
  const bounded = internals.extensionReadTimeout
  assert.ok(bounded !== undefined)
  assert.equal(internals.EXTENSION_READ_TIMEOUT_MS, 4000)
  const fast = await bounded(Promise.resolve('value'), 50)
  assert.deepEqual(fast, { timedOut: false, value: 'value' })
  const started = Date.now()
  const slow = await bounded(new Promise<string>(resolve => { setTimeout(() => resolve('late'), 200) }), 20)
  assert.equal(slow.timedOut, true)
  assert.ok(Date.now() - started >= 15)
})

test('during loading the page paints the static models and checking copy, and never the absent copy', () => {
  const internals = loadInternals()
  const page = internals.ModelToolsSettings
  assert.ok(page !== undefined)
  const form: FormStub = {
    getSnapshot: () => ({ status: 'ready', writable: true, value: {} }),
    subscribe: () => () => {},
    set: async () => true,
  }
  const tree = page({
    form,
    ctx: { configForms: { get: () => form }, get: () => undefined },
    remoteSlot: { get: () => null, subscribe: () => () => {} },
  })
  const text = flattenText(tree).join(' | ')
  assert.ok(text.includes('Align'), 'the static catalog must paint immediately: ' + text.slice(0, 300))
  assert.ok(text.includes('Checking the host for extension state…'), 'the checking copy must be shown')
  assert.ok(text.includes('checking…'), 'extension rows carry a neutral checking badge')
  assert.equal(text.includes('does not expose its extension state'), false, 'the per-row absent note must not render while loading')
  assert.equal(text.includes('so extension-backed rows cannot be installed'), false, 'the absent card copy must not render while loading')
  const enabledToggles = elementsOf(tree).filter(node => node.props.className === 'mtt-toggle' && node.props.disabled !== true)
  assert.ok(enabledToggles.length > 0, 'config toggles stay enabled while the host is checked')
})

test('the generated bundle carries the helpers inline', () => {
  const source = readFileSync(BUNDLE, 'utf8')
  for (const marker of ['function extensionRemoteView', 'function initialExtensionRemote', 'function extensionReadTimeout', 'EXTENSION_READ_TIMEOUT_MS']) {
    assert.ok(source.includes(marker), 'missing ' + marker)
  }
})
