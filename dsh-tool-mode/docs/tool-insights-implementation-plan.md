# Tool Insights — implementation plan (Direction B approved)

Status: **implemented and verified** in a clean disposable DSH instance (web 3180, MCP 3865);
see [verification-report.md](verification-report.md) for the PASS verdict, live evidence and the one
explicitly accepted coverage gap (live Code Mode expansion, unit-tested only). The design source of
truth is the Paper page `Tool Insights · B selected` (Tool Insights, Tool Inventory, MCP tabs); the
data and behaviour proposal is [tool-insights-proposal.md](tool-insights-proposal.md).

## 1. Approved scope

Build the selected B direction as one first-level page with three tabs:

1. **Tool Insights** — workbench, KPIs, calls/day, tool performance, model leaderboard,
   paginated All calls with expandable Code Mode sub-calls.
2. **Tool Inventory** — all registered tools grouped by origin (DSH core / Tool Mode /
   other plugins), state, kind, usage and pagination; row opens the workbench detail.
3. **MCP** — endpoint/transport/auth, clients, exposed vs withheld tools, paginated
   external call log.

The sidebar entry is **Tool Insights** at order **15** (after Automation tasks). The
three tab states live inside that page; `Inventory →` in the Tools panel selects the
inventory tab.

### Non-goals

- No new install/registry mechanism. `Install extension` from inventory opens the
  existing extension install surface.
- No global DSH theme change. The blue palette is scoped to this page.
- No new runtime dependency. React, zod and the tool-mode packages already available.
- No change to the main `:3080` instance or its data.

## 2. Definition of done

- The page appears at order 15 in a fresh profile and degrades safely on older hosts.
- The three tabs work by click, keyboard and deep link (`#insights`, `#inventory`,
  `#mcp`); switching does not reload the page.
- Tool Insights renders from real session logs, backfills existing sessions, and agrees
  with the host report for calls, success, duration, model, owner and Code Mode nesting.
- Inventory lists every registered tool plus never-called tools, with truthful state and
  origin; pagination and filters operate; `model_tools` is never exposed via MCP.
- MCP tab reads the actual configured endpoint/port, clients from real grant identities,
  exposed tools from the real export surface, and calls from the persisted external
  ledger. It never renders the token, arguments or results.
- Tests written first for every slice; the full suite, build, bundle check, packed check,
  MCP verification and anti-slop lint pass.
- A new disposable DSH instance runs on **3180** with MCP on **3865**, verified in the
  browser and through MCP, with evidence saved.

## 3. Architecture

```
session events ──► toolUsage projection ──► toolUsageReport ─┐
tool registry + extension store ──► toolInventory ──────────┤
mcpV3 config + grants + external ledger ──► mcpStatus/mcpCalls
                                                          ▼
                                             client/tool-insights.js
                                      tabs: Insights / Inventory / MCP
```

### Host

- **Projection**: `toolUsage` and `toolUsageDetail`, registered on
  `ctx.sessionProjections` when available. Direct calls come from `tool/call` →
  `tool/result`; Code Mode calls from `tool/ptc-dispatch-start` → `tool/ptc-dispatch`,
  linked by `rootCallId`/`parentCallId`. Model attribution follows the step's route /
  emitting assistant message; sub-calls inherit the parent model; unknown is explicit.
- **Inventory** is a live read, not a projection: registry `schemas()` + extension store
  `describe()` + the same owner resolver. It must keep never-called tools.
- **MCP status** reads the `mcpV3` config and the `model-tools.mcp-endpoint` service;
  clients come from grant/ledger identities. External call history is a bounded JSONL
  ledger written from `onAccounted`, which must start carrying the tool name.
- **Remote namespace**: add additive `toolSources()`, `toolInventory()`,
  `mcpStatus()`, `mcpCalls()` and `toolUsageReport()` to the existing `modelTools`
  namespace. Older hosts that lack them produce a degraded page, never a crash.

### Client

