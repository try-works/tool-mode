# D/G/O adoption run — 2026-11-19

Status: **completed, null result for the digest; save offer untriggered.**

This run followed `docs/adoption-levers-plan.md`. It used real headless agent
sessions, the local working tree linked into an isolated profile, and the same
artifact and task instances in every arm. No results were simulated.

## Environment

- Commit under test: `47286bf` (adoption levers on by default).
- DSH CLI: `D:\deepseek-harness\apps\cli\lib\bin.js`, profile `headless`.
- Isolated `DSH_HOME` with the local package linked:
  `@try-works/dsh-tool-mode 0.5.95 <- D:\DEV\tool-mode\dsh-tool-mode\packages\dsh-tool-mode`.
- Permission mode for the run: `DSH_PERMISSION_MODE=danger-full-access`.
- Model route: the profile's configured deepseek route (the exact model id was
  not recorded in the ledger; do not infer one from this report).
- One global artifact, identical in all arms:

```text
workflow_g1_invoice_total
  Invoice total: apply the tax rate to the subtotal and round the result to cents.
  input: { subtotal: number, rate: number }
```

- Ten invoice tasks per arm, same instances in D/G/O.
- New session per task; 30 real sessions total.

## Arms

| Arm | `adoption.digest` | `adoption.saveOffer` |
| --- | --- | --- |
| D | false | false |
| G | true | false |
| O | true | true |

Each arm had separate `stateFile`, `agentAuthoringFile`, `runCaptureFile`, and
session ledger paths.

## Results

| Arm | Sessions | Correct | Calls | Sessions with reuse | Reuse rate | Authored | Save offers | Artifact uses |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| D | 10 | 10/10 | 10 | 10 | 1.000 | 0 | 0 | 10 |
| G | 10 | 10/10 | 10 | 10 | 1.000 | 0 | 0 | 10 |
| O | 10 | 10/10 | 10 | 10 | 1.000 | 0 | 0 | 10 |

- Every session made exactly one Tool Mode call.
- The call was `workflow_g1_invoice_total`; the durable usage row records
  10 uses, 10 distinct sessions, 0 failures in every arm.
- No session authored a new artifact.
- No save offer was surfaced, because no session made three calls with the same
  argument shape.
- All 30 numeric answers matched the expected totals within one cent.

Raw evidence:

- `arm-D/session-ledger.json`, `arm-D/artifact-usage.json`
- `arm-G/session-ledger.json`, `arm-G/artifact-usage.json`
- `arm-O/session-ledger.json`, `arm-O/artifact-usage.json`
- `task-results.json` (expected, answer, correctness, exit per task)

## Pre-registered kill rules

From the plan:

- **G must beat D by at least 10 percentage points in reuse.** G = 100%, D = 100%;
  lift = 0 pp. **Kill rule triggered: drop the digest.**
- **O drafts must be reused within two sessions in at least one third of drafts.**
  No drafts and no offers were produced. The save offer was **not exercised**, so
  this rule is inconclusive, not a pass or a fail.
- **No correctness regression.** 10/10 in every arm.

## Interpretation

This is a **ceiling-effect null result**, not evidence that a digest can never
help.

- The artifact was registered as a normal callable tool, so its name and
  description were visible in every arm through `tool_mode_list` and the tool
  schema. D found it without the digest.
- The task text and the artifact description were near-identical ("invoice
  total"), which made discovery trivial.
- Each task needed one call, so the repeated-shape save offer had no trigger.
- The experiment therefore did not create the discovery problem the digest was
  meant to solve.

The digest should be treated as **unproven** and, per the kill rule, **off** for
the next experiment. A useful next run needs:

1. an artifact whose callable name/description does not match the task wording;
2. a task set where direct calculation is plausible, so discovery is the
   variable;
3. a separate repetition task set that can trigger the save offer;
4. a recorded model id and temperature;
5. a D arm with the artifact hidden from the tool list (or an equivalent
   "not visible" condition), otherwise D cannot be a discovery baseline.

## Reproduction

The arm patches and run script are in the experiment directory. The report
script was run against each ledger:

```
node scripts/adoption-report.mjs \
  --session-ledger research/adoption-dgo-2026-11-19/arm-G/session-ledger.json \
  --usage research/adoption-dgo-2026-11-19/arm-G/artifact-usage.json
```

The session material was produced by `dsh --profile headless --patch <arm>.yml`
with `DSH_HOME` pointed at an isolated profile and `DSH_PERMISSION_MODE` set to
`danger-full-access` so the authored-workflow sandbox can run on Windows.
