# Final adoption verification (task-79)

**Workspace:** `D:\DEV\tool-mode\dsh-tool-mode`  
**HEAD audited:** `3ac8df3` (clean worktree). **Earlier verified source:** `b573ff3`;
the fixes from the previous round remain in the tree.  
**Verifier:** task-79. **Writes:** this report only. Scratch probes lived under
`D:\DEV\tmp\adoption-reverify`; no source/test/doc other than this report was modified.
No git add/commit.

## Verdict

**PASS WITH FINDINGS — the shipped behavior and gates are sound; the Phase 8 "silent"
claim and the auto-draft default decision are not yet fully evidenced.**

- All required gates pass, including full integration on the final tree.
- The shipped default now creates a callable draft (F1/F2 fixes hold); the functional
  auto-draft behavior is verified.
- The Phase 8 evidence is numerically self-consistent (30 answers, G/O ledgers 10/10,
  usage 10 uses/10 sessions) but the run is **not genuinely silent across the surface the
  report/plan claims**: the digest-only `purpose` is returned by `tool_mode_tools list/get`
  and `tool_mode_list`'s authoring block. A D session that inspected the library would have
  seen the purpose; D made zero tool calls, so the 0/10 result measures non-initiation, not
  an inability to discover. This must be fixed or the claim downgraded before citing the
  +100 pp result as a silent-baseline result.
- The auto-draft default was flipped to true although Phase 8 never exercised
  `tool_mode_run` (the report says so); the plan still says `autoDraft: true` is explicit
  "until the Phase 8 gate flips the shipped default" (line 388). The flip is functionally
  tested but not validated by the Phase 8 adoption run.

No functional regression was found in F1/F2/F3/F6-F11.

## Gates (re-run on `3ac8df3`)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 (19 tsc projects) |
| `npm run test:integration:dsh` | `ℹ tests 2137 · pass 2130 · fail 0 · skipped 7 · cancelled 0` — exit 0 |
| adoption + authoring bundle (`adoption-*.test.ts`, `agent-authoring`, `authoring-quality`, `run-capture`) | 156 tests, 155 pass, 0 fail, 1 skip (POSIX permissions on win32) |
| `npm run build:host` | exit 0; client catalog 18 models / 9 runnable |
| `npm run verify:built` | exit 0; built artifact loads through package main |
| `npm run verify:docs` | exit 0; 22 user-doc pages, README coverage OK |

The 7 full-suite skips are the established environment set: POSIX permission bits on
win32; two file-symlink cases (EPERM); the env-gated real-needle case; and three
Windows-ACL `workspace-write` arms (plus the parent CODE-09 `TMP/TEMP` prerequisite).
No adoption or authoring test is skipped to hide a failure.

## Auto-draft default (F5 / the flip)

**Code:** `adoption.autoDraft` now defaults to `true` (`src/index.ts:912,914`); the old
comment "off until the gate" was replaced by "default true".

**Execution:** a default mount (no `adoption` override) plus a successful
`tool_mode_run {code:'return { doubled: input.value * 2 }', input:{value:2}}` now leaves
one session-scoped draft (`agent_from_draft_...`, `status:"draft"`, `expiresAt`), and
executing that draft returns `{"doubled":6}`. The new test "ships with auto-draft enabled
by default" passes. So the previous F5 functional blocker is resolved.

**But the flip is not adoption-validated by Phase 8:**

- the silent report itself says "Auto-draft: not exercised; no session called
  `tool_mode_run`" (`research/adoption-dgo-2026-11-19-silent/REPORT.md:45-47`);
  O had `autoDraft:true` but made zero drafts;
- the plan's arm design still says `autoDraft: true` is "explicit until the Phase 8 gate
  flips the shipped default" (`docs/adoption-improvement-plan.md:388-389`), while the
  post-hoc Phase 8 result now says defaults are decided by functional suites (:432-433);
- therefore the default flip is a **criterion change**, not a result of the experiment.
  It is defensible as a functional/default decision, but should be stated as such (or an
  auto-draft experiment should be run before claiming an adoption lift).

**Verdict on F5:** functionally PASS, adoption-evidence NOT ESTABLISHED. No code blocker;
do not present the default flip as measured adoption improvement.

## Phase 8 silent run — what the evidence supports

I cross-checked the committed artifacts (not the summary):

- `task-results.json`: exactly 30 entries (10 D, 10 G, 10 O), all `correct:true`,
  all `EXIT=0`.
- G and O each have 10 session-ledger rows, each with exactly one `agent_a7f3` call,
  `saveOffers:0`, `authored:0`, arm G/O.
- G and O usage rows: `agent_a7f3`, 10 uses, 10 sessions, 0 failures, same digest
  `66e4b164…`; the ledger session ids and usage session ids match exactly.
- D has no ledger row (and no `arm-D` evidence directory in the checkout); the report
  interprets the absence as zero calls. The task results are consistent with that.

So the **counts as committed are internally consistent**: D 0, G 10/10, O 10/10,
correctness 10/10 per arm. I found no contradictory counter. This does not prove the
sessions ran, however: there are no raw task logs, no session transcripts, and no seeded
`agent-authoring.json` (see Evidence gaps).

### Critical finding: `purpose` is not "digest-only"

The plan says "purpose visible only in the digest" (`docs/adoption-improvement-plan.md:428-429`)
and the report calls it digest-only. Execution on HEAD disproves the stronger claim:

- define `agent_a7f3` with `description: "A helper."` and the silent purpose; it is stored
  with the purpose (`agent-authoring.ts:307/339/462`);
