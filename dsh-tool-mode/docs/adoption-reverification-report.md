# Adoption re-verification after the FAIL (task-76)

**Workspace:** `D:\DEV\tool-mode\dsh-tool-mode`  
**Source HEAD:** `b573ff3` (the task's HEAD; the current checkout is `1cb41da`, a docs-only
commit after it — `git diff b573ff3..HEAD` is only `docs/README.md` and
`docs/adoption-red-evidence.md`).  
**Prior FAIL:** `docs/adoption-verification-report.md` against `0dad8cb`/base `d4baacd`.  
**Verifier:** task-76. **Writes:** this report only. Probe scripts lived under
`D:\DEV\tmp\adoption-reverify`; the repo working tree was clean and no source/test was modified.
No git add/commit.

## Verdict

**PASS WITH FINDINGS.**

Every functional fix I re-tested by execution works: F1, F2, F3, F6, F7, F8, F9, F10 and F11.
The earlier blockers (uncallable drafts/promoted tools, no-input promotion failure, missing
failure evidence) are gone, and the regression gates are green. Two issues remain:

- **F5 is unresolved as a product decision**: `adoption.autoDraft` is still `false`, so a
  default run leaves no draft. That is not a code regression, but it still blocks claiming the
  Phase 4 adoption goal in the default configuration.
- **F4 is partially addressed**: `docs/adoption-red-evidence.md` is an honest summary, but it
  is not the recorded red output the plan requires, and at least two counts are not
  reproducible from the current tests (details below). This is a process/evidence finding, not
  a functional blocker.

No new functional blocker was found.

## Gates (executed on the fixed source)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 (all 19 tsc projects) |
| adoption + adjacent suites | **138 tests, 138 pass, 0 fail, 0 skipped** |
| the fix-specific suites (auto-draft, failure-class, first-contact, non-offerable, offer-channel, quality-metadata, directive-digest, receipt-tree) | **57 tests, 57 pass, 0 fail, 0 skipped** |
| `npm run test:integration:dsh` | `ℹ tests 2128 · pass 2121 · fail 0 · skipped 7 · cancelled 0`, exit 0 |
| `npm run build:host` | exit 0; client catalog 18 models / 9 runnable |
| `npm run verify:built` | exit 0; built artifact loads through package main |
| `npm run verify:docs` | exit 0; 22 user-doc pages, README coverage OK |

The 7 full-suite skips are the same environmental set as the first verification (POSIX
permission bits on win32; file-symlink tests EPERM; env-gated real-needle artifacts; three
Windows-ACL `workspace-write` arms). No adoption test is skipped.

## Re-verification by execution

Each probe mounted the **real plugin** (real registry, real authoring/usage stores, fake PTC
runtime only for speed) and inspected the actual result/file/registry — not the diff.

### F1 — drafts and promoted tools are callable: FIXED

Probe on the fixed source (autoDraft on, session caller):

- after `tool_mode_run` with input, `agent_from_draft_462e422e` is in `ctx.tools.schemas()`
  (**registered: true**) and executing it returns `{"doubled":6}`;
- `from-run` with `name:'agent_double_value'` produces a registered tool
  (**registered: true**), **digestEqual: true**, **draftConsumed: true**, and executing it
  returns `{"doubled":6}`.

The new cases `adoption-auto-draft.test.ts` ("executes the auto-drafted tool immediately...",
"executes a promoted tool under its readable name...") pass. The previous
`unknown tool` behaviour is gone.

### F2 — a run with no input promotes the same content: FIXED

Probe `tool_mode_run {code:'return 1', tools:[]}` followed by `from-run`:

- draft `agent_from_draft_19cd4245` and promoted name are the **same** name;
- **digestEqual: true**, **draftsAfter: []** (draft consumed, no orphan), **registered: true**,
  and executing the promoted tool returns `1`.

The no-input case is now in the auto-draft suite and passes.

### F3 — failure classes reach the digest: FIXED

Probe: workspace-scoped `agent_mixed` (succeeds normally, throws on `{fail:true}`), three
successes, one failure (4 uses), then one success (5 uses):

- at 4 uses: section text is only `Use agent_mixed — Mixed outcome.` (no caveat);
- at 5 uses: `Use agent_mixed — Mixed outcome.\nKnown failure: failed.\nEvidence: 5 uses, 1
  failure across 1 sessions (20% failed).` 
- the persisted usage row carries `failureClasses: ["failed"]`, so the class comes from the
  real failed run, not from test prose.

The class is code-shaped and bounded, but it is the generic authoring code `failed`; rendering
`Known failure: failed.` is truthful but not very informative (minor finding below).

### F8 — the five-use/session evidence gate: FIXED

- direct `buildDirectiveDigest` with `uses:1, failures:1, knownFailure:'X_FAILED'` emitted
  **no** caveat (previously it did);
- `uses:5, failures:0, sessions:0` and `uses:5, failures:0` (sessions undefined) both render
  `Evidence: 5 uses, 0 failures.` — **no "0 sessions" claim**;
- the runtime probe above showed no `Known failure` at 4 uses and the caveat at 5.

The new quality/digest cases pass.

### F6 — prewarm outcome and failure log: FIXED

Probe: mount with `adoption.prewarmAfterEnable: true`, patch `ctx.logger` prototype (sentinel
verified), enable `voz` (no implementation/plan → deterministic failure):

- enable result: `prewarm: "started"`, no error;
- exactly one log line:
  `model-tools: prewarm after enable failed for voz: no preparation plan for @try-works/extension-desert-ant-voz; run the plan disclosure first`;
- `voz` remains `readiness: "prepared-cold"`, `cold: true` — a failed warm did not claim
  readiness;
