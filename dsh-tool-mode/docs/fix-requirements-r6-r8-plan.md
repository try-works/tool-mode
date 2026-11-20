# R6-R8 plan — cross-workspace registration and auto-keep dedupe

Status: implemented. Target release: **0.5.109**. Source: updated
`research/reports/2026-11-20-fix-requirements-0.5.106.md` (R6/R7/R8, R1 re-scoped).

The 0.5.108 ablation corrected R1: fresh authored artifacts bind. The remaining defect is
**R6 — persisted rows are not re-registered for every workspace**. R7 (auto-keep duplicates)
and R8 (verifiability hint) are new; R4's refusal text must be re-tested on the restarted
host before any code change because 0.5.108 already names the tool, reason, scope and action.

No behavioural change starts without a failing test. No live claim is recorded unless it ran.

## 0. Baseline and preserve

- Host/npm: 0.5.108 from npm, web process restarted; `tool_mode_run` refusal includes
  `nonexistent_probe_tool`, `not-registered`, scope and action.
- Fresh authore artifacts bind; stored-name workflow alias and `workflow_*` bind.
- Full suite baseline: 2196 tests, 2189 pass, 7 skipped, 0 fail.
- Keep R3 full verification, U44 filters, and authored `bindable` rows.

## 1. R6 — register persisted artifacts across all workspaces (P1)

**Root cause hypothesis.** `registerAuthored` boot only iterates `toolEntries()` (global) and
`toolEntries(workspaceScope.context)` (the HOST process cwd). A row stored under
`d:\dev\tool-mode-internal` is never registered when the host cwd is
`d:\dev\tool-mode\dsh-tool-mode`. The dispatcher resolves the caller's scope at call time,
so ONE registration per name is enough for all workspaces; the missing step is registering
every durable name, not every scope.

**TDD red test** `tests/cross-workspace-registration.test.ts`:

1. Seed the authoring store with a workspace tool in a **different** workspace key, then
   mount the plugin in the test host's workspace. Assert `tool_mode_list` reports
   `bindable:true` for the row and a probe resolves it.
2. Run `return await <name>({...})`; assert the result.
3. Repeat for a persisted workspace workflow in a different workspace key, including the
   stored-name and `workflow_*` spellings.
4. Assert a session-scoped draft from another root is NOT registered or advertised.
5. Add a restart-shaped test: seed store file → dispose host → mount again with a different
   cwd/workspace → same assertions.

**Implementation:**

- Add store methods to enumerate **durable** rows across all scope keys
  (`durableToolEntries()`, `durableWorkflowEntries()`) without exposing session drafts.
- Boot-register every unique durable name once; keep the dispatcher's caller-scope
  resolution. Apply the same to workflows and to stored-name aliases.
- If a row cannot be registered (invalid schema/name collision), `bindable:false` must carry
  a reason and action; never a silent dead end.
- U42 withdrawal must still remove a registration when the last visible row disappears.

**Acceptance:** define in workspace A, restart with host cwd B, fresh session A sees
`bindable:true` and runs the program.

## 2. R7 — dedupe auto-keep by program shape (P1)

**Current behaviour.** Auto-keep produces one draft per successful run; the library holds
three counting artifacts. The user-visible consequence is a solver declining to author
because “a third copy adds no capability.”

**TDD red test** `tests/auto-keep-dedupe.test.ts`:

1. Perform the same normalized program shape three times across three sessions.
2. Assert the durable library has **one** canonical row (or one canonical workspace row plus
   no additional session duplicates for the same shape) and `uses:3`.
3. Assert the digest prints one line for the shape.
4. Run a genuinely different shape; assert a second row appears.
5. Assert different input schemas are kept separate and labelled with the shape they cover.

**Implementation (minimum):**

- Add a normalized shape fingerprint (program text with whitespace/comments normalized,
  sorted tool bindings, input schema shape).
- On auto-keep, before creating a draft, look for an existing durable row with the same
  fingerprint; if found, record the use/evidence on it and do not create another row.
- If a session draft is required for isolation, reuse one draft per fingerprint per root
  session rather than per run.
