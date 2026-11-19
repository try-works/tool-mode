# Auto-keep lifecycle corrections (0.5.99)

**Status:** red -> green, source-verified. **Build under repair:** 0.5.98 at commit
`4b82115`. **Trigger:** the live verification note
[2026-11-20-auto-keep-verified.md](D:/DEV/tool-mode-internal/research/sources/repo/2026-11-20-auto-keep-verified.md)
and the measured report
[2026-11-19-performance-and-improvements.md](D:/DEV/tool-mode-internal/research/reports/2026-11-19-performance-and-improvements.md).

## What the live note found

1. The second-capture workspace promotion was not observed.
2. An auto-draft did not set the digest-only `purpose`.
3. A run that called a draft produced another draft (U41: drafts self-amplify).

## Root cause of the "missing" promotion

The promotion was present. It used `workspaceScopeRef`, which is built from the HOST
process cwd, instead of the caller's workspace key. The live authoring store showed the
promoted row with:

```text
scope:    workspace
scopeKey: d:\deepseek-harness
```

while the caller session's workspace key was `d:\dev\tool-mode` (and the live delete
surface resolved `d:\dev\dsh-model-as-tool` for the same session). The row existed, but in a
different workspace, so the caller's `list` could not see it. `autoKeep:'workspace'` had
the same target bug.

## TDD evidence

Test file: `packages/dsh-tool-mode/tests/auto-keep-lifecycle.test.ts`.

```text
npx tsx --test packages/dsh-tool-mode/tests/auto-keep-lifecycle.test.ts
red:   4 tests, 0 pass, 4 fail
green: 4 tests, 4 pass, 0 fail
```

The four red failures were the intended missing behavior, not setup errors:

- promotion landed at `d:\dev\tool-mode` instead of the caller temp workspace;
- `autoKeep:'workspace'` landed at the same host key;
- the draft `purpose` was `undefined`;
- a run declaring an existing draft produced a second draft.

Adjacent auto-keep suite after the change: **28 tests, 28 pass**. Typecheck: exit 0.

## Changes

- **Promotion target.** `promoteWorkspaceDraft` now targets
  `from.workspaceKey` (the caller's workspace), not `workspaceScopeRef`.
- **autoKeep:'workspace' target.** `scopeForDraft` rewrites the caller context to workspace
  scope using `caller.workspaceKey`; the boot context remains only a no-caller fallback.
- **Purpose.** `SaveDraftInput` accepts `purpose`; the automatic path copies the run's
  description to it; `saveDraft` persists it. The digest already prefers `purpose` for tool
  rows.
- **No draft-of-a-draft.** The run hook checks whether any declared tool resolves to a row
  with `status:'draft'`; if so it still captures the run for `from-run` but does not mint
  another draft.

## What this does not fix

- **Discovery.** E14/E15 still hold: an unannounced auto-draft is not used; the directive
  is what gets it adopted. This change does not add a directive.
- **Batching.** E15 called the draft once per record despite a `texts[]` schema. That is a
  prompt/affordance problem, not a storage problem.
- **Installed build.** 0.5.99 is packed and installed into the web profile (disk package
  and confinement evidence both report 0.5.99). The running host still has the old module
  graph until DSH is fully stopped and started; the live 0.5.99 probe is therefore pending,
  not claimed.
