# Tool Insights — host contract (task-13)

Status: host half implemented; client tolerance confirmed by task-14. The methods are
ADDITIVE on the existing `modelTools` namespace and are absent on an older host.

## Projection (rides `session.list` rows)

Unit key `toolModeUsage`, `stateVersion: 1`. The projection STATE is the host-only detail;
the WIRE is compact:

```ts
{ stateVersion: 1, calls, errors, unsettled, toolMs, uniqueTools,
  byOwner: Record<owner, {calls, errors, ms}>,
  byModel: Record<model, {calls, errors, tools, ms}>,
  byDay: Record<YYYY-MM-DD, {calls, errors, ms, unsettled}>,
  recent: Array<{time,name,model,ms|null,ok|null,kind,code}> (≤20),
  topTools: Array<{name,calls,ms}> (≤5) }
```

`ok: null` = never settled. `model` is the emitting model or `unattributed`. Code Mode
sub-calls are separate `kind:'code'` records linked by root/parent ids and never inflate
the parent duration. Bounds: pending 100, recent 200, tools 100, models 20, days 60,
histogram 16 buckets. The projection is registered through an OPTIONAL
`ctx.inject(['sessionProjections'], …)`; absent projections degrade the page, never throw.

The host half declares `SessionProjectionMap.toolModeUsage` / `.stateMap.toolModeUsage`.
Its schemas are hand-written strict `parse(value)` boundaries rather than zod: the harness
checkout and this workspace resolve different zod copies, so a structurally identical
object is not assignable across them (and the plugin must not add a second runtime dep).

## Remote methods

### `toolUsageReport({ from?, to?, range? })`
`range` defaults to `7d`; explicit `from`/`to` win. Client contract (flat):

```ts
{ range, from, to,
  calls, errors, unsettled, toolMs, codeCalls, sessions, uniqueTools, successRate,
  p50, p95,
  tools: [{ name, owner, calls, errors, unsettled, codeCalls, directCalls,
            totalMs, maxMs, p50, p95, firstUsed, lastUsed, argsBytes, resultBytes }],
  models: [{ model, calls, errors, tools, ms, p50, p95 }],
  days: [{ day, calls, errors, ms, unsettled }],
  workspaces: [{ workspace, sessions, calls, errors, ms }],
  errorCodes: [{ code, calls }],
  recentCalls: [{ time, name, owner, model, ms, ok, errorCode, kind, callId,
                  parentCallId, sessionId, workspace }],
  histogramScope: 'retained' }
```

Percentiles are histogram-derived approximations over retained settled calls; `maxMs` is
exact for the window. `from` inclusive, `to` exclusive at the millisecond level; day
rollups are host-local `YYYY-MM-DD` and include both boundary days.

### `toolSources()` → `{ tools: [{ name, description, owner, kind, origin }] }`
`kind`: built-in | extension | tool-mode | mcp | unknown. `origin`: dsh-core | extension |
tool-mode | mcp | unknown. An unrecognised owner is the literal `unattributed`.

### `toolInventory()` → `{ tools: [...] }`
Rows: `{ name, description, owner, kind, origin, state, extension, version,
extensionVersion, contractVersion, argumentCount, lastRegistered, mcpExposed, calls,
success, lastUsed }`. `state`: active | prepared-cold | failed. `model_tools` is always
present with `mcpExposed: false`.

### `mcpStatus()` → flat client contract
```ts
{ enabled, listening,
  endpoint: { host, port, path, url } | null,
  configured: { host, port, path } | null,
  transport: 'http',
  auth: { scheme, mode, tokenFile },       // never the token
  uptimeMs,
  clients: [{ clientId, id, label, grantId, calls, errors, lastSeen }],
  exposed: string[], withheld: string[], exposedCount, withheldCount }
```
A disabled endpoint reports `listening:false`, `endpoint:null`, `uptimeMs:0`. `model_tools`
is always withheld.

### `mcpCalls({ clientId?, page?, pageSize? })` → `{ total, calls, page, pageSize, clients }`
Newest first. A record carries `{ time, tool, clientId, grantId, totalMs, queuedMs,
loadMs, inferenceMs, failureClass, reason, inputBytes, outputBytes, receiptId }` — no
arguments, results or tokens exist in the type. Ledger: `$DSH_HOME/model-as-tool/`
adjacent `mcp-usage.jsonl`, trimmed at 5,000 rows, corrupt lines skipped.

Evidence: `docs/tool-insights/evidence/`.
