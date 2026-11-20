# Fix requirements for 0.5.106 — TDD and verification plan

Status: proposed. Target release: **0.5.107**. Source report:
`research/reports/2026-11-20-fix-requirements-0.5.106.md` (external research checkout;
evidence `2026-11-20-0.5.106-verification-rendered.md`, runlog E29).

This plan treats the report's R1-R5 as acceptance requirements, not as implementation
instructions. Every behavioural change starts with a failing test that reproduces the
reported behaviour, then the smallest fix, then adjacent regressions and the full gate.
No test, probe, or live result is recorded unless it ran.

## 0. Preserve these 0.5.106 behaviours

Add regression assertions before touching them:

- `verification` is stored, returned by `tool_mode_tools {action:'get'}`, and rendered.
- `tool_mode_describe` resolves authored tools and workflows under both spellings.
- `tool_mode_workflows {action:'run'}` runs saved workflows.
- `tool_mode_list({scope:'workspace'})` shows a promoted workspace row.
- U44 filters keep `run_code` / control tools out of `pendingOffers` and
  `authoring.suggestions`.

## 1. Decide R1 before writing the fix

The report allows two outcomes:

- **A (preferred): authored artifacts bind inside `tool_mode_run`.** The digest is already
  written in program-call syntax; making the three calls succeed keeps one route for
  catalog tools, authored tools, and workflows.
- **B (fallback): authored artifacts are intentionally not bindable.** The digest must stop
  printing a program call and print the route that works, and `tool_mode_list` must name
  that route.

**Decision gate.** Spend the first TDD cycle on R1-A. If the failure is a registration or
scope-resolution defect, fix it. If the failure is a deliberate authority boundary that
cannot be crossed without weakening SEC-04/CODE-03, switch to R1-B and change the digest and
list output instead. Do not leave the digest in program syntax while the route is B.

### Phase 1 — R1-A: authored program binding (red → green)

**Red tests** in `packages/dsh-tool-mode/tests/authored-program-binding.test.ts`:

1. Define a session tool `agent_counts` (program `return { counts, total }`) and a workspace
   workflow `g1_lang_counts` whose program calls `agent_counts`.
2. `tool_mode_run({probe:true, tools:['agent_counts']})` → `preflight[0].resolved === true`.
3. The report's three calls, using the fixture names, return
   `{counts:{pl:1,fi:1}, total:2}`:
   - direct authored tool,
   - stored workflow `g1_lang_counts`,
   - callable spelling `workflow_g1_lang_counts`.
4. A saved workflow whose program binds another authored artifact runs, proving the nested
   binding path, not only the top-level preflight.
5. A genuinely absent name still resolves false with a named reason (R4 overlap).

**Diagnose, do not guess.** On the red run, record the exact `preflight` rows and the
`tool_mode_run` refusal. Check, in order:

- `ctx.tools.schemas()` contains the authored name and `workflow_<name>`.
- `authoredToolVisibleAt(name, scopeFor(exec)) ` is true for the caller's scope.
- `ProgramRunner`'s `grant()`/`visible()` include the name at run time.
- `authoringStore.getTool/getWorkflow` resolves the same row the digest advertised.
- the nested `runAuthoredProgram` path passes the resolved `tools` list through the same
  authority function (`authorizeProgramTools`).

**Minimum implementation** is one of:
- register/restore the authored row before the digest can advertise it;
- make the binding resolver and `grant()` agree on the same live registry/scope;
- pass a resolved authored binding through the nested workflow program path.

No new allowlist that bypasses `authorizeProgramTools`; the program authority must remain the
single decision point.

### Phase 1B — R1-B route (only if the gate selects B)

If B is chosen:

- Digest tools: print the direct-call route and explicitly say “call directly, not through
  `tool_mode_run`”.
- Digest workflows: print
  `tool_mode_workflows {"action":"run","name":"<name>","input":{...}}`.
- `tool_mode_list` authoring rows gain a `route` field that names the same command.
- Add a test that parses the digest route and executes it verbatim.

## 2. Phase 2 — R2: the digest may only advertise what it can execute

**Red test** `tests/digest-executable.test.ts`:

1. Build the digest for the fixture authored tool and workflow.
2. Parse each advertised artifact and its printed call form.
3. Execute that form in a fresh program with a sample input.
4. Assert zero bind refusals and the expected result.

The test must cover the **top candidate** and each **supporting** entry, because E26/E27/E28
were supporting entries. If R1-A is green, this is the same binding test through the digest
surface; if R1-B is green, it asserts the alternative route text.

Do not weaken this test by allowing a documented “except authored tools” clause — that is the
reported failure.

## 3. Phase 3 — R3: verification renders in full

**Red test** `tests/verification-fidelity.test.ts`:

- Store the report's 176-character verification.
- Assert the digest contains **all six** `word->code` pairs and the closing instruction.
- Assert no rendered value ends mid-token (no `->h…`).
- Add an over-budget case: the value is cut at a word boundary and ends with
  `… read the full text with tool_mode_tools {action:'get'}`; the pointer is not optional.
- Assert the existing 600-character / 4-line cap still holds.

