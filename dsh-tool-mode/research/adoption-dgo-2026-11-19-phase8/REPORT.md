# Phase 8 D/G/O run — 2026-11-19

Status: **completed, ceiling-effect null result. The digest and auto-draft levers were
not isolated by this design.**

Thirty real headless sessions were run (10 per arm) against the local build at
`56d0c02`. No result was simulated. All 30 sessions exited 0 and all 30 answers were
correct within one cent.

## Configuration

| Arm | digest | digestMode | saveOffer | autoDraft |
| --- | --- | --- | --- | --- |
| D | false | directive (unused) | false | false |
| G | true | neutral | false | false |
| O | true | directive | true | true |

- One global authored tool in every arm: `agent_assess_due`.
- Description: "Applies a proportional assessment to a base amount and rounds the amount
  due to cents."
- Each task: "An invoice has a base amount of X and an assessment rate of Y. What is the
  amount due? Use the available tools if useful."
- Same tasks, model, cwd, isolated profile and artifact in every arm.
- `DSH_PERMISSION_MODE=danger-full-access` for the authored-program sandbox.

## Results

| Arm | Sessions | Correct | Calls | Reused | Reuse rate | Authored | Save offers | Drafts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| D | 10 | 10/10 | 10 | 10 | 1.000 | 0 | 0 | 0 |
| G | 10 | 10/10 | 10 | 10 | 1.000 | 0 | 0 | 0 |
| O | 10 | 10/10 | 10 | 10 | 1.000 | 0 | 0 | 0 |

Every session made exactly one call: `agent_assess_due`. The durable usage row records
10 uses, 10 sessions, 0 failures in each arm. No offer was triggered because no session
made three calls with the same shape. No draft was created because no session called
`tool_mode_run`; auto-draft was not exercised by this task set.

## Pre-registered rules

- **G vs D:** 0 percentage points. The rule fires, but D was not silent: the artifact was
  a registered tool whose name and description were visible in every arm. D found it
  without the digest.
- **O vs D:** 0 percentage points. Same ceiling.
- **Correctness:** no regression.
- **Offer/draft retention:** not exercised; no claim.

This run therefore **cannot** support dropping the digest, and cannot support shipping
it. It is a ceiling test, not a framing test.

## Why it ceilinged

The task wording and the tool description were near-identical ("base", "rate", "amount
due"), and the artifact was a normal callable tool. D did not need a digest or a prompt
mention. This is the same failure mode as the earlier `research/adoption-dgo-2026-11-19`
run.

## What a useful rerun needs

1. D must not see the artifact as a callable tool with a matching description. Use a
   library-only artifact with an opaque name and a purpose that only the digest reveals,
   or an equivalent genuinely hidden condition.
2. The task must be solvable by hand and must not reuse the artifact's vocabulary.
3. A separate repetition set must produce three identical call shapes so the offer has a
   trigger.
4. O must include a real `tool_mode_run` so auto-draft/promote is measured, not merely
   configured.

## Evidence

- `arm-D/session-ledger.json`, `arm-D/artifact-usage.json`
- `arm-G/session-ledger.json`, `arm-G/artifact-usage.json`
- `arm-O/session-ledger.json`, `arm-O/artifact-usage.json`
- `task-results.json` — expected, answer, correctness per task
- `arm-D.yml`, `arm-G.yml`, `arm-O.yml`, `run.ps1`

Report command (same output for each arm):

```text
arm  sessions  calls  reusedCalls  sessionsWithReuse  reuseRate  authored  saveOffers
D    10        10     10           10                 1.000      0         0
G    10        10     10           10                 1.000      0         0
O    10        10     10           10                 1.000      0         0
```

## Harness note

The session logs show a non-fatal `config-editor` import warning
(`@deepseek-ai/cordis-plugin-include` had no built `lib/index.js`). The plugin and the
tool-mode calls were unaffected; the missing build output was restored afterwards. This
is a harness-side issue, not a Tool Mode result.
