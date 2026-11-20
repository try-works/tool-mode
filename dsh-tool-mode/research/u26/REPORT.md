# U26 — `tool_mode_tools list({scope:'workspace'})` after promoting a session draft

Date: 2026-11-20. Role: u26-list. Scope: `packages/dsh-tool-mode/tests/u26-list.test.ts`,
`research/u26`. No product source was edited.

## Reproduction

`tests/u26-list.test.ts` drives the real plugin with the fake PTC runtime and explicit
session ids:

1. `tool_mode_run` succeeds with the default auto-keep, leaving a SESSION DRAFT
   (`status: draft`, `scope: session`);
2. `tool_mode_tools { action: 'promote', name: <draft>, to: 'workspace', force: true }`
   promotes it, keepSource defaults to true so the session source survives;
3. the default list still resolves the session row (the workspace row is shadowed);
4. `tool_mode_tools { action: 'list', scope: 'workspace' }` must show the promoted
   workspace row.

Command:

    npx tsx --test packages/dsh-tool-mode/tests/u26-list.test.ts

## Result at HEAD — GREEN, no list gap

    ▶ U26 — a promoted workspace row is listable by scope
      ✔ shows the workspace row while the session draft survives and shadows it
    ℹ tests 1
    ℹ pass 1
    ℹ fail 0

The explicit workspace list returns the promoted row (`scope: 'workspace'`) with its
`promotedFrom` provenance while the session source still survives and wins default
resolution. The row also carries the shadow annotation, so the listing explains the hidden
pair rather than silently dropping one.

## What the first run actually showed

The first run failed ONLY at the test's own provenance assertion: `assert.deepEqual` was
given a partial `{ scope, scopeKey }` while the stored `PromotedFrom` is the full record
(`scope, scopeKey, version, at, tools, sessionId`). The line-160 workspace-row assertion
passed before that. The assertion was corrected to check the identifying fields
(`scope === 'session'`, `scopeKey === 'u26-session'`); the suite is green.

## Why there is no source fix to make

The list path already implements the intended behavior in
`packages/dsh-tool-mode/src/authoring-surface.ts`:

    const rows = authoringStore.listTools(scope.context, { all: includeAll })
    // Scope filtering selects rows from the annotated union (U26).
    const listed = rawScope === undefined || rawScope === 'all'
      ? rows
      : authoringStore.listTools(scope.context, { all: true })
        .filter(row => row.scope === rawScope)

`git blame` dates this to `d2515dc` (2026-11-18, "fix: scope keys, shadowedBy annotations,
and delete refusals") and `7916d34` (refactor extraction); `git merge-base --is-ancestor
d2515dc d4baacd` exits 0, so the stated baseline d4baacd ALREADY contains it. The internal
report's failure was observed on 0.5.101, which predates this code.

Variants probed read-only against the same harness (all showed the workspace row):

- session KEPT tool -> promote -> list workspace: PASS
- session DRAFT (auto-keep) -> promote with keepSource: PASS
- list from a different session after promotion: PASS
- session workflow -> promote -> workflow list workspace: PASS
- promote with keepSource:false -> list workspace: PASS
- explicit `workspaceRoot` and default discovery: PASS

One adjacent semantic difference, not a list-visibility gap: `tool_mode_tools {action:'from-run',
scope:'workspace'}` falls back to `define` (returns `defined:true`, not `promoted:true`)
because the draft is looked up through the workspace context. The resulting workspace row IS
listed by `scope:'workspace'`; that is a separate from-run source-scope question.

## Proposed minimal fix

None. The regression test is the deliverable. If an older installed build still shows the
symptom, its source lacks the union-filter lines quoted above; rebuilding from HEAD applies the
already-present fix. Task-85 should be closed without an authoring-surface edit.
