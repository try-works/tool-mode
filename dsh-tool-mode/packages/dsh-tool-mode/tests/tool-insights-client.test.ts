/**
 * Tool Insights client logic: tabs, pagination, formatting, tolerant normalizers,
 * projection aggregation, report derivation, Code Mode grouping, inventory
 * filters/grouping and MCP view derivation.
 *
 * The page source is an authoring module inlined into `client/index.js` (a sibling
 * chunk would 404), so these tests load `client/tool-insights.js` as a factory —
 * exactly like `client-toolview.test.ts` loads the chat cards.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const PACKAGE_DIR = join(process.cwd(), 'packages', 'dsh-tool-mode')
const SOURCE = join(PACKAGE_DIR, 'client', 'tool-insights.js')

/** A createElement stub that records the tree it is asked to build. */
function stubReact() {
  return { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: props ?? {}, children }) }
}

/** A React stub whose hooks are inert, enough to call a component once. */
function inertReact() {
  return {
    ...stubReact(),
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
  const factory = new Function('React', `${source}\nreturn createToolInsights`)(inertReact()) as (h: unknown) => Surface
  return factory(stubReact().createElement)
}

/** The compact wire one session row carries. */
function projection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
      { time: 1_760_000_100_000, name: 'tool_mode_run', model: 'deepseek-v3.1', ms: 300, ok: false, kind: 'code' },
    ],
    topTools: [{ name: 'decision_choose', calls: 2, ms: 500 }],
    ...overrides,
  }
}

test('the five tabs are ordered and labelled for the page', () => {
  const s = loadSurface()
  assert.deepEqual((s['TABS'] as { id: string; label: string }[]).map(t => t.id), ['insights', 'inventory', 'mcp', 'create', 'settings'])
  assert.deepEqual((s['TABS'] as { label: string }[]).map(t => t.label), ['Tool Insights', 'Tool Inventory', 'MCP', 'Create tool', 'Settings'])
  assert.equal(s['PALETTE'].primary, '#4F63FF')
  assert.equal(s['PALETTE'].failure, '#B7791F')
  assert.deepEqual(s['TOOL_PAGE_SIZES'], [25, 50, 100])
})

test('the page owns its scroll container and aligns numeric headers', () => {
  const source = readFileSync(SOURCE, 'utf8')
  assert.match(source, /\.mti-page \{[^}]*overflow-y: auto/)
  assert.match(source, /\.mti-page \{[^}]*height: 100%/)
  assert.match(source, /\.mti-table th\.mti-num \{ text-align: right; \}/)
})

test('deep links resolve to a tab with an insights fallback', () => {
  const s = loadSurface()
  const read = s['readTabFromHash'] as (hash: unknown) => string
  assert.equal(read('#inventory'), 'inventory')
  assert.equal(read('#mcp'), 'mcp')
  assert.equal(read('#settings'), 'settings')
  assert.equal(read('#insights'), 'insights')
  assert.equal(read('#INVENTORY'), 'inventory')
  assert.equal(read('#junk'), 'insights')
  assert.equal(read(''), 'insights')
  assert.equal(read(null), 'insights')
  assert.equal(read(42), 'insights')
  const hash = s['tabHash'] as (tab: string) => string
  assert.equal(hash('inventory'), '#inventory')
  assert.equal(hash('junk'), '#insights')
})

test('page math clamps and reports a showing range', () => {
  const s = loadSurface()
  const info = s['pageInfo'] as (total: number, pageSize: number, page: number) => Record<string, number>
  assert.deepEqual(info(41, 12, 1), { page: 1, pages: 4, from: 1, to: 12, total: 41, pageSize: 12 })
  assert.deepEqual(info(41, 12, 4), { page: 4, pages: 4, from: 37, to: 41, total: 41, pageSize: 12 })
  assert.deepEqual(info(41, 12, 99), { page: 4, pages: 4, from: 37, to: 41, total: 41, pageSize: 12 })
  assert.deepEqual(info(41, 12, -3), { page: 1, pages: 4, from: 1, to: 12, total: 41, pageSize: 12 })
  assert.deepEqual(info(0, 12, 5), { page: 1, pages: 1, from: 0, to: 0, total: 0, pageSize: 12 })
  const page = s['paginate'] as (rows: readonly string[], page: number, size: number) => { rows: string[]; info: Record<string, number> }
  assert.deepEqual(page(['a', 'b', 'c'], 2, 2).rows, ['c'])
  assert.deepEqual(page([], 1, 10).rows, [])
})

