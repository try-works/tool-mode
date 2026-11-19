# Adoption improvement verification (phases 0-6)

**Workspace:** `D:\DEV\tool-mode\dsh-tool-mode`  
**HEAD:** `0dad8cb` — **base:** `d4baacd` (6 commits, 27 files, +3686/-98)  
**Verifier:** independent, task-69. **Writes:** this report only; probe/replay scratch was
`D:\DEV\tmp\adoption-verify` (outside the repo). No source or test was modified; no git add/commit.

## Verdict

**FAIL — for the plan's definition of done (phases 0-6), not for regression safety of the
default configuration.**

All required gates pass: typecheck, the full DSH integration suite (2113/2106, 7 environment
skips, 0 fail), build, verify-built and verify-docs. The Phase 0/1/2 receipt, verb and scope
fixes are real and well tested. However, the adoption loop this work exists to deliver is not
operational when enabled:

1. an auto-drafted artifact is **not callable**, and `from-run` promotion does **not register**
   the kept artifact — both answer `unknown tool` until a restart ([F1](#f1));
2. a successful run **without input** is not promoted by `from-run`: the draft identity and
   the capture schema disagree, so a second, differently-digested artifact is created and the
   draft is left behind ([F2](#f2));
3. the evidence-backed `Known failure:` line can **never appear from a real failed run**: no
   production failure path records a `failureClass` ([F3](#f3));
4. phases 3-6 do not have red-first evidence that satisfies the plan's TDD protocol; tests and
   implementation were committed together, and two suites' "red" replay is an import error,
   which the plan explicitly rejects ([F4](#f4));
5. `adoption.autoDraft` still defaults to **false**, so the default build does not deliver
   Phase 4 at all ([F5](#f5)).

With `autoDraft: false` (the default) the broken draft path is inert, so this is not a
default-config regression. It is a blocker for claiming the adoption goal or enabling the
feature, and a major evidence gap for the phases.

## Gate results (exact commands)

| # | Command | Result |
|---|---|---|
| 1 | `npm run typecheck` | exit 0 (all 19 `tsc --noEmit` projects) |
| 2 | `npx tsx --test packages/dsh-tool-mode/tests/adoption-*.test.ts ... run-capture/authoring-quality/receipt-enrichment/scoped-authoring-store` | 123 tests, 123 pass, 0 fail, 0 skipped |
| 3 | `npm run test:integration:dsh` | `ℹ tests 2113 · pass 2106 · fail 0 · skipped 7 · cancelled 0`, exit 0 |
| 4 | `npm run build:host` | exit 0; `lib` rebuilt; client catalog "18 models, 9 runnable here" |
| 5 | `npm run verify:built` | exit 0; "OK — the built artifact loads through package main and works under plain Node" |
| 6 | `npm run verify:docs` | exit 0; "user docs OK — 22 pages"; "README coverage OK — 18 catalog models" |

## Findings

### F1 — BLOCKER when Phase 4 is enabled: drafts and promoted tools are not callable

**Where:** `src/runtime-surface.ts:285-309` only calls `draftStore.saveDraft(...)`; nothing
registers the returned definition. `src/authoring-surface.ts:678-705` returns directly after
`promoteDraft(...)`; `registerAuthored` is called only by `define` (:763) and `clone` (:664).
Boot registration covers only global and workspace artifacts
(`src/index.ts:4392-4407`), not session drafts.

**Observed (HEAD probe, real plugin + fake PTC runtime, `adoption.autoDraft: true`):**

- after a successful run, `agent_from_draft_<hex>` appears in `tool_mode_tools list`
  (`draft: true`) but **not** in `ctx.tools.schemas()`; executing it returns
  `isError: unknown tool "agent_from_draft_..."`;
- `from-run` on a parameterised run promotes the draft with the **same digest** and consumes
  it (good), but the kept `agent_double_value` is **not registered**;
  executing it returns `unknown tool "agent_double_value"` until a restart;
- with no caller registration, the adoption loop E13 ("created by the host, used, promoted")
  cannot run inside the session that created the draft.

**Why tests miss it:** `tests/adoption-auto-draft.test.ts:2` claims a "callable draft", but
the suite only reads the persisted file / list output; it never executes the draft
(:144-156). The plan's Phase 4 test explicitly requires "the draft is callable under a stable
name" (plan line 249); that case is absent.

**Fix:** pass a `registerDraft(definition)` hook into `registerRuntimeTools` and call it after
`saveDraft`; after a successful `promoteDraft`, call `registerAuthored(promoted.tool)` (and
on failure either roll back or return the registration error). Add two behavioural tests:
execute the draft immediately after the run, and execute the promoted name after `from-run`.
Session-scoped rows legitimately cannot be registered at boot; that is exactly why the
in-session registration is required.

### F2 — MAJOR: a run without input is not promoted by `from-run`

**Where:** `src/runtime-surface.ts:22-25` normalises a missing/ non-object input schema to
`{type:'object',properties:{}}`; `src/run-capture.ts:75-90` returns `{}` for `undefined`.
`src/authoring-surface.ts:690-691` hashes `capture.inputSchema` (the `{}`) without applying
the same normalisation, so the content digest differs from the auto-draft's digest.

**Observed:** after `tool_mode_run {code:'return 1', tools:[]}` (no input):
draft `agent_from_draft_19cd4245`, digest `983b60e…`; `from-run` created
`agent_from_rcpt_000002`, digest `e2b6014…`, and the original draft **survived**. The
call did create a working registered tool via the define fallback, but it did not promote the
captured draft, and the two artifacts now disagree about content identity.

**Fix:** use one canonical observed-schema helper on both sides (for example export
`objectSchemaShape(value)` from run-capture and use it in both `saveDraft` and the `from-run`
lookup), or normalise `capture.inputSchema` before computing the draft name. Add the no-input
case to `adoption-auto-draft.test.ts` asserting draft consumed, digest equal, and no duplicate.

### F3 — MAJOR: `Known failure:` is not wired to real failures

**Where:** `artifact-usage.ts:190-194` accepts a class only when
`outcome === 'failed' && normalizeFailureClass(failureClass)`. Production failure paths never
supply one: `authoring-surface.ts:503-514` (workflow run), `index.ts:4218-4220` and
`index.ts:4345-4347` (authored-tool run) call `artifactUsage.record` without `failureClass`.
`recordFailedComposition` records a receipt but no usage class. The only tests that exercise
`knownFailure` write the store directly (`tests/adoption-quality-metadata.test.ts:36-56`).

**Consequence:** the directive digest's `Known failure:` line is unreachable from an actual
failed run; only a test/third-party usage row can produce it. Phase 7's stated capability
("from failed receipts and the authoring error code", plan lines 359-361) is not delivered.

**Fix:** in each catch, derive a bounded code (e.g. `AuthoringError.code`, the outcome code,
or a fixed `EXECUTION_FAILED`) and pass it as `failureClass`; do not pass prose. Add an
integration test: define a failing tool, run it five times, then assert the digest contains
`Known failure: <code>` and `5 uses`/`5 failures`, and that no class appears without a failed
run.

### F4 — MAJOR (process): red-first evidence is incomplete for phases 3-6

The plan's TDD protocol (plan lines 69-83) requires writing the test first and **recording
the red output**, and explicitly says a test that passes before implementation is not
evidence. What the repository contains:

| Phase | Tests/implementation commit | Recorded red output | Replay against base `d4baacd` (HEAD tests, base src) |
|---|---|---|---|
| 0 | `3e90153` (+ fix) | Yes: `adoption-baseline-reconcile.md:72-80` (7 tests, 3 pass, 4 fail) | **matches exactly**: 7/3/4; same four failing names |
| 1 | `3e90153` (+ fix) | Yes: `adoption-baseline-reconcile.md:59-70` (10 tests, 2 pass, 8 fail) | **matches exactly**: 10/2/8; same eight failing names |
| 2 | `af70dbb` (fix+tests) | No recorded command/output; reconcile only narrates "RED on baseline" for three rows | reconcile+tree+purge: 16 tests, 6 pass, 10 fail. The three Phase-2 behaviours fail (good), but 3 receipt-tree tests pass on base as regressions |
| 3 | `af945a2` (module+digest+quality) | None | whole files fail at **import/module resolution** (`adoption-digest-ranking.ts` absent) — the plan forbids a setup/type error as red evidence |
| 4a | `c7dab09` (impl+tests) | None; test doc claims a "not-implemented stub" red, no artifact | 6 tests, 4 fail, **2 pass on base** (failed-run and capture-off absence tests) |
| 4b | `c7dab09` | None; test doc lines 10-14 claim "Skeleton red", no evidence | whole suite fails at import of the new store exports (not behavioural) |
| 5 | `0dad8cb` (impl+tests) | None | 9 tests, 6 fail, **3 pass on base** (no-repeat and two suppression/absence tests) |
| 6 | `0dad8cb` | None | 7 tests, 4 fail, **3 pass on base** (deterministic reads, no-manage-tool, no-unhandled-rejection) |

So phases 0-1 have reproducible recorded red evidence; phase 2 has behavioural replay but no
recorded red; phases 3-6 are pre-green test bundles or, for the new-module suites, only import
errors. The absence tests are still useful regression coverage, but they cannot distinguish
implemented from unimplemented and do not satisfy the protocol.

**Fix:** for each phase, preserve a `red.log` (or commit a test-only parent change) showing
the intended failure; for phases 3/4 define the API stub first so the red is a behavioural
assertion, not a module-not-found. If a case is genuinely pre-existing (like the Phase-2
discovery/usage regressions), label it "regression, not red" in the test/doc rather than
counting it as evidence.

### F5 — Product blocker: `adoption.autoDraft` defaults to false

**Where:** `src/index.ts:316,905,907`; `c7dab09` says "autoDraft defaults off until the phase
gate"; the plan says "Add `adoption.autoDraft` … (default on after validation)" (plan line
267) and Phase 4's definition of done requires successful runs to leave a draft (plan line
442). The only validation is the unrun Phase 8 experiment.

**Decision: not a code-merge blocker (default behaviour is unchanged and safe), but a
goal-completion blocker.** The default build does not exercise any auto-draft behavior, so
the adoption lever the plan is about is not shipped. Either (a) keep false and explicitly
label phases 4-7 "opt-in, not validated" in the plan, or (b) run the Phase 8 gate and flip
true only after F1-F3 and the red evidence are fixed.

### F6 — MINOR: prewarm reports "started" when nothing ran, and never logs failure

**Where:** `src/discovery-surface.ts:519-527`: `prewarm = started.coalesced ? 'started' :
'started'` is always `'started'`; the type includes `'unavailable'` but it is never assigned.
The attached `.catch` is unreachable because `warmOnce` catches every failure internally
(:168-172), so a failed prewarm is **not logged**. The test
(`tests/adoption-first-contact.test.ts:88-108`) asserts `prewarm === 'started'`, the cold row
and no unhandled rejection, but not the log, the once-only behaviour, or the bound.

**Fix:** have `warmOnce` report whether a real attempt started/coalesced and attach
`.then(outcome => { if (!outcome.ok) logger.warn(...) })`; return `'unavailable'` when the
prepare surface is absent; add a logger-spy assertion and a second-enable case.

### F7 — MINOR: "warm is management-only" is not verified and is probably false

**Where:** `src/discovery-surface.ts:648-674` serves `action:'warm'` from `model_tools`;
there is no `managementGrant` check in that branch. The test
(`tests/adoption-first-contact.test.ts:72-86`) only proves that `model_tools_manage` does not
exist when `managementGrant:false`; it never attempts `warm` on the read-only mount. Plan
line 321 says warm is management-only.

**Fix:** gate `warm` (and any other mutating action on `model_tools`) on the management
grant, or update the plan/test to say `model_tools` itself is the management surface; make the
read-only test call `warm` and assert refusal. Treat this as a product decision, not a
functional regression.

### F8 — MINOR: two small truthfulness gaps in the evidence line

- `library-digest.ts:123-125` renders `knownFailure` regardless of use count, while the
  evidence line is gated at `uses >= 5` (:125). The Phase 7 test only checks a below-five
  candidate with **no** known failure (`adoption-quality-metadata.test.ts:30-34`). Decide
  whether a real (but one-use) failure class may be shown; if the plan's "five uses" rule is
  intended, gate the caveat too.
- `library-digest.ts:84` renders `candidate.sessions ?? 0` — an unknown session count is
  printed as "0 sessions". Production always passes `sessions` from usage, but the pure API
  can claim zero from no data; omit the clause when undefined or say "sessions unknown". Add a
  test for the omitted case.

### F9 — MINOR: the offer suppression set omits `model_tools_manage`

`src/index.ts:3608-3610` excludes `tool_mode_list/describe/workflows/tools/model_tools` but
not `model_tools_manage` (nor `tool_mode_run`, `decision_*`). Three repeated management calls
can therefore produce a "save this shape" offer. The test
(`tests/adoption-offer-channel.test.ts:133-143`) only exercises `tool_mode_list`. Add the
management/control tools to `NON_OFFERABLE_TOOLS` and extend the test.

### F10 — MINOR (test strength): "flag off is byte-identical" is not byte-identical in the test

`tests/adoption-offer-channel.test.ts:83-96` compares only the text content prefix and the
block count; it does not compare `value`, `logs`, `meta` or the serialized result. The code
path does return the untouched result when the tracker is absent, so the behaviour is likely
fine, but the assertion is weaker than the plan's wording ("byte-identical to the current
output"). Compare `JSON.stringify` of the whole result (excluding the session id/timestamps
if any) between flag-off and a baseline build, or assert deep equality of `value`.

### F11 — MINOR (spec tension): list/describe write discovery receipts

`src/index.ts:3319-3341` records a durable `discovery` receipt for every `tool_mode_list`/
`tool_mode_describe`. The Phase 6 test says list/describe are "side-effect free"
(`adoption-first-contact.test.ts:46-59`) but only checks identical output and no warm fields;
the receipt write is a side effect by design from Phase 2. Define "side-effect free" as
"no warm/prepare/registry mutation; observability receipts are allowed" (and test that), or
make discovery receipts opt-out. Not a functional defect, but the claim and the behaviour
disagree.

### F12 — MINOR (test/doc honesty): two claims are stronger than their tests

- `tests/adoption-auto-draft.test.ts:2` and `tests/adoption-draft-retention.test.ts:5` say the
  draft is callable; no test executes it (and it is not callable — F1).
- `tests/adoption-first-contact.test.ts:88` names the test "bounded and **logged**" but does
  not assert a log line or the bound (F6).

These read as coverage claims the suite does not deliver; rename or add the assertions.

### F13 — INFO: anti-slop results on changed source

New files are clean (`adoption-digest-ranking.ts`, plus the changed
`artifact-usage/authoring-surface/discovery-control/library-digest/model-tools-schema/runtime-surface/session-ledger/agent-authoring`).
New findings in changed-lines:

- `discovery-surface.ts:139,142,180` — `no-known-value-widening` on `warmOnce`'s anonymous
  return type (minor style).
- `index.ts:1257` `no-unsafe-dictionary-type`; `index.ts:3822,4022,4023`
  `no-conditional-empty-object-spread`; `index.ts:3896` `no-known-value-widening`.
- `run-capture.ts:75` `no-unknown-parameters` + `no-shape-in-symbol-names` (existing
  `schemaShape` signature touched by the diff).
- `index.ts` carries **331 pre-existing** findings outside the changed lines; they are not
  introduced by this diff. No new security-relevant finding was found.

### F14 — INFO: full-suite skips are environmental, not hiding adoption failures

Final adoption tests skip **0**. The 7 skipped tests in `test:integration:dsh` are:

1. `writes the store with owner-only permissions on POSIX` — POSIX bits are meaningless on
   win32.
2. `refuses a file symlink that escapes the root` — file symlinks unavailable (EPERM).
3. `a planted SYMLINK at the store path is replaced` — symlinks not permitted without
   developer mode.
4. `the REAL needle activates with the planning shape seen` — needs
   `NEEDLE_EXTENSION_ENGINE`/`NEEDLE_EXTENSION_WEIGHTS`.
5-7. the three `workspace-write` sandbox arms (`AVAILABLE`, `PERMITS`, `REFUSES`) — Windows
   ACL start failed (`SetNamedSecurityInfoW` Win32 5); the parent CODE-09 suite also names the
   `TMP/TEMP` D:-workspace prerequisite. These are the existing confinement environment
   skips, unrelated to adoption.

History: `3e90153` added three Phase-2 assertions as skipped with explicit "moved to Phase 2
(task-65)" reasons (program duplicate, workflow orphan, root reach); `ccbde09` removed the
skips and the assertions now run. No assertion in the final adoption suite is skipped, and no
existing test assertion was weakened (the only historical test edit, the U29 field change in
`ccbde09`, moved the assertion to the new `reach.called` field and added an `agents` count —
not loosened).

## Requirement checklist

**U40/U37 — truthful verbs/deletes: PASS.** Wrong-kind deletes refuse with
`E_WRONG_ARTIFACT_KIND` and mutate nothing; both-kind names are resolved by the chosen verb;
`delete` returns `deletedScopes`/`remainingScopes`/`complete` and claims
`deleted:true` only when no visible row survives; the authoring receipt names the removed
scope. Tests: `adoption-artifact-verbs.test.ts` (7 cases), `adoption-delete-regression.test.ts`
(3). Replay on base: 8/10 fail, matching the recorded red.

**U29/U35/U36 — receipt tree/reach: PASS with scope note.** A direct workflow run records one
parent receipt with `artifactName`/`artifactDigest`/`rootSessionId` and nested children;
program sub-calls leave only nested rows (no duplicate non-nested receipt); discovery calls
record `kind:'discovery'`; the root session's `reach.called` unions two subagents with
per-agent counts and no arguments; disposal purges only the root; failed runs increment
`uses`/`failures` without a new session and leave a failed receipt. Tests:
`adoption-baseline-reconcile.test.ts` (7), `adoption-receipt-tree.test.ts` (7),
`adoption-receipt-tree-purge.test.ts` (2). The new `reach` is a forward-only instrument: the
internal report retracts U36 (the old counter did not aggregate), so this work must not be
read as retroactively measuring prior sessions.

**Directive digest: PASS on the isolated contract, PARTIAL on production evidence.** One
imperative line, purpose, both names, a known-failure line only from evidence, compact
`Also available:` list, 4-line/600-char caps, deterministic ranking (session > workspace >
global, recent use, name; low-quality candidates dropped), caller-scope isolation (session
rows invisible without a matching session id), recomputed per assembly, no section when the
flag is off. Tests pass (`adoption-directive-digest.test.ts`, `adoption-digest-ranking.test.ts`,
`adoption-quality-metadata.test.ts`). **Caveat:** the production failure-class wiring is
missing (F3), and the caveat/unknown-session edge cases are not specified (F8).

**Auto-draft: FAIL as a usable feature.** Store-level identity (content digest), one-row
upsert, reload, expiry and scope tests pass; runtime wiring does not make drafts/promoted rows
callable (F1) and loses the no-input identity (F2). The retention test is store-only and its
red was an import error, not a behavioural red (F4).

**Offer channel: PASS with minor gaps.** Exactly one line at threshold with callable name and
one-call command; no repeat; pending offer in the next list; suppression when an equivalent
artifact exists; acceptance clears/counts when the artifact appears; ignoring creates no
draft/artifact. Gaps: weak full-result byte comparison (F10), management tools not suppressed
(F9).

**First contact: PASS for cold labelling/coalescing, MINOR gaps.** list/describe are
deterministic and do not warm; cold rows say `cold:true` and give the first-call expectation;
warm coalesces one preparation; warm failure does not mark callable; prewarm is fire-and-forget
and does not reject. Gaps: prewarm failure is not logged and status is always `started`
(F6); management-only claim is not tested (F7); discovery receipts are a side effect by design
(F11).

**Defaults: see F5.** `autoDraft:false` is the safe default but not the plan's goal; do not
flip it until F1-F3 are fixed and the Phase 8 gate has run.

## Red-first / TDD evidence details

Replay method: `git archive d4baacd` into a scratch directory, copy HEAD's
`packages/dsh-tool-mode/tests` over it, junction the repository's `node_modules`, and run the
repository's `tsx` binary against the base source. This reproduces the documented Phase 0 and
Phase 1 red counts exactly and shows what each later suite would have done before its
implementation. It cannot prove what a developer actually ran before committing; the absence
of recorded red output for phases 2-6 is the finding, not the replay itself.

| Phase | Replay result | Verdict |
|---|---|---|
| 0 | 7 tests / 3 pass / 4 fail; same 4 names as `adoption-baseline-reconcile.md:72-80` | recorded red reproduces |
| 1 | 10 tests / 2 pass / 8 fail; same 8 names as `adoption-baseline-reconcile.md:59-70` | recorded red reproduces |
| 2 | 16 / 6 pass / 10 fail (reconcile+tree+purge); 3 tree tests pass as base regressions; skip history unskipped | behaviour red exists but not recorded |
| 3 | 3 files fail at import (new module/functions absent) | **invalid red** (setup/type error) |
| 4a | 6 / 4 fail / 2 pass (absence tests pass on base) | partial behavioural red, no record |
| 4b | whole file fails at import (new store exports absent) | **invalid red** |
| 5 | 9 / 6 fail / 3 pass (absence tests pass on base) | behavioural red exists but not recorded |
| 6 | 7 / 4 fail / 3 pass (regression/absence tests) | behavioural red exists but not recorded |

## Limitations

- Did not run `verify:packed`, `verify:architecture`, `verify:mcp`, or a publish/install;
  the Lead's task list stopped at typecheck/integration/build/verify-built/verify-docs.
- The replay uses HEAD tests against base source; a test added later may import a helper/
  module introduced later, which is itself part of the red-first finding.
- The probe uses the real plugin with a fake PTC runtime for speed; it exercises the exact
  registration path (`ctx.tools.schemas`/`execute`) that production uses, not a mock of it.
- No session experiment was run; the internal reports' session numbers are cited as sources,
  not re-measured. Reconcile's red counts were re-measured and match.