**Implementation:**

- Remove the supporting-row 55-character cap; render the complete value when it fits.
- Define an explicit verification budget (start at 240 characters) and a word-boundary
  truncator; never `slice` mid-token.
- If the total digest budget forces a cut, keep the explicit pointer. A second line is
  allowed when needed; update the cap test only with a documented reason.

## 4. Phase 4 — R4: diagnostic refusal and list-level bindable

**Red tests** `tests/bind-diagnostics.test.ts`:

1. `tool_mode_run({tools:['nonexistent_thing'], code:'return 1'})` message contains the exact
   name, a reason class, the caller scope, and a route/action.
2. The same assertion for a stored-but-out-of-scope authored name.
3. `tool_mode_list` authored **tool** and **workflow** rows carry `bindable: true|false`.
4. That value equals `tool_mode_run({probe:true, tools:[name]}).preflight[0].resolved`.

**Implementation:** keep the existing `runtime-surface` diagnostic path and fix any empty
`reason`/`action`; add `bindable` to the authoring snapshot rows for both kinds. Do not add a
second “can bind” predicate: use `bindableName`/the binding resolver.

## 5. Phase 5 — R5: offers must not save unrunnable artifacts

The 0.5.106 build already filters `pendingOffers` and `authoring.suggestions` through
`bindableName`; the report asks for a re-check.

**Regression test** `tests/offer-runnability.test.ts`:

1. Produce a repetition shaped like `repeat_run_code` / `repeat_tool_mode_run`.
2. Assert neither list offers it.
3. For any offer that remains, accept it and run the resulting artifact; assert success.
4. If acceptance can still fail, validate the binding set before saving and return an error
   naming the unbindable tool; assert nothing was saved.

## 6. Phase 6 — full gate, release, and live verification

Run in this order; a failure stops the release:

1. Focused tests for each phase, then adjacent suites:
   `adoption-directive-digest`, `adoption-verification`, `adoption-non-offerable`,
   `artifact-scoping-acceptance`, `tool-mode-describe`, `host-cluster`.
2. `npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json`.
3. `npm run test:integration:dsh` — full plugin suite.
4. `anti_slop_lint` on every changed source/test file.
5. `npm run build:host`; `node scripts/record-confinement-evidence.mjs ...`.
6. `npm run verification`, `npm run verify:built`, `npm run verify:docs`,
   `npm run verify:verification`.
7. Bump to 0.5.107, `npm pack`, install into the web profile **and** a disposable headless
   `DSH_HOME` profile.
8. Full DSH web stop/start (not a reload); confirm the new PID and that the probe reports
   `possibly-current`.
9. Live probe with a fresh headless session:
   - first-step digest contains all six verification cases;
   - `tool_mode_run({probe:true, tools:[...]})` resolves authored tool and workflow;
   - the three R1 calls succeed;
   - `tool_mode_list` row `bindable` matches probe;
   - unknown name refusal names the name.
10. Commit code, tests, plan/report, verification artifacts; push. Do not commit stray tarballs
    except the current release tarball if the repository convention keeps one.

## 7. Definition of done

| Req | Done when |
|---|---|
| R1 | Authored tool, stored workflow, and `workflow_*` spelling bind and run; nested workflow binding works; or the R1-B route is the only advertised route and executes verbatim. |
| R2 | Every digest-advertised artifact executes exactly as printed in a fresh program; 0 refusals. |
| R3 | All six case mappings and the instruction are present for the 176-char value; no mid-token cut; over-budget pointer is explicit. |
| R4 | Refusal names the tool, reason, scope, and action; authored list rows expose `bindable` matching `probe:true`. |
| R5 | Accepting an offer either yields a runnable artifact or refuses by name and saves nothing. |
| Gate | Full suite green, typecheck/build/docs/verification green, 0.5.107 installed, live probe recorded, report committed. |

## 8. Parallel work split (optional, disjoint scopes)

- **Lead:** Phase 0 fixtures, R1 decision gate, digest integration, full release/live gate.
- **Binding stream:** `runtime-surface.ts`, `discovery-binding.ts`, `index.ts` binding/registration;
  R1/R4 tests.
- **Digest stream:** `library-digest.ts`, `adoption-digest-ranking.ts`; R2/R3 tests.
- **Offer stream:** `index.ts` offer builder and `tests/offer-runnability.test.ts`; R5.

Do not let two agents edit `index.ts` concurrently; sequence the binding and offer patches,
and have the Lead review the combined diff and run the full gate.

## 9. Risks and rollback

- **R1 authority weakening:** do not add a parallel authorization path. If the live binding
  cannot be made consistent without bypassing `authorizeProgramTools`, choose R1-B.
- **Digest budget:** full verification text can crowd out evidence lines. Keep the explicit
  truncation pointer and a test for the 600/4 cap; do not silently drop the six cases.
- **Existing artifacts:** a restored session draft may be stale. Reproduce with a freshly
  defined artifact first, then with the report's restored row; record which case fails.
- **Rollback:** each phase is a separate commit; revert the digest route change if R1-A is
  reverted, so the prompt never prints a refusal.
