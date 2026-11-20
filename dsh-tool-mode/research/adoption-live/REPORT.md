# Live adoption probe — 0.5.103 (task-turn digest, boot/auth, artifact scope)

**Date:** 2026-11-20. **Target build:** 0.5.103 (task-turn digest placement, unverified framing).
**Harness:** [`scripts/probe-adoption-0.5.103.mjs`](../../scripts/probe-adoption-0.5.103.mjs).
**Machine:** Windows, node v24.11.0, DSH profile `web` (`C:\Users\erikb\.dsh\profiles\web`).

**Status: PARTIAL — 3 checks measured, 1 measured as absent, 2 PENDING the restart.**
The running host is **not** running 0.5.103, proven by timestamp ordering (below), so no
0.5.103 *behavior* is claimed anywhere in this report. What is here is the boot/auth evidence
and the placement evidence from the *running* build, plus the exact commands that settle the
rest.

## How to reproduce

```text
cd D:\DEV\tool-mode\dsh-tool-mode
node scripts/probe-adoption-0.5.103.mjs                       # human summary
node scripts/probe-adoption-0.5.103.mjs --json                # + JSON under research/adoption-live/
node scripts/probe-adoption-0.5.103.mjs --session <sessionId> # inspect one session's transcript
node scripts/probe-adoption-0.5.103.mjs --live                # REFUSES unless 0.5.103 is loaded
```

Exit codes: `0` every check ran with nothing pending; `3` live checks pending (the expected
state until the restart); `1` a check could not run. The probe never starts or stops DSH,
never packs or installs, never mutates the authoring store, and writes only under
`research/adoption-live/`.

Status vocabulary used by every check: **measured** (a value was observed), **absent** (a
specific thing was searched for and not found — a result, not a pass), **pending** (needs the
0.5.103 graph or an in-process call the script cannot make), **failed** (could not run).

## 1. Installed ≠ loaded — proven by ordering, not by reading a version string

| Fact | Value | Source |
|---|---|---|
| Source version | `0.5.103` | `packages/dsh-tool-mode/package.json` |
| Installed version | `0.5.103` | `profiles\web\node_modules\@try-works\dsh-tool-mode\package.json` |
| Installed at | `2026-11-20T07:25:45Z` | that file's mtime |
| Host process booted | `2026-11-20T05:45:27Z` (PID 30464) | `Win32_Process.CreationDate`, command line matches `dsh web` |
| Gap | install is **100 min LATER** than boot | derived |
| Installed `lib/index.js` SHA-256 (16) | `661a6532abda2e89` | hash of profile file |
| Repo built `lib/index.js` SHA-256 (16) | `661a6532abda2e89` | hash of repo file — **byte-identical** |

A plugin's module graph is fixed at process start (plan: "Restart boundary"). Installing a
package 100 minutes *after* the process started cannot retrofit that process. Therefore the
running host **cannot** be executing 0.5.103; it is an older build. The probe reports
`loadedVerdict: older-than-target` and deliberately never prints which version *is* loaded,
because nothing on disk records that.

This is the single most important result here: every behavioral assertion about 0.5.103 in
this document would be meaningless without it.

## 2. Boot/auth reachability — measured independently of extension restore

| Observation | Value |
|---|---|
| `DSH_WEB_URL` | `http://127.0.0.1:3080` |
| HTTP answer | **401** in **101 ms** (this run; 56–174 ms across runs) |
| Extension restore consulted for that answer? | **No** — and it is not claimed complete |

A 401 is the correct "reachable but not authenticated" answer: the host is serving. The probe
reports reachability as an HTTP measurement with a duration, and restore state as a *separate*
fact, because conflating them is exactly the error the plan warns about
("measure boot/auth reachability without assuming extension restore finished").

**A trap worth recording:** DSH writes `logs/startup-*.log` only when startup **fails**. The
newest such file on this machine is `startup-2026-11-18T11-03-53.863Z-…` — a failure dump
whose head reads `dsh: startup failed: 2 required plugins did not activate`. That is **not** a
boot record for the current process, and the probe labels it `isFailureDump: true` and does
not derive boot time from it. Boot time comes from the OS process table.

## 3. Task-turn digest delivery on the running build — ABSENT as a user message

Read from the root session transcript
(`sessions\--D-DEV-dsh-model-as-tool--\session-a03968b1-…\session.v4.jsonl.zstd`), decoded
across **21,619 concatenated zstd frames** → **48,760 records**, 0 parse failures.
Evidence JSON: `probe-2026-11-20T07-42-41-259Z.json` (the counts move between runs because
the session is live; the per-type table below was identical across the two runs I kept).

Searched for the 0.5.103 wording `Verify its output on edge cases` and the call shape
`Use agent_from_draft`:

| Record type carrying the digest text | count |
|---|---|
| `assistant/message` | 27 |
| `tool/ptc-dispatch` | 21 |
| `tool/call` | 15 |
| `tool/ptc-dispatch-start` | 15 |
| `tool/result` | 8 |
| **`system/message`** | **2** |
| `job/registered` / `job/settled` | 2 / 2 |
| **`user/message`** | **0** |

Reading: on the running build the digest reaches the model through **`system/message`** (the
standing Tool Mode section, the 0.5.100–0.5.102 placement). It **never** arrives as a
`user/message`, which is the 0.5.103 placement (`agent/pre-step`, first step of the first
turn). The other record types are agents **quoting** the text, not delivery.

