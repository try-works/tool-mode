# Auto-keep and the `autoDraft` deprecation plan

Status: implemented (0.5.98; lifecycle corrections in 0.5.99; session-start adoption in 0.5.100; fail-open prompt in 0.5.101; async boot digest in 0.5.102; task-turn injection in 0.5.103; artifact verification + U42/U26 closure in 0.5.104; U44 render/describe/offer fixes in 0.5.105). This plan turns the accepted direction — **runs are stored and reusable by
default; delete is the only required curation action** — into a sequenced, test-first
change.

## Current state

| Build | Behavior |
| --- | --- |
| Source at `cc00526` | `adoption.autoDraft` exists and defaults **true**; a successful run leaves a callable draft with a 24 h TTL |
| Installed web profile, package `0.5.95` | The Phase 4 fields are absent; this build predates auto-draft |

The installed package is stale. Phase 0 below fixes that before any behavior is judged.

## Decision

1. **`autoDraft` is true today.**
2. **Deprecate it in the next minor**, keeping the alias for one release.
3. **Remove it in the following minor.**
4. **`captureRunPrograms:false` is the only off switch.** It disables capture, drafts and
   `from-run` coherently.
5. **Replace the boolean with one policy field**, `adoption.autoKeep`:
   `'off' | 'session' | 'workspace'`, default `'session'`.
6. **Keeping is not publishing.** An automatically stored row is labeled unverified and
   scoped; workspace/global visibility needs evidence, a pin, or an explicit policy.

## Why remove rather than leave a boolean

A false `autoDraft` creates a state that is hard to explain:

> capture the run, keep it for `from-run`, but do not materialize a draft.

That is a hidden dead state. It also doubles the configuration matrix for little product
value. The accepted model is simpler: a successful run is captured and callable in its
scope; retention and scope decide how long and how far it travels.

The cost is that a user who wants “capture but never materialize” loses that mode. The
one-release alias gives them time to migrate.

## Lifecycle target

```text
successful tool_mode_run
  -> capture (program, tools, shape-only schema, purpose?)
  -> auto artifact (status: draft, origin: auto)
  -> callable in the caller scope
  -> session scope: dies with the session
  -> workspace scope: only after second successful use, a pin, or autoKeep:'workspace'
  -> global scope: explicit promotion only
  -> delete / expire
```

- **Session:** every successful run is automatically reusable until the session ends.
- **Workspace:** auto-keep only with evidence or an explicit project policy.
- **Global:** never automatic.
- **Delete:** removes one scope and reports what survives elsewhere.
- **Retention:** unused auto rows expire; pinned/kept rows do not.
- **Discovery:** digest ranks a bounded top set; the tool list stays bounded.

## Non-goals

- No automatic global publication.
- No second “save” step for same-session reuse.
- No auto-trust: an auto-kept artifact is not described as verified.
- No unbounded tool registration from every run.
- No secret or one-off constant persisted without a check.

## TDD protocol

Every behavioral phase follows the same order:

1. Write the test file and the smallest failing cases before touching source.
2. Run only those tests and record the red output. The failure must be the intended
   missing behavior — not a setup, import or type error.
3. Implement the minimum that makes those cases pass.
4. Re-run the phase tests plus the adjacent regression suites.
5. Run the full gate: typecheck, host integration, build, built-artifact check, docs.
6. Commit the tests and the implementation together. Never weaken an assertion to make a
   phase pass; move the unresolved case to a later phase and say so.

A test that passes before the implementation is a regression test, not red evidence.
Record the command, the red count and the green count in the commit or the phase report.

Every phase also needs a **verification section** with the exact commands it ran. A plan
phase is not done because the code compiles; it is done when its tests are green and its
gate output is recorded.

## Restart boundary

DSH loads plugin host code at boot. A packed-plugin update is not fully testable from the
old host process, and client HMR is not a host restart. Every release/install step must:

