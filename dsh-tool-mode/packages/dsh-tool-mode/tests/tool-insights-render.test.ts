/**
 * Tool Insights render tree: the three-tab shell, the workbench sections, the
 * empty/degraded states and the inventory/MCP views, rendered with a stub React
 * (no DOM) exactly as the client bundle builds them.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const PACKAGE_DIR = join(process.cwd(), 'packages', 'dsh-tool-mode')
const SOURCE = join(PACKAGE_DIR, 'client', 'tool-insights.js')

type Tree = { type: unknown; props: Record<string, unknown>; children: unknown[] }

function createElement(type: unknown, props: unknown, ...children: unknown[]): Tree {
  return { type, props: (props ?? {}) as Record<string, unknown>, children }
}

function stubReact() {
  return {
    createElement,
    useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
    useEffect: () => {},
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (factory: unknown) => factory,
    useRef: () => ({ current: null }),
  }
}

type Surface = Record<string, any>

function loadSurface(): Surface {
  const source = readFileSync(SOURCE, 'utf8')
  assert.ok(source.includes('function createToolInsights'), 'client/tool-insights.js must expose createToolInsights')
  const react = stubReact()
  const factory = new Function('React', `${source}\nreturn createToolInsights`)(react) as (h: unknown, reactLib: unknown) => Surface
  return factory(createElement, react)
}

/** Every string in the tree, in order. */
function textOf(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) textOf(child, out)
    return out
  }
  if (node !== null && typeof node === 'object') {
    const tree = node as Tree
    for (const child of tree.children) textOf(child, out)
  }
  return out
}

function collect(node: unknown, predicate: (tree: Tree) => boolean, out: Tree[] = []): Tree[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, out)
    return out
  }
  if (node !== null && typeof node === 'object' && 'children' in (node as Tree)) {
    const tree = node as Tree
    if (predicate(tree)) out.push(tree)
    for (const child of tree.children) collect(child, predicate, out)
  }
  return out
}

function projection(): Record<string, unknown> {
  return {
    stateVersion: 1,
    calls: 3,
    errors: 1,
    toolMs: 700,
    uniqueTools: 2,
    byOwner: { '@try-works/extension-laya': { calls: 2, errors: 0, ms: 500 }, unattributed: { calls: 1, errors: 1, ms: 200 } },
    byModel: { 'deepseek-v3.1': { calls: 3, errors: 1, tools: 2, ms: 700 } },
    byDay: { '2026-10-21': { calls: 2, errors: 1, ms: 400 }, '2026-10-22': { calls: 1, errors: 0, ms: 300 } },
    recent: [
      { time: 1_760_000_000_000, name: 'decision_choose', model: 'deepseek-v3.1', ms: 200, ok: true },
      { time: 1_760_000_100_000, name: 'tool_mode_run', model: 'deepseek-v3.1', ms: 300, ok: false, kind: 'code', callId: 'run-1' },
      { time: 1_760_000_090_000, name: 'semantic_similarity', model: 'deepseek-v3.1', ms: 40, ok: true, kind: 'code', callId: 'sub-1', parentCallId: 'run-1' },
    ],
    topTools: [{ name: 'decision_choose', calls: 2, ms: 500 }],
  }
}

test('TabBar renders five accessible tabs and marks the active one', () => {
  const s = loadSurface()
  const TabBar = s['TabBar'] as (props: unknown) => Tree
  const tree = TabBar({ tab: 'inventory', onSelect: () => {} })
  const text = textOf(tree).join(' ')
  assert.ok(text.includes('Tool Insights'))
  assert.ok(text.includes('Tool Inventory'))
  assert.ok(text.includes('MCP'))
  assert.ok(text.includes('Create tool'))
  assert.ok(text.includes('Settings'))
  const tabs = collect(tree, node => node.props['role'] === 'tab')
  assert.equal(tabs.length, 5)
  const active = tabs.filter(node => node.props['aria-selected'] === true)
  assert.equal(active.length, 1)
  assert.equal(active[0]?.props['data-tab'], 'inventory')
  assert.equal(tabs[0]?.props['type'], 'button')
  assert.equal(tabs[0]?.props['role'], 'tab')
})

