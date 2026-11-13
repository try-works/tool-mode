# Tool Insights — disposable-instance verification report

**Date:** 2026-10-23 (Asia/Shanghai)
**Scope:** task-15, plan `docs/tool-insights-implementation-plan.md` §6–7.
**Verdict: PASS.** Live browser + API + MCP evidence on a clean disposable instance, final build
client rev `f280cbd80a3c` (positional Client Remote arguments). Every plan checklist item was
exercised against real host data, including a live Code Mode parent expansion drilled from a
PTC-tail session (§5).

All defects found during the run (D1 slot registration, D2 zero-argument calls, D4/D5/D6 report and
range wiring) are fixed and re-verified. The disposable instance has been torn down; the main
`:3080` host was never touched.

---

## 1. Environment (clean, disposable)

| Piece | Value |
| --- | --- |
| `DSH_HOME` | `D:\DEV\dsh-ti-verify` (created for the run, deleted afterwards) |
| Profile | `tool-insights`, template `web` |
| Plugin | `@try-works/dsh-tool-mode@0.5.19`, final build; served client rev `f280cbd80a3c` |
| Web | `http://127.0.0.1:3180` (launch token → `dsh-auth` cookie; unauthenticated `/` answers 401) |
| MCP | `http://127.0.0.1:3865/mcp`, static bearer token (`DSH_TOOL_MODE_MCP_TOKEN`) |
| Extension | `@try-works/extension-desert-ant-tongue@0.1.3` installed from source; prepared (`prepared-cold`), active |
| Seed data | 4 legacy v3 sessions (`--D-DEV-dsh-anti-slop--`) + 3 copied v4 sessions (`--D-DEV-dsh-tool-mode--`) folded by the host backfill |
| Main host | `:3080` pid 48924 — never touched, still running after teardown |
| Disposable pid | 50344 — stopped during teardown; `3180`/`3865` closed |

Profile patch used (disposable only):

```yaml
- id: model-tools
  name: "@try-works/dsh-tool-mode"
  config:
    extensionStore: "D:/DEV/dsh-ti-verify/profiles/tool-insights/extensions"
    extensionSourceDir: "D:/DEV/dsh-tool-mode/packages"
    extensions:
      allowSourceDirectories: true
    allowPreinstalledDependencies: true
    preinstalledDependenciesRoot: "D:/DEV/dsh-tool-mode"
    mcpV3:
      enabled: true
      host: "127.0.0.1"
      port: 3865
      path: "/mcp"
```

Plan corrections found while executing:

1. `allowSourceDirectories` must be **nested under `extensions:`**; the flat key is ignored and the
   tongue source install is refused with “source-directory installs are developer mode …”.
2. Unauthenticated `GET /` answers **401**, not the plan's 200; the verifier authenticates with the
   launch token and then gets 200.
3. `npm pack` / `dsh plugin add` skips a same-path tarball (“Already up to date”); reinstall under a
   new file name.

---

## 2. Results per acceptance item