1. install the packed artifact into the target profile;
2. stop DSH completely;
3. start DSH again;
4. verify the loaded package version;
5. run a real `tool_mode_run` and confirm the resulting draft is callable;
6. restart again and confirm the intended persistence:
   - a session draft is gone with its session;
   - a workspace auto-kept row survives and is discoverable;
   - a deleted row stays deleted;
7. record the before/after output.

The restart is mandatory for Phase 0 and Phase 7. A no-restart test only proves the old
process still works.

## Phase 0 — Release hygiene and the real baseline

**Goal:** make the installed build match the source before changing behavior.

**Tests / checks**

- Package version is bumped for the release.
- The packed artifact contains `autoDraft`, `draftTtlMs`, purpose handling, and the
  auto-draft runtime hook.
- A clean install into a disposable profile is followed by a **full DSH restart**, then
  lists a draft after a real `tool_mode_run`.
- A second restart keeps a workspace auto-kept row (when Phase 4 exists) and removes a
  session-only row; until then, the restart probe at least proves the new plugin build is
  the one running.
- The installed `lib/index.js` is byte-identical to the packed build.

**Implementation**

- Bump the workspace/plugin version.
- `npm run build`, `npm run verify:built`, `npm pack`.
- Install the packed tarball into a disposable profile.
- **Stop and restart DSH** before probing; the old process keeps the old module graph.
- Run the probe, then restart once more and repeat the persistence check.
- Record the exact version, restart timestamps and probe output in the release notes.

**Verification**

```text
npm run typecheck
npm run build
npm run verify:built
npm run plugin:pack
# install packed artifact into the disposable profile
# stop DSH, start DSH, verify loaded version
# run tool_mode_run, list the draft, call it
# restart, re-check persistence and delete
```

The restart output is the evidence, not a code review claim.

**Exit criterion**

The restarted installed build reports `autoDraft:true` and leaves a callable draft. The
second restart proves the intended persistence boundary. No product decision is made from
`0.5.95`.

## Phase 1 — Deprecate `autoDraft` (one release)

**Goal:** keep compatibility and make the new invariant explicit.

**Tests first**

`tests/auto-keep-config.test.ts`:

- omitted → one draft after a successful run;
- `autoDraft:true` → identical behavior;
- `autoDraft:false` → no draft, capture still exists, `from-run` works, warning is
  emitted once;
- `captureRunPrograms:false` → no capture, no draft, `from-run` refuses with a pointing
  error naming the flag;
- unknown keys are not silently misread as `autoDraft`.

**Implementation**

- Keep `autoDraft` in both Config surfaces for one release.
- Default true, mark deprecated in JSDoc/description.
- Warn once on false with the migration: use `captureRunPrograms:false` for no automatic
  storage.
- Update docs and the config reference.

**Verification**

```text
npm run typecheck
npx tsx --test packages/dsh-tool-mode/tests/auto-keep-config.test.ts \
  packages/dsh-tool-mode/tests/adoption-auto-draft.test.ts
```

**Exit criterion**

All four config cases are tested; the warning is asserted, not inferred.

## Phase 2 — `autoKeep` policy replaces the boolean

**Goal:** one policy field controls scope, not materialization.

**Tests first**

`tests/auto-keep-scope.test.ts`:

- `off` → capture only; no draft; `from-run` still works;
- `session` (default) → callable draft in the caller session; invisible to another session;
- `workspace` → draft is auto-kept at workspace scope; visible to another session in the
  same workspace;
- global is never auto-created;
- `autoDraft` absent after removal; a removed-key diagnostic is clear.

`tests/auto-keep-dedupe.test.ts`:

- same content digest updates the row, not a duplicate;
- a new content digest creates a new row;
- a promoted copy and its draft do not both remain callable under the same name;
- name collision gets a deterministic suffix or a pointing error.

**Implementation**