- One authoring source `client/tool-insights.js` exporting a factory
  (`createToolInsights(h)`) with pure helpers and components, inlined into
  `client/index.js` by `gen-client-catalog.mjs` — no sibling chunk, same reason the chat
  cards are inlined.
- `index.template.js` registers `main` (`key: 'tool-insights'`) and
  `sidebar.panellist` (`id: 'tool-insights'`, order 15, icon) and calls the factory.
  Existing Settings registration stays.
- Root props `useSessions` / `useWorkspaces`; compact `toolModeUsage` values from
  `projectionValues`; inventory/MCP/report through guarded remote calls.
- Tab state in `location.hash` with `replaceState` + `hashchange`, local state fallback.
- Blue palette scoped to the page; dsh-context card/donut/heatmap/table language.

## 4. TDD sequence

Protocol for every slice: write the failing test, run the exact command and save the red
output under `docs/tool-insights/evidence/`, implement only enough to go green, rerun.
No production code before a red test except the S0 harness.

| Slice | Tests first | Red proves | Green means |
| --- | --- | --- | --- |
| **S0 harness** | `tests/fixtures/tool-insights.ts`, `tests/helpers/client-source.ts` | fixture can emit synthetic session events and load the client factory | existing suite still green |
| **S1 projection** | `tests/tool-usage-projection.test.ts` | a synthesized call/result pair has no reader | direct/PTC pairing, errors, model, caps, histogram, JSON purity |
| **S2 report** | `tests/tool-usage-report.test.ts` | range/percentile/owner grouping returns nothing | exact range, p50/p95, tool/model/workspace rollups |
| **S3 inventory** | `tests/tool-inventory.test.ts` | registry+manifests can’t produce a row | all rows, states, never-called, owner, MCP exposure |
| **S4 MCP ledger** | `tests/mcp-usage.test.ts` | accounting has no tool name | bounded append/read/rotate, aggregates, no payloads |
| **S5 MCP status** | `tests/mcp-status.test.ts` | endpoint/clients/exposure not derived | configured endpoint, truthful clients, withheld tools |
| **S6 remote** | `tests/tool-insights-remote.test.ts` | new descriptors are absent | spec/artifacts in sync, additive client fallbacks |
| **S7 client logic** | `tests/tool-insights-client.test.ts` | tab/pagination/format helpers absent | tabs, hash, pagination, grouping, formatting, junk tolerance |
| **S8 client render** | `tests/tool-insights-render.test.ts` | no three-tab page tree | three tabs, KPI/table/empty states render with stub React |
| **S9 slots/bundle** | `tests/tool-insights-registration.test.ts`, `tests/tool-insights-bundle.test.ts` | no slot registration/inlined source | order 15, guarded old-host path, inline bundle, no chunk |
| **S10 host integration** | `tests/tool-insights-host.test.ts` | service methods not dispatchable | remote methods return truthful contracts |

### Required test cases

**S1 projection**

- call → result pairs duration `max(0, result.time - call.time)`.
- missing result at `turn/end` is unsettled, never a fake success.
- `error.code`/`isError` counts; prototype callIds (`constructor`, `toString`) do not
  pair.
- `tool/ptc-dispatch-start` + `tool/ptc-dispatch` pairs by `subCallId` and links the
  parent `tool_mode_run`; sub-call duration never adds to the parent.
- model attribution: request-header route, assistant message, mid-turn route change,
  missing model → `unattributed`.
- caps: pending 100, recent 200, tools 100, days 60, duration buckets 16.
- stateVersion bump and pure-JSON round trip.

**S2 report**

- range boundaries (inclusive/exclusive), timezone day keys.
- percentiles from the histogram, max exact, unsettled excluded.
- grouping by tool, model, owner, workspace; Code Mode split.
- pagination is a client concern, but report totals never change with page size.

**S3 inventory**

- registered tool with no calls appears as never called.
- extension tool gets owner `@try-works/...`, kind `extension`, state
  active/prepared-cold/failed; unknown owner stays explicit.
