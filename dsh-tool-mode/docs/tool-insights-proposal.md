# Tool Insights — proposal for a Tool Mode first-level page

Status: proposal approved for Direction B. Implementation plan:
[tool-insights-implementation-plan.md](tool-insights-implementation-plan.md). Based on a read of `bowenliang123/dsh-context`
(v0.74.0), DSH's `session-projection` contract, and the Tool Mode plugin's existing client
surface.

## 1. What dsh-context does that we should copy

The Context Insights page is built from four separable pieces:

| Piece | dsh-context mechanism | Relevance |
| --- | --- | --- |
| Sidebar row | `slots.register({ name: 'sidebar.panellist', id, order, label })` | exact same slot we need |
| Center page | `slots.register({ name: 'main', key: id })` — `id` and `key` are the same value | how the row opens a full page |
| Data | per-session `ctx.sessionProjections` units (`contextTimeline`, `contextActivity`, `contextHeaders`) read from `session.list` rows' `projectionValues` | durable, replayable, no polling API |
| Attribution | host-side `createToolAttribution(ctx)`: wraps `tools.register`, peeks at `ctx.tools` boot entries, plus a pinned first-party map and `mcp__<server>__` grammar | answers "which plugin owns this tool" |

Orders in the shipped sidebar: Plugins `0`, Automation tasks `10`; dsh-context uses `20`.
Its page reads the root slot props `useSessions` and `useWorkspaces`, which already carry
every session row (`cwd`, `title`, `updatedAt`, `origin`, `projectionValues`) and the
workspace→sessionIds grouping. It does not need its own HTTP API for the overview.

DSH also has an existing `sessionStats` projection with `toolMs` and step counts, but it has
no per-tool detail. We need our own unit.

## 2. What to display

The selected B direction is one page with three sibling tabs above the title:
**Tool Insights** (usage), **Tool Inventory** (provenance/availability) and **MCP** (endpoint,
clients, exposure and external call log). The sidebar entry opens Tool Insights; the Tools
panel's `Inventory →` selects the inventory tab; MCP is a peer tab, not a settings sub-page.

Page title **Tool Insights**, with a range control (24h / 7d / 30d / All). Suggested layout,
matching the density of the Context Insights screenshot:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Tool Insights        [24h | 7d | 30d | All]        Updated 2m ago   [Export] │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌ Calls 2,148 ┐ ┌ Tools used 27/41 ┐ ┌ Success 98.4% ┐ ┌ Tool time 1h10m ┐  │
│ ┌ Sessions 57 ┐ ┌ Calls/session 37 ┐ ┌ p50 132ms    ┐ ┌ Code Mode 4.8% ┐  │
├───────────────────────────────────────────┬──────────────────────────────────┤
│ Calls per day  (bar: success / error)     │ Owner mix (donut)                │
│                                           │ built-ins · extensions · MCP · TM │
├───────────────────────────────────────────┴──────────────────────────────────┤
│ Activity heatmap (8 weeks × calls)        │ Hour-of-day distribution         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Tool leaderboard                                                             │
│ Tool        Owner                          Calls  Err%  p50   p95   Last used │
│ read        @deepseek-ai/dsh-tool-fs        812   0.4%  28ms  210ms  2m ago   │
│ lang_detect @try-works/extension-...tongue   96   1.0%  1.1s  2.4s   5m ago   │
│ tool_mode_run @try-works/dsh-tool-mode   41   2.4%  25s   48s    5m ago   │
│ … click a row → detail drawer (recent calls, error codes, sessions, sparkline)│
├──────────────────────────────────────────────────────────────────────────────┤
│ Models using tools   model · provider · calls · distinct tools · success · p50│
│ deepseek-v3.1  5,840 calls · 31 tools · 98.8% · 112ms   ← tool-call leader   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Tool performance     tool · calls · succ · p50 · p95 · max · total · code · last│
│ read  4,812 · 99.6% · 28ms · 210ms · 1.4s · 4m12s · — · 2m                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Workspaces            stacked calls per workspace, sessions, top tools       │
├──────────────────────────────────────────────────────────────────────────────┤
│ Sessions              cards: title · workspace · calls · top tools · ring    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Recent calls          time · tool · owner · session/workspace · ms · status  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Sections and the question each answers:

| Section | Answers |
| --- | --- |
| KPI band | How much, how often, how healthy — calls, distinct tools vs available, success rate, tool time, sessions using tools, calls/session, p50 latency, Code Mode share |
| Calls per day | When did tools run; error overlay |
| Owner mix | Which plugins/extensions/MCP servers are actually used |
| Heatmap + hour distribution | Work rhythm at day/hour granularity |
| Tool leaderboard | Per tool: calls, error rate, p50/p95, last used, owner, availability; click for detail |
| Tool performance table | Per tool, per call: calls, success rate, p50 / p95 / max duration, summed tool time, share of calls that were Code Mode sub-calls, first and last used; sortable columns; a row selects the tool in the inspector. Paginated (7 / 15 / 30 rows per page) with a showing-range, page count and prev/next controls, so all tools remain reachable. |
| Model leaderboard | Which model used tools most: calls, distinct tools, success rate and median latency per model, sorted by calls; click a model to filter the page |
| Workspaces | Which workspace drives usage; calls per workspace and sessions |
| Session cards | Which session used what; top tools and a compact owner ring; click opens the session |
| All calls | Paginated call history (range, page size, page controls); a Code Mode parent row expands in place to show its component tool calls, each with its own duration and status while sharing the parent session and workspace. |
| Recent calls | Live tail with status and duration; the debugging view |
| Tool Inventory tab | All 41 registered tools grouped by origin (DSH core / Tool Mode / other plugins), with kind, availability (active / prepared-cold / failed), calls, success and last used; search, origin and state filters, sort, and pagination. Also reachable from `Inventory →` in the Tools panel; a row opens the same tool detail as the workbench. |
| MCP tab | Endpoint (`http://127.0.0.1:3765/mcp`), transport/auth state, uptime and 7d calls; connected clients with call volume/success/last seen; exposed tools (21 of 41) with withheld count; paginated external call log with client, duration, status and receipt. |

Deliberate exclusions: no prompt/argument/result bodies (only argument/result byte sizes), no
receipts table (receipts are per tool-mode call and already surfaced by the chat card), no
cost attribution (tool calls have no token cost; keep cost out of this page).

## 3. Data model

### 3.1 Host projection: `toolModeUsage`

A new session-projection unit registered by the host half (declare-merge into
`SessionProjectionMap` / `SessionProjectionStateMap`). Pure fold over DSH session events:

- `tool/call` `{ turn, step, callId, name, arguments }` → remember `callId → { name, start,
  turn, step, argsBytes }` (pending map, capped).
- `tool/result` `{ turn, step, message, error? }` → join by
  `message.source.callId`; duration `max(0, time - start)`; success = no `error` and
  `message.content` carries no `isError`; record `error.code` only (class-level).
- `tool/ptc-dispatch-start` / `tool/ptc-dispatch` → same aggregation for **Code Mode
  sub-calls** (`subCallId`, `name`, `arguments`, `isError`, `error.code`), marked
  `kind: 'code'`. This is how Code Mode's real calls are counted; `tool_mode_run` itself is
  one direct call. The dispatch's `parentCallId`/`rootCallId` links each sub-call to its
  parent, so the history table can indent it under the `tool_mode_run` row while keeping its
  own duration, status and origin. Sub-calls inherit the parent's session, workspace and
  model but never contribute to the parent's duration.
- `turn/end` → drop unmatched pending calls (cancelled turns).