test('formatting is stable and never invents a value', () => {
  const s = loadSurface()
  assert.equal(s['formatNumber'](0), '0')
  assert.equal(s['formatNumber'](2148), '2,148')
  assert.equal(s['formatNumber'](Number.NaN), '—')
  assert.equal(s['formatPercent'](0.984), '98.4%')
  assert.equal(s['formatPercent'](1), '100%')
  assert.equal(s['formatPercent'](null), '—')
  assert.equal(s['formatDuration'](0), '0ms')
  assert.equal(s['formatDuration'](132), '132ms')
  assert.equal(s['formatDuration'](1500), '1.5s')
  assert.equal(s['formatDuration'](71_000), '1m 11s')
  assert.equal(s['formatDuration'](null), '—')
  assert.equal(s['formatBytes'](2048), '2.0 KB')
  assert.equal(s['formatAgo'](1_000_000, 1_060_000), '1m ago')
  assert.equal(s['formatAgo'](1_000_000, 1_000_500), 'just now')
  assert.equal(s['formatAgo'](undefined, 1_000_000), '—')
})

test('normalizeProjection keeps only finite, well-shaped facts', () => {
  const s = loadSurface()
  const normalize = s['normalizeProjection'] as (value: unknown) => Record<string, any> | null
  assert.equal(normalize(null), null)
  assert.equal(normalize('junk'), null)
  assert.equal(normalize([]), null)
  assert.deepEqual(normalize({}), { calls: 0, errors: 0, toolMs: 0, uniqueTools: 0, byOwner: {}, byModel: {}, byDay: {}, recent: [], topTools: [] })
  const junk = normalize({
    calls: 'many', errors: -2, toolMs: 12.5, uniqueTools: Number.POSITIVE_INFINITY,
    byOwner: { a: { calls: 2, errors: 1, ms: 3 }, b: 'nope' },
    byModel: { m: { calls: 1, errors: 0, tools: 1, ms: 4 } },
    byDay: { '2026-10-21': { calls: 2, errors: 0, ms: 4 }, nope: { calls: 1 } },
    recent: [{ time: 5, name: 'x', model: '', ms: 3, ok: true }, null, { name: '' }],
    topTools: [{ name: 'x', calls: 2, ms: 3 }, { name: 7 }],
  }) as Record<string, any>
  assert.equal(junk['calls'], 0)
  assert.equal(junk['errors'], 0)
  assert.equal(junk['toolMs'], 12.5)
  assert.equal(junk['uniqueTools'], 0)
  assert.deepEqual(Object.keys(junk['byOwner']), ['a'])
  assert.deepEqual(Object.keys(junk['byDay']), ['2026-10-21'])
  assert.equal(junk['recent'].length, 1)
  assert.equal(junk['recent'][0].name, 'x')
  assert.equal(junk['topTools'].length, 1)
  // Prototype names are data, not prototypes.
  const hostile = normalize({ byModel: { constructor: { calls: 1 } } }) as Record<string, any>
  assert.equal(Object.getPrototypeOf(hostile['byModel']), Object.prototype)
  assert.ok(Object.hasOwn(hostile['byModel'], 'constructor'))
})

test('aggregateProjections sums sessions and reports coverage', () => {
  const s = loadSurface()
  const aggregate = s['aggregateProjections'] as (rows: readonly unknown[]) => Record<string, any>
  const value = aggregate([
    { id: 's1', projectionValues: { toolModeUsage: projection() } },
    { id: 's2', projectionValues: { toolModeUsage: projection({ calls: 2, errors: 0, toolMs: 100, byModel: { 'deepseek-v3.1': { calls: 2, errors: 0, tools: 1, ms: 100 } }, byDay: { '2026-10-22': { calls: 2, errors: 0, ms: 100 } } }) } },
    { id: 's3', projectionValues: {} },
    null,
    { projectionValues: 'bad' },
  ])
  assert.equal(value['calls'], 5)
  assert.equal(value['errors'], 1)
  assert.equal(value['toolMs'], 800)
  assert.equal(value['uniqueTools'], 2)
  assert.equal(value['coverage'].sessions, 4)
  assert.equal(value['coverage'].covered, 2)
  assert.equal(value['byDay']['2026-10-21'].calls, 2)
  assert.equal(value['byDay']['2026-10-22'].calls, 3)
  assert.equal(value['byModel']['deepseek-v3.1'].calls, 5)
  assert.equal(value['sessions'], 2)
})