- extension install failure is reported as failed, not hidden.
- `model_tools` is present in inventory but `mcpExposed: false`.
- no token, arguments, results or file paths leak into rows.

**S4 MCP ledger**

- only external calls; session-native calls are not duplicated.
- tool name, client/grant id, timings, failure class, receipt id, byte sizes only.
- rotation at the bound; a corrupt line is skipped, not fatal.
- page boundaries and client filter; no credentials/body fields exist in the type.

**S5 MCP status**

- disabled endpoint → no fabricated listening state.
- configured port 3865 appears as 3865, not 3765/3080.
- single static token yields one truthful client identity; named clients only when the
  grant/credential store actually provides them.
- exposed count matches the export surface; withheld includes `model_tools`.
- recent client labels follow the ledger, not guesses.

**S7/S8 client**

- `#inventory` / `#mcp` select the right tab; invalid hash → insights.
- `Inventory →` selects inventory; `Back to workbench` selects insights.
- page math: 41 rows, 12/page → 4 pages; 0 rows → page 1/1; out-of-range clamps.
- Code Mode grouping: parent row with children; collapse hides children; no orphan
  children.
- empty/partial data renders an explicit empty state, never invented numbers.
- stub-React tree includes the three tab labels, active styling, table headers and
  pagination controls.

**S9 bundle/slots**

- `gen-client-catalog --check` is current after build.
- generated `client/index.js` contains the page source and no `require.async` chunk.
- `exports.inject` includes `slots`; registration is skipped when slots are absent.
- `main.key === sidebar.panellist.id`, order 15.

**S10 integration**

- mount the host half with a fake projection registry/extension service and call the
  remote methods; verify additive fallback when optional services are missing.
- run MCP over an ephemeral port (`port: 0`), `tools/list`, one safe call, assert
  `model_tools` absent and the ledger gains the call.

## 5. File map

### Host (`packages/dsh-tool-mode/src/`)

| File | Work |
| --- | --- |
| `tool-usage-projection.ts` (new) | definitions, schemas, fold, model attribution, wire/detail views |
| `tool-usage-report.ts` (new) | range/percentile/rollup aggregation |
| `tool-sources.ts` (new) | owner resolver: extension manifests, contracts, MCP grammar, pinned map |
| `tool-inventory.ts` (new) | registry + `describe()` snapshot; states, kinds, exposure |
| `mcp-usage.ts` (new) | bounded external ledger; append/read/rotate |
| `mcp-status.ts` (new) | endpoint/auth, clients, exposed/withheld, status |
| `extensions-api.ts` / `extensions-remote.ts` | additive `ModelToolsRemote` + client methods |
| `remote/spec.mjs` + generated artifacts | descriptors/validators for the new methods |
| `mcp/host-binding.ts` | pass tool name into `onAccounted` |
| `index.ts` | register projection, expose service methods, wire ledger/status behind config |
| `tests/...` | S0–S10 tests above |

### Client (`packages/dsh-tool-mode/client/`)

| File | Work |
| --- | --- |
| `tool-insights.js` (new) | factory: tabs, Insights/Inventory/MCP views, pure helpers |
| `index.template.js` | inline placeholder, slot registration, guarded host compatibility |
| `scripts/gen-client-catalog.mjs` | `/*__TOOL_INSIGHTS_SOURCE__*/` placeholder + `--check` |
| `package.json` | `dsh.client.inject`: `slots`, `dsh-client-ui-conversation`, `dsh-client-ui-sidebar-right` (verify names) |
| tests | S7–S9 |

### Scripts / evidence

| File | Work |
| --- | --- |
| `scripts/verify-tool-insights-instance.mjs` (new) | fetch bundle, drive MCP, record live evidence; pure helpers tested first |
| `docs/tool-insights-implementation-plan.md` (this file) | plan |
| `docs/tool-insights/evidence/<stamp>/` | red logs, live JSON, screenshots |