- Add `adoption.autoKeep` with default `session`.
- Remove `autoDraft` from the schema in the release after the deprecation.
- Keep `captureRunPrograms` as the hard capture switch.
- Session scope: auto-keep every successful run.
- Workspace scope: only when `autoKeep:'workspace'`; otherwise the draft stays session.
- Global: never automatic.

**Verification**

```text
npm run typecheck
npx tsx --test packages/dsh-tool-mode/tests/auto-keep-scope.test.ts \
  packages/dsh-tool-mode/tests/auto-keep-dedupe.test.ts
```

**Exit criterion**

A single field explains where a run is stored; there is no capture-without-artifact mode.

## Phase 3 — Evidence-based workspace persistence

**Goal:** “workspace keeps everything” without turning the first one-off run into a
permanent tool.

**Tests first**

`tests/auto-keep-evidence.test.ts`:

- first successful use creates only a session draft;
- second successful use of the same digest creates/updates the workspace row;
- a pin creates the workspace row immediately and marks it pinned;
- an explicit `autoKeep:'workspace'` bypasses the second-use rule;
- a one-off constant program is stored but not auto-published;
- a failed run never promotes.

**Implementation**

- Count successful uses by content digest in the existing usage store.
- At threshold 2, promote the session row to workspace (or save a workspace copy).
- Add a bounded pin action; do not add a new prompt instruction.
- Record provenance: `origin:'auto'`, `pinned?:true`, `promotedFrom?`.

**Verification**

```text
npx tsx --test packages/dsh-tool-mode/tests/auto-keep-evidence.test.ts \
  packages/dsh-tool-mode/tests/artifact-usage.test.ts \
  packages/dsh-tool-mode/tests/artifact-scope-context.test.ts
```

**Exit criterion**

The workspace does not grow on first use, but a genuinely reused run becomes durable
without a save call.

## Phase 4 — Retention, delete and the only required action

**Goal:** keeping everything is safe because unused rows expire and delete is truthful.

**Tests first**

`tests/auto-keep-retention.test.ts`:

- unused session rows disappear with the session;
- unused workspace auto rows expire after the configured retention;
- a pinned/kept row never expires by this policy;
- a read never rewrites the document;
- delete removes one scope and reports `deleted`, `complete`, `deletedScopes`,
  `remainingScopes`;
- deleting a workspace row falls back to a surviving session row;
- deleting an auto row does not delete a promoted copy.

**Implementation**

- Add `adoption.autoKeepTtlMs` (or reuse `draftTtlMs` for the auto tier).
- Sweep at mount and root-session dispose, bounded.
- Keep only `expire` in the authoring ledger; do not invent an operation.
- No read-time mutation.

**Verification**

```text
npx tsx --test packages/dsh-tool-mode/tests/auto-keep-retention.test.ts \
  packages/dsh-tool-mode/tests/adoption-draft-retention.test.ts \
  packages/dsh-tool-mode/tests/adoption-artifact-verbs.test.ts
```

**Exit criterion**

A user can rely on delete as the only curation action without the library growing forever.

## Phase 5 — Discovery and tool-budget control

**Goal:** many stored rows must not become many prompt tools or a bad first choice.

**Tests first**

`tests/auto-keep-discovery.test.ts`:

- digest ranks caller-scope first, then workspace, then global;
- low-quality rows are not the imperative candidate;
- an auto row is labeled unverified;
- the digest stays within 4 lines/600 characters;
- the tool list is capped/paginated; the cap is visible;
- a hidden/omitted auto row is still callable by name and discoverable through
  `tool_mode_list` within the cap.

**Implementation**

- Reuse `buildDirectiveDigest` ranking; add an `auto`/unverified marker.
- Add a bounded list cap and a cursor or “show all” outside the digest.
- Do not register unbounded auto rows as top-level prompt tools; if registration is
  required for callability, cap it and expose the rest through the control tool.
- Keep list/describe artifact-state free (discovery receipts are allowed and tested).

**Verification**