- Digest ranks one row per fingerprint; if variants are retained, render each one's shape.

## 3. R8 — make aggregate-only outputs honest (P2)

**TDD red test** `tests/verifiability-hint.test.ts`:

- Define an authored tool with `verifiability:'aggregate'`.
- Digest line says the output is aggregate-only / not per-item verifiable.
- Define `verifiability:'per-item'`; no caveat.
- Define no hint; no invented claim.
- `tool_mode_list/get` returns the field; schema/docs updated.
- A per-item route named in the caveat is callable.

**Implementation:** add optional `verifiability?: 'per-item' | 'aggregate'` to authoring
metadata, preserving it through define/from-run/clone/draft/promote. Render the caveat only
when explicitly `aggregate`; do not infer from arbitrary program text. Document that the
field is a claim, not a correctness guarantee.

## 4. R4 — verify on the restarted host

- Add the restart/cross-workspace refusal assertion to the R6 test: the message names the
  tool, `not-registered`, caller scope, and action.
- Do not change runtime-surface unless the restarted 0.5.109 host actually returns an empty
  reason. Current 0.5.108 evidence says it is already detailed.

## 5. Full gate and release

1. Focused tests for R6/R7/R8/R4, then adjacent `artifact-scoping`, `agent-authoring`,
   `adoption-*`, `tool-mode-list/describe` suites.
2. `npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json`.
3. `npm run test:integration:dsh` (full plugin suite).
4. `anti_slop_lint` on changed files.
5. Build, record confinement evidence, `npm run verification`, `verify:built`, `verify:docs`,
   `verify:verification`.
6. Bump 0.5.109, pack, publish to npm, install the web profile **from npm** and a disposable
   headless profile from npm.
7. Restart the web host; fresh-session live probe for:
   - cross-workspace persisted artifact bindable and runnable;
   - one canonical auto-keep line with `uses:3`;
   - aggregate verifiability caveat;
   - R4 refusal detail.
8. Commit, push, and record the observed JSON and npm integrity.

## 6. Definition of done

| Req | Done when |
|---|---|
| R6 | Persisted workspace A artifact, host cwd B, fresh session A: `bindable:true` and program runs; no other-root session draft registered. |
| R7 | Same shape 3× → one canonical row/line, uses 3; different shape → second row. |
| R8 | Explicit aggregate hint renders and names a per-item route; per-item/no hint do not invent a caveat. |
| R4 | Restarted host refusal names tool, reason, scope, action. |
| Gate | Full suite green; 0.5.109 npm published and installed from registry; live probe recorded. |

## Outcome (0.5.109)

- **R6:** `durableToolEntries()`/`durableWorkflowEntries()` enumerate every workspace/global
  row across scope keys, excluding session rows. Boot registers one dispatcher per durable
  name. Red test: workspace A row with host in workspace B was advertised but
  `bindable:false`; green: 6/6, program runs, stored/workflow aliases work, other root's
  session draft stays private.
- **R7:** `toolShapeFingerprint()` normalizes comments/whitespace, sorted tools and an
  annotation-free schema. `saveAutoKeep()` reuses one canonical visible durable row, then the
  caller's own session draft; the runtime records each auto-keep hit as evidence. Three
  same-shape runs -> one `agent_from_draft_*` row at `uses:3`; another workspace or a different
  shape is not reused. 8/8 tests.
- **R8:** optional `verifiability: 'per-item' | 'aggregate'` persists through the real store and
  define/list/get, and the digest renders an aggregate-only caveat naming the callable route.
  No claim is inferred. 6/6 surface + 1/1 store + 1/1 host-digest wiring.
- **R4:** restarted-host refusal still names the tool, `not-registered`, caller scope and
  action; no runtime-surface change was needed.
- **Gate:** full plugin suite **2218 tests, 2211 pass, 7 skipped, 0 fail**; typecheck, build,
  docs/verification and `verify:built` green. Live probe 9/9 measured, 0 failed.
- **Release:** `@try-works/dsh-tool-mode@0.5.109` published to npm `latest`; web and
  disposable profiles installed from the registry. Web restart remains a scheduled host action.
