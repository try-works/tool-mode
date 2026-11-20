# R5 — offers accept to runnable artifacts or refuse by name (0.5.106 re-check)

Date: 2026-11-20. Role: litert-provider, task-90. Scope: `tests/offer-runnability.test.ts` and
this report only. **No product source was edited.**

Sources read first: `docs/fix-requirements-0.5.106-plan.md` (Phase 5 / R5) and
`D:\DEV\tool-mode-internal\research\reports\2026-11-20-fix-requirements-0.5.106.md` (R5).

## Requirement

R5: an offer must either accept to an artifact that RUNS, or refuse with an error naming the
unbindable tool and save nothing. The 0.5.104 regression: repeating `run_code` offered
`repeat_run_code` with `tools:['run_code']`; accepting saved a wrapper that failed at run
time with "unauthorized: the program requested tools it may not use".

## Test (new)

`packages/dsh-tool-mode/tests/offer-runnability.test.ts` (2 tests):

1. **Control calls never become offers.** Mounts the real plugin with the tongue fixture, a
   fake PTC runtime and `hostedCode:true`; repeats the control call
   `tool_mode_run {probe:true, tools:[]}` three times (and `run_code`, if this deployment
   registers that spelling). Asserts:
   - the third result content contains no `Offer:` line;
   - `authoring.pendingOffers` and `authoring.suggestions` name neither `run_code` nor
     `tool_mode_run` (nor any `tool_mode_*` control name);
   - `saveOffersAccepted === 0`, and no tool/workflow row was saved.
2. **The remaining legitimate offer accepts AND runs.** Repeats `lang_detect` three times
   (tongue enabled), asserts exactly one pending offer whose command is
   `tool_mode_workflows save`; accepts it verbatim; asserts the pending offer is cleared and
   counted; asserts `tool_mode_run {probe:true, tools:[callableName]}` resolves true; then
   executes `tool_mode_workflows {action:'run', name, input:{text}}` and asserts a successful
   result containing the detected language. If that run had failed, the test requires a
   refusal naming the artifact and that no tool/workflow row survived — the 0.5.104 defect
   would fail the test here.

## Commands and results

    npx tsx --test packages/dsh-tool-mode/tests/offer-runnability.test.ts
    -> 2 tests, 2 pass, 0 fail

    npx tsx --test tests/offer-runnability.test.ts tests/adoption-non-offerable.test.ts tests/adoption-offer-acceptance.test.ts
    -> 6 tests, 6 pass, 0 fail

    npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json
    -> exit 0

    anti_slop_lint on tests/offer-runnability.test.ts
    -> clean

There was no red run: the current build already passes the requirement, which the plan
anticipated ("the 0.5.106 build already filters `pendingOffers` and `authoring.suggestions`
through `bindableName`; the report asks for a re-check"). The test is a regression proof, not
a fix.

## Why no 0.5.106 source change is needed

The filter is already in `src/index.ts`:

- `offerSupport.build` returns undefined unless `bindableName(candidate.toolName, scopeFor(exec))`
  is true (U44b comment: the offer is a promise that accepting produces a runnable artifact);
- `authoring.suggestions` is filtered by the same `bindableName` predicate;
- `NON_OFFERABLE_TOOLS` also suppresses `tool_mode_list/describe/workflows/tools`,
  `model_tools`/`model_tools_manage`, and every `decision_*` tool by prefix.

`run_code` and `tool_mode_run` are control tools outside the program binding lane, so
`bindableName` excludes them; the regression cannot recur without removing that gate. The
acceptance half is covered because the offered command is saved and then executed through the
same binding resolver the probe reports.

Residual note: this harness registers `tool_mode_run`, not a separate `run_code` tool; the
test repeats `run_code` only when the deployment exposes it. The guarantee is name-independent
(the `bindableName` gate applies to every candidate), and the control-name assertions also
cover any `tool_mode_*` offer.

## Conclusion

0.5.106 needs **no source change** for R5. No commit, no pack/install/restart.
