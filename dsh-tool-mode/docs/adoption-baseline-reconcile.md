# Adoption baseline reconciliation (Phase 0) and truthful verbs (Phase 1)

Baseline: `d4baacd` (docs: adoption improvement plan). This document answers the
Phase 0 question — which reported findings still reproduce on THIS build — and records
what Phase 1 fixed. A finding is only actioned when a test reproduces it; a passing test
that contradicts a report is kept as a regression test.

## U-number → current result → test

| U | Reported issue | Result on the baseline build | Test (file: test name) | Status |
| --- | --- | --- | --- | --- |
| U35 | A direct top-level model call should produce exactly one receipt | GREEN: one `text.language_detect` receipt, kind `direct`, parent `null`, `runId === receiptId` | `adoption-baseline-reconcile.test.ts`: "a top-level model call records exactly one direct receipt" | refuted; kept as regression |
| U35 | A direct `workflow_<name>` call should leave a parent workflow receipt | GREEN: contract `workflow.probe-flow`, `artifactName` set, parent `null`, child receipt parented to it | `adoption-baseline-reconcile.test.ts`: "a direct workflow run leaves a parent workflow receipt" | refuted; kept as regression |
| U35 | A workflow sub-call must not leave an ORPHAN receipt of its own | RED: the sub-call's own receipt has `parentReceiptId: null` beside the nested trace row | `adoption-baseline-reconcile.test.ts`: "the workflow sub-call leaves no orphan receipt of its own" | reproduced; **moved to Phase 2 (task-65)** |
| U36 | A call inside a program must not ALSO appear as a top-level invocation | RED: a program calling `lang_detect` left an extra `text.language_detect` row (kind `invocation`, parent `null`, own `runId`) beside the nested trace and the composition | `adoption-baseline-reconcile.test.ts`: "a call inside a program adds NO second top-level receipt" | reproduced; **moved to Phase 2 (task-65)** |
| U29 | A subagent's call must be visible in the ROOT session's reach counter | RED: `sessionLedger` keys by the LEAF session id, so `authoring.session.called` on the root had no `lang_detect` entry | `adoption-baseline-reconcile.test.ts`: "a subagent call is visible in the ROOT session reach counter" | reproduced; **moved to Phase 2 (task-65)** |
| U40 | `tool_mode_tools delete {name:'workflow_x'}` must point at `tool_mode_workflows`, not no-op | RED: returned `{deleted:false, reason:...}` with no mention of the right tool; nothing mutated | `adoption-artifact-verbs.test.ts`: "tool_mode_tools delete of a workflow name names tool_mode_workflows and mutates nothing" | **fixed in Phase 1** |
| U40 | `tool_mode_workflows delete {name:'agent_x'}` must point at `tool_mode_tools` | RED: same silent-no-op shape as above | `adoption-artifact-verbs.test.ts`: "tool_mode_workflows delete of an authored tool name names tool_mode_tools and mutates nothing" | **fixed in Phase 1** |
| U40 | A name held by BOTH kinds must be resolved by the verb, never guessed | RED: the response had no kind identity at all; the delete was scope-exact but the reply could not prove which kind went | `adoption-artifact-verbs.test.ts`: "a name held by BOTH kinds is resolved by the verb the caller chose, never guessed" | **fixed in Phase 1** |
| U37 | A delete that leaves a visible copy must not claim `deleted:true` | RED: a default (session) delete with a promoted workspace copy returned `{deleted:true}` and no scope fields | `adoption-artifact-verbs.test.ts`: "a default delete that leaves a promoted copy reports both scopes and no completion" | **fixed in Phase 1** |
| U37 | Delete must report per-scope results (`deletedScopes`, `remainingScopes`, `complete`) | RED: the response was only `{deleted}` | `adoption-artifact-verbs.test.ts`: "delete with scope:workspace removes only that row and says what remains" | **fixed in Phase 1** |
| U37 | List/describe must show both the stored and the callable name | List GREEN (rows carry `name` + `callableName`); describe RED (returned only the callable spelling, dropping `double-value`) | `adoption-baseline-reconcile.test.ts`: "list rows carry both the stored and the callable name", "describe reports both spellings it accepts" | list refuted; **describe fixed in Phase 0** (`storedName`/`callableName`) |
| U37 | Delete must name the scope actually removed in its durable receipt | GREEN (after Phase 1): the authoring receipt records `scope: 'workspace'` for a workspace-scope delete | `adoption-delete-regression.test.ts`: "the deletion receipt names the scope actually removed" | kept as regression |

## Phase 1 behaviour (what a caller can now rely on)

`tool_mode_workflows delete` and `tool_mode_tools delete` return:

```json
{
  "deleted": false,
  "complete": false,
  "deletedScopes": [{ "scope": "session", "scopeKey": "session-a", "version": 1 }],
  "remainingScopes": [{ "scope": "workspace", "scopeKey": "<workspace>", "version": 1 }]
}
```

- `deleted`/`complete` are `true` only when the requested row went AND no visible row of
  that name survives from the caller's resolution chain.
- `deletedScopes` is what this call removed; `remainingScopes` is what still answers the
  name (including scope-exact deletes that leave a shadowing row elsewhere).
- A name that belongs ONLY to the other artifact kind is refused with
  `E_WRONG_ARTIFACT_KIND` naming the correct tool, before any mutation.
- A name in BOTH kinds is deleted by the chosen verb; the other kind survives (each verb
  resolves its own store first).
- An unknown name keeps the old `deleted:false` + `reason` shape, now with
  `complete:false`, empty scope arrays and `checkedScopes`.

The published output schema of both tools declares `deleted`, `complete`,
`deletedScopes` (scope/scopeKey/version) and `remainingScopes`; `additionalProperties`
stays true because the same tools publish the other actions.

## Evidence commands

Red-first evidence (before the Phase 1 implementation, against `d4baacd`'s
`authoring-surface.ts`):

```text
npx tsx --test packages/dsh-tool-mode/tests/adoption-artifact-verbs.test.ts \
  packages/dsh-tool-mode/tests/adoption-delete-regression.test.ts
  tests 10, pass 2, fail 8

failing: wrong-kind tools delete; wrong-kind workflows delete; both-kinds resolution;
unknown-name arrays; promoted-copy default delete; authored-tool per-scope; workspace
scope delete; cleanup-per-scope regression
```

Phase 0 red (before the describe fix):

```text
npx tsx --test packages/dsh-tool-mode/tests/adoption-baseline-reconcile.test.ts
  tests 7, pass 3, fail 4

failing: program sub-call duplicate (moved to task-65); workflow child orphan (task-65);
subagent root reach (task-65); describe stored name (fixed here)
```

Green:

```text
npx tsx --test packages/dsh-tool-mode/tests/adoption-baseline-reconcile.test.ts
  tests 7, pass 4, fail 0, skipped 3 (the three Phase 2 findings)
npx tsx --test packages/dsh-tool-mode/tests/adoption-artifact-verbs.test.ts \
  packages/dsh-tool-mode/tests/adoption-delete-regression.test.ts
  tests 10, pass 10, fail 0
npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json
  exit 0
```

Pending (owned by task-65, Phase 2): direct/discovery/workflow receipt tree (no duplicate
non-nested row, children parented), and session-tree reach keyed by the ROOT session.
