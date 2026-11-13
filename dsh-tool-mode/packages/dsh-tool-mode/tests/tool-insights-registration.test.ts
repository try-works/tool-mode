/**
 * Tool Insights registration: the generated client bundle registers the main page
 * and its sidebar entry (order 15), keeps the Settings section, skips unavailable
 * slots on an older host, and declares the client inject edges the page needs.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const PACKAGE_DIR = join(process.cwd(), 'packages', 'dsh-tool-mode')
const BUNDLE = join(PACKAGE_DIR, 'client', 'index.js')

interface Registration { name: string; id?: string; key?: string; order?: number; label?: unknown; component: unknown }

/** Load the generated browser bundle through a stubbed module loader. */
function loadBundle(): { exports: Record<string, unknown>; require: Record<string, unknown> } {
  const source = readFileSync(BUNDLE, 'utf8')
  let captured: { id: string; factory: (require: unknown) => unknown } | null = null
  const win = {
    __ModuleLoader__: {
      load(spec: { id: string; factory: (require: unknown) => unknown }) {
        captured = spec
      },
    },
  }
  // The bundle is the shipped lazy-CJS artifact: it registers a factory on the
  // loader and executes nothing else.
  new Function('window', source)(win)
  assert.ok(captured !== null, 'the bundle must register a module factory')
  const createElement = (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: props ?? {}, children })
  const react = {
    createElement,
    useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
    useEffect: () => {},
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (factory: unknown) => factory,
    useRef: () => ({ current: null }),
  }
  const require = (id: string) => {
    if (id === 'react') return react
    throw new Error(`unexpected module ${id}`)
  }
  const exports = (captured as { factory: (require: unknown) => unknown }).factory(require) as Record<string, unknown>
  return { exports, require: require as unknown as Record<string, unknown> }
}

/** A slots service that records what the plugin registers and models late declarations. */
function fakeSlots(declared: readonly string[]) {
  const registrations: Registration[] = []
  const injections: { name: string; factory: () => () => void }[] = []
  const active = new Set(declared)
  const activate = (names: readonly string[]) => {
    for (const name of names) {
      if (active.has(name)) continue
      active.add(name)
      for (const injection of injections.filter(candidate => candidate.name === name)) injection.factory()
    }
  }
  return {
    registrations,
    injections,
    activate,
    inject(name: string, factory: () => () => void) {
      injections.push({ name, factory })
      if (active.has(name)) factory()
      return () => {}
    },
    register(spec: Registration, component: unknown) {
      registrations.push({ ...spec, component })
      return () => {}
    },
    spec(name: string) {
      return active.has(name) ? { kind: name === 'settings.section' ? 'list' : 'keyed', scope: 'root' } : undefined
    },
  }
}

/** The minimal client context the bundle's apply() reads. */
function fakeContext(slots: ReturnType<typeof fakeSlots>): Record<string, unknown> {
  const form = { getSnapshot: () => ({ status: 'unavailable' }), subscribe: () => () => {}, set: async () => true }
  return {
    slots,
    configForms: { get: () => form },
    effect(factory: () => () => void) {
      factory()
    },
    get: () => undefined,
    logger: { warn: () => {} },
  }
}

const ALL_SLOTS = ['main', 'sidebar.panellist', 'settings.section', 'tool.call.toolview']