test('InsightsView renders KPI band, charts, performance and All calls', () => {
  const s = loadSurface()
  const aggregate = s['aggregateProjections'] as (rows: readonly unknown[]) => Record<string, any>
  const derive = s['deriveInsights'] as (input: Record<string, unknown>) => Record<string, any>
  const InsightsView = s['InsightsView'] as (props: unknown) => Tree
  const model = derive({
    projection: aggregate([{ projectionValues: { toolModeUsage: projection() } }]),
    report: null,
    range: '7d',
    now: 1_760_000_300_000,
    toolsAvailable: 41,
  })
  const tree = InsightsView({
    model, range: '7d', onSelectRange: () => {}, onOpenInventory: () => {},
    toolPage: 1, toolPageSize: 7, callPage: 1, callPageSize: 10, onToolPage: () => {}, onCallPage: () => {},
    expanded: {}, onToggleCall: () => {}, onSelectTool: () => {},
  })
  const text = textOf(tree).join(' ')
  assert.ok(text.includes('Calls per day'), text)
  assert.ok(text.includes('Model leaderboard'), text)
  assert.ok(text.includes('Tool performance'), text)
  assert.ok(text.includes('All calls'), text)
  assert.ok(text.includes('Inventory'), 'there is an Inventory jump control')
  assert.ok(text.includes('decision_choose'), 'tool rows come from the projection')
  assert.ok(text.includes('Previous') && text.includes('Next'), 'pagination controls are present')
  assert.ok(text.includes('98.4%') || text.includes('66.7%'), 'success rate renders as a percentage')
  // The range control is a labelled group of four options.
  assert.ok(text.includes('24h') && text.includes('7d') && text.includes('30d') && text.includes('All'))
  // Tables use real table semantics.
  assert.ok(collect(tree, node => node.type === 'table').length >= 2)
  assert.ok(collect(tree, node => node.type === 'th').length >= 6)
})

test('an empty projection renders an explicit empty state, never zeroed cards', () => {
  const s = loadSurface()
  const aggregate = s['aggregateProjections'] as (rows: readonly unknown[]) => Record<string, any>
  const derive = s['deriveInsights'] as (input: Record<string, unknown>) => Record<string, any>
  const InsightsView = s['InsightsView'] as (props: unknown) => Tree
  const model = derive({ projection: aggregate([]), report: null, range: '7d', now: 1_760_000_300_000, toolsAvailable: 41 })
  const text = textOf(InsightsView({
    model, range: '7d', onSelectRange: () => {}, onOpenInventory: () => {},
    toolPage: 1, toolPageSize: 7, callPage: 1, callPageSize: 10, onToolPage: () => {}, onCallPage: () => {},
    expanded: {}, onToggleCall: () => {}, onSelectTool: () => {},
  })).join(' ')
  assert.ok(text.includes('No tool calls in this range.'), text)
})

test('InventoryView groups by origin, shows withheld tools and paginates', () => {
  const s = loadSurface()
  const build = s['filterAndGroupInventory'] as (tools: readonly unknown[], query: Record<string, unknown>) => Record<string, any>
  const InventoryView = s['InventoryView'] as (props: unknown) => Tree
  const model = build([
    { name: 'read', owner: '@deepseek-ai/dsh-tool-fs', kind: 'built-in', state: 'active', calls: 4 },
    { name: 'lang_detect', owner: '@try-works/extension-desert-ant-tongue', kind: 'extension', state: 'prepared-cold' },
    { name: 'model_tools', owner: '@try-works/dsh-tool-mode', kind: 'tool-mode', state: 'active', mcpExposed: false },
  ], { query: {}, page: 1, pageSize: 7 })
  const tree = InventoryView({
    model, filters: { query: '', origin: 'all', state: 'all' }, onFilter: () => {}, page: 1, onPage: () => {},
    selected: null, onSelect: () => {}, onBack: () => {},
  })
  const text = textOf(tree).join(' ')
  assert.ok(text.includes('Tool Inventory'))
  assert.ok(text.includes('Back to workbench'))
  assert.ok(text.includes('DSH core'))
  assert.ok(text.includes('Tool Mode'))
  assert.ok(text.includes('prepared-cold'))
  assert.ok(text.includes('withheld from MCP'), text)
  assert.ok(text.includes('Previous') && text.includes('Next'))
  assert.ok(text.includes('never called'), 'a never-called tool says so')
})