- `tool_mode_tools {action:'list'}` returns the full row, including the purpose
  (`authoring-surface.ts:813`; probe: `purposeInToolsList:true`);
- `tool_mode_list`'s `authoring.tools`/`workflows` block spreads the same rows
  (`index.ts:3969-3980`); probe: `purposeInToolModeList:true`;
- `tool_mode_tools {action:'get'}` returns it as well (`authoring-surface.ts:819`).

The callable tool's own description remains "A helper." (good), and D's system prompt has
no digest (config `digest:false`), so the **observed** D arm (zero calls) did not see the
purpose. But a D solver that called `tool_mode_list` — the discovery surface the plan
explicitly measures — would have seen the purpose in the authoring block. D made zero tool
calls, so the run cannot distinguish "silent artifact" from "solver never looked"; its 0/10
is a non-initiation measurement, not a demonstration that the artifact was undiscoverable.
This undermines the report's "valid silent result" and "genuinely silent" wording.

**Fix:** strip `purpose` from all non-digest surfaces (tool list/get, workflow list/get,
`tool_mode_list` authoring rows) and add a test that the purpose is absent there while
present in both digest modes; then rerun the D arm (or explicitly downgrade the claim to
"no prompt/digest signposting"). This is a small code change plus a test.

### Evidence gaps

- **No raw session evidence**: the repo contains derived `task-results.json`, ledgers and
  usage only. The session logs (`task-*.log`), the model's answers, and the prompt text
  are not committed. `run.ps1` writes logs to `E:\tmp\adoption-run-v4\arm-*\task-*.log`
  and deletes the arm directory except `agent-authoring.json`; no such logs are in the
  checkout.
- **No seeded artifact**: `run.ps1` never creates `agent_a7f3`, and there is no committed
  `agent-authoring.json`. The report gives the name/description/purpose/schema but not the
  actual program or a reproducible seed. The claimed "one global authored tool in every
  arm" cannot be verified from the repository. (The usage digest is evidence a row existed,
  not proof of its program/description.)
- **D's zero calls** are inferred from the absence of a ledger that only exists if a call
  happens; there is no independent log showing the plugin mounted and the task ran with no
  tool call. This is plausible given the run script and task results, but not independently
  confirmable.
- The G/O ledgers and usage are mutually consistent, so this is an evidence-completeness
  problem, not a demonstrated fabrication. The report should either add the raw logs/seed
  or label the result "internally consistent derived evidence, sessions not re-auditable."

**Silent-run verdict:** observed counts PASS internal consistency; **"genuinely silent" FAIL**
because the purpose is exposed by the discovery surfaces, and the D arm made no calls to
test it. Do not cite the +100 pp figure as proof of a silent baseline until the leak is
fixed and the run repeated (or the claim is downgraded).

## Auto-draft default vs the plan

The functional suite is green and the default now produces a callable draft, so F1/F2
remain fixed. The remaining issue is the **decision basis**:

- Phase 8 O made no `tool_mode_run`, so no drafts/offers were exercised (report lines
  45-47);
- plan line 388 says `autoDraft:true` is explicit until the Phase 8 gate flips the
  default; the plan result now says functional suites decide (:432-433), which is a
  post-hoc criterion change;
- the report is honest that it does not claim an adoption lift, but the shipped-default
  claim needs that qualifier in the plan/release notes.

If the project accepts functional tests as the gate, the flip is acceptable; otherwise
revert to opt-in or run an auto-draft experiment. No code defect is implied.

## F4 / red evidence

`docs/adoption-red-evidence.md` was corrected after the previous audit: Phase 4a now says
2 pass/4 fail, F1 now says 4 behavioural fails and explicitly labels the readable-name
case as a regression (replay 6/3 on `0dad8cb`). It still states the remaining gaps: no raw
transcripts for phases 2, 4b, 5, 6, and Phase 3's first red was partly an import error. That
is honest, but **F4 remains partial** — the plan's recorded-red requirement is still not
met. This is a documentation/evidence issue, not a functional blocker.

## Remaining findings

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | major (functional/claim) | `purpose` leaks through `tool_mode_tools` list/get and `tool_mode_list`'s authoring block; "purpose visible only in the digest" is false, and a curious D solver could see it. | Remove purpose from non-digest output types; test absence; rerun D or downgrade the claim. |
| R2 | major (evidence) | Phase 8 has no raw logs/transcripts and no seeded artifact; run.ps1 uses `E:\tmp` paths and does not create `agent_a7f3`. | Commit the seed and task logs, or label the result as derived evidence only; do not call it independently reproducible. |
| R3 | major (process/product) | `autoDraft` flipped true although Phase 8 did not exercise it; plan line 388 says explicit until the gate. | Keep functional-default rationale explicit and update line 388, or revert to opt-in / run the auto-draft experiment. |
| R4 | minor (evidence) | D's 0 calls is inferred from an absent ledger; no raw log proves the D sessions mounted the plugin and made no calls. | Add the session log / state snapshot for one or all D sessions. |
| R5 | minor (evidence) | F4 red evidence is still partial (no raw transcripts for phases 2/4b/5/6, Phase 3 partly import red). | Preserve per-phase red logs/test-only commits or state the limitation in the release note. |
| R6 | info | The 7 full-suite skips and 1 adoption-bundle skip are environmental (POSIX bits, symlink EPERM, needle artifacts, Windows ACL). | No action. |

## What was not run

- No new 30-session experiment; I audited the committed evidence and replayed gates.
- No publish/install, `verify:packed/architecture/mcp/traceability`, or live MCP suite.
- Probes use the real plugin/registry/stores with a fake PTC runtime where execution was
  needed; the full suite uses the real harness.