test('apply registers the page, the sidebar entry at order 15 and keeps Settings', () => {
  const { exports } = loadBundle()
  const apply = exports['apply'] as (ctx: unknown) => void
  assert.equal(typeof apply, 'function')
  const slots = fakeSlots(ALL_SLOTS)
  apply(fakeContext(slots))

  const main = slots.registrations.find(entry => entry.name === 'main' && entry.key === 'tool-insights')
  assert.ok(main !== undefined, 'the Tool Insights main page must be registered')
  assert.equal(typeof main?.component, 'function')

  const sidebar = slots.registrations.find(entry => entry.name === 'sidebar.panellist' && entry.id === 'tool-insights')
  assert.ok(sidebar !== undefined, 'the sidebar entry must be registered')
  assert.equal(sidebar?.order, 15)
  assert.equal(sidebar?.label, 'Tool Insights')
  assert.equal(typeof sidebar?.component, 'function')
  assert.equal(main?.key, sidebar?.id, 'main key and sidebar id must agree')

  const settings = slots.registrations.find(entry => entry.name === 'settings.section' && entry.id === 'model-tools')
  assert.ok(settings !== undefined, 'the existing Settings section must stay registered')

  // The page is injected through the two root slots the host declares.
  assert.ok(slots.injections.some(injection => injection.name === 'main'))
  assert.ok(slots.injections.some(injection => injection.name === 'sidebar.panellist'))
})

test('an older host without the page slots keeps Settings and does not throw', () => {
  const { exports } = loadBundle()
  const apply = exports['apply'] as (ctx: unknown) => void
  const slots = fakeSlots(['settings.section', 'tool.call.toolview'])
  assert.doesNotThrow(() => apply(fakeContext(slots)))
  assert.equal(slots.registrations.some(entry => entry.name === 'main'), false)
  assert.equal(slots.registrations.some(entry => entry.name === 'sidebar.panellist'), false)
  assert.ok(slots.registrations.some(entry => entry.name === 'settings.section'), 'Settings survives the older host')
})

test('the page slots register when the declaring plugins apply later', () => {
  const { exports } = loadBundle()
  const apply = exports['apply'] as (ctx: unknown) => void
  const slots = fakeSlots([])
  apply(fakeContext(slots))

  // At apply time the root slots are not declared yet. inject() must still be
  // called: it is the lazy path that resolves when ui-sidebar declares them.
  assert.ok(slots.injections.some(injection => injection.name === 'main'))
  assert.ok(slots.injections.some(injection => injection.name === 'sidebar.panellist'))
  assert.equal(slots.registrations.some(entry => entry.name === 'main'), false)

  slots.activate(['main', 'sidebar.panellist'])
  assert.ok(slots.registrations.some(entry => entry.name === 'main' && entry.key === 'tool-insights'))
  assert.ok(slots.registrations.some(entry => entry.name === 'sidebar.panellist'
    && entry.id === 'tool-insights' && entry.order === 15))
})

test('the page registers without a Remote (config-only hosts still mount it)', () => {
  const { exports } = loadBundle()
  const apply = exports['apply'] as (ctx: unknown) => void
  const slots = fakeSlots(ALL_SLOTS)
  assert.doesNotThrow(() => apply(fakeContext(slots)))
  const main = slots.registrations.find(entry => entry.name === 'main' && entry.key === 'tool-insights')
  // Rendering the component must not depend on a mounted Remote either.
  const createElement = (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: props ?? {}, children })
  const rendered = (main?.component as (props: unknown) => unknown)({
    useSessions: (select: (state: unknown) => unknown) => select({ ids: [], byId: {} }),
    useWorkspaces: (select: (state: unknown) => unknown) => select({ ids: [], byId: {} }),
    call: () => Promise.resolve(null),
  })
  assert.equal((rendered as { type: unknown }).type, 'div')
  void createElement
})

test('exports inject and package client inject edges name the real packages', () => {
  const { exports } = loadBundle()
  const inject = exports['inject'] as readonly string[]
  assert.ok(Array.isArray(inject))
  assert.ok(inject.includes('slots'), 'slots must be injected')
  assert.ok(inject.includes('configForms'), 'the Settings form must keep working')

  const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as
    { dsh?: { client?: { platform?: string; inject?: string[] } } }
  const clientInject = pkg.dsh?.client?.inject ?? []
  assert.equal(pkg.dsh?.client?.platform, 'web')
  for (const name of [
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-sidebar-right',
  ]) {
    assert.ok(clientInject.includes(name), `${name} must be declared in dsh.client.inject`)
  }
})