```text
npx tsx --test packages/dsh-tool-mode/tests/auto-keep-discovery.test.ts \
  packages/dsh-tool-mode/tests/adoption-directive-digest.test.ts \
  packages/dsh-tool-mode/tests/adoption-digest-ranking.test.ts
```

**Exit criterion**

Storage scale does not become prompt scale; the digest names one best candidate.

## Phase 6 — Safety checks and trust labels

**Goal:** automatic persistence must not persist secrets or silently trust one-off code.

**Tests first**

`tests/auto-keep-safety.test.ts`:

- a program containing a secret-shaped literal is refused or redacted before storage;
- a constant/one-off program is stored but marked unparameterised and not auto-published;
- a program with side effects is not auto-kept to workspace;
- a failed run leaves no auto row;
- an auto row is labeled unverified in the digest/list;
- quality evidence is only shown at the existing five-use threshold;
- no model prose is used as a failure class or trust claim.

**Implementation**

- Run a bounded secret/credential scan on the program and description before writing.
- Reuse `parameterised`/schema inference; require parameterisation for workspace
  auto-keep.
- Add `trust: 'auto' | 'verified'` or an equivalent label; never call auto “verified”.
- Keep failure classes from receipts/authoring error codes.

**Verification**

```text
npx tsx --test packages/dsh-tool-mode/tests/auto-keep-safety.test.ts \
  packages/dsh-tool-mode/tests/adoption-quality-metadata.test.ts
```

**Exit criterion**

Automatic storage cannot silently persist a credential or promote an unparameterised
one-off as a trusted workspace tool.

## Phase 7 — Release and experiment

**Tests / checks**

- Pack, install into a disposable profile, **stop and restart DSH**, then verify the
  loaded version and run a real `tool_mode_run` with a callable draft.
- Restart again and check the persistence boundary: session row gone, workspace auto row
  survives, deleted row stays deleted.
- Run a 10-session A/B: session auto-keep vs explicit `from-run` (same tasks).
- Measure same-session reuse, time-to-first-reuse, duplicate rows, delete/expiry, and
  correctness.
- Do not claim a workspace-adoption lift unless the workspace arm is genuinely exercised.

**Verification**

```text
npm run typecheck
npm run test:integration:dsh
npm run build:host
npm run verify:built
npm run verify:docs
```

**Exit criterion**

The installed package and the source agree after a restart; a real run produces a
callable artifact without a save call; the post-restart persistence and delete checks are
recorded; the report states what was and was not measured.

## Removal result (0.5.98)

`adoption.autoDraft` is no longer a functional setting. The schema keeps a tombstone key
so an old configuration fails with: "adoption.autoDraft was removed. Use adoption.autoKeep
to choose 'off' | 'session' | 'workspace'..." — not a silent fallback. `autoKeep` is the
policy. Evidence: [removal report](../research/auto-keep-removal/REPORT.md).

The installed 0.5.98 build rejects the old key, accepts `autoKeep: session`, creates a
session draft, and a restart shows the draft does not leak into the new session.

## Phase 7 run result (2026-11-20)

Recorded in [REPORT.md](../research/auto-keep-phase7/REPORT.md). The packed **0.5.97**
build was installed, restarted, and probed: two identical runs produced a workspace draft
on the second success; the draft survived a restart; delete reported complete and the
next restart listed zero rows.

The A/B was 10 sessions per arm. Both arms answered correctly in 10/10. Auto-keep made
the draft available, but the solver still used `from-run` in 8/10 A sessions; only 2/10
reused the draft directly. A used 39 calls vs B's 30. The storage/lifecycle behavior is
verified; the task did not produce a save-call reduction. The next step is a directive
that points at the existing draft, or a task that explicitly forbids re-saving.

## Lifecycle correction result (0.5.99)

A later live check found the second-capture promotion "missing" and a draft-of-a-draft
amplification. Both were real, and both were fixed test-first:

- **Promotion was mis-targeted, not absent.** It used the host process cwd
  (`workspaceScopeRef`) as the workspace. The live row was written at
  `d:\deepseek-harness` while the caller's workspace was `d:\dev\tool-mode`, so the
  caller's `list` could not see it. Promotion now targets `from.workspaceKey`.
  `autoKeep:'workspace'` has the same caller-workspace rule.
- **U41: no draft of a draft.** A run whose declared tools include a row with
  `status:'draft'` is still captured for `from-run`, but does not mint another draft. This
  keeps the 20-tool budget from filling with one-shot reuse artifacts.
- **Purpose.** The automatic draft copies the run description into the digest-only
  `purpose` field; the callable description is unchanged.

Red/green: 4 new tests in `tests/auto-keep-lifecycle.test.ts`; **0/4 red -> 4/4 green**.
Adjacent auto-keep suite: **28/28**. Typecheck: exit 0. Evidence:
[REPORT.md](../research/auto-keep-lifecycle/REPORT.md).

The E14/E15 discovery result is unchanged: auto-keep moves authoring to the host, not
adoption. A directive is still required.

## Session-start adoption (0.5.100)

The discovery step now has a real harness seam. DSH's `AssembleContext` carries the live
`Agent` (`assembleContextFor(agent, signal)`), but the existing library digest ignored the
context and therefore resolved only workspace/global rows. A session-scoped auto-draft was
invisible in the system prompt by construction.

The section callback now:

- resolves the caller with `scopeFor({ agent })`, which also supplies the caller's workspace
  and root session;
- lists the artifacts visible through that scope chain, including session rows;
- passes the caller session id to `buildDirectiveDigest`, so session rows are filtered to
  their owner;
- includes the compact call shape and, for a list-shaped input, the instruction to pass the
  whole list in one call.

The hook choice is deliberate:

- `system-prompt/assemble` / `systemPrompt.section({ text(context) })` is assembled once per
  request and receives the Agent. It is the right place for prompt text.
- `agent/request` runs after assembly and explicitly cannot mutate messages.
- `agent/pre-step` can replace the messages entering a step, but it is later and noisier
  than the existing prompt section.
- `systemPrompt.context` is the alternative if a durable user-role snapshot is preferred;
  it would avoid changing the cached system prefix on every artifact change, at the cost of
  another message in history.

Tradeoff: the system prompt now changes when the caller's artifact set changes, which can
invalidate prefix reuse from the first changed token. Adoption is the measured bottleneck
(E14 0 calls unnamed vs E15 61 calls named), so this is the intended trade.

Red/green: the first two cases in `tests/adoption-session-prompt.test.ts` were
**0/2 -> 2/2**; a third case pins a workspace workflow beside the caller draft, so the suite
is **3/3**. The tests prove the owner sees the draft with `{texts: string[]}` and another
session's assembly does not. Evidence:
[REPORT.md](../research/session-adoption/REPORT.md).

## Task-turn placement and unverified framing (0.5.103)

The live 0.5.101 check separated **content** from **placement** and **framing**:

- the same digest in the standing Tool Mode section produced **0 artifact calls in 3/3**
  runs (E19, E24, E25);
- the same sentence in the task prompt produced calls in **3/3** (E20, E21, E23);
- without a failure/verify clause, both solvers accepted a wrong output (E20, E22);
  with the clause and a verify instruction, both were correct (E21, E23).

So the build now appends the digest as a separately-sourced user message on the **first
step of the first turn** through `agent/pre-step`. The standing section remains for the
neutral experiment and as a fallback, but the task-turn message is the shipping placement.
A digest failure is caught and skipped: adoption must never break a step.

The counters describe exceptions, not correctness: a draft with 61 uses and 0 failures
was still wrong (E22). An auto-kept row therefore no longer prints an `Evidence:` claim;
it prints `Verify its output on edge cases before relying on it.` Only a kept row may show
the usage counters. This is not a substitute for an artifact-specific verification field,
which remains the next source-of-truth change.