| # | Acceptance item | Result |
| --- | --- | --- |
| 1 | Fresh profile; sidebar entry order 15 | **PASS** — Plugins → Automation tasks → Tool Insights → Workspaces (`08-sidebar-with-insights.png`). |
| 2 | All three tabs reachable | **PASS** — Tool Insights / Tool Inventory / MCP render and switch. |
| 3 | Deep links work | **PASS** — `/#insights`, `/#inventory`, `/#mcp` open the matching tab; tab clicks update the hash. |
| 4 | Insights data matches the report; KPIs; table/pagination | **PASS** — each range matches the host exactly: 24h `668 calls / 1 session / 23 tools`, 7d `1,565 / 3 / 35`, 30d `1,565 / 3 / 35`, All `2,448 / 5 / 43`; errors/success, tool time, p50/p95, model leaderboard and tool performance render from the host report; All-calls pager “Showing 1-10 of 200 calls”, `Page 1 of 20`, Previous/Next. |
| 5 | Inventory: all tools, never-called, origin/kind/state, pagination, `model_tools` withheld | **PASS** — 6 tools grouped DSH core(1)/Tool Mode(3)/Other plugins(2); `model_tools` “withheld from MCP”; filters verified live (origin → 3, search “lang” → 1, state active → 6); “Showing 1-6 of 6”, Page 1 of 1, Previous/Next, per-page 7/15/30 (`09-inventory-data.png`). |
| 6 | MCP tab: 3865, clients, exposure, paginated `mcpCalls` log | **PASS** — endpoint `http://127.0.0.1:3865/mcp`, transport http, auth static-token; “Exposed 1 of 2”, withheld `model_tools`, tools `lang_detect`; clients `host`; log shows `lang_detect` calls with receipts (`mcp_mvkl0ufe_1`, `mcp_mvklhfc4_1`, `mcp_mvkmmgnm_1`), “Showing 1-3 of 3 calls”, Page 1 of 1 (`19-mcp-final.png`). |
| 7 | `initialize` refused, `server/discover` works | **PASS** — script records `-32601`, then discover 200 with supported `2026-07-28`. |
| 8 | `tools/list` has tools, `model_tools` absent | **PASS** — `[lang_detect]`, `model_tools` absent. |
| 9 | One safe MCP call | **PASS** — `lang_detect` returns `complete`; the object-shaped `semantic_similarity` call also returns score `0.855` (`cosine_similarity`). |
| 10 | Code Mode parent expansion | **PASS** — a `run_code` parent in the newest retained window expands to its `send_message` sub-call; parent `call_00_62oZ38XL2UmQVgG06Xzu6239` (1,174 ms, ok) and child (7 ms, ok, kind `code`), child row renders as “send_message sub-call” with its own time/status (`20-code-mode-expanded.png`, `code-mode-expansion.json`, §5). |
| 11 | Evidence folder (red logs, live JSON, screenshots, commands) | **PASS** — `docs/tool-insights/evidence/verify-2026-10-23T06-20/` (30 files incl. red/green test logs, verifier JSON, host data, screenshots, DOM dumps, probes). |
| 12 | Main `:3080` untouched; disposable torn down | **PASS** — `:3080` pid 48924 still running and untouched; disposable pid 50344 stopped, `D:\DEV\dsh-ti-verify` deleted, `3180`/`3865` closed, disposable browser tab closed. |

Verifier (final build): **PASS — 11 passed, 0 failed** (`instance-verification.json`).
Host backfill: `toolUsageReport` over the seeded stored logs returns
All `2,448 calls / 5 sessions / 43 tools`, 7d `1,565 / 3 / 35`, 24h `668 / 1 / 23`, 30d `1,565 / 3 / 35`;
no `readStoredUsage`/`restore` errors in the host logs.

---

## 3. Defects found live (all fixed and re-verified)

| ID | Symptom | Root cause | Fix verified |
| --- | --- | --- | --- |
| D1 | Sidebar entry/page absent on a fresh profile | `ctx.slots.spec()` probed before the declaring plugins applied, so both registrations were skipped | unconditional deferred `ctx.slots.inject` (`registerPageSlot`) |
| D2 | Inventory/MCP showed “remote method is absent” | zero-parameter calls passed `{}` as the generated method's `signal` | call with no argument |
| D4 | Insights report degraded | argument shape passed at the wrong layer | positional Client Remote parameter |
| D5/D6 | All/24h/30d kept the initial 7d report; label changed only | Client Remote parameters are positional (`packages/api/gateway/src/client/index.ts` `prepareInvocation`); the `{query:…}` wrapper produced the default 7d window | `requestUsageReport(call, range, now)` → `call('toolUsageReport', reportQuery(range, now))`; `requestMcpCalls` → `call('mcpCalls', { page, pageSize })`; controlled report loader |

---

## 4. Exact commands (final pass)

```powershell
$env:DSH_HOME = 'D:\DEV\dsh-ti-verify'
node scripts/install-dsh-plugin.mjs --profile tool-insights --template web --no-build

# rebuild/repack the fixed plugin and reinstall (same version, unique tarball name)
cd packages/dsh-tool-mode; npm pack
node D:\deepseek-harness\apps\cli\lib\bin.js plugin --profile tool-insights add `
  D:\DEV\dsh-ti-verify\profiles\tool-insights\plugins\dsh-tool-mode-0.5.19-fix6.tgz

# launch the disposable host (source runner: same checkout as the :3080 host)
node --import tsx/esm apps/cli/src/bin.ts --profile tool-insights `
  --host 127.0.0.1 --port 3180 --no-open          # cwd D:\deepseek-harness

# verifier
node scripts/verify-tool-insights-instance.mjs `
  --web-url "http://127.0.0.1:3180/?token=<launch>" `
  --mcp-url http://127.0.0.1:3865/mcp `
  --token "$env:DSH_TOOL_MODE_MCP_TOKEN" `
  --out docs\tool-insights\evidence\verify-2026-10-23T06-20\instance-verification.json

# teardown
Stop-Process -Id 50344 -Force
Remove-Item -Recurse -Force D:\DEV\dsh-ti-verify
```

