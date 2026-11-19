# Auto-keep and the `autoDraft` deprecation plan

Status: proposed. This plan turns the accepted direction — **runs are stored and reusable by
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

## Phase 0 — Release hygiene and the real baseline

**Goal:** make the installed build match the source before changing behavior.

**Tests / checks**

- Package version is bumped for the release.
- The packed artifact contains `autoDraft`, `draftTtlMs`, purpose handling, and the
  auto-draft runtime hook.
- A clean install into the isolated web profile starts and lists a draft after a real
  `tool_mode_run`.
- The installed `lib/index.js` is byte-identical to the packed build.

**Implementation**

- Bump the workspace/plugin version.
- `npm run build`, `npm run verify:built`, `npm pack`.
- Install the packed tarball into a disposable profile and run the probe.
- Record the exact version and probe output in the release notes.

**Exit criterion**

The installed build reports `autoDraft:true` and leaves a callable draft. No product
decision is made from `0.5.95`.

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

- Pack, install into a disposable profile, run a real `tool_mode_run`, verify a callable
  draft.
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

The installed package and the source agree; a real run produces a callable artifact
without a save call; the report states what was and was not measured.

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