test('deriveInsights prefers the host report and degrades honestly without it', () => {
  const s = loadSurface()
  const aggregate = s['aggregateProjections'] as (rows: readonly unknown[]) => Record<string, any>
  const derive = s['deriveInsights'] as (input: Record<string, unknown>) => Record<string, any>
  const projected = aggregate([{ projectionValues: { toolModeUsage: projection() } }])
  const report = {
    calls: 10, errors: 1, unsettled: 1, toolMs: 5000, codeCalls: 2, sessions: 4, p50: 30, p95: 90,
    tools: [{ name: 'read', owner: 'core', calls: 6, errors: 0, totalMs: 1000, maxMs: 200, p50: 20, p95: 40, codeCalls: 0 }],
    models: [{ model: 'deepseek-v3.1', calls: 10, errors: 1, tools: 2, ms: 5000, p50: 30, p95: 90 }],
    days: [{ day: '2026-10-21', calls: 10, errors: 1, ms: 5000 }],
    recentCalls: [{ time: 1_760_000_200_000, name: 'read', owner: 'core', ms: 20, ok: true, callId: 'c1' }],
    toolsAvailable: 41,
  }
  const withReport = derive({ projection: projected, report, range: '7d', now: 1_760_000_300_000, toolsAvailable: 41 })
  assert.equal(withReport['degraded'], false)
  assert.equal(withReport['kpis'].calls, 10)
  assert.equal(withReport['kpis'].sessions, 4)
  assert.equal(withReport['kpis'].callsPerSession, 2.5)
  assert.equal(withReport['kpis'].successRate, 0.9)
  assert.equal(withReport['kpis'].codeModeShare, 0.2)
  assert.equal(withReport['kpis'].p50, 30)
  assert.equal(withReport['kpis'].toolsUsed, 1)
  assert.equal(withReport['kpis'].toolsAvailable, 41)
  assert.equal(withReport['calls'].length, 1)

  const without = derive({ projection: projected, report: null, range: '7d', now: 1_760_000_300_000, toolsAvailable: 41 })
  assert.equal(without['degraded'], true)
  assert.equal(without['banner'].includes('session projections'), true)
  assert.equal(without['kpis'].calls, 3)
  assert.equal(without['kpis'].successRate, 2 / 3)
})

test('All sends a range-only query, never null bounds', () => {
  const s = loadSurface()
  const query = s['reportQuery'] as (range: string, now: number) => Record<string, unknown>
  assert.deepEqual(query('all', 1_760_000_300_000), { range: 'all' })
  assert.deepEqual(query('7d', 1_760_000_300_000), {
    range: '7d',
    from: 1_760_000_300_000 - 7 * 24 * 60 * 60 * 1000,
    to: 1_760_000_300_000,
  })
})

test('the generated Remote methods are called positionally, not with a query wrapper', () => {
  const s = loadSurface()
  const request = s['requestUsageReport'] as (call: Function, range: string, now: number) => unknown
  const requestCalls = s['requestMcpCalls'] as (call: Function, page: number, pageSize: number) => unknown
  const seen: Array<[string, unknown]> = []
  const stub = (method: string, args: unknown) => {
    seen.push([method, args])
    return Promise.resolve({ ok: true, value: {} })
  }
  request(stub, 'all', 1_760_000_300_000)
  request(stub, '24h', 1_760_000_300_000)
  requestCalls(stub, 1, 50)
  assert.deepEqual(seen.map(([method]) => method), ['toolUsageReport', 'toolUsageReport', 'mcpCalls'])
  assert.deepEqual(seen[0]?.[1], { range: 'all' })
  assert.deepEqual(seen[1]?.[1], {
    range: '24h',
    from: 1_760_000_300_000 - 24 * 60 * 60 * 1000,
    to: 1_760_000_300_000,
  })
  assert.deepEqual(seen[2]?.[1], { page: 1, pageSize: 50 })
})