Tests: `adoption-session-prompt.test.ts` now covers both the section and the first task
step, and fails if an unverified row shows `Evidence:` or omits the verify clause.
Adjacent adoption/digest suites: **45/45**.

## Artifact-specific verification (0.5.104)

The generic verify clause is not a source of truth. Authored tools now accept an optional
`verification` note through `define`/`from-run`; `saveTool`, `saveDraft`, clone and
promotion preserve it. The digest renders `Verify: <note>` and suppresses the counter-based
`Evidence:` line for that row. An artifact without a note keeps the generic unverified
warning; the counters remain available to a kept row that has no note.

TDD: `tests/adoption-verification.test.ts` **0/2 red -> 3/3 green**, including a
`define -> prompt digest` integration case. Evidence:
[REPORT.md](../research/verification-field/REPORT.md).

## U42/U26 closure (0.5.104)

- **U42.** Registration and row lifetime were separate stores: sweep/session disposal removed
  authored rows but never withdrew the tool registration, leaving a name advertised in the
  binding snapshot while preflight refused it as `not-visible-at-scope`. `authoredRowRemains()`
  + `withdrawAuthoredIfAbsent()` now withdraw only when no visible global/workspace/released-session
  row remains; workflow dispatchers use the same rule. A surviving workspace copy stays
  registered and bindable. Red: **3 tests, 1 pass/2 fail**; green: **3/3**. Residual: the
  registry is process-global, so a live row of another root can still be advertised; preflight
  correctly refuses that cross-root hand-down.
- **U26.** The explicit-scope list already filters the annotated union (`listTools(context,
  { all:true }).filter(row => row.scope === rawScope)`), so the 0.5.101 observation predates
  the fix. Added regression: **1/1 green**, with the session row surviving and shadowing normal
  resolution while `list({scope:'workspace'})` still returns the workspace row.

## U44 closure (0.5.105)

- **Metadata on supporting artifacts.** The digest rendered `purpose` and `verification`
  only on the imperative candidate; an artifact ranked second appeared as a bare name.
  `Also available` now carries a bounded purpose and `[Verify: ...]` note per entry. Live
  headless 0.5.105 shows both marker strings in the first-step prompt.
- **Authored describe.** `tool_mode_describe` now builds an authored artifact's entry from
  its stored row (schema, scope, stored/callable name) instead of requiring a registry
  projection; an unregistered row is explained, not `unknown tool`.
- **Bindable offers.** The save-offer builder refuses a name outside the program binding
  lane, so a `run_code` wrapper is no longer proposed. F9 now uses `lang_detect` as its
  positive control.

Evidence: [REPORT.md](../research/u44/REPORT.md). Full plugin suite **2178 tests, 2171 pass,
7 skipped, 0 fail**.

## Verification matrix

```text
npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json
npx tsx --test <phase tests> <adjacent tests>
npm run test:integration:dsh
npm run build:host
npm run verify:built
npm run verify:docs
```

Run `npm run verify` only at release. If an output schema changes, run
`npm run verify:mcp`. Call the `anti_slop_lint` tool on changed src.

Restart probe (mandatory for Phase 0 and Phase 7, recorded manually):

```text
install packed artifact -> stop DSH -> start DSH
  verify loaded package version
  tool_mode_run -> draft listed and callable
  restart -> session row gone; workspace auto row survives; delete persists
```

## Definition of done

- `autoDraft` is true in the deprecation release, then removed.
- `captureRunPrograms:false` is the only off switch.
- `autoKeep` is the single scope/materialization policy.
- Session reuse needs no save call.
- Workspace persistence needs evidence, a pin, or an explicit policy.
- Global is never automatic.
- Delete and expiry are the only required curation actions.
- The digest and list stay bounded; auto rows are labeled unverified.
- Secrets and unparameterised one-offs are not silently published.
- The installed package matches the source and has a real-run probe.