**Model attribution.** Each tool call belongs to the model that emitted it. The fold keeps
the step's route (`request/header` config model/provider, updated only at an epoch boundary)
and the emitting assistant message's model; a call records that model. Code Mode sub-calls
inherit the parent program's model. A step that switched route mid-turn still attributes each
call to the route in force at its `tool/call`. Calls with no readable model (legacy logs, or
external MCP calls, which are not session events) land in an explicit `unattributed` bucket,
never under a guessed model.

Compact client-visible wire (kept small; this rides every `session.list` row):
`{ calls, errors, toolMs, uniqueTools, byOwner: Record<owner, {calls, errors, ms}>, byModel:
Record<model, {calls, errors, tools: number, ms}>, byDay: Record<YYYY-MM-DD, {calls, errors,
ms}>, recent: Array<{time,name,model,ms,ok}≤20>, topTools: Array<{name,calls,ms}>≤5 }`.

Host-only detail unit (`toolModeUsageDetail`, not wired) keeps the exact matrix
`byTool[name].byDay[day]` plus recent ≤200, used by the page's report channel when exact
range filtering is needed. This mirrors dsh-context's "slim wire + detail channel" split so
the session list does not carry the full matrix. The report returns the model rollup
(`calls`, `errors`, `tools`, `ms`, `p50`, `p95`, per day) plus recent calls per model. The
performance and call-history tables paginate client-side over that report (page size does not
change the aggregates), and history rows are grouped parent → sub-call by the dispatch ids.

Each tool's performance keeps `calls`, `errors`, `totalMs`, `maxMs`, first/last used,
argument/result bytes, and a bounded log-scale duration histogram (16 buckets) so the report
can produce p50/p95 without retaining every duration. Elapsed time is `tool/result.time −
tool/call.time`; cancelled calls with no result count as unsettled and are excluded from
percentiles (the row shows them separately). Code Mode sub-calls form their own performance
rows and do not double-count the parent `tool_mode_run`.

Bounds: 100 tools/session, 20 models/session, 16 duration buckets/tool, 60 days, 100 pending
calls, 200 recent calls; strict zod schemas; `stateVersion: 1`. All state plain JSON
(projection cache requirement).

### 3.2 Owner attribution

A host-side resolver, built from live data, not guesses:

1. Active extension manifests in the store: `tools[].name → extensionId` and
   `implementations[].contractId → extensionId` (covers tongue, voz, needle, EmbeddingGemma,
   MiniLM, Laya, declarative recipes).
2. Tool Mode's own tools: `model_tools`, `tool_mode_run` → `@try-works/dsh-tool-mode`.
3. `mcp__<server>__<tool>` → `mcp:<server>`.
4. Pinned first-party map (copy the factual mapping style from dsh-context, not its code):
   `read/write/edit/read_image → @deepseek-ai/dsh-tool-fs`, `glob/grep → dsh-tool-fs-search`,
   `pwsh → dsh-tool-pwsh`, `web_search/web_fetch → dsh-tool-web`, jobs, todo, plan, skill,
   subagent/agent-team, workflow, schedule, goal, lsp, etc.
5. Anything else → `unattributed` (named, never fabricated).

The same resolver returns description, availability (registered? extension active?
prepared/failed) for the Inventory tab.

### 3.3 Inventory snapshot

The inventory is not a projection: it is a live read of the registry joined with the extension
store, so it can show tools that have never been called.

Per tool: `name`, `description`, owner package/extension, `kind` (built-in / extension / code
mode / other plugin), `state` (active / prepared-cold / failed), extension and contract version,
argument count (not the schema body), and `lastRegistered`. Usage columns (`calls`, `success`,
`lastUsed`) join from `toolUsageReport` by name; a tool with no report row is shown as
`never called` rather than hidden. The same owner resolver as the attribution section provides
provenance, and an unknown owner is labeled, never guessed.

`toolInventory()` in the remote namespace returns the whole list; the client handles search,
origin/state filters, grouping by origin, and pagination. Selecting a row opens the same tool
detail used by the workbench, so the inventory and performance views never disagree.