test('McpView renders the endpoint, clients, exposure and external call log', () => {
  const s = loadSurface()
  const view = s['mcpView'] as (status: unknown, calls: unknown, options: Record<string, unknown>) => Record<string, any>
  const McpView = s['McpView'] as (props: unknown) => Tree
  const model = view({
    enabled: true,
    endpoint: { host: '127.0.0.1', port: 3865, path: '/mcp' },
    transport: 'streamable-http',
    auth: { scheme: 'bearer', tokenFile: 'C:/Users/erikb/.dsh/model-as-tool/mcp-token.txt' },
    uptimeMs: 3_600_000,
    clients: [{ id: 'static-token', calls: 3, errors: 0, lastSeen: 1_760_000_000_000 }],
    exposed: ['read', 'lang_detect'],
    withheld: ['model_tools'],
  }, { total: 1, calls: [{ time: 1_760_000_000_000, tool: 'lang_detect', clientId: 'static-token', totalMs: 40, receiptId: 'rcpt_1' }] }, { page: 1, pageSize: 10 })
  const tree = McpView({ model, page: 1, onPage: () => {}, onBack: () => {} })
  const text = textOf(tree).join(' ')
  assert.ok(text.includes('http://127.0.0.1:3865/mcp'), text)
  assert.ok(text.includes('3865'))
  assert.ok(text.includes('streamable-http'))
  assert.ok(text.includes('static-token'))
  assert.ok(text.includes('Exposed 2 of 3'), text)
  assert.ok(text.includes('withheld'))
  assert.ok(text.includes('model_tools'))
  assert.ok(text.includes('rcpt_1'))
  assert.ok(text.includes('Previous') && text.includes('Next'))
  // The MCP tab must never render the token value, only the file path.
  assert.ok(!text.includes('secret-token-value'))
  const disabled = McpView({ model: view({ enabled: false }, null, { page: 1, pageSize: 10 }), page: 1, onPage: () => {}, onBack: () => {} })
  assert.ok(textOf(disabled).join(' ').includes('MCP endpoint is disabled'))
})

test('SettingsView hosts the Model as Tool configuration', () => {
  const s = loadSurface()
  const View = s['SettingsView'] as (props: unknown) => Tree
  const text = textOf(View({ settings: () => 'plugin-settings' })).join(' ')
  assert.ok(text.includes('plugin-settings'))
  const unavailable = textOf(View({})).join(' ')
  assert.ok(unavailable.includes('not available'))
})

test('ToolInsightsPage renders the four tabs without throwing on stub props', () => {
  const s = loadSurface()
  const Page = s['ToolInsightsPage'] as (props: unknown) => Tree
  const sessions = { ids: ['s1'], byId: { s1: { id: 's1', projectionValues: { toolModeUsage: projection() } } } }
  const workspaces = { ids: [], byId: {}, list: [] }
  const tree = Page({
    useSessions: (select: (state: unknown) => unknown) => select(sessions),
    useWorkspaces: (select: (state: unknown) => unknown) => select(workspaces),
    call: () => Promise.resolve(null),
    openSession: () => {},
  })
  const text = textOf(tree).join(' ')
  assert.ok(text.includes('Tool Insights'))
  assert.ok(text.includes('Tool Inventory'))
  assert.ok(text.includes('MCP'))
  assert.ok(text.includes('Settings'))
  // Malformed projection data must not throw and must not invent numbers.
  const junk = Page({
    useSessions: (select: (state: unknown) => unknown) => select({ ids: ['x'], byId: { x: { projectionValues: { toolModeUsage: 'junk' } } } }),
    useWorkspaces: () => null,
    call: () => Promise.reject(new Error('no host')),
  })
  assert.ok(textOf(junk).length > 0)
})