---

## 5. Code Mode expansion evidence (live)

The expansion was drilled in a second clean disposable run using the PTC-tail session supplied by
the Lead:

- Seed: `C:\Users\erikb\.dsh\sessions\--C-Users-erikb-OneDrive-Dokument-temp--\1ca4a24f-ea7b-4893-80f8-db7f3da3207b\session.v4.jsonl.zstd`
  (whole folder copied into the fresh `$DSH_HOME\sessions` tree; workspace
  `C:\Users\erikb\OneDrive\Dokument\temp`).
- Host backfill folds it into `toolUsageReport` with no live session: `all = 27 calls / 1 session /
  2 tools`; the retained recent list has 26 `run_code` calls and one `send_message` code call, i.e.
  the parent is inside the newest-200 window.
- Browser (Tool Insights → All calls): the first `run_code` row is expandable (control
  `title="Show Code Mode sub-calls"`). Clicking it sets `aria-expanded=true` and inserts the child
  row `send_message sub-call @deepseek-ai/dsh-tool-subagent-control 1ca4a24f… 7ms ok`.
- Host report rows behind the UI: parent `call_00_62oZ38XL2UmQVgG06Xzu6239` — `name: run_code`,
  `ms: 1174`, `ok: true`, `kind: direct`; child — `name: send_message`, `parentCallId:
  call_00_62oZ38XL2UmQVgG06Xzu6239`, `ms: 7`, `ok: true`, `kind: code`.
- Evidence: `code-mode-expansion.json`, `screens/20-code-mode-expanded.png`.

The earlier seed sets did not place a parent inside the retained window; this run closes that
coverage item with a real session, no fabricated rows.

---

## 6. Evidence index

`docs/tool-insights/evidence/verify-2026-10-23T06-20/`

| File | Contents |
| --- | --- |
| `instance-verification.json`, `script-run.log` | final verifier run (11/11 PASS, build rev `f280cbd80a3c`) |
| `extension-install.json` | tongue install/prepare/enable + describe |
| `host-data.json` | inventory / mcpStatus / mcpCalls / toolUsageReport via the page's data path |
| `usage-report-ranges.json` | 7d / 30d / all / explicit windows with backfilled sessions |
| `insights-page-vs-host.json`, `range-refetch.json` | page-vs-host KPI evidence collected while fix-verifying D5/D6 |
| `screens/01-sidebar-no-insights.png` | pre-D1 sidebar (entry absent) |
| `screens/02-settings-model-as-tool.png` | plugin client active in Settings |
| `screens/03-insights-7d.png`, `04-insights-all-empty.png` | Insights before fixes (degraded) |
| `screens/05-inventory-degraded.png`, `06-mcp-degraded.png` | Inventory/MCP before D2 fix |
| `screens/08-sidebar-with-insights.png` | post-D1 sidebar, order 15 |
| `screens/09-inventory-data.png` | Inventory with data + filters + pagination |
| `screens/10-mcp-data.png`, `15-mcp-final.png` | MCP tab through the fix iterations |
| `screens/12-insights-7d-data.png` | Insights 7d with backfilled data |
| `screens/14-insights-all-range-bug.png`, `16-range-24h-stale.png` | the D5/D6 stale-range defect |
| `screens/17-insights-all-final.png` | final All range: 2,448 / 5 sessions / 43 tools |
| `screens/18-insights-24h-final.png` | final 24h range: 668 / 1 session / 23 tools |
| `screens/19-mcp-final.png` | final MCP log with receipts |
| `screens/20-code-mode-expanded.png` | All calls with the expanded `run_code` → `send_message sub-call` row |
| `code-mode-expansion.json` | parent/child host rows, seed session id, browser expansion facts |
| `dom/*-facts.json`, `dom/*-body.txt` | DOM labels/order/body text per capture |
| `probe-*.mjs` | reproducible probes (host data, usage ranges, bundle, remote chunk/WS, range refetch) |

---

## 7. Final state

- First disposable instance torn down after the main run (pid 50344); a second fresh disposable
  instance (pid 49648) was created only for the Code Mode expansion drill in §5 and then torn down:
  `D:\DEV\dsh-ti-verify` deleted, ports `3180`/`3865` closed, disposable browser tab closed.
- Main `:3080` host (pid 48924) untouched and running; the GUI tab was restored to `:3080`.
- Task-15 completed on the strength of the evidence above; no coverage items remain open.