Copying a session workspace folder works because this build discovers
`<DSH_HOME>/sessions/<cwd-key>/session-*/session.jsonl.zstd` by directory; if a future
build requires an index, create one short real session instead of hand-writing an index.

## 6. Disposable-instance verification (non-3080)

Ports: **web 3180**, **MCP 3865**. Never point this at the running 3080 profile.

### 6.1 Isolated home and profile

```powershell
$root = 'D:\DEV\dsh-ti-verify'
Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $root | Out-Null
$env:DSH_HOME = $root
$env:DSH_TOOL_MODE_MCP_TOKEN = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })

# stop if a port is already occupied
Get-NetTCPConnection -LocalPort 3180,3865 -ErrorAction SilentlyContinue | ForEach-Object { throw "port in use: $($_.LocalPort)" }

npm run build
node scripts/install-dsh-plugin.mjs --profile tool-insights --template web --no-build
```

The installer creates `$root\profiles\tool-insights` and adds the bundle. Add the profile
patch for the disposable store and MCP port:

```powershell
$profile = Join-Path $root 'profiles\tool-insights'
@'
- id: model-tools
  config:
    mcpV3:
      enabled: true
      host: "127.0.0.1"
      port: 3865
      path: "/mcp"
    extensionStore: "D:/DEV/dsh-ti-verify/profiles/tool-insights/extensions"
    extensionSourceDir: "D:/DEV/dsh-tool-mode/packages"
    allowPreinstalledDependencies: true
    preinstalledDependenciesRoot: "D:/DEV/dsh-tool-mode"
    extensions:
      allowSourceDirectories: true
'@ | Set-Content (Join-Path $profile 'cordis.patch.yml') -Encoding utf8
```

Seed deterministic Insights history by copying one real session workspace folder (no
extension store, no credentials):

```powershell
New-Item -ItemType Directory -Force (Join-Path $root 'sessions') | Out-Null
Copy-Item -Recurse 'C:\Users\erikb\.dsh\sessions\--D-DEV-dsh-anti-slop--' (Join-Path $root 'sessions\')
```

The copied logs exercise projection backfill, model attribution and Code Mode nesting
without a model credential in the disposable profile.

### 6.2 Launch

```powershell
$dsh = Start-Process -FilePath node -ArgumentList @(
  'D:\deepseek-harness\apps\cli\lib\bin.js',
  '--profile','tool-insights',
  '--host','127.0.0.1',
  '--port','3180',
  '--no-open'
) -PassThru -RedirectStandardOutput "$root\dsh.log" -RedirectStandardError "$root\dsh.err"

# wait for HTTP 200 on 3180 and the MCP log line
$deadline = (Get-Date).AddSeconds(90)
do {
  try { $r = Invoke-WebRequest 'http://127.0.0.1:3180/' -UseBasicParsing -TimeoutSec 2 } catch { $r = $null }
  if ($r -and $r.StatusCode -eq 200) { break }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
if (-not $r -or $r.StatusCode -ne 200) { throw 'disposable DSH did not start' }
Get-Content "$root\dsh.log" | Select-String 'MCP endpoint|127.0.0.1:3865'
```

Confirm it is not the 3080 instance: URL is `http://127.0.0.1:3180/`, and
`DSH_WEB_URL`/the log must say 3180.

### 6.3 API and MCP checks

Add `scripts/verify-tool-insights-instance.mjs` (test-first for its pure helpers):

1. Fetch `/`, discover the client bundle URL, assert the bundle contains
   `Tool Insights`, `Tool Inventory`, `MCP` and the pagination labels.
2. Connect to `http://127.0.0.1:3865/mcp` with the bearer token; `initialize`,
   `tools/list`; assert the expected tools are present and `model_tools` is absent.
3. Call a safe exposed tool (`read` on a temp file) once; assert `isError` absent and a
   receipt id exists when the tool declares `meta`.