test('All calls groups Code Mode parents with their sub-calls and never orphans them', () => {
  const s = loadSurface()
  const group = s['groupCallRows'] as (calls: readonly unknown[]) => { name: string; children: { name: string }[] }[]
  const rows = group([
    { time: 3, name: 'read', callId: 'read-1', ok: true },
    { time: 2, name: 'tool_mode_run', callId: 'run-1', ok: false, kind: 'code' },
    { time: 1, name: 'decision_choose', callId: 'sub-1', parentCallId: 'run-1', ok: true, kind: 'code' },
    { time: 4, name: 'semantic_similarity', callId: 'sub-2', parentCallId: 'run-1', ok: true, kind: 'code' },
    { time: 5, name: 'stt_transcribe', callId: 'sub-3', parentCallId: 'gone', ok: true, kind: 'code' },
    null,
    { name: 'x' },
  ])
  assert.equal(rows.length, 3, 'read, run-1 and the orphan subs are top-level')
  const parent = rows.find(row => row.name === 'tool_mode_run')
  assert.equal(parent?.children.length, 2)
  assert.deepEqual(parent?.children.map(child => child.name), ['decision_choose', 'semantic_similarity'])
  assert.ok(rows.some(row => row.name === 'stt_transcribe'), 'an orphan sub-call is shown, not hidden')
  assert.equal(rows.some(row => row.children.some(child => child.name === 'stt_transcribe')), false)
})

test('inventory filters, groups, paginates and keeps never-called rows', () => {
  const s = loadSurface()
  const build = s['filterAndGroupInventory'] as (tools: readonly unknown[], query: Record<string, unknown>) => Record<string, any>
  const tools = [
    { name: 'read', owner: '@deepseek-ai/dsh-tool-fs', kind: 'built-in', state: 'active', calls: 4, success: 1, lastUsed: 100 },
    { name: 'lang_detect', owner: '@try-works/extension-desert-ant-tongue', kind: 'extension', state: 'active', calls: 2, success: 1, lastUsed: 90 },
    { name: 'model_tools', owner: '@try-works/dsh-tool-mode', kind: 'tool-mode', state: 'active', mcpExposed: false },
    { name: 'custom', owner: 'someone', kind: 'other', state: 'failed' },
    'junk',
  ]
  const all = build(tools, { query: {}, page: 1, pageSize: 10 })
  assert.equal(all['total'], 4)
  assert.deepEqual(all['groups'].map((group: { origin: string }) => group['origin']), ['core', 'tool-mode', 'other'])
  assert.equal(all['groups'][0].label, 'DSH core')
  assert.equal(all['groups'][0].rows[0].name, 'read')
  // Never-called rows survive.
  assert.ok(all['groups'].flatMap((group: { rows: { name: string }[] }) => group.rows).some(row => row.name === 'custom'))
  const extensionFilter = build(tools, { origin: 'tool-mode', page: 1, pageSize: 10 })
  assert.deepEqual(extensionFilter['groups'].map((group: { origin: string }) => group['origin']), ['tool-mode'])
  const search = build(tools, { query: 'lang', page: 1, pageSize: 10 })
  assert.equal(search['total'], 1)
  const failed = build(tools, { state: 'failed', page: 1, pageSize: 10 })
  assert.equal(failed['total'], 1)
  const paged = build(tools, { page: 2, pageSize: 2 })
  assert.equal(paged['info'].page, 2)
  assert.equal(paged['info'].pages, 2)
  assert.equal(paged['total'], 4, 'totals do not depend on the page size')
  // A row that might be withheld from MCP says so rather than hiding.
  const withheld = all['groups'].flatMap((group: { rows: { name: string; mcpExposed?: boolean }[] }) => group.rows)
    .find(row => row.name === 'model_tools')
  assert.equal(withheld?.mcpExposed, false)
  const rate = s['inventorySuccessRate'] as (row: Record<string, unknown>) => number | null
  assert.equal(rate({ calls: 199, success: 186 }), 186 / 199)
  assert.equal(rate({ calls: 3, success: 3 }), 1)
  assert.equal(rate({ calls: 0, success: 0 }), null)
})