### 3.4 External MCP calls

Native agent calls exist in session logs; **external MCP `tools/call`s do not** — they are not
session steps. To show them on this page, the MCP host must persist a bounded call ledger:

- Extend the `onAccounted` hook in `mcp/host-binding.ts` to pass the tool name (the current
  `InvocationAccounting` has receipt, timings, sizes, failure class, client/grant id — no
  name).
- In `index.ts`, append to a bounded JSONL (`$DSH_HOME/model-as-tool/mcp-usage.jsonl`, one row
  per call: time, tool, clientId, totalMs, failureClass, input/output bytes, receiptId).
  Rotate/trim at e.g. 5,000 rows; no arguments or results.
- Expose via the remote method (below); the page renders an "External MCP" section with
  calls by client and tool. Workspace is not applicable; label the client.

The **MCP tab** turns that into a surface view: endpoint/transport/auth from the `mcpV3`
config, connected clients with their grant identity and call volume, exposed tools
(`toolSources` filtered to the MCP surface, with `model_tools` always withheld) and a
paginated external call log from the same ledger. It never shows arguments, results or the
token value — only the token file path and the receipt id.

This is optional for v1 but is the honest way to answer "MCP is used, by whom, how often".

### 3.5 Delivery to the client

Two mechanisms, both already used by the plugin:

1. The compact projection arrives free in `session.list` rows' `projectionValues` — the page
   aggregates KPI/day/owner/session cards without an API.
2. A new host remote method (extend `remote/spec.mjs`, regenerate artifacts):
   - `toolSources()` → tool catalog + owner + availability + description;
   - `toolInventory()` → registry + manifest snapshot for the inventory screen (state,
     version, contract, provenance);
   - `mcpStatus()` → endpoint/transport/auth, connected clients, exposed and withheld tools;
   - `mcpCalls({ clientId?, page, pageSize })` → external call history from the ledger;
   - `toolUsageReport({ from, to })` → exact range aggregate from the detail units and the
     external ledger (by tool, owner, workspace input, error code, latency buckets, recent
     calls).
   Client calls it through the existing guarded `modelToolsRemote()` route.

A first page load may need a **backfill**: sessions whose logs predate the unit have no
projection row. A bounded host routine reads stored logs (as dsh-context's
`watchActivityBackfill` does), restores the unit, and reports progress. Until it completes the
page shows "covering N of M sessions" rather than silently undercounting.

## 4. Build plan in this repo

### Host half (`packages/dsh-tool-mode/src/`)

| File | Work |
| --- | --- |
| `tool-usage.ts` (new) | projection units: compact wire + host-only detail; folding helpers; zod schemas; `stateVersion` |
| `tool-sources.ts` (new) | owner resolver (extensions + Tool Mode + MCP grammar + pinned map); catalog snapshots |
| `tool-inventory.ts` (new) | registry + manifest snapshot: name, description, owner, kind, state, version, contract, argument count; join usage by name |
| `tool-usage-report.ts` (new) | range aggregation over projections + external ledger; latency percentiles |
| `external-usage.ts` (new) | bounded JSONL append/read/rotate for external MCP calls |
| `mcp-status.ts` (new) | endpoint/transport/auth from `mcpV3`, connected clients, exposed-tool count, withheld tools |
| `mcp/host-binding.ts` | pass tool name into `onAccounted` |
| `index.ts` | register projection/units and remote methods behind `ctx.inject(['sessionProjections'])`; wire the external ledger only when `mcpV3.enabled` |
| `remote/spec.mjs` + generated artifacts | add `toolSources`, `toolInventory` and `toolUsageReport` descriptors and implementation mapping |

No new runtime dependency: zod and React are already available. Reuse the existing
`modelTools` remote namespace rather than adding another service.

### Client half (`packages/dsh-tool-mode/client/`)

