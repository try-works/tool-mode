# U44 — digest metadata, authored describe, bindable offers

**Build:** 0.5.106. **Status:** source + headless live verified.

## 1. Metadata was rendered only for the imperative candidate

E26/E27/E28's artifacts sat in `Also available`. `buildDirectiveDigest` rendered the
`Use <name> ... <purpose> ... Verify: <note>` line only for the top-ranked artifact; the
supporting line was names only. That is why both documented fields looked write-only.

**Fix:** the supporting line now carries a bounded purpose and verification note per entry:

```text
Also available: agent_probe_both — PROBE-PURPOSE-MARKER-doubles-and-triples [Verify: PROBE-VERIF-MARKER-2: wrong on negatives]
```

Live on 0.5.105: a fresh headless session's first-step user message contained both markers
(session `6338129c-3e15-4f3b-bee8-53b3d0e3f5dd`). Unit: `adoption-verification.test.ts`
**5/5**, including a supporting-row marker test.

## 2. U44a — describe authored artifacts

`tool_mode_describe` now describes an authored artifact from its stored row whenever the
authoring snapshot contains it, instead of dead-ending on an empty registry projection.
The row supplies the real input schema; `bindable` remains the live binding answer. A
stored-but-unregistered row is reported as `callable:false` with the scope/restart reason
rather than `unknown tool`. This preserves the existing describe behavior for catalog tools
and adds regression coverage through the existing scoping/describe suites (**67/67**).

## 3. U44b — offers that cannot run

The save-offer builder now refuses a candidate whose name is not in the program binding
lane (`bindableName(candidate.toolName, scopeFor(exec))`). The same filter is applied to
`authoring.suggestions`, which is the list that produced the `repeat_tool_mode_run` /
`repeat_run_code` suggestion. This removes wrappers around `run_code` and the tool-mode
control tools, which saved but failed with "program requested tools it may not use". The F9
test now uses `lang_detect` as the positive control and asserts `tool_mode_run` is absent from
both pending offers and suggestions. Live on 0.5.106: after three `tool_mode_run` probes,
`authoring.suggestions` and `authoring.pendingOffers` were both `[]`.

## Freshness caveat

The digest is recomputed per assembly, but a newly defined artifact can still lag a spawn by
one turn; this change does not alter that. A test of a brand-new artifact should allow a turn
or assert on the binding.

## Gate

- Full plugin suite: **2178 tests, 2171 pass, 7 skipped, 0 fail**.
- Typecheck, build, `verify:built`, `verify:docs`, `verify:verification`, confinement and
  package checks pass.
- 0.5.106 packed and installed in the web profile and in the disposable headless profile.
