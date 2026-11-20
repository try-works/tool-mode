# Remaining adoption follow-ups — 0.5.104

**Goal:** `goal-10de7a2a-3245-4f3f-a782-b4892bf9b052`.
**Build:** 0.5.104, packed and installed. **Live:** the task-turn/digest and binding behavior
is verified in fresh 0.5.104 headless DSH processes; the long-running web host on :3080 still
holds the pre-0.5.104 graph, so its own restart remains a deployment action, not a code claim.

## Delivered

### 1. Artifact-specific verification field
Authored tools carry `verification?: string`; `define`, `from-run`, clone, draft and
promotion preserve it. The digest renders `Verify: <note>` and suppresses the counter-based
`Evidence:` line for that row. An artifact without a note keeps the generic warning.
TDD: `adoption-verification.test.ts` **0/2 red -> 3/3 green**, including a
`define -> prompt digest` integration. Commit `028056a`.

### 2. U42 — advertised but unbindable authored tool
Root cause: row removal and registration lifetime were separate. Draft sweep and session
disposal deleted rows without withdrawing the registered tool; the registry advertised a
name preflight refused. `authoredRowRemains()` + `withdrawAuthoredIfAbsent()` now withdraw
only when no visible global/workspace/released-session row remains; workflow dispatchers use
the same rule. A surviving workspace copy stays registered.
Red **1/3 -> green 3/3**; adjacent batch 125 tests, 124 pass, 1 pre-existing skip.
Commit `028056a` (fix) + `c5d59b9` (test/report).
Residual: the registry is process-global; a live row of another root can still be advertised
and is correctly refused at preflight. A store-wide per-name query would close that edge.

### 3. U26 — workspace list after promotion
The explicit-scope list already filters the annotated union; the 0.5.101 observation predates
the fix. Added a regression: run -> session draft -> promote to workspace with the session
source surviving -> default list resolves session -> `list({scope:'workspace'})` still returns
the workspace row. **1/1 green**; adjacent scoping suite 31/31. Commit `c242aea`.
Separate observation, not changed: `from-run` with `scope:'workspace'` falls back to define
because the draft lookup uses the workspace context; that is a from-run semantic, not U26.

### 4. Live probe
`scripts/probe-adoption-0.5.103.mjs` (commit `7175ad0`) proves installed-vs-loaded by
timestamps, records auth reachability independently of restore, decodes the concatenated
zstd transcript to locate digest placement, and refuses `--live` until the restart ordering
allows it. The pre-restart run (commit `3bc229b`) recorded: installed 0.5.104, host booted
127 minutes earlier, HTTP 401 in 106 ms, digest present only in `system/message` (0
`user/message`), and the U42/bindability checks PENDING.

## Gate

- Plugin suite: **2177 tests, 2170 pass, 7 skipped, 0 fail**.
- Typecheck, `build:host`, `verify:built`, `verify:docs`, `verify:verification`,
  confinement evidence and package check pass.
- Team: U42 (core-runtime), U26 (litert-provider), live probe (ext-landscape); Lead owned the
  verification field and the shared authoring/digest files. U26 task-85 was deleted because
  no source fix was needed.

## Headless live evidence (0.5.104)

| Session | Result |
|---|---|
| define `agent_live_probe` with a verification note | digest rendered `Use agent_live_probe(...) ... Verify: Fails on short lists; verify counts.` |
| first task `Reply READY` | first-step user message contains the same digest before any tool call |
| `tool_mode_run({probe:true, tools:['agent_live_probe']})` | `resolved: true` |
| run a program, then probe the new draft | `agent_from_draft_47091bf0` at session scope; `resolved: true` |

Full evidence: [research/headless-live/REPORT.md](../headless-live/REPORT.md). This satisfies
the live task-turn/digest and real `tool_mode_run` verification in a fresh full DSH process.
The web host on :3080 is still PID 30464 (booted before 0.5.104); a web restart remains the
operator's deployment step.

## Headless live evidence (0.5.104)

| Session | Result |
|---|---|
| define `agent_live_probe` with a verification note | digest rendered `Use agent_live_probe(...) ... Verify: Fails on short lists; verify counts.` |
| first task `Reply READY` | first-step user message contains the same digest before any tool call |
| `tool_mode_run({probe:true, tools:['agent_live_probe']})` | `resolved: true` |
| run a program, then probe the new draft | `agent_from_draft_47091bf0` at session scope; `resolved: true` |

Full evidence: [research/headless-live/REPORT.md](../headless-live/REPORT.md). This satisfies
the live task-turn/digest and real `tool_mode_run` verification in a fresh full DSH process.
The web host on :3080 is still PID 30464 (booted before 0.5.104); a web restart remains the
operator's deployment step.

## Required next step

Full DSH stop/start, then:

```text
cd D:\DEV\tool-mode\dsh-tool-mode
node scripts/probe-adoption-0.5.103.mjs --live --json
```

Then run the P1/P2/P3 calls in `research/adoption-live/REPORT.md`: new session draft resolves
from its own session; promoted workspace artifact is bindable from a matching caller/subagent;
first task step contains a `user/message` digest hit. Only then is the goal complete.