| File | Work |
| --- | --- |
| `tool-insights.js` (new authoring source) | the workbench page; pure aggregation helpers separated for tests |
| `tool-inventory.js` | inventory view: grouped table, search/origin/state filters, sort, pagination; row opens the workbench detail |
| `tool-mcp.js` | MCP view: endpoint/auth, clients, exposed tools, paginated external call log |
| `tool-insights.css` or inline `<style>` in the page | cards, grids, heatmap, bars, table, drawer; use DSH theme variables (`--dsw-alias-bg-base/layer-2`, `--dsw-alias-border-l2`, `--dsw-alias-label-primary/secondary`, `--color-blue-500`, etc.) |
| `gen-client-catalog.mjs` | inline the page (a sibling chunk would 404; same reason the tool cards are inlined) |
| `index.template.js` | in `apply()`: `ctx.slots.inject('main', … key: 'tool-insights')` and `ctx.slots.inject('sidebar.panellist', … id: 'tool-insights', order: 15, label: 'Tool Insights', icon)`; guarded so an older host simply gets no page. The page owns the **Tool Insights / Tool Inventory / MCP** tab state. |
| `package.json` `dsh.client.inject` | add the client packages dsh-context declares for first-level pages: `@deepseek-ai/dsh-client-ui-conversation`, `@deepseek-ai/dsh-client-ui-sidebar-right` (keep settings); verify exact names against the installed DSH |

Page internals:

- Root props: `useSessions`, `useWorkspaces`; read compact projection from
  `row.projectionValues.toolModeUsage`.
- Fetch catalog + exact report through the remote with guarded fallbacks; on failure degrade
  to compact-only aggregation and show a banner.
- Local state: active tab (**Tool Insights / Tool Inventory / MCP**), range, workspace filter,
  owner filter, search, sort, selected tool. The inventory tab has its own origin/state
  filters, grouping and pagination, and no range selector because its usage columns are fixed
  to 30d; `Inventory →` in the Tools panel selects that tab.
- Aggregation memoized by (rows, range, filters); no server round-trip on filter changes when
  the compact data suffices.
- Charts are hand-drawn SVG/CSS (no chart dependency): bars, donut (stroke-dasharray),
  heatmap grid, percentile strips.
- Session click uses the guarded `uiWorkspace.openSession` verb (same as dsh-context), not a
  hard dependency.
- Accessibility: table semantics, keyboard-sortable headers, focus-visible states, ARIA
  labels on chart summaries, no color-only encoding (counts + labels), reduced-motion safe.

### Tests

- Projection unit tests with synthetic events: call/result pairing, missing result on
  `turn/end`, error codes, PTC sub-call pairing, hostile callIds (`constructor`, `toString`),
  caps, day key, JSON purity, stateVersion bump.
- Report tests: range boundaries, percentile math, owner mapping (extension, MCP, pinned,
  unknown), workspace grouping, external ledger merge.
- Client aggregation tests: junk rows, missing projection, filters, sorting, empty state.
- Inventory tests: registry/tool join by name, owner resolution, state derivation
  (active / prepared-cold / failed), never-called rows kept, origin grouping, search/filter,
  pagination bounds, and row selection opening the same detail.
- MCP view tests: exposed/withheld counts, client aggregation, endpoint auth state, call-log
  pagination and client filter, and no token/argument/result leakage.
- Registration tests: `main` key equals `sidebar.panellist` id, order, icon, guarded absence,
  no chunk fetch, bundle includes all three tabs, and the Tools `Inventory →` entry selects
  the inventory tab.
- Live verification on a disposable instance: generate calls across two sessions/workspaces
  with a mix of built-in + extension + Code Mode tools, then screenshot and assert the KPI
  totals against the session logs. Verify a historical session backfills.

## 5. Phasing