4. Open `http://127.0.0.1:3180/` in the shared browser:
   - assert the tab strip and active underline;
   - click Inventory → check counts/pagination/filters;
   - click MCP → assert endpoint shows **3865**, clients and call log (the call from step 3);
   - return to Insights → check KPIs, performance table, model leaderboard, All calls
     pagination, and `tool_mode_run` expansion;
   - capture screenshots and a short DOM/text dump into `docs/tool-insights/evidence/`.

### 6.4 Extension-path check

In the disposable instance, Settings → Model as Tool → install the tongue extension from
source, prepare/enable it, then restart the disposable host (the running host keeps the
first activation’s binding). After restart, Inventory shows `lang_detect` as a Tool Mode
extension; make one MCP `lang_detect` call and confirm the MCP call log records it. If the
install path is unavailable, record it as an explicit gap rather than claiming success.

### 6.5 Teardown

```powershell
Stop-Process -Id $dsh.Id -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
Remove-Item Env:DSH_HOME, Env:DSH_TOOL_MODE_MCP_TOKEN
```

Do not stop the main 3080 process. Close the disposable browser tab.

## 7. Acceptance checklist

- [ ] Fresh profile: sidebar entry order 15; all three tabs reachable; deep links work.
- [ ] Insights data matches the report; no double-counted Code Mode calls; model and owner
      attribution show explicit unknown buckets rather than guesses.
- [ ] Inventory shows all registered tools, never-called tools, origin/kind/state, and
      paginates; `model_tools` is marked withheld from MCP.
- [ ] MCP tab shows 3865, real client identities, 21/41-style exposure counts and a
      paginated external log; token/arguments/results absent.
- [ ] All new tests were red first; suite, typecheck, build, `verify:built`, `verify:packed`,
      `verify:mcp` and `anti_slop_lint` pass.
- [ ] Evidence folder contains red logs, live JSON, screenshots and exact commands.
- [ ] Main `:3080` host untouched; disposable instance torn down.

## 8. Gates and sequencing

| Phase | Scope | Exit gate |
| --- | --- | --- |
| P0 (0.5d) | S0 harness and fixtures | baseline suite green; red harness runs |
| P1 (2d) | S1/S2 projection/report | targeted + full host tests |
| P2 (1.5d) | S3 inventory + S6 remote | inventory tests; remote artifact check |
| P3 (2d) | S4/S5 MCP ledger/status | MCP unit + in-process endpoint test |
| P4 (1.5d) | S7 client logic | client helper tests |
| P5 (2.5d) | S8 Insights UI | render tree + bundle |
| P6 (2d) | Inventory + MCP UI | render/bundle tests |
| P7 (1.5d) | S9/S10 slots/integration | registration, bundle check, host integration |
| P8 (1d) | disposable instance | browser/MCP evidence |

Total: ~12–15 working days, with P1/P2 and P4/P5 parallelizable across two agents.

## 9. Risks and rollback

- **Projection schema drift**: bump `stateVersion`; a cached row that fails the schema is
  ignored and re-folded, never rendered as zero.
- **Backfill cost**: bounded per-session batches and progress in the UI; no blocking of
  the page.
- **Model attribution**: mixed-route turns and missing models use explicit
  `unattributed`; do not infer a model from the current default.
- **Remote compatibility**: new methods are additive; a host without them shows the
  degradation banner and keeps Insights usable.
- **MCP identity truthfulness**: a single static token cannot invent “cursor”/“claude”;
  show the actual grant/client id. Named clients only from the credential/grant store.
- **Token leakage**: the UI receives only the endpoint and token *file path*; the ledger
  has no body fields and no token.
- **Client bundle growth**: keep the page one inline source; assert no async chunk and
  run `gen-client-catalog --check`.
- **Port conflicts**: preflight 3180/3865; kill only the disposable PID.
- **Windows token ACL**: use the env token for the disposable run; the token-file route
  is covered by existing credential tests.