test('the Model as Tool settings pane names the restart boundary for captured settings', () => {
  /**
   * Slice 3 of docs/plans/semantic-model-hardening.md.
   *
   * `apply()` captures model/tool registration settings once; a save changes storage
   * and the displayed value but not the registered tools. The pane must therefore say
   * so, deterministically, instead of implying the new values are already live.
   */
  const notice = 'Model and tool registration changes apply after restart.'
  const template = readFileSync(join(PACKAGE_DIR, 'client', 'index.template.js'), 'utf8')
  const paneStart = template.indexOf('function ModelToolsSettings(')
  assert.notEqual(paneStart, -1, 'the settings pane component must exist in the template')
  const paneEnd = template.indexOf('\n    function apply(', paneStart)
  assert.notEqual(paneEnd, -1, 'the settings pane component must end before apply()')

  const pane = template.slice(paneStart, paneEnd)
  // Rendered copy, not a comment: the literal sits inside the pane's element tree.
  assert.ok(
    pane.includes(`h('p', { className: 'mtt-help mtt-restart-notice', role: 'note' }, '${notice}')`),
    'the settings pane must render the restart notice as a literal note',
  )
  // Deterministic across renders: one immutable literal, no condition around it.
  assert.equal(pane.split(notice).length - 1, 1, 'the notice must appear exactly once in the pane')
  assert.equal(/restart notice/.test(pane), false, 'the literal must be the copy, not a comment')

  // The shipped bundle is generated from the template, so it must carry the same text.
  const bundle = readFileSync(join(PACKAGE_DIR, 'client', 'index.js'), 'utf8')
  assert.ok(bundle.includes(notice), 'the generated client bundle must carry the restart notice')
})

test('MCP view derives endpoint, exposure and a paginated call log truthfully', () => {
  const s = loadSurface()
  const view = s['mcpView'] as (status: unknown, calls: unknown, options: Record<string, unknown>) => Record<string, any>
  const status = {
    enabled: true,
    endpoint: { host: '127.0.0.1', port: 3865, path: '/mcp' },
    transport: 'streamable-http',
    auth: { scheme: 'bearer', tokenFile: 'C:/Users/erikb/.dsh/model-as-tool/mcp-token.txt' },
    uptimeMs: 3_600_000,
    clients: [{ id: 'static-token', calls: 3, errors: 0, lastSeen: 1_760_000_000_000 }],
    exposed: ['read', 'lang_detect'],
    withheld: ['model_tools'],
  }
  const calls = {
    total: 3,
    calls: [
      { time: 3, tool: 'read', clientId: 'static-token', totalMs: 12, receiptId: 'rcpt_1' },
      { time: 2, tool: 'lang_detect', clientId: 'static-token', totalMs: 40 },
      { time: 1, tool: 'read', clientId: 'static-token', totalMs: 9, failureClass: 'timeout' },
    ],
  }
  const ready = view(status, calls, { page: 1, pageSize: 2 })
  assert.equal(ready['available'], true)
  assert.equal(ready['enabled'], true)
  assert.equal(ready['endpoint'], 'http://127.0.0.1:3865/mcp')
  assert.equal(ready['port'], 3865)
  assert.equal(ready['exposedCount'], 2)
  assert.equal(ready['withheld'].includes('model_tools'), true)
  assert.equal(ready['callsInfo'].pages, 2)
  assert.equal(ready['calls'].length, 2)
  const disabled = view({ enabled: false }, null, { page: 1, pageSize: 2 })
  assert.equal(disabled['available'], true)
  assert.equal(disabled['enabled'], false)
  assert.equal(disabled['endpoint'], null)
  assert.equal(disabled['calls'].length, 0)
  const absent = view(null, null, { page: 1, pageSize: 2 })
  assert.equal(absent['available'], false)
  assert.equal(absent['banner'].includes('not available'), true)
})
