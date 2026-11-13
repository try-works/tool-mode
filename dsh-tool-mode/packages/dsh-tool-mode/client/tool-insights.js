/**
 * Tool Insights — the three-tab first-level page (Tool Insights / Tool Inventory /
 * MCP) in the approved blue system.
 *
 * THIS FILE IS INLINED INTO client/index.js by `scripts/gen-client-catalog.mjs`.
 * It is deliberately not a sibling chunk: the client module service serves only the
 * bundle file a plugin declares, so a chunk would answer 404 and the page would
 * silently disappear (the same reason the chat cards are inlined).
 *
 * Data sources, all guarded:
 * - the compact `toolModeUsage` projection carried by each session row in
 *   `projectionValues` (free with `session.list`);
 * - the host's additive Remote methods `toolUsageReport`, `toolInventory`,
 *   `mcpStatus` and `mcpCalls`, reached through the injected `call(method, args)`
 *   (which already unwraps RemoteResult and never throws).
 *
 * Nothing here invents data: a missing projection is an empty state, a failed
 * report is a named degraded mode that says what is missing, and an older host
 * without the methods still renders the page from the compact projection.
 *
 * @param createElement - React.createElement, supplied by the client bundle.
 * @param reactLib - React itself (hooks); the bundle passes it, tests may stub it.
 * @returns the page components and the pure helpers (also used by tests).
 */