| Phase | Scope | Outcome |
| --- | --- | --- |
| P0 — spike (½–1 day) | register a dummy `main` + `sidebar.panellist` entry from Tool Mode on a disposable host; confirm page props/`projectionValues`; confirm sidebar order | proves the surface before real work |
| P1 — core (2–3 days) | projection (direct + PTC), owner resolver, model attribution, KPI band, calls/day, tool + model leaderboards, recent calls, sidebar entry | useful page with all-time/recent data |
| P2 — context (2–3 days) | workspaces, session cards, heatmap/hour, detail drawer, range filters, exact report endpoint, backfill, external MCP ledger/section, inventory tab, MCP tab | parity with the Context Insights feel |
| P3 — completeness (1–2 days) | inventory tab, export, accessibility and responsive pass, docs/screenshot | feature complete |

## 6. Decisions (locked)

1. **Position**: "Tool Insights" at **order 15**, immediately after Automation tasks and before
   Context Insights.
2. **Scope**: **all tools**, with origin shown as **DSH core / Tool Mode / other plugins**
   (plus MCP clients for external calls).
3. **External MCP telemetry**: **included** — persisted call ledger, with client, latency and
   failure class.
4. **Historical coverage**: **backfill on first open**, with visible coverage while it runs.
5. **Subagents**: **included and badged** (`SUBAGENT`), never merged silently into a parent.
6. **Visual language**: **dsh-context components** — KPI cards, segmented range, donut, heatmap,
   leaderboard, session cards.
7. **Direction**: **B — Tool workbench** is selected. It is recolored from its original green
   accent to the blue system shown on its cover card, and now carries the paginated per-tool
   performance table between the workbench and the model leaderboard. Its All calls table is
   paginated and expands Code Mode parent rows into their component sub-calls. B is a tabbed
   page: **Tool Insights**, **Tool Inventory** (grouped, paginated) and **MCP** (endpoint,
   clients, exposed tools and external call log). A and C remain on the sheet for comparison.

Selected palette: primary `#4F63FF`, tint `#E9EDFF`, page `#F7F8FC`, main surface
`#F8F9FD`, border `#E5E8F2`, ink `#0B1015`, muted `#5F6B80`, failure `#B7791F`.

Paper review sheet: <https://app.paper.design/file/01M4W17M77729GE195KMVC283K/p-8-0> — cover
plus three desktop layouts (A analytics console, **B tool workbench — selected**, C activity
timeline). B now uses the blue scheme from its cover card.
Direction C keeps its activity-first page and embeds B's two inspector panels — the ranked tool
list and the full tool detail — as a full-width "Tool inspector" section below the stream,
preceded by a per-tool performance table (calls, success, p50/p95/max, total time, Code Mode
share, last used) whose rows select the tool shown in the inspector.

## 7. Risks / notes

- **Attribution is best-effort for historical calls**: a tool registered before Tool Mode
  started has no live registration to observe; the pinned map plus extension manifests cover
  the current catalog, and anything else is marked unattributed.
- **Projection payload growth**: the compact wire must stay small; exact per-tool/day data
  lives in the host-only unit and is fetched only when the page asks.
- **External calls need the ledger**; `model_tools` remains host-local and must never appear in
  the tool catalog exposed to MCP.
- **Model attribution is step-scoped**: a route change applies from its `request/header`
  onward; a model alias rename splits the leaderboard by the name the log carried. External
  MCP calls have no model and are counted separately, not in the model leaderboard.
- **Tool latency percentiles are histogram-derived** (16 log-scale buckets per tool), so a
  p95 is an approximation over settled calls; MAX is exact. Cancelled calls without a result
  are reported as unsettled and excluded from the percentiles.
- **Day/hour bucketing is host-local time**, matching dsh-context; note it in the UI.
- **Old DSH versions** may lack `main`/`sidebar.panellist`; registration must be optional so
  the Settings page keeps working.
- No receipt/argument/result bodies are stored; only names, times, durations, error codes and
  byte sizes. That keeps the page observationally useful without becoming a payload archive.