- the new "UNAVAILABLE prewarm" case (no preparation surface) passes.

### F7 — read-only `model_tools` refuses warm: FIXED

Probe with `managementGrant:false`:

- `model_tools_manage` is absent (as before);
- `model_tools {action:'warm'}` now returns an error:
  `model_tools is read-only; action "warm" requires the separate model_tools_manage tool and an explicit managementGrant`;
- no state change; the dedicated F7 test passes.

### F9 — management shapes never produce the save offer: FIXED

Probe: three identical `model_tools_manage {action:'list'}` calls, then `tool_mode_list`:

- **0** `Offer:` lines in all results; **0** `authoring.pendingOffers`.

The new non-offerable suite (model_tools_manage + decision_* + normal control shape) passes.

### F10 — flag-off is untouched; flag-on adds exactly one block: FIXED

Probe: three identical `lang_detect` calls on a flag-off mount and a flag-on mount:

- baseline has no offer; offered result has exactly **1** offer block;
- the offered content prefix is byte-equal to the baseline content
  (`prefixEqual: true`);
- the result `value` is deep-equal (`valueEqual: true`);
- the only difference is one extra content block (`blockDelta: 1`).

This is stronger than the earlier test (which compared only the content prefix); the new
assertion is meaningful.

### F11 — read-only discovery leaves artifact state untouched: FIXED / scoped

Probe with an isolated authoring store: `tool_mode_list` + `tool_mode_describe`
left the authoring and usage files **byte-identical** (both absent before and after). The plan
now defines "side-effect free" as free of ARTIFACT state (durable discovery receipts are
observability, plan lines 67-70), and the new receipt-tree F11 case passes. This is a
specification clarification plus test coverage, not a runtime change; it is acceptable.

## F4 — docs/adoption-red-evidence.md

The document exists and is honest about its limits: raw transcripts were not retained; counts
are task-owner reports; the verifier's Phase 0/1 replay is the only reproduced red. It labels
the pre-green absence cases, the Phase 3 import failure, and the Phase 4b skeleton stub. That
is a real improvement in transparency.

It does **not** close F4, because it is not recorded red output and its counts are not all
reproducible:

- **Phase 0/1**: still matches exactly (7/3/4 and 10/2/8, same failing names).
- **Phase 4a row inconsistency**: the row says "6 tests, 0 pass / 6 fail", while its own gap
  column says "2 absence cases passed on the base". Those cannot both be true.
- **F1 row**: claims "9 tests, 5 pass / 4 fail". Replaying the current F1 tests against the
  pre-fix source `0dad8cb` gives **9 tests, 6 pass / 3 fail**; the "executes a promoted tool
  under its readable name" case passes pre-fix through the define fallback, so it is not a
  discriminating red. The exact test revision for the stated 5/4 was not preserved.
- **Phase 3**: still partly an import failure (the module did not exist); the doc acknowledges
  it, but the plan explicitly disallows setup/type errors as red evidence.
- Phase 2/4b/5/6 remain counts without a transcript; Phase 4b's "explicit stub" is not in the
  repository.

**F4 verdict: PARTIAL.** The documentation gap is disclosed, not closed. Fix: commit the
actual red terminal output (or a test-only failing commit) per phase, tie each count to a
commit/test revision, and correct the Phase 4a/F1 rows. This is a process finding, not a
functional blocker for the fixes.

## F5 — autoDraft default

Probe with a default mount (no `adoption` override), successful `tool_mode_run`:

- no authoring file was created; `tool_mode_list` reports **0** drafts.

The config is still `autoDraft: z.boolean().default(false)` and the default object has
`autoDraft: false`; the plan still says "default on after validation" (line 270). No Phase 8
validation exists in the diff/evidence.

**F5 verdict: unchanged — a goal-completion blocker, not a code-merge blocker.** With the default
configuration the Phase 4 lever is inert. F1/F2 now make enabling technically viable, but do
not justify flipping the default without the validation gate. Either update the plan/release
notes to declare phases 4-7 opt-in and unvalidated, or run the Phase 8 gate and then flip
`autoDraft` (and consider the digest/offer defaults as part of that decision).

## Remaining findings

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | major (process) | F4 evidence is a summary, not recorded red; Phase 4a self-contradicts (0/6 vs 2 absent passes); F1 5/4 does not reproduce (current tests: 6/3 on `0dad8cb`). | Preserve per-phase red transcripts/test-only commits; correct the affected rows. |
| R2 | major (product/goal) | `autoDraft` still defaults false; default runs leave no draft; plan says on after validation. | Decide explicitly: keep opt-in and update the plan/claim, or run Phase 8 and flip. |
| R3 | minor | `Known failure: failed.` uses the generic authoring code; it is truthful but not a named failure mode. | Derive a more specific code-shaped class (e.g. `AUTHORED_RUN_FAILED`/the error's own code) while staying bounded and prose-free. |
| R4 | minor (grammar) | Evidence line renders `across 1 sessions` for a one-session artifact. | Pluralise "session/sessions". |
| R5 | minor (evidence) | The F1 "promoted tool ... readable name" case passes pre-fix via the define fallback, so it is not a red discriminator; it remains a regression test. | Keep it, label it as regression, and add a red case that only the promotion path can satisfy. |
| R6 | info | Task stated HEAD `b573ff3`; the checkout is `1cb41da`, a docs-only commit. Source/tests are identical. | No action; verify source at `b573ff3`/current source tree. |

## What was not run

- No publish/install, `verify:packed/architecture/mcp/traceability`, or live MCP suite.
- No new session experiment: F5 remains a product decision.
- Probes use a fake PTC runtime for speed but the real plugin, registry, stores and prompt
  assembly; the suites above also ran the real test harness.