This is a second, independent line of evidence that the old build is loaded: the placement
observed is precisely the one 0.5.102 would produce and precisely the one 0.5.103 replaced.

Caveat stated plainly: **0** `user/message` hits is evidence about this loaded build only. It
is not evidence that 0.5.103 fails to deliver. That question is PENDING by construction.

## 4. Authored artifacts, scopes, and what is advertised but unresolvable

On disk (`model-as-tool/agent-authoring.json`, document version **2**), 4 rows:

| Kind | Name | Scope | scopeKey | Ver | Notes |
|---|---|---|---|---|---|
| workflow | `g1_lang_counts` | session | `session-0232f88b-…` | 1 | other session |
| workflow | `g2_word_stats` | session | `session-0232f88b-…` | 1 | other session |
| tool | `agent_from_draft_69543846` | workspace | `d:\deepseek-harness` | 1 | `status:draft`, promotedFrom session v2 |
| tool | `agent_from_draft_051ab807` | workspace | `d:\dev\tool-mode-internal` | 1 | promotedFrom session v1 |

Live probes from this session (read-only) are recorded verbatim in
[`observations-2026-11-20.json`](observations-2026-11-20.json):

- `tool_mode_list` **advertises both drafts** as callable tools, each with `bindable: false`.
- `tool_mode_run({probe:true, tools:["agent_from_draft_051ab807"]})` →
  `resolved:false`, `reason:"not-visible-at-scope"`; same for `…69543846`. Control
  `lang_detect` → `resolved:true`.
- `tool_mode_tools({action:'list', scope:'all', all:true})` → `{tools:[], total:0, scope:"session"}`:
  the `all` filter was **ignored** on the running build while 2 tool rows exist on disk.
- `agent_from_draft_69543846` is keyed to `d:\deepseek-harness` — the **host process cwd**.
  `docs/auto-keep-plan.md` (0.5.99) records exactly this mis-targeting
  (`workspaceScopeRef` instead of `from.workspaceKey`). That row is the surviving artefact of
  that bug and is still advertised here.

**Two corrections to my own first reading, kept because they matter:**

1. I first read `resolved:false` as the U42 "declared-but-unbindable" bug. It is **not**.
   Both rows are workspace-scoped to *other directories*, and this session's workspace is
   `D:\DEV\dsh-model-as-tool`, so refusing to resolve them is **correct by scope**. The
   defect that remains is the **advertisement**: rows that no scope of this caller can resolve
   still appear in the callable tool list. That is the U42 shape to test after the restart.
2. The preflight's help text (`"Save the artifact with scope \"session\""`) **misdiagnoses**
   the refusal: the row is invisible because of its workspace key, not because it lacks session
   scope. A caller following that advice would create a duplicate rather than fix visibility.

## 5. PENDING — needs the 0.5.103 module graph

Both remaining checks need a full **stop/start** of DSH (not a browser refresh, not HMR), and
neither can be performed by a Node script because they are in-process tool calls.

### P1. Create a session auto-draft with `tool_mode_run`

```text
tool_mode_run({ code: "return { probe: Date.now() }", tools: [], description: "adoption probe 0.5.103" })
```
Expect: a **new** `agent_from_draft_<hash>` in `tool_mode_list` with `scope: session` at the
caller's root session, and a row at session scope in `tool_mode_tools list`.
Then: `tool_mode_run({ probe: true, tools: ["<new name>"] })` must report `resolved: true`.
Observable failure to watch for: it is minted but `bindable:false` **and** `resolved:false`
from its own session — that would be a genuine U42 instance rather than a scope mismatch.

### P2. Promoted workspace artifact bindable in a delegated binding set

```text
1. from the OWNING session:  tool_mode_workflows({ action: "promote", name: "<name>", to: "workspace" })
2. from a caller WITH THAT workspace:  tool_mode_run({ probe: true, tools: ["<promoted name>"] })
   expect preflight[0].resolved === true
3. repeat (2) from a SUBAGENT session whose workspaceKey is the same workspace
   expect: the binding set contains it (scope sharing is by root session + workspaceKey)
```
Record which of `resolved`, `bindable`, and the actual run disagree. The 0.5.103 report lists
U42 (advertised-but-unbindable) and the U26 list-after-promotion case as still open, so a
negative result here is a real finding, not a setup error.

### P3. Re-run the digest check on the new build

```text
node scripts/probe-adoption-0.5.103.mjs --session <new root session> --live --json
```
Expect `digest: measured` with `userMessageHits > 0` on the first step of the first turn.
This is the direct 0.5.103 acceptance check that today's run can only falsify for the old build.

## 6. What this report does NOT establish

- It does **not** show that 0.5.103 works, or fails. It shows the running host is older and
  therefore cannot be evidence about 0.5.103 either way.
- It does **not** claim extension restore completed. Restore was never required to answer the
  HTTP question, and no restore-complete marker was found (the only startup log is a
  two-day-old failure dump).
- It does **not** claim a bindability verdict for promoted workspace artifacts. Both live
  probes were scope mismatches, which is why the check is PENDING rather than "failed".
- The digest counts are **record-type classification**, not proof of what the model saw. A
  `system/message` record containing the text is strong evidence of the standing-section
  placement; it is not a transcript of the assembled prompt.
