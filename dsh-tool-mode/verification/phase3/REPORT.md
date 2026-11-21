# Phase 3 report — the skill contract slice

Generated 2026-11-21. This is the artifact §14.6 requires: the red command, the green run, the gate,
the measured values or their guards, and what was not run. It replaces the earlier status claim that
"the red half is in this session's transcript", which was not a record a reviewer could open.

## 1. The red run

Command: `npx tsx --test packages/dsh-tool-mode/tests/skill-contract.test.ts`, executed before
`src/skill-contract.ts` existed.

Failure (verbatim, first lines):

~~~text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'D:\DEV\tool-mode\dsh-tool-mode\packages\dsh-tool-mode\src\skill-contract.ts'
imported from ...\tests\skill-contract.test.ts
✖ packages\dsh-tool-mode\tests\skill-contract.test.ts
ℹ tests 1 | ℹ pass 0 | ℹ fail 1
~~~

This is the failure the test was written to produce: a missing module, not an accidental syntax error.

## 2. The green run

`npx tsx --test packages/dsh-tool-mode/tests/skill-contract.test.ts` → **26 tests, 26 pass, 0 fail**.
`npx tsx --test packages/dsh-tool-mode/tests/skill-disable.test.ts` → **3 tests, 3 pass, 0 fail**
(the disabled skill is unpublished while its tool stays registered; the environment override is
honoured; an unknown name changes nothing).

Adjacent suites (`extension-skills`, `tool-description-surfaces`,
`tool-description-registration`, `plugin`) → **32 pass across 11 suites**. `npm run typecheck` → exit
0 across every workspace package.

## 3. The mutation check (§14.1 step 4, §14.2)

The behaviour removed: `skillKindOf`'s flow threshold, changed from `>= 2` to `>= 99` and reverted.

| step | result |
| --- | --- |
| baseline | 26 pass, 0 fail |
| mutation applied | **1 fail**: "is a flow skill when it declares two or more tools" (25 pass) |
| mutation reverted | 26 pass, 0 fail |

This is the first recorded revert result for this plan. Until now §14.2 described a rule, not a
practice.

## 4. The gate

`npm run verify:static` and `verify:skills` were **not** run: `verify:skills` does not exist yet
(§14.8 row 3 is therefore `unavailable`, not passing), so the Phase 3 gate is unmet by construction.

## 5. Measured values, and what is null

- skill digest: computed at registration; **not reported on any surface yet** — no `skills list`, so
  the Phase 3 gate's "every registered skill reports a digest and a token count" is unmet.
- `requiresTools`: **not in the digest** — §5.5 requires it; the module needs the field.
- budgets: functions implemented and tested; **not enforced at render time**.
- conflict lint: C1–C7 and C9 implemented; **no `verify:skills`**, so no build can fail on them.
- `anti_slop_lint`: **not run** — it reports `oxlint-not-found` in this environment. Not claimed.
- full `npm test`: 4084 tests, 4058 pass, 25 skipped, 1 failure
  (`tools-plan-hosting.test.ts:660`, which passes 27/27 in isolation — recorded as a load-dependent
  timing flake, not a regression).

## 6. Open items

Tracked in `docs/reuse-evidence-plan.md` Appendix D. This report closes none of them by itself.