function createToolInsights(createElement, reactLib) {
  const h = createElement
  const React = reactLib

  /** The blue system from the approved cover card. */
  const PALETTE = Object.freeze({
    primary: '#4F63FF',
    tint: '#E9EDFF',
    page: '#F7F8FC',
    surface: '#F5F8FF',
    border: '#E5E8F2',
    ink: '#0B1015',
    muted: '#5F6B80',
    failure: '#B7791F',
  })

  const TABS = Object.freeze([
    { id: 'insights', label: 'Tool Insights' },
    { id: 'inventory', label: 'Tool Inventory' },
    { id: 'mcp', label: 'MCP' },
    { id: 'create', label: 'Create tool' },
    { id: 'settings', label: 'Settings' },
  ])

  const RANGES = Object.freeze(['24h', '7d', '30d', 'all'])
  const TOOL_PAGE_SIZES = Object.freeze([25, 50, 100])
  const CALL_PAGE_SIZES = Object.freeze([10, 25, 50])
  const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

  // ── small value helpers ────────────────────────────────────────────────────

  /** A plain object (arrays and null excluded). */
  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  /** A finite number, else null. */
  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  /** A non-negative finite number, else 0. */
  function count(value) {
    const number = finite(value)
    return number === null || number < 0 ? 0 : number
  }

  /** A non-empty string, else undefined. */
  function text(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }

  /** Assign an own data property, so `__proto__` and `constructor` stay data. */
  function own(target, key, value) {
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true })
    return target
  }

  /** Iterate the own entries of a plain object, tolerating any junk. */
  function entries(value) {
    if (!isObject(value)) return []
    return Object.keys(value).map(key => [key, value[key]])
  }

  // ── tabs and deep links ────────────────────────────────────────────────────

  /**
   * Resolve a location.hash to a tab id.
   * @param hash - `location.hash` (any value; junk falls back to insights).
   * @returns the matching tab id from {@link TABS}, else 'insights'.
   */
  function readTabFromHash(hash) {
    if (typeof hash !== 'string') return 'insights'
    const id = hash.replace(/^#/, '').trim().toLowerCase()
    return TABS.some(entry => entry.id === id) ? id : 'insights'
  }

  /** The hash to write for a tab id (invalid ids fall back to insights). */
  function tabHash(id) {
    return '#' + readTabFromHash('#' + String(id))
  }

  // ── formatting ─────────────────────────────────────────────────────────────

  /** Group the integer part with commas; non-numbers are an em dash. */
  function formatNumber(value) {
    const number = finite(value)
    if (number === null) return '—'
    return Math.round(number).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  /** A fraction as a percentage; a missing fraction is an em dash. */
  function formatPercent(value) {
    const number = finite(value)
    if (number === null) return '—'
    const percent = number * 100
    return (Number.isInteger(percent) ? String(percent) : percent.toFixed(1)) + '%'
  }

  /** Milliseconds in a compact human duration. */
  function formatDuration(value) {
    const number = finite(value)
    if (number === null) return '—'
    if (number < 1000) return Math.max(0, Math.round(number)) + 'ms'
    if (number < 60_000) return (number / 1000).toFixed(1) + 's'
    const minutes = Math.floor(number / 60_000)
    const seconds = Math.round((number % 60_000) / 1000)
    return minutes + 'm' + (seconds === 0 ? '' : ' ' + seconds + 's')
  }

  /** Bytes in KB/MB, bounded to one decimal. */
  function formatBytes(value) {
    const number = finite(value)
    if (number === null) return '—'
    if (number < 1024) return Math.round(number) + ' B'
    if (number < 1024 * 1024) return (number / 1024).toFixed(1) + ' KB'
    return (number / (1024 * 1024)).toFixed(1) + ' MB'
  }

  /** A relative "n ago" label; a missing time is an em dash. */
  function formatAgo(value, now) {
    const time = finite(value)
    const current = finite(now) ?? Date.now()
    if (time === null) return '—'
    const delta = Math.max(0, current - time)
    if (delta < 10_000) return 'just now'
    if (delta < 60_000) return Math.round(delta / 1000) + 's ago'
    if (delta < 3_600_000) return Math.round(delta / 60_000) + 'm ago'
    if (delta < DAY_MILLISECONDS) return Math.round(delta / 3_600_000) + 'h ago'
    return Math.round(delta / DAY_MILLISECONDS) + 'd ago'
  }

  // ── pagination ─────────────────────────────────────────────────────────────

  /**
   * Page math for a list.
   * @param total - number of rows.
   * @param pageSize - rows per page (positive).
   * @param page - requested page (clamped into range).
   * @returns { page, pages, from, to, total, pageSize } (1-based, inclusive).
   */
  function pageInfo(total, pageSize, page) {
    const size = finite(pageSize) !== null && pageSize > 0 ? Math.floor(pageSize) : 10
    const rows = Math.max(0, Math.floor(finite(total) ?? 0))
    const pages = Math.max(1, Math.ceil(rows / size))
    const requested = Math.floor(finite(page) ?? 1)
    const current = Math.min(Math.max(requested, 1), pages)
    return {
      page: current,
      pages,
      from: rows === 0 ? 0 : (current - 1) * size + 1,
      to: Math.min(current * size, rows),
      total: rows,
      pageSize: size,
    }
  }

  /** Slice rows for a page and return both slices and page math. */
  function paginate(rows, page, pageSize) {
    const list = Array.isArray(rows) ? rows : []
    const info = pageInfo(list.length, pageSize, page)
    return { rows: list.slice(info.from === 0 ? 0 : info.from - 1, info.to), info }
  }

  // ── compact projection ────────────────────────────────────────────────────

  /** A normalized per-owner/entry usage triple. */
  function usageTriple(value) {
    if (!isObject(value)) return null
    return { calls: count(value.calls), errors: count(value.errors), ms: count(value.ms) }
  }

  /**
   * Normalize the compact wire one session row carries.
   * @param value - `projectionValues.toolModeUsage` (any shape).
   * @returns the normalized compact value, or null when it is not an object.
   */
  function normalizeProjection(value) {
    if (!isObject(value)) return null
    const projection = {
      calls: count(value.calls),
      errors: Math.min(count(value.errors), count(value.calls)),
      toolMs: count(value.toolMs),
      uniqueTools: count(value.uniqueTools),
      byOwner: {},
      byModel: {},
      byDay: {},
      recent: [],
      topTools: [],
    }
    for (const [owner, usage] of entries(value.byOwner)) {
      const triple = usageTriple(usage)
      if (triple !== null && owner.length > 0) own(projection.byOwner, owner, triple)
    }
    for (const [model, usage] of entries(value.byModel)) {
      const triple = usageTriple(usage)
      if (triple === null || model.length === 0) continue
      own(projection.byModel, model, { ...triple, tools: count(usage.tools) })
    }
    for (const [day, usage] of entries(value.byDay)) {
      const triple = usageTriple(usage)
      if (triple === null || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      own(projection.byDay, day, triple)
    }
    if (Array.isArray(value.recent)) {
      for (const candidate of value.recent) {
        if (!isObject(candidate) || typeof candidate.name !== 'string' || candidate.name.length === 0) continue
        const recent = {
          time: finite(candidate.time),
          name: candidate.name,
          model: text(candidate.model),
          ms: finite(candidate.ms),
          ok: candidate.ok !== false,
          kind: candidate.kind === 'code' ? 'code' : 'direct',
        }
        if (projection.recent.length < 20) projection.recent.push(recent)
      }
    }
    if (Array.isArray(value.topTools)) {
      for (const candidate of value.topTools) {
        if (!isObject(candidate) || typeof candidate.name !== 'string' || candidate.name.length === 0) continue
        if (projection.topTools.length >= 5) break
        projection.topTools.push({ name: candidate.name, calls: count(candidate.calls), ms: count(candidate.ms) })
      }
    }
    return projection
  }

  /** Merge one normalized compact value into an aggregate. */
  function mergeProjection(target, projection, top) {
    target.calls += projection.calls
    target.errors += projection.errors
    target.toolMs += projection.toolMs
    target.uniqueTools = Math.max(target.uniqueTools, projection.uniqueTools)
    for (const [owner, usage] of entries(projection.byOwner)) {
      const previous = Object.hasOwn(target.byOwner, owner) && isObject(target.byOwner[owner])
        ? target.byOwner[owner]
        : { calls: 0, errors: 0, ms: 0 }
      own(target.byOwner, owner, { calls: previous.calls + usage.calls, errors: previous.errors + usage.errors, ms: previous.ms + usage.ms })
    }
    for (const [model, usage] of entries(projection.byModel)) {
      const previous = Object.hasOwn(target.byModel, model) && isObject(target.byModel[model])
        ? target.byModel[model]
        : { calls: 0, errors: 0, tools: 0, ms: 0 }
      own(target.byModel, model, {
        calls: previous.calls + usage.calls,
        errors: previous.errors + usage.errors,
        tools: Math.max(previous.tools, usage.tools),
        ms: previous.ms + usage.ms,
      })
    }
    for (const [day, usage] of entries(projection.byDay)) {
      const previous = Object.hasOwn(target.byDay, day) && isObject(target.byDay[day])
        ? target.byDay[day]
        : { calls: 0, errors: 0, ms: 0 }
      own(target.byDay, day, { calls: previous.calls + usage.calls, errors: previous.errors + usage.errors, ms: previous.ms + usage.ms })
    }
    for (const recent of projection.recent) {
      if (target.recent.length >= 200) break
      target.recent.push(recent)
    }
    for (const tool of projection.topTools) {
      const previous = top.get(tool.name) ?? { name: tool.name, calls: 0, ms: 0 }
      previous.calls += tool.calls
      previous.ms += tool.ms
      top.set(tool.name, previous)
    }
  }

  /**
   * Aggregate the compact projection across session rows.
   * @param rows - session rows carrying `projectionValues.toolModeUsage`.
   * @returns totals, rollups, bounded recent/top lists and coverage counts.
   */
  function aggregateProjections(rows) {
    const aggregate = {
      calls: 0, errors: 0, toolMs: 0, uniqueTools: 0,
      byOwner: {}, byModel: {}, byDay: {},
      recent: [], topTools: [],
      coverage: { sessions: 0, covered: 0 },
    }
    const top = new Map()
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!isObject(row)) continue
      aggregate.coverage.sessions += 1
      const projectionValues = row.projectionValues
      if (!isObject(projectionValues)) continue
      const projection = normalizeProjection(projectionValues.toolModeUsage)
      if (projection === null) continue
      aggregate.coverage.covered += 1
      mergeProjection(aggregate, projection, top)
    }
    aggregate.topTools = [...top.values()].sort((left, right) => right.calls - left.calls).slice(0, 5)
    aggregate.sessions = aggregate.coverage.covered
    aggregate.recent.sort((left, right) => (finite(right.time) ?? 0) - (finite(left.time) ?? 0))
    return aggregate
  }

  // ── host report ───────────────────────────────────────────────────────────

  /** Normalize one report tool row; null when it carries no name. */
  function reportTool(value) {
    if (!isObject(value) || typeof value.name !== 'string' || value.name.length === 0) return null
    return {
      name: value.name,
      owner: text(value.owner),
      calls: count(value.calls),
      errors: Math.min(count(value.errors), count(value.calls)),
      totalMs: count(value.totalMs),
      maxMs: finite(value.maxMs),
      p50: finite(value.p50),
      p95: finite(value.p95),
      firstUsed: finite(value.firstUsed),
      lastUsed: finite(value.lastUsed),
      codeCalls: count(value.codeCalls),
    }
  }

  /** Normalize one report model row; null when it carries no model. */
  function reportModel(value) {
    if (!isObject(value) || typeof value.model !== 'string' || value.model.length === 0) return null
    return {
      model: value.model,
      calls: count(value.calls),
      errors: Math.min(count(value.errors), count(value.calls)),
      tools: count(value.tools),
      ms: count(value.ms),
      p50: finite(value.p50),
      p95: finite(value.p95),
    }
  }

  /** Normalize a call row for the All calls table. */
  function callRow(value) {
    if (!isObject(value) || typeof value.name !== 'string' || value.name.length === 0) return null
    const callId = text(value.callId)
    const time = finite(value.time)
    if (callId === undefined && time === null) return null
    return {
      time,
      name: value.name,
      owner: text(value.owner),
      model: text(value.model),
      ms: finite(value.ms),
      ok: value.ok !== false && value.isError !== true,
      errorCode: text(value.errorCode) ?? text(value.error?.code),
      kind: value.kind === 'code' ? 'code' : 'direct',
      callId,
      parentCallId: text(value.parentCallId),
      sessionId: text(value.sessionId),
      workspace: text(value.workspace),
    }
  }

  /**
   * Normalize the host report, dropping malformed rows and preserving only facts.
   * @param value - the `toolUsageReport` value.
   * @returns the normalized report, or null when it is not a usable object.
   */
  function normalizeReport(value) {
    if (!isObject(value)) return null
    const tools = []
    for (const candidate of Array.isArray(value.tools) ? value.tools : []) {
      const row = reportTool(candidate)
      if (row !== null) tools.push(row)
    }
    const models = []
    for (const candidate of Array.isArray(value.models) ? value.models : []) {
      const row = reportModel(candidate)
      if (row !== null) models.push(row)
    }
    const days = []
    for (const candidate of Array.isArray(value.days) ? value.days : []) {
      if (!isObject(candidate) || typeof candidate.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.day)) continue
      days.push({ day: candidate.day, calls: count(candidate.calls), errors: count(candidate.errors), ms: count(candidate.ms) })
    }
    const calls = []
    const callList = Array.isArray(value.calls)
      ? value.calls
      : Array.isArray(value.callRows) ? value.callRows : Array.isArray(value.recentCalls) ? value.recentCalls : []
    for (const candidate of callList) {
      const row = callRow(candidate)
      if (row !== null) calls.push(row)
    }
    calls.sort((left, right) => (finite(right.time) ?? 0) - (finite(left.time) ?? 0))
    // A host may send `calls` as the count or as the list itself; when it is the
    // list the count comes from `callCount`, else from the list length.
    const callCount = Array.isArray(value.calls)
      ? (finite(value.callCount) !== null ? count(value.callCount) : calls.length)
      : count(value.calls)
    return {
      calls: callCount,
      errors: Math.min(count(value.errors), callCount),
      unsettled: count(value.unsettled),
      toolMs: count(value.toolMs),
      codeCalls: count(value.codeCalls),
      sessions: count(value.sessions),
      p50: finite(value.p50),
      p95: finite(value.p95),
      tools,
      models,
      days,
      callRows: calls,
    }
  }

  // ── derived view model ────────────────────────────────────────────────────

  /** Milliseconds covered by a range id. */
  function rangeWindow(range, now) {
    const current = finite(now) ?? Date.now()
    const days = range === '24h' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : null
    return { from: days === null ? null : current - days * DAY_MILLISECONDS, to: current }
  }

  /**
   * The query value for `toolUsageReport`. `all` is range-only: a numeric window
   * requires both bounds and null is not a number. The value is passed
   * POSITIONALLY to the generated method (see requestUsageReport).
   */
  function reportQuery(range, now) {
    const window = rangeWindow(range, now)
    return window.from === null ? { range } : { range, from: window.from, to: window.to }
  }

  /**
   * Call the positional Client Remote method. The generated namespace takes the
   * descriptor's parameters positionally and the gateway builds the wire
   * `args` object; passing `{ query: … }` here would nest it one level too deep
   * and the host would fall back to its default 7d window.
   */
  function requestUsageReport(call, range, now) {
    return call('toolUsageReport', reportQuery(range, now))
  }

  /** The same positional convention for the MCP calls page. */
  function requestMcpCalls(call, page, pageSize) {
    return call('mcpCalls', { page, pageSize })
  }

  /** Success rate for a calls/errors pair (null when there were no calls). */
  function successRate(calls, errors) {
    return calls > 0 ? (calls - Math.min(errors, calls)) / calls : null
  }

  /** Success rate of a tool row; null when the row carries no error facts. */
  function toolSuccessRate(tool) {
    return typeof tool.errors === 'number' && typeof tool.calls === 'number' ? successRate(tool.calls, tool.errors) : null
  }

  /**
   * Success ratio for an inventory row. The host's `success` column is a COUNT
   * of successful calls (not a ratio); normalize it here so every renderer
   * formats the same value.
   */
  function inventorySuccessRate(row) {
    const calls = finite(row.calls)
    const success = finite(row.success)
    if (calls === null || success === null || calls <= 0) return null
    return Math.max(0, Math.min(success, calls)) / calls
  }

  /**
   * Build the workbench view model from the compact projection and/or the report.
   * The report wins when present; otherwise the page degrades to the compact
   * projection and says so.
   * @param input - { projection, report, range, now, toolsAvailable }.
   * @returns { degraded, banner, kpis, days, models, tools, calls, range }.
   */
  function deriveInsights(input) {
    const projection = isObject(input.projection) ? input.projection : aggregateProjections([])
    const report = normalizeReport(input.report)
    const range = typeof input.range === 'string' ? input.range : '7d'
    const toolsAvailable = finite(input.toolsAvailable)

    if (report !== null) {
      const tools = report.tools.slice().sort((left, right) => right.calls - left.calls)
      return {
        degraded: false,
        banner: null,
        range,
        kpis: {
          calls: report.calls,
          errors: report.errors,
          unsettled: report.unsettled,
          successRate: successRate(report.calls, report.errors),
          toolMs: report.toolMs,
          sessions: report.sessions,
          callsPerSession: report.sessions > 0 ? report.calls / report.sessions : null,
          p50: report.p50,
          p95: report.p95,
          codeModeShare: report.calls > 0 ? report.codeCalls / report.calls : null,
          toolsUsed: report.tools.length,
          toolsAvailable,
        },
        days: report.days.slice().sort((left, right) => left.day.localeCompare(right.day)),
        models: report.models.slice().sort((left, right) => right.calls - left.calls),
        tools,
        calls: report.callRows.slice(),
        coverage: projection.coverage,
      }
    }

    const byDay = entries(projection.byDay)
      .map(([day, usage]) => ({ day, calls: usage.calls, errors: usage.errors, ms: usage.ms }))
      .sort((left, right) => left.day.localeCompare(right.day))
    const models = entries(projection.byModel)
      .map(([model, usage]) => ({ model, calls: usage.calls, errors: usage.errors, tools: usage.tools, ms: usage.ms, p50: null, p95: null }))
      .sort((left, right) => right.calls - left.calls)
    const tools = projection.topTools
      .slice()
      .sort((left, right) => right.calls - left.calls)
      .map(tool => ({ name: tool.name, owner: null, calls: tool.calls, errors: null, totalMs: tool.ms, maxMs: null, p50: null, p95: null, firstUsed: null, lastUsed: null, codeCalls: null }))
    const codeCalls = projection.recent.filter(recent => recent.kind === 'code').length
    return {
      degraded: true,
      banner: 'The exact host report is not available on this build; these figures come from session projections '
        + '(' + projection.coverage.covered + ' of ' + projection.coverage.sessions + ' sessions carry the usage projection).',
      range,
      kpis: {
        calls: projection.calls,
        errors: projection.errors,
        unsettled: null,
        successRate: successRate(projection.calls, projection.errors),
        toolMs: projection.toolMs,
        sessions: projection.sessions,
        callsPerSession: projection.sessions > 0 ? projection.calls / projection.sessions : null,
        p50: null,
        p95: null,
        codeModeShare: projection.calls > 0 ? codeCalls / projection.calls : null,
        toolsUsed: projection.uniqueTools,
        toolsAvailable,
      },
      days: byDay,
      models,
      tools,
      calls: projection.recent.slice(),
      coverage: projection.coverage,
    }
  }

  // ── Code Mode grouping ────────────────────────────────────────────────────

  /**
   * Group call rows: a `tool_mode_run` parent carries its component sub-calls.
   * A sub-call whose parent is absent is shown as its own row, never hidden.
   * @param calls - call rows (report or projection shape).
   * @returns top-level rows, each with a `children` array.
   */
  function groupCallRows(calls) {
    const rows = []
    for (const candidate of Array.isArray(calls) ? calls : []) {
      const row = callRow(candidate)
      if (row !== null) rows.push({ ...row, children: [] })
    }
    const byId = new Map()
    for (const row of rows) {
      if (row.callId !== undefined && !byId.has(row.callId)) byId.set(row.callId, row)
    }
    const top = []
    for (const row of rows) {
      const parent = row.parentCallId === undefined ? undefined : byId.get(row.parentCallId)
      if (parent !== undefined && parent !== row) parent.children.push(row)
      else top.push(row)
    }
    for (const row of top) {
      row.children.sort((left, right) => (finite(left.time) ?? 0) - (finite(right.time) ?? 0))
    }
    return top
  }

  // ── inventory ─────────────────────────────────────────────────────────────

  /** The origin group a tool belongs to. */
  function originOf(tool) {
    if (tool.kind === 'built-in' || tool.kind === 'core') return 'core'
    if (tool.kind === 'extension' || tool.kind === 'tool-mode') return 'tool-mode'
    if (tool.kind === 'custom') return 'custom'
    if (typeof tool.owner === 'string') {
      if (tool.owner.startsWith('@deepseek-ai/dsh')) return 'core'
      if (tool.owner.startsWith('@try-works/')) return 'tool-mode'
    }
    return 'other'
  }

  const ORIGIN_LABELS = Object.freeze({ core: 'DSH core', 'tool-mode': 'Tool Mode', custom: 'Custom tools', other: 'Other plugins' })

  /** Normalize one inventory row; null when it carries no usable name. */
  function inventoryRow(value) {
    if (!isObject(value) || typeof value.name !== 'string' || value.name.length === 0) return null
    const row = {
      name: value.name,
      description: text(value.description),
      owner: text(value.owner),
      kind: typeof value.kind === 'string' && value.kind.length > 0 ? value.kind : 'unknown',
      state: typeof value.state === 'string' && value.state.length > 0 ? value.state : 'unknown',
      extension: text(value.extension),
      extensionVersion: text(value.extensionVersion),
      contractVersion: text(value.contractVersion),
      argumentCount: finite(value.argumentCount),
      lastRegistered: finite(value.lastRegistered),
      calls: finite(value.calls),
      success: finite(value.success),
      lastUsed: finite(value.lastUsed),
      mcpExposed: value.mcpExposed === true ? true : value.mcpExposed === false ? false : undefined,
    }
    row.origin = originOf(row)
    return row
  }

  /**
   * Filter, group and paginate the inventory.
   * @param tools - raw inventory rows.
   * @param query - { query, origin, state, page, pageSize }.
   * @returns { available, groups, total, info, filtered }.
   */
  function filterAndGroupInventory(tools, query) {
    const options = isObject(query) ? query : {}
    const search = typeof options.query === 'string' ? options.query.trim().toLowerCase() : ''
    const origin = typeof options.origin === 'string' && options.origin !== 'all' ? options.origin : 'all'
    const state = typeof options.state === 'string' && options.state !== 'all' ? options.state : 'all'
    const rows = []
    for (const candidate of Array.isArray(tools) ? tools : []) {
      const row = inventoryRow(candidate)
      if (row === null) continue
      if (origin !== 'all' && row.origin !== origin) continue
      if (state !== 'all' && row.state !== state) continue
      if (search.length > 0) {
        const haystack = (row.name + ' ' + (row.owner ?? '') + ' ' + (row.description ?? '') + ' ' + row.kind).toLowerCase()
        if (!haystack.includes(search)) continue
      }
      rows.push(row)
    }
    const page = paginate(rows, options.page, options.pageSize)
    const order = ['core', 'tool-mode', 'custom', 'other']
    const groups = order
      .map(id => ({ origin: id, label: ORIGIN_LABELS[id], rows: page.rows.filter(row => row.origin === id) }))
      .filter(group => group.rows.length > 0)
    return {
      available: true,
      groups,
      filtered: rows,
      total: rows.length,
      info: page.info,
    }
  }

  // ── MCP ───────────────────────────────────────────────────────────────────

  /** Normalize a names list or a {count,tools} object. */
  function namesOf(value) {
    if (Array.isArray(value)) return value.filter(name => typeof name === 'string' && name.length > 0)
    if (isObject(value) && Array.isArray(value.tools)) return value.tools.filter(name => typeof name === 'string' && name.length > 0)
    return []
  }

  /** Normalize the MCP status document; null when it is not usable. */
  function normalizeMcpStatus(value) {
    if (!isObject(value) || typeof value.enabled !== 'boolean') return null
    const endpoint = isObject(value.endpoint) ? value.endpoint : null
    const host = endpoint === null ? undefined : text(endpoint.host)
    const port = endpoint === null ? null : finite(endpoint.port)
    const path = endpoint === null ? undefined : text(endpoint.path)
    const url = host !== undefined && port !== null ? 'http://' + host + ':' + String(port) + (path ?? '') : null
    const clients = []
    for (const candidate of Array.isArray(value.clients) ? value.clients : []) {
      if (!isObject(candidate) || typeof candidate.id !== 'string' || candidate.id.length === 0) continue
      clients.push({
        id: candidate.id,
        label: text(candidate.label),
        calls: count(candidate.calls),
        errors: Math.min(count(candidate.errors), count(candidate.calls)),
        lastSeen: finite(candidate.lastSeen),
      })
    }
    const exposed = namesOf(value.exposed)
    const withheld = namesOf(value.withheld)
    return {
      enabled: value.enabled,
      endpoint: url,
      host: host ?? null,
      port,
      path: path ?? null,
      transport: text(value.transport) ?? null,
      scheme: isObject(value.auth) ? text(value.auth.scheme) ?? null : null,
      tokenFile: isObject(value.auth) ? text(value.auth.tokenFile) ?? null : null,
      uptimeMs: finite(value.uptimeMs),
      clients,
      exposed,
      withheld,
      exposedCount: exposed.length,
      withheldCount: withheld.length,
    }
  }

  /** Normalize one external call row. */
  function mcpCallRow(value) {
    if (!isObject(value) || typeof value.tool !== 'string' || value.tool.length === 0) return null
    return {
      time: finite(value.time),
      tool: value.tool,
      clientId: text(value.clientId) ?? 'unknown client',
      totalMs: finite(value.totalMs),
      failureClass: text(value.failureClass),
      inputBytes: finite(value.inputBytes),
      outputBytes: finite(value.outputBytes),
      receiptId: text(value.receiptId),
    }
  }

  /**
   * Build the MCP view model: endpoint, clients, exposure and a page of calls.
   * @param status - the `mcpStatus` value (or null when the host lacks it).
   * @param calls - the `mcpCalls` value (or null).
   * @param options - { page, pageSize }.
   */
  function mcpView(status, calls, options) {
    const normalized = normalizeMcpStatus(status)
    const optionsValue = isObject(options) ? options : {}
    if (normalized === null) {
      return {
        available: false,
        banner: 'The MCP status is not available on this host build (the mcpStatus remote method is absent).',
        enabled: false, endpoint: null, host: null, port: null, path: null, transport: null,
        scheme: null, tokenFile: null, uptimeMs: null, clients: [], exposed: [], withheld: [],
        exposedCount: 0, withheldCount: 0, calls: [], callsInfo: pageInfo(0, 10, 1),
      }
    }
    const rawCalls = Array.isArray(calls) ? calls : isObject(calls) && Array.isArray(calls.calls) ? calls.calls : []
    const rows = []
    for (const candidate of rawCalls) {
      const row = mcpCallRow(candidate)
      if (row !== null) rows.push(row)
    }
    rows.sort((left, right) => (finite(right.time) ?? 0) - (finite(left.time) ?? 0))
    const page = paginate(rows, optionsValue.page, optionsValue.pageSize)
    return {
      available: true,
      banner: null,
      ...normalized,
      calls: page.rows,
      callsInfo: page.info,
    }
  }

  // ── components ────────────────────────────────────────────────────────────

  const CSS = `
.mti-page { box-sizing: border-box; height: 100%; min-height: 100%; overflow-y: auto; overflow-x: hidden; padding: 18px 24px 44px; background: ${PALETTE.page}; color: ${PALETTE.ink}; font-size: 13px; line-height: 20px; }
.mti-page *, .mti-page *::before, .mti-page *::after { box-sizing: border-box; }
.mti-page:focus-visible, .mti-page button:focus-visible, .mti-page input:focus-visible, .mti-page select:focus-visible {
  outline: 2px solid ${PALETTE.primary}; outline-offset: 2px;
}
.mti-tabs { display: flex; gap: 2px; border-bottom: 1px solid ${PALETTE.border}; margin-bottom: 16px; }
.mti-tab { appearance: none; border: 0; background: transparent; color: ${PALETTE.muted}; font: inherit; font-size: 13px; line-height: 20px;
  padding: 8px 12px 10px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; border-radius: 6px 6px 0 0; }
.mti-tab:hover { color: ${PALETTE.ink}; background: ${PALETTE.tint}; }
.mti-tab[data-active='true'] { color: ${PALETTE.primary}; border-bottom-color: ${PALETTE.primary}; font-weight: 600; }
.mti-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
.mti-title { margin: 0; font-size: 22px; line-height: 28px; font-weight: 650; letter-spacing: -0.01em; }
.mti-sub { margin: 4px 0 0; color: ${PALETTE.muted}; font-size: 12.5px; line-height: 18px; max-width: 720px; }
.mti-range { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mti-range-label { color: ${PALETTE.muted}; font-size: 11.5px; }
.mti-seg { display: inline-flex; border: 1px solid ${PALETTE.border}; border-radius: 7px; overflow: hidden; background: #FFFFFF; }
.mti-seg button { appearance: none; border: 0; background: transparent; color: ${PALETTE.muted}; font: inherit; font-size: 12px;
  padding: 5px 10px; cursor: pointer; border-left: 1px solid ${PALETTE.border}; }
.mti-seg button:first-child { border-left: 0; }
.mti-seg button[data-active='true'] { background: ${PALETTE.tint}; color: ${PALETTE.primary}; font-weight: 600; }
.mti-banner { display: flex; align-items: flex-start; gap: 8px; border: 1px solid ${PALETTE.border}; border-left: 3px solid ${PALETTE.primary};
  background: ${PALETTE.tint}; color: ${PALETTE.ink}; border-radius: 8px; padding: 9px 12px; margin: 0 0 14px; font-size: 12.5px; }
.mti-banner[data-kind='warn'] { border-left-color: ${PALETTE.failure}; background: #FDF6EA; }
.mti-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
.mti-kpi { background: #FFFFFF; border: 1px solid ${PALETTE.border}; border-radius: 10px; padding: 11px 13px; min-width: 0; }
.mti-kpi-label { color: ${PALETTE.muted}; font-size: 11px; line-height: 15px; letter-spacing: 0.03em; text-transform: uppercase; }
.mti-kpi-value { margin-top: 3px; font-size: 23px; line-height: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
.mti-kpi-hint { color: ${PALETTE.muted}; font-size: 11px; line-height: 15px; margin-top: 2px; }
.mti-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); gap: 12px; margin-bottom: 14px; }
.mti-card { background: #FFFFFF; border: 1px solid ${PALETTE.border}; border-radius: 10px; padding: 13px 15px; min-width: 0; margin-bottom: 14px; }
.mti-grid .mti-card { margin-bottom: 0; }
.mti-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.mti-card-title { margin: 0; font-size: 13px; line-height: 18px; font-weight: 600; }
.mti-card-note { color: ${PALETTE.muted}; font-size: 11px; }
.mti-bars { display: flex; align-items: flex-end; gap: 6px; min-height: 96px; border-bottom: 1px solid ${PALETTE.border}; padding-top: 6px; }
.mti-bar { flex: 1 1 0; min-width: 6px; display: flex; flex-direction: column; justify-content: flex-end; height: 96px; }
.mti-bar-stack { display: flex; flex-direction: column-reverse; gap: 1px; }
.mti-bar-ok { background: ${PALETTE.primary}; border-radius: 2px 2px 0 0; min-height: 1px; }
.mti-bar-err { background: ${PALETTE.failure}; border-radius: 2px 2px 0 0; min-height: 1px; }
.mti-bar-label { color: ${PALETTE.muted}; font-size: 10px; text-align: center; margin-top: 5px; white-space: nowrap; }
.mti-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.mti-table th { text-align: left; color: ${PALETTE.muted}; font-size: 10.5px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
  padding: 6px 8px; border-bottom: 1px solid ${PALETTE.border}; white-space: nowrap; }
.mti-table th.mti-num { text-align: right; }
.mti-table td { padding: 7px 8px; border-bottom: 1px solid ${PALETTE.border}; font-size: 12.5px; vertical-align: top; }
.mti-table tbody tr:last-child td { border-bottom: 0; }
.mti-table tbody tr:hover td { background: ${PALETTE.surface}; }
.mti-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mti-name { font-weight: 550; color: ${PALETTE.ink}; }
.mti-tool-link { appearance: none; border: 0; background: transparent; padding: 0; font: inherit; color: ${PALETTE.primary}; cursor: pointer; text-align: left; }
.mti-tool-link:hover { text-decoration: underline; }
.mti-muted { color: ${PALETTE.muted}; }
.mti-pill { display: inline-block; border: 1px solid ${PALETTE.border}; border-radius: 999px; padding: 0 7px; font-size: 10.5px; line-height: 16px;
  color: ${PALETTE.muted}; background: #FFFFFF; white-space: nowrap; }
.mti-pill[data-ok='true'] { color: #1F7A4D; border-color: #BFDCCB; background: #F1FAF5; }
.mti-pill[data-ok='false'] { color: ${PALETTE.failure}; border-color: #EAD3B3; background: #FDF6EA; }
.mti-pill[data-state='active'] { color: ${PALETTE.primary}; border-color: #C9D2FF; background: ${PALETTE.tint}; }
.mti-pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 10px; color: ${PALETTE.muted}; font-size: 11.5px; flex-wrap: wrap; }
.mti-pager button { appearance: none; border: 1px solid ${PALETTE.border}; background: #FFFFFF; color: ${PALETTE.ink}; border-radius: 6px;
  font: inherit; font-size: 11.5px; padding: 3px 9px; cursor: pointer; }
.mti-pager button:disabled { color: ${PALETTE.muted}; opacity: 0.55; cursor: default; }
.mti-pager .mti-page-count { white-space: nowrap; }
.mti-empty { border: 1px dashed ${PALETTE.border}; border-radius: 10px; padding: 26px 18px; text-align: center; color: ${PALETTE.muted};
  background: ${PALETTE.surface}; font-size: 12.5px; }
.mti-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mti-btn { appearance: none; border: 1px solid ${PALETTE.border}; background: #FFFFFF; color: ${PALETTE.ink}; border-radius: 7px;
  font: inherit; font-size: 12px; line-height: 18px; padding: 5px 11px; cursor: pointer; }
.mti-btn:hover { border-color: ${PALETTE.primary}; color: ${PALETTE.primary}; }
.mti-btn-primary { background: ${PALETTE.primary}; border-color: ${PALETTE.primary}; color: #FFFFFF; }
.mti-btn-primary:hover { color: #FFFFFF; opacity: 0.92; }
.mti-filters { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.mti-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.mti-field label { color: ${PALETTE.muted}; font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; }
.mti-input, .mti-select { height: 30px; border: 1px solid ${PALETTE.border}; border-radius: 7px; background: #FFFFFF; color: ${PALETTE.ink};
  font: inherit; font-size: 12px; padding: 0 9px; min-width: 140px; }
.mti-input { min-width: 220px; }
.mti-group-title { display: flex; align-items: center; gap: 8px; margin: 14px 0 6px; color: ${PALETTE.muted};
  font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
.mti-group-title::after { content: ''; flex: 1 1 auto; height: 1px; background: ${PALETTE.border}; }
.mti-detail { border: 1px solid ${PALETTE.border}; border-left: 3px solid ${PALETTE.primary}; background: ${PALETTE.surface};
  border-radius: 8px; padding: 11px 13px; margin: 10px 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 16px; }
.mti-detail dt { color: ${PALETTE.muted}; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }
.mti-detail dd { margin: 1px 0 0; font-size: 12.5px; word-break: break-word; }
.mti-mono { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 11.5px; }
.mti-subcall td { background: ${PALETTE.surface}; }
.mti-indent { padding-left: 22px; }
.mti-expand { appearance: none; border: 0; background: transparent; color: ${PALETTE.muted}; cursor: pointer; font: inherit; font-size: 11px;
  width: 16px; padding: 0; text-align: left; }
.mti-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.mti-kv { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 5px 12px; margin: 0; }
.mti-kv dt { color: ${PALETTE.muted}; font-size: 11.5px; }
.mti-kv dd { margin: 0; font-size: 12.5px; word-break: break-word; }
@media (max-width: 980px) { .mti-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .mti-grid, .mti-split { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 720px) {
  .mti-page { padding: 12px 12px 36px; }
  .mti-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mti-title { font-size: 19px; }
  .mti-col-optional { display: none; }
  .mti-detail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.mti-create-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr); gap: 20px; align-items: start; }
.mti-create-heading { margin: 18px 0 10px; font-size: 13px; font-weight: 650; letter-spacing: 0.01em; }
.mti-create-heading:first-child { margin-top: 0; }
.mti-create-row { display: flex; gap: 10px; align-items: flex-end; }
.mti-create-checks { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0 4px; color: ${PALETTE.ink}; font-size: 12.5px; }
.mti-create-checks label { display: flex; align-items: center; gap: 6px; }
.mti-create-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.mti-create-list { border: 1px solid ${PALETTE.border}; border-radius: 9px; overflow: hidden; }
.mti-create-list-row { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 10px 12px; border-bottom: 1px solid ${PALETTE.border}; }
.mti-create-list-row:last-child { border-bottom: 0; }
.mti-create-list-title { font-size: 12.5px; font-weight: 600; color: ${PALETTE.ink}; }
.mti-create-list-actions { display: flex; gap: 6px; flex-shrink: 0; }
.mti-create-side { border-left: 1px solid ${PALETTE.border}; padding-left: 20px; }
.mti-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; min-width: 0; }
.mti-field-wide { width: 100%; }
.mti-field-grow { flex: 1 1 auto; }
.mti-field label { color: ${PALETTE.muted}; font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; }
.mti-input, .mti-select, .mti-textarea { box-sizing: border-box; width: 100%; border: 1px solid ${PALETTE.border}; border-radius: 7px;
  background: #FFFFFF; color: ${PALETTE.ink}; font: inherit; font-size: 12.5px; padding: 6px 9px; }
.mti-textarea { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 11.5px; line-height: 1.45; resize: vertical; }
.mti-input:focus-visible, .mti-select:focus-visible, .mti-textarea:focus-visible { outline: 2px solid ${PALETTE.primary}; outline-offset: 1px; }
.mti-button { appearance: none; border: 1px solid ${PALETTE.border}; background: #FFFFFF; color: ${PALETTE.ink}; border-radius: 7px;
  font: inherit; font-size: 12px; padding: 5px 11px; cursor: pointer; }
.mti-button:hover:not(:disabled) { border-color: ${PALETTE.primary}; color: ${PALETTE.primary}; }
.mti-button:disabled { opacity: 0.55; cursor: default; }
.mti-button-primary { background: ${PALETTE.primary}; border-color: ${PALETTE.primary}; color: #FFFFFF; }
.mti-button-small { font-size: 11px; padding: 3px 8px; }
.mti-help { margin: 0 0 10px; color: ${PALETTE.muted}; font-size: 11.5px; line-height: 16px; }
.mti-note { margin: 10px 0; border-radius: 7px; padding: 8px 10px; font-size: 12px; line-height: 17px; }
.mti-note-ok { background: #F1FAF5; border: 1px solid #BFDCCB; color: #1F7A4D; }
.mti-note-error { background: #FDF6EA; border: 1px solid #EAD3B3; color: ${PALETTE.failure}; }
.mti-issues { margin: 8px 0; padding-left: 18px; color: ${PALETTE.failure}; font-size: 11.5px; line-height: 17px; }
.mti-pre { max-height: 220px; overflow: auto; margin: 10px 0; padding: 9px 10px; border: 1px solid ${PALETTE.border}; border-radius: 7px;
  background: ${PALETTE.surface}; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 11px; line-height: 1.45; }
@media (max-width: 980px) { .mti-create-grid { grid-template-columns: minmax(0, 1fr); } .mti-create-side { border-left: 0; padding-left: 0; } }
@media (max-width: 720px) { .mti-create-row { flex-direction: column; align-items: stretch; } }
@media (prefers-reduced-motion: reduce) { .mti-page * { transition: none !important; } }
`

  /** A section card with a title row. */
  function Card(title, note, children) {
    return h('section', { className: 'mti-card' },
      h('div', { className: 'mti-card-head' },
        h('h3', { className: 'mti-card-title' }, title),
        note === null || note === undefined ? null : h('span', { className: 'mti-card-note' }, note)),
      children)
  }

  /** One KPI tile. */
  function Kpi(label, value, hint) {
    return h('div', { className: 'mti-kpi', key: label },
      h('div', { className: 'mti-kpi-label' }, label),
      h('div', { className: 'mti-kpi-value' }, value),
      hint === null || hint === undefined ? null : h('div', { className: 'mti-kpi-hint' }, hint))
  }

  /** A pager with a showing range and previous/next controls. */
  function Pager(info, onPage, label) {
    const name = typeof label === 'string' ? label : 'rows'
    return h('div', { className: 'mti-pager', role: 'navigation', 'aria-label': 'Pagination' },
      h('span', { className: 'mti-page-count' }, 'Showing ' + String(info.from) + '-' + String(info.to) + ' of ' + String(info.total) + ' ' + name),
      h('span', { className: 'mti-page-count' }, 'Page ' + String(info.page) + ' of ' + String(info.pages)),
      h('button', {
        type: 'button',
        disabled: info.page <= 1,
        onClick: () => onPage(info.page - 1),
        'aria-label': 'Previous page',
      }, 'Previous'),
      h('button', {
        type: 'button',
        disabled: info.page >= info.pages,
        onClick: () => onPage(info.page + 1),
        'aria-label': 'Next page',
      }, 'Next'))
  }

  /** The segmented range control. */
  function RangeControl(range, onSelectRange) {
    return h('div', { className: 'mti-range' },
      h('span', { className: 'mti-range-label', id: 'mti-range-label' }, 'Range'),
      h('div', { className: 'mti-seg', role: 'group', 'aria-labelledby': 'mti-range-label' },
        RANGES.map(id => h('button', {
          type: 'button',
          key: id,
          'data-active': id === range ? 'true' : 'false',
          'aria-pressed': id === range,
          onClick: () => onSelectRange(id),
        }, id === 'all' ? 'All' : id))))
  }

  /** The three-tab strip. */
  function TabBar(props) {
    const tab = readTabFromHash('#' + String(props.tab))
    return h('div', { className: 'mti-tabs', role: 'tablist', 'aria-label': 'Tool insights sections' },
      TABS.map(entry => h('button', {
        key: entry.id,
        type: 'button',
        role: 'tab',
        className: 'mti-tab',
        id: 'mti-tab-' + entry.id,
        'data-tab': entry.id,
        'data-active': entry.id === tab ? 'true' : 'false',
        'aria-selected': entry.id === tab,
        'aria-controls': 'mti-panel-' + entry.id,
        tabIndex: 0,
        onClick: () => props.onSelect(entry.id),
      }, entry.label)))
  }

  /** An explicit empty state. */
  function EmptyState(message) {
    return h('div', { className: 'mti-empty' }, message)
  }

  /** A degraded-mode banner. */
  function Banner(message, kind) {
    if (typeof message !== 'string' || message.length === 0) return null
    return h('div', { className: 'mti-banner', role: 'status', 'data-kind': kind === 'warn' ? 'warn' : 'info' }, message)
  }

  /** A status pill. */
  function Pill(label, props) {
    const extra = isObject(props) ? props : {}
    return h('span', { className: 'mti-pill', ...extra }, label)
  }

  /** Calls-per-day bars (success + errors). */
  function CallsPerDay(days) {
    const rows = Array.isArray(days) ? days.filter(day => isObject(day) && typeof day.day === 'string') : []
    if (rows.length === 0) return EmptyState('No calls recorded in this range.')
    const peak = Math.max(1, ...rows.map(day => count(day.calls)))
    return h('div', { className: 'mti-bars', role: 'img', 'aria-label': 'Calls per day, success versus errors' },
      rows.slice(-30).map(day => {
        const calls = count(day.calls)
        const errors = Math.min(count(day.errors), calls)
        const height = Math.max(2, Math.round((calls / peak) * 80))
        const errorHeight = calls === 0 ? 0 : Math.round((errors / calls) * height)
        return h('div', { className: 'mti-bar', key: day.day, title: day.day + ': ' + String(calls) + ' calls, ' + String(errors) + ' errors' },
          h('div', { className: 'mti-bar-stack', style: { height: String(height) + 'px' } },
            h('div', { className: 'mti-bar-ok', style: { height: String(Math.max(0, height - errorHeight)) + 'px' } }),
            errorHeight > 0 ? h('div', { className: 'mti-bar-err', style: { height: String(errorHeight) + 'px' } }) : null),
          h('div', { className: 'mti-bar-label' }, day.day.slice(5)))
      }))
  }

  /** The model leaderboard. */
  function ModelLeaderboard(models) {
    const rows = Array.isArray(models) ? models : []
    if (rows.length === 0) return EmptyState('No model attribution recorded in this range.')
    return h('table', { className: 'mti-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Model'),
        h('th', { scope: 'col', className: 'mti-num' }, 'Calls'),
        h('th', { scope: 'col', className: 'mti-num' }, 'Tools'),
        h('th', { scope: 'col', className: 'mti-num' }, 'Success'),
        h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'p50'))),
      h('tbody', null, rows.slice(0, 8).map(row => h('tr', { key: row.model },
        h('td', null, h('span', { className: 'mti-name' }, row.model)),
        h('td', { className: 'mti-num' }, formatNumber(row.calls)),
        h('td', { className: 'mti-num' }, formatNumber(row.tools)),
        h('td', { className: 'mti-num' }, formatPercent(successRate(row.calls, row.errors))),
        h('td', { className: 'mti-num mti-col-optional' }, formatDuration(row.p50))))))
  }

  /** The per-tool performance table with pagination. */
  function ToolPerformanceTable(props) {
    const rows = Array.isArray(props.rows) ? props.rows : []
    const page = paginate(rows, props.page, props.pageSize)
    if (rows.length === 0) return EmptyState('No tool performance recorded in this range.')
    return h('div', null,
      h('table', { className: 'mti-table' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Tool'),
          h('th', { scope: 'col', className: 'mti-col-optional' }, 'Owner'),
          h('th', { scope: 'col', className: 'mti-num' }, 'Calls'),
          h('th', { scope: 'col', className: 'mti-num' }, 'Success'),
          h('th', { scope: 'col', className: 'mti-num' }, 'p50'),
          h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'p95'),
          h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'Max'),
          h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'Total'),
          h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'Code'),
          h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'Last used'))),
        h('tbody', null, page.rows.map(row => h('tr', { key: row.name },
          h('td', null, h('button', {
            type: 'button', className: 'mti-tool-link', onClick: () => props.onSelectTool(row.name),
            title: 'Show this tool in the inventory',
          }, row.name)),
          h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted mti-mono' }, row.owner ?? '—')),
          h('td', { className: 'mti-num' }, formatNumber(row.calls)),
          h('td', { className: 'mti-num' }, formatPercent(toolSuccessRate(row))),
          h('td', { className: 'mti-num' }, formatDuration(row.p50)),
          h('td', { className: 'mti-num mti-col-optional' }, formatDuration(row.p95)),
          h('td', { className: 'mti-num mti-col-optional' }, formatDuration(row.maxMs)),
          h('td', { className: 'mti-num mti-col-optional' }, formatDuration(row.totalMs)),
          h('td', { className: 'mti-num mti-col-optional' }, row.codeCalls === null ? '—' : formatNumber(row.codeCalls)),
          h('td', { className: 'mti-num mti-col-optional' }, formatAgo(row.lastUsed, props.now)))))),
      Pager(page.info, props.onPage, 'tools'))
  }

  /** The All calls table with expandable Code Mode parents. */
  function AllCallsTable(props) {
    const rows = groupCallRows(props.calls)
    const page = paginate(rows, props.page, props.pageSize)
    if (rows.length === 0) return EmptyState('No tool calls in this range.')
    const expanded = isObject(props.expanded) ? props.expanded : {}
    return h('div', null,
      h('table', { className: 'mti-table' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, ''),
          h('th', { scope: 'col' }, 'Time'),
          h('th', { scope: 'col' }, 'Tool'),
          h('th', { scope: 'col', className: 'mti-col-optional' }, 'Owner'),
          h('th', { scope: 'col', className: 'mti-col-optional' }, 'Session'),
          h('th', { scope: 'col', className: 'mti-num' }, 'ms'),
          h('th', { scope: 'col' }, 'Status'))),
        h('tbody', null, page.rows.flatMap(row => {
          const open = expanded[row.callId ?? row.name + String(row.time)] === true
          const expandable = row.children.length > 0
          const key = row.callId ?? row.name + String(row.time)
          const self = h('tr', { key },
            h('td', null, expandable
              ? h('button', {
                type: 'button', className: 'mti-expand', 'aria-expanded': open,
                onClick: () => props.onToggleCall(key),
                title: open ? 'Hide Code Mode sub-calls' : 'Show Code Mode sub-calls',
              }, open ? '▾' : '▸')
              : null),
            h('td', null, h('span', { className: 'mti-muted' }, formatAgo(row.time, props.now))),
            h('td', null, h('span', { className: 'mti-name' }, row.name), row.kind === 'code' ? ' ' : null,
              row.kind === 'code' && row.parentCallId === undefined ? Pill('CODE MODE') : null),
            h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted mti-mono' }, row.owner ?? '—')),
            h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted' }, row.sessionId ?? '—')),
            h('td', { className: 'mti-num' }, formatDuration(row.ms)),
            h('td', null, Pill(row.ok ? 'ok' : (row.errorCode ?? 'error'), { 'data-ok': row.ok ? 'true' : 'false' })))
          if (!expandable || !open) return [self]
          const children = row.children.map(child => h('tr', { key: child.callId ?? child.name, className: 'mti-subcall' },
            h('td', null),
            h('td', null, h('span', { className: 'mti-muted' }, formatAgo(child.time, props.now))),
            h('td', null, h('span', { className: 'mti-indent mti-name' }, child.name), ' ', Pill('sub-call')),
            h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted mti-mono' }, child.owner ?? '—')),
            h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted' }, child.sessionId ?? '—')),
            h('td', { className: 'mti-num' }, formatDuration(child.ms)),
            h('td', null, Pill(child.ok ? 'ok' : (child.errorCode ?? 'error'), { 'data-ok': child.ok ? 'true' : 'false' }))))
          return [self, ...children]
        }))),
      Pager(page.info, props.onPage, 'calls'))
  }

  /** The workbench (Tool Insights tab). */
  function InsightsView(props) {
    const model = isObject(props.model) ? props.model : deriveInsights({})
    const kpis = isObject(model.kpis) ? model.kpis : {}
    const hasCalls = count(kpis.calls) > 0
    return h('div', { role: 'tabpanel', id: 'mti-panel-insights', 'aria-labelledby': 'mti-tab-insights' },
      h('div', { className: 'mti-head' },
        h('div', null,
          h('h2', { className: 'mti-title' }, 'Tool Insights'),
          h('p', { className: 'mti-sub' },
            'What the agent actually did with tools: volume, health, latency, Code Mode nesting and model attribution. '
            + 'Figures are host-reported; nothing on this page is estimated.')),
        RangeControl(props.range, props.onSelectRange)),
      Banner(model.banner, 'warn'),
      h('div', { className: 'mti-kpis' },
        Kpi('Calls', formatNumber(kpis.calls), model.range === 'all' ? 'all time' : 'in ' + String(model.range)),
        Kpi('Tools used', formatNumber(kpis.toolsUsed) + (finite(kpis.toolsAvailable) === null ? '' : ' / ' + formatNumber(kpis.toolsAvailable)),
          'distinct tools with activity'),
        Kpi('Success', formatPercent(kpis.successRate), formatNumber(kpis.errors) + ' failed calls'),
        Kpi('Tool time', formatDuration(kpis.toolMs), 'sum of settled calls'),
        Kpi('Sessions', formatNumber(kpis.sessions), 'sessions carrying usage'),
        Kpi('Calls / session', finite(kpis.callsPerSession) === null ? '—' : (kpis.callsPerSession).toFixed(1), 'mean across sessions'),
        Kpi('p50 latency', formatDuration(kpis.p50), finite(kpis.p95) === null ? '' : 'p95 ' + formatDuration(kpis.p95)),
        Kpi('Code Mode', formatPercent(kpis.codeModeShare), 'share of sub-calls')),
      h('div', { className: 'mti-grid' },
        Card('Calls per day', 'success versus errors, host-local days',
          CallsPerDay(model.days)),
        Card('Model leaderboard', 'who used tools most',
          ModelLeaderboard(model.models))),
      Card('Tool performance', 'settled calls; percentiles from the host histogram',
        ToolPerformanceTable({
          rows: model.tools, page: props.toolPage, pageSize: props.toolPageSize, now: props.now,
          onPage: props.onToolPage, onSelectTool: props.onSelectTool,
        })),
      Card('All calls', 'newest first; Code Mode parents expand into their sub-calls',
        h('div', null,
          h('div', { className: 'mti-actions', style: { marginBottom: '8px' } },
            h('button', { type: 'button', className: 'mti-btn', onClick: () => props.onOpenInventory() }, 'Inventory →')),
          hasCalls
            ? AllCallsTable({
              calls: model.calls, page: props.callPage, pageSize: props.callPageSize, now: props.now,
              expanded: props.expanded, onToggleCall: props.onToggleCall, onPage: props.onCallPage,
            })
            : EmptyState('No tool calls in this range.'))))
  }

  /** One inventory row's inline detail. */
  function ToolDetail(row, onClose) {
    return h('dl', { className: 'mti-detail' },
      h('div', null, h('dt', null, 'Owner'), h('dd', { className: 'mti-mono' }, row.owner ?? '—')),
      h('div', null, h('dt', null, 'Kind'), h('dd', null, row.kind)),
      h('div', null, h('dt', null, 'State'), h('dd', null, Pill(row.state, { 'data-state': row.state }))),
      h('div', null, h('dt', null, 'Calls'), h('dd', null, row.calls === null ? 'never called' : formatNumber(row.calls))),
      h('div', null, h('dt', null, 'Success'), h('dd', null, formatPercent(inventorySuccessRate(row)))),
      h('div', null, h('dt', null, 'Last used'), h('dd', null, formatAgo(row.lastUsed))),
      h('div', null, h('dt', null, 'Extension'), h('dd', { className: 'mti-mono' }, row.extension ?? '—')),
      h('div', null, h('dt', null, 'Version'), h('dd', null, row.extensionVersion ?? row.contractVersion ?? '—')),
      h('div', null, h('dt', null, 'Arguments'), h('dd', null, row.argumentCount === null ? '—' : String(row.argumentCount))),
      h('div', null, h('dt', null, 'MCP'), h('dd', null, row.mcpExposed === false ? 'withheld from MCP' : row.mcpExposed === true ? 'exposed' : '—')),
      h('div', { style: { gridColumn: '1 / -1' } },
        typeof row.description === 'string' && row.description.length > 0
          ? h('dd', { className: 'mti-muted' }, row.description) : h('dd', { className: 'mti-muted' }, 'No description reported.' )),
      h('div', { style: { gridColumn: '1 / -1' } },
        h('button', { type: 'button', className: 'mti-btn', onClick: onClose }, 'Close detail')))
  }

  /** The Tool Inventory tab. */
  function InventoryView(props) {
    const model = isObject(props.model) ? props.model : filterAndGroupInventory([], {})
    const filters = isObject(props.filters) ? props.filters : {}
    const rows = Array.isArray(model.filtered) ? model.filtered : []
    return h('div', { role: 'tabpanel', id: 'mti-panel-inventory', 'aria-labelledby': 'mti-tab-inventory' },
      h('div', { className: 'mti-head' },
        h('div', null,
          h('h2', { className: 'mti-title' }, 'Tool Inventory'),
          h('p', { className: 'mti-sub' },
            'Every registered tool, grouped by origin. State and provenance come from the host; usage columns join the '
            + 'same report as the workbench. A tool with no calls is kept and labelled.')),
        h('div', { className: 'mti-actions' },
          h('button', { type: 'button', className: 'mti-btn', onClick: () => props.onBack() }, 'Back to workbench'))),
      model.available === false ? Banner(model.banner, 'warn') : null,
      h('div', { className: 'mti-filters' },
        h('div', { className: 'mti-field' },
          h('label', { htmlFor: 'mti-inv-search' }, 'Search'),
          h('input', {
            id: 'mti-inv-search', className: 'mti-input', type: 'search', value: filters.query ?? '',
            placeholder: 'Tool, owner or description',
            onChange: event => props.onFilter({ query: event.target.value }),
          })),
        h('div', { className: 'mti-field' },
          h('label', { htmlFor: 'mti-inv-origin' }, 'Origin'),
          h('select', {
            id: 'mti-inv-origin', className: 'mti-select', value: filters.origin ?? 'all',
            onChange: event => props.onFilter({ origin: event.target.value }),
          }, h('option', { value: 'all' }, 'All origins'), h('option', { value: 'core' }, 'DSH core'),
          h('option', { value: 'tool-mode' }, 'Tool Mode'), h('option', { value: 'custom' }, 'Custom tools'), h('option', { value: 'other' }, 'Other plugins'))),
        h('div', { className: 'mti-field' },
          h('label', { htmlFor: 'mti-inv-state' }, 'State'),
          h('select', {
            id: 'mti-inv-state', className: 'mti-select', value: filters.state ?? 'all',
            onChange: event => props.onFilter({ state: event.target.value }),
          }, h('option', { value: 'all' }, 'All states'), h('option', { value: 'active' }, 'active'),
          h('option', { value: 'prepared-cold' }, 'prepared-cold'), h('option', { value: 'failed' }, 'failed'))),
        h('div', { className: 'mti-field' },
          h('label', { htmlFor: 'mti-inv-size' }, 'Per page'),
          h('select', {
            id: 'mti-inv-size', className: 'mti-select', value: String(props.pageSize ?? 25),
            onChange: event => props.onPageSize(Number(event.target.value)),
          }, TOOL_PAGE_SIZES.map(size => h('option', { key: size, value: String(size) }, String(size)))))),
      rows.length === 0
        ? EmptyState('No tools match these filters.')
        : h('div', null,
          model.groups.map(group => h('div', { key: group.origin },
            h('div', { className: 'mti-group-title' }, group.label + ' · ' + String(group.rows.length)),
            h('table', { className: 'mti-table' },
              h('thead', null, h('tr', null,
                h('th', { scope: 'col' }, 'Tool'),
                h('th', { scope: 'col', className: 'mti-col-optional' }, 'Owner'),
                h('th', { scope: 'col' }, 'Kind'),
                h('th', { scope: 'col' }, 'State'),
                h('th', { scope: 'col', className: 'mti-num' }, 'Calls'),
                h('th', { scope: 'col', className: 'mti-num' }, 'Success'),
                h('th', { scope: 'col', className: 'mti-num mti-col-optional' }, 'Last used'),
                h('th', { scope: 'col' }, 'MCP'))),
              h('tbody', null, group.rows.map(row => h('tr', { key: row.name },
                h('td', null, h('button', {
                  type: 'button', className: 'mti-tool-link', onClick: () => props.onSelect(row.name),
                }, row.name)),
                h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted mti-mono' }, row.owner ?? '—')),
                h('td', null, row.kind),
                h('td', null, Pill(row.state, { 'data-state': row.state })),
                h('td', { className: 'mti-num' }, row.calls === null ? h('span', { className: 'mti-muted' }, 'never called') : formatNumber(row.calls)),
                h('td', { className: 'mti-num' }, formatPercent(inventorySuccessRate(row))),
                h('td', { className: 'mti-num mti-col-optional' }, formatAgo(row.lastUsed)),
                h('td', null, row.mcpExposed === false
                  ? Pill('withheld from MCP', { 'data-ok': 'false' })
                  : row.mcpExposed === true ? Pill('exposed', { 'data-ok': 'true' }) : h('span', { className: 'mti-muted' }, '—')))))))),
          Pager(model.info, props.onPage, 'tools')),
      props.selected === null || props.selected === undefined
        ? null
        : (() => {
          const row = rows.find(candidate => candidate.name === props.selected)
          return row === undefined ? null : h('div', null, ToolDetail(row, () => props.onSelect(null)))
        })())
  }

  /** Dedicated Model as Tool configuration tab. */
  function SettingsView(props) {
    return h('div', { role: 'tabpanel', id: 'mti-panel-settings', 'aria-labelledby': 'mti-tab-settings' },
      typeof props.settings === 'function'
        ? props.settings()
        : h('p', { className: 'mti-sub' }, 'Model as Tool configuration is not available on this host.'))
  }

  /** The MCP tab. */
  function McpView(props) {
    const model = isObject(props.model) ? props.model : mcpView(null, null, {})
    const clients = Array.isArray(model.clients) ? model.clients : []
    const withheld = Array.isArray(model.withheld) ? model.withheld : []
    const exposed = Array.isArray(model.exposed) ? model.exposed : []
    const header = h('div', { className: 'mti-head' },
      h('div', null,
        h('h2', { className: 'mti-title' }, 'MCP'),
        h('p', { className: 'mti-sub' },
          'The external MCP surface: the configured endpoint, the clients that actually hold a grant, which tools are '
          + 'exposed, and the persisted external call log. Tokens, arguments and results are never shown.')),
      h('div', { className: 'mti-actions' },
        h('button', { type: 'button', className: 'mti-btn', onClick: () => props.onBack() }, 'Back to workbench')))
    const endpointCard = Card('Endpoint', model.enabled ? null : 'disabled',
      model.enabled === false
        ? EmptyState('MCP endpoint is disabled on this host.')
        : h('dl', { className: 'mti-kv' },
          h('dt', null, 'Endpoint'), h('dd', { className: 'mti-mono' }, model.endpoint ?? '—'),
          h('dt', null, 'Transport'), h('dd', null, model.transport ?? '—'),
          h('dt', null, 'Auth'), h('dd', null, model.scheme ?? '—'),
          h('dt', null, 'Token file'), h('dd', { className: 'mti-mono' }, model.tokenFile ?? 'configured outside this page'),
          h('dt', null, 'Uptime'), h('dd', null, formatDuration(model.uptimeMs))))
    const exposureCard = Card('Exposure', 'model_tools is host-local and withheld by design',
      h('dl', { className: 'mti-kv' },
        h('dt', null, 'Exposed'),
        h('dd', null, 'Exposed ' + String(model.exposedCount) + ' of ' + String(model.exposedCount + model.withheldCount) + ' tools'),
        h('dt', null, 'Withheld'),
        h('dd', null, withheld.length === 0
          ? h('span', { className: 'mti-muted' }, 'None reported')
          : withheld.map(name => Pill(name, { 'data-ok': 'false', key: name }))),
        h('dt', null, 'Tools'),
        h('dd', { className: 'mti-muted mti-mono' }, exposed.length === 0 ? '—' : exposed.slice(0, 12).join(', '))))
    const clientsTable = h('table', { className: 'mti-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Client'),
        h('th', { scope: 'col', className: 'mti-num' }, 'Calls'),
        h('th', { scope: 'col', className: 'mti-num' }, 'Success'),
        h('th', { scope: 'col', className: 'mti-num' }, 'Last seen'))),
      h('tbody', null, clients.map(client => h('tr', { key: client.id },
        h('td', null, h('span', { className: 'mti-name mti-mono' }, client.id)),
        h('td', { className: 'mti-num' }, formatNumber(client.calls)),
        h('td', { className: 'mti-num' }, formatPercent(successRate(client.calls, client.errors))),
        h('td', { className: 'mti-num' }, formatAgo(client.lastSeen))))))
    const clientsCard = Card('Clients', 'identities come from grants, never invented',
      clients.length === 0 ? EmptyState('No MCP client has called this host yet.') : clientsTable)
    const callsTable = h('table', { className: 'mti-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Time'),
        h('th', { scope: 'col' }, 'Tool'),
        h('th', { scope: 'col' }, 'Client'),
        h('th', { scope: 'col', className: 'mti-num' }, 'ms'),
        h('th', { scope: 'col' }, 'Status'),
        h('th', { scope: 'col', className: 'mti-col-optional' }, 'Receipt'))),
      h('tbody', null, model.calls.map((call, index) => h('tr', { key: (call.receiptId ?? call.tool) + String(index) },
        h('td', null, h('span', { className: 'mti-muted' }, formatAgo(call.time, props.now))),
        h('td', null, h('span', { className: 'mti-name' }, call.tool)),
        h('td', null, h('span', { className: 'mti-muted mti-mono' }, call.clientId)),
        h('td', { className: 'mti-num' }, formatDuration(call.totalMs)),
        h('td', null, call.failureClass === undefined
          ? Pill('ok', { 'data-ok': 'true' })
          : Pill(call.failureClass, { 'data-ok': 'false' })),
        h('td', { className: 'mti-col-optional' }, h('span', { className: 'mti-muted mti-mono' }, call.receiptId ?? '—'))))))
    const logCard = Card('External call log', 'persisted ledger; no payloads',
      h('div', null,
        (Array.isArray(model.calls) ? model.calls : []).length === 0
          ? EmptyState('No external MCP calls recorded yet.')
          : callsTable,
        Pager(model.callsInfo, props.onPage, 'calls')))
    return h('div', { role: 'tabpanel', id: 'mti-panel-mcp', 'aria-labelledby': 'mti-tab-mcp' },
      header,
      model.available === false ? Banner(model.banner, 'warn') : null,
      h('div', { className: 'mti-split' }, endpointCard, exposureCard),
      clientsCard,
      logCard)
  }

  /** The sidebar icon for the Tool Insights entry. */
  function ToolInsightsIcon() {
    return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
      h('path', { d: 'M2 13V7M6 13V3M10 13V9M14 13V5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      h('path', { d: 'M2 13h12', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.55 }))
  }

  /** Read one injected Remote answer into a page state. */
  function remoteState(result) {
    if (result === null || result === undefined) return { status: 'unavailable', value: null }
    if (isObject(result) && typeof result.ok === 'boolean') {
      return result.ok === true
        ? { status: 'ready', value: result.value }
        : { status: 'error', value: null, text: typeof result.error === 'object' && result.error !== null && typeof result.error.message === 'string' ? result.error.message : 'The host refused the request.' }
    }
    return { status: 'ready', value: result }
  }

  /**
   * Page-lifetime caches. Opening the page again reconstructs the component,
   * so component state alone would refetch every tab; these survive the
   * remount and make Inventory/MCP instant until their TTL expires.
   */
  const REPORT_TTL_MS = 30_000
  const INVENTORY_TTL_MS = 5 * 60_000
  const MCP_TTL_MS = 30_000
  const reportCache = new Map()
  const inventoryCache = { value: null, at: 0 }
  const mcpCache = { value: null, calls: null, at: 0 }

  /**
   * The page. Root props come from the host (`useSessions`, `useWorkspaces`);
   * the injected `call`, `openSession` and `now` come from the registration.
   */
  function ToolInsightsPage(props) {
    const options = isObject(props) ? props : {}
    const sessionState = typeof options.useSessions === 'function' ? options.useSessions(state => state) : null
    const rows = isObject(sessionState) && Array.isArray(sessionState.ids)
      ? sessionState.ids.map(id => (isObject(sessionState.byId) ? sessionState.byId[id] : undefined)).filter(row => isObject(row))
      : []

    const initialHash = typeof location !== 'undefined' && location !== null ? location.hash : ''
    const [tab, setTab] = React.useState(() => readTabFromHash(initialHash))
    const [range, setRange] = React.useState('7d')
    const cachedReport = reportCache.get('7d')
    const [report, setReport] = React.useState(() => cachedReport === undefined
      ? { status: 'loading', value: null }
      : { status: 'ready', value: cachedReport.value })
    const [inventory, setInventory] = React.useState(() => inventoryCache.at === 0
      ? { status: 'loading', value: null }
      : { status: 'ready', value: inventoryCache.value })
    const [mcp, setMcp] = React.useState(() => mcpCache.at === 0
      ? { status: 'loading', value: null, calls: null }
      : { status: 'ready', value: mcpCache.value, calls: mcpCache.calls })
    const [toolPage, setToolPage] = React.useState(1)
    const [toolPageSize, setToolPageSize] = React.useState(7)
    const [callPage, setCallPage] = React.useState(1)
    const [callPageSize, setCallPageSize] = React.useState(10)
    const [inventoryPage, setInventoryPage] = React.useState(1)
    const [inventoryPageSize, setInventoryPageSize] = React.useState(25)
    const [inventoryFilters, setInventoryFilters] = React.useState({ query: '', origin: 'all', state: 'all' })
    const [mcpPage, setMcpPage] = React.useState(1)
    const [expanded, setExpanded] = React.useState({})
    const [selectedTool, setSelectedTool] = React.useState(null)
    const reportRequest = React.useRef(0)

    const call = typeof options.call === 'function' ? options.call : null
    const now = typeof options.now === 'function' ? options.now() : Date.now()

    /**
     * Load the report for one range DIRECTLY from the range control as well as
     * from the mount effect. The gateway is not the only place this can fail:
     * an effect that updates its dependency array without executing leaves the
     * previous range's report on screen under the new label. A request counter
     * makes a slow answer for the old range unable to overwrite the new one.
     */
    const loadReport = nextRange => {
      const request = ++reportRequest.current
      if (call === null) {
        setReport({ status: 'unavailable', value: null })
        return
      }
      setReport({ status: 'loading', value: null })
      Promise.resolve(requestUsageReport(call, nextRange, now)).then(result => {
        if (request !== reportRequest.current) return
        const state = remoteState(result)
        if (state.status === 'ready') reportCache.set(nextRange, { value: state.value, at: Date.now() })
        setReport(state)
      }, error => {
        if (request === reportRequest.current) {
          setReport({ status: 'error', value: null, text: String((error && error.message) || error) })
        }
      })
    }

    const selectTab = next => {
      const id = readTabFromHash('#' + String(next))
      setTab(id)
      try {
        if (typeof location !== 'undefined' && location !== null && typeof history !== 'undefined' && history !== null
          && typeof history.replaceState === 'function') history.replaceState(null, '', tabHash(id))
      } catch (error) {
        // A host without history keeps the local tab state; the hash is a convenience.
      }
    }

    React.useEffect(() => {
      const onHash = () => setTab(readTabFromHash(typeof location !== 'undefined' && location !== null ? location.hash : ''))
      if (typeof window !== 'undefined' && window !== null && typeof window.addEventListener === 'function') {
        window.addEventListener('hashchange', onHash)
        return () => window.removeEventListener('hashchange', onHash)
      }
      return undefined
    }, [])

    React.useEffect(() => {
      if (call === null) {
        setReport({ status: 'unavailable', value: null })
        return
      }
      const cached = reportCache.get(range)
      if (cached !== undefined && Date.now() - cached.at < REPORT_TTL_MS) {
        setReport({ status: 'ready', value: cached.value })
        return
      }
      loadReport(range)
    }, [call, range])

    React.useEffect(() => {
      if (tab !== 'inventory') return
      if (call === null) {
        setInventory({ status: 'unavailable', value: null })
        return
      }
      if (inventoryCache.at !== 0 && Date.now() - inventoryCache.at < INVENTORY_TTL_MS) {
        setInventory({ status: 'ready', value: inventoryCache.value })
        return
      }
      let alive = true
      setInventory({ status: 'loading', value: null })
      Promise.resolve(call('toolInventory')).then(result => {
        const state = remoteState(result)
        if (!alive) return
        if (state.status === 'ready') {
          inventoryCache.value = state.value
          inventoryCache.at = Date.now()
        }
        setInventory(state)
      }, error => {
        if (alive) setInventory({ status: 'error', value: null, text: String((error && error.message) || error) })
      })
      return () => { alive = false }
    }, [call, tab])

    React.useEffect(() => {
      if (tab !== 'mcp') return
      if (call === null) {
        setMcp({ status: 'unavailable', value: null, calls: null })
        return
      }
      if (mcpCache.at !== 0 && Date.now() - mcpCache.at < MCP_TTL_MS) {
        setMcp({ status: 'ready', value: mcpCache.value, calls: mcpCache.calls })
        return
      }
      let alive = true
      setMcp({ status: 'loading', value: null, calls: null })
      Promise.resolve(call('mcpStatus')).then(result => {
        const state = remoteState(result)
        if (!alive) return
        if (state.status !== 'ready') {
          setMcp(state.status === 'unavailable'
            ? { status: 'unavailable', value: null, calls: null }
            : { status: 'error', value: null, calls: null, text: state.text })
          return
        }
        setMcp({ status: 'ready', value: state.value, calls: null })
        Promise.resolve(requestMcpCalls(call, 1, 50)).then(calls => {
          if (!alive) return
          const callState = remoteState(calls)
          mcpCache.value = state.value
          mcpCache.calls = callState.value
          mcpCache.at = Date.now()
          setMcp({ status: 'ready', value: state.value, calls: callState.value })
        }, () => {
          if (!alive) return
          mcpCache.value = state.value
          mcpCache.calls = null
          mcpCache.at = Date.now()
          setMcp({ status: 'ready', value: state.value, calls: null })
        })
      }, error => {
        if (alive) setMcp({ status: 'error', value: null, calls: null, text: String((error && error.message) || error) })
      })
      return () => { alive = false }
    }, [call, tab])

    const projection = aggregateProjections(rows)
    const inventoryValue = inventory.status === 'ready' && isObject(inventory.value) ? inventory.value : null
    const inventoryTools = inventoryValue !== null && Array.isArray(inventoryValue.tools) ? inventoryValue.tools : []
    const toolsAvailable = inventoryTools.length > 0 ? inventoryTools.length : null
    const model = deriveInsights({
      projection,
      report: report.status === 'ready' ? report.value : null,
      range,
      now,
      toolsAvailable,
    })
    const inventoryModel = filterAndGroupInventory(inventoryTools, {
      ...inventoryFilters,
      page: inventoryPage,
      pageSize: inventoryPageSize,
    })
    const mcpModel = mcpView(mcp.value, mcp.calls, { page: mcpPage, pageSize: 10 })

    let body
    if (tab === 'inventory') {
      body = InventoryView({
        model: inventory.status === 'ready' ? inventoryModel : {
          available: false,
          banner: inventory.status === 'loading'
            ? 'Reading the tool inventory from the host…'
            : inventory.status === 'error'
              ? (inventory.text || 'The host refused the tool inventory request.')
              : 'The tool inventory is not available on this host build (the toolInventory remote method is absent).',
          groups: [], filtered: [], total: 0, info: pageInfo(0, inventoryPageSize, 1),
        },
        filters: inventoryFilters,
        page: inventoryPage,
        pageSize: inventoryPageSize,
        selected: selectedTool,
        onFilter: patch => {
          setInventoryFilters(previous => ({ ...previous, ...patch }))
          setInventoryPage(1)
        },
        onPage: page => setInventoryPage(page),
        onPageSize: size => { setInventoryPageSize(size); setInventoryPage(1) },
        onSelect: name => setSelectedTool(name ?? null),
        onBack: () => selectTab('insights'),
      })
    } else if (tab === 'mcp') {
      body = McpView({ model: mcpModel, page: mcpPage, onPage: page => setMcpPage(page), onBack: () => selectTab('insights') })
    } else if (tab === 'create') {
      body = typeof CreateToolView === 'function'
        ? CreateToolView({ call: options.call })
        : Banner('The Create tool editor is unavailable in this build.', 'mti-banner mti-banner-warn')
    } else if (tab === 'settings') {
      body = SettingsView({ settings: options.settings })
    } else {
      body = InsightsView({
        model,
        range,
        now,
        toolPage,
        toolPageSize,
        callPage,
        callPageSize,
        expanded,
        onSelectRange: next => { setRange(next); setToolPage(1); setCallPage(1); loadReport(next) },
        onOpenInventory: () => selectTab('inventory'),
        onToolPage: page => setToolPage(page),
        onCallPage: page => setCallPage(page),
        onToggleCall: key => setExpanded(previous => ({ ...previous, [key]: previous[key] !== true })),
        onSelectTool: name => { setSelectedTool(name); selectTab('inventory') },
        onCallPageSize: size => { setCallPageSize(size); setCallPage(1) },
      })
    }

    return h('div', { className: 'mti-page', 'data-page': 'tool-insights' },
      h('style', null, CSS),
      TabBar({ tab, onSelect: selectTab }),
      body)
  }

  return {
    // pure helpers (tests and the registration both use them)
    PALETTE,
    TABS,
    RANGES,
    TOOL_PAGE_SIZES,
    readTabFromHash,
    tabHash,
    formatNumber,
    formatPercent,
    formatDuration,
    formatBytes,
    formatAgo,
    pageInfo,
    paginate,
    normalizeProjection,
    aggregateProjections,
    normalizeReport,
    deriveInsights,
    rangeWindow,
    reportQuery,
    requestUsageReport,
    requestMcpCalls,
    groupCallRows,
    filterAndGroupInventory,
    inventorySuccessRate,
    originOf,
    normalizeMcpStatus,
    mcpView,
    // components
    Card,
    Kpi,
    Pager,
    TabBar,
    Banner,
    EmptyState,
    CallsPerDay,
    ModelLeaderboard,
    ToolPerformanceTable,
    AllCallsTable,
    InsightsView,
    InventoryView,
    McpView,
    SettingsView,
    ...(typeof CreateToolView === 'function' ? { CreateToolView } : {}),
    ToolInsightsPage,
    ToolInsightsIcon,
  }
}
