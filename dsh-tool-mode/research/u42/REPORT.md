# U42 — declared in the bindings, refused at call time

Build: workspace `028056a` (package 0.5.103). Owner: u42-binding / core-runtime.
Task: `task-83`. Date: 2026-11-20.

**Release note:** the Lead's release commit `028056a` swept the `index.ts` fix in while this
task was in progress. The red replay below was recorded against the pre-fix line; the green
runs are against the committed fix. This task added no commits; the test and this report are
still untracked for the Lead to commit.

## Symptom

A delegated solver's declared tool bindings named an authored tool that preflight then
refused as unbindable ("the program requested tools it cannot bind"). The observed case
was an `agent_from_draft_*` tool **absent from the session library**: the artifact row
had been released, but the tool REGISTRATION (the schema/binding snapshot) survived.

## Root cause

Registration and row lifetime are separate stores:

- `ctx.tools.register(...)` writes the schema that advertises a name to every solver;
- `agent-authoring.json` rows are what `authoredToolVisibleAt` / `bindingPreflight`
  resolve against.

Two release paths deleted rows WITHOUT withdrawing the registration:

1. `sweepDrafts()` — removes expired drafts (mount and root-session end);
2. `session/disposed` — `authoringStore.expireSession(root)` removes the session's rows.

The registry kept the name forever. A later program declaring it hit preflight's
`not-visible-at-scope` refusal: advertised but unbindable (U42 phantom). Workflow
dispatchers (`workflow_<name>`) had the same gap on session disposal.

## Fix (packages/dsh-tool-mode/src/index.ts only)

- `authoredRowRemains(name, sessionId?)` — checks the same scope set the existing delete
  path uses (this host's global row, the workspace row, and the released session's row).
- `withdrawAuthoredIfAbsent(name, sessionId?)` — calls `unregisterAuthoredRef` only when
  no visible copy remains.
- Wired at the two release paths:
  - the draft sweep, per expired draft;
  - `session/disposed`, per expired TOOL (drafts included), plus the same withdrawal for
    expired WORKFLOW dispatchers.
- Preflight is untouched: the name is either visible and bindable, or ABSENT from the
  registry snapshot (then refused as `not-registered`). No check was weakened.
- `src/runtime-surface.ts` needed no change.

## Red test — `packages/dsh-tool-mode/tests/u42-binding.test.ts` (NEW)

Three tests:
1. a released session DRAFT is absent from the registry and preflight says `not-registered`;
2. a released kept session TOOL is withdrawn too;
3. a name with a surviving WORKSPACE copy stays registered and bindable.

Red replay (withdrawal call at the fix seam temporarily disabled; no other file changed):

```text
npx tsx --test packages/dsh-tool-mode/tests/u42-binding.test.ts
  tests 3, pass 1, fail 2
  ✖ withdraws a released session DRAFT ... AssertionError: a released row must be ABSENT
    from the binding snapshot, not advertised-but-unbindable (true !== false)
  ✖ withdraws a released session TOOL ... AssertionError: an expired kept session tool
    must not stay advertised either (true !== false)
  ✔ keeps a name registered while a WORKSPACE copy still answers it
```

(First run before the test's own setup was corrected failed the draft case at a setup
error — `tool_mode_run` requires `tools` — so the replay above is the recorded
behavioural red evidence.)

## Green

```text
npx tsx --test packages/dsh-tool-mode/tests/u42-binding.test.ts
  tests 3, pass 3, fail 0, skipped 0

npx tsx --test u42-binding tool-mode-run adoption-receipt-tree
  adoption-receipt-tree-purge adoption-auto-draft adoption-draft-retention
  agent-authoring artifact-scoping-acceptance
  tests 125, suites 24, pass 124, fail 0, skipped 1 (pre-existing win32 POSIX-mode skip)

npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json
  exit 0
```

anti_slop_lint (absolute targets):
- `tests/u42-binding.test.ts`: 0 findings.
- `src/index.ts`: 342 findings on the committed HEAD, unchanged by this fix's added lines
  (the working-tree delta seen mid-task belonged to a concurrently written `verification`
  block that landed in the same Lead commit).

## Residual limits (documented, not hidden)

- The registry is process-global. A LIVE session-scoped row of a FOREIGN root is still
  advertised (its list row is `bindable:false`) and preflight correctly refuses it when a
  name is handed down across roots. Making the schema itself caller-scoped is a
  registry/bindings redesign outside this task. The released-row phantom (the observed
  U42) is fixed.
- Other roots' live session rows are not enumerable through the store API, so the
  remaining-row check covers global, workspace and the released session — the same scope
  set the existing delete path uses. Two live sessions holding the SAME name could still
  see one registration withdrawn when the other is released; fixing that needs a
  store-wide "rows for name" query (agent-authoring.ts, outside this task's writes).

## Files

- `packages/dsh-tool-mode/src/index.ts` (fix; committed by the Lead in `028056a`)
- `packages/dsh-tool-mode/tests/u42-binding.test.ts` (new red/green suite; untracked)
- `research/u42/REPORT.md` (this report; untracked)

`src/runtime-surface.ts` was not modified.