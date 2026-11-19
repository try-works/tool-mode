# Silent Phase 8 D/G/O run — 2026-11-19

Status: **valid silent result.** D had no usable signposting, G had the neutral list, O
had the directive. No result was simulated.

Thirty real headless sessions were run (10 per arm) on the local build at
`5ed7569` + the auto-draft default flip. All 30 answers were correct.

## The silent artifact

- Name: `agent_a7f3`
- Published description: `A helper.`
- Purpose (digest-only, never a tool description): "Computes the amount due from a base
  and a proportional rate. Arguments: a is the base amount, b is the rate."
- Input schema: opaque names `a` and `b`.
- D sees the opaque name, description and `a`/`b`; no digest.
- G sees the neutral list, including the purpose.
- O sees the imperative line and the purpose.

The purpose field is the only reason this run is silent. Without it, the tool's own
description told D what it did (the earlier ceiling).

## Results

| Arm | Sessions | Tool-calling sessions | Calls | Reuse rate | Correct | Offers | Drafts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| D | 10 | **0** | 0 | **0.000** | 10/10 | 0 | 0 |
| G | 10 | 10 | 10 | **1.000** | 10/10 | 0 | 0 |
| O | 10 | 10 | 10 | **1.000** | 10/10 | 0 | 0 |

D sessions answered by hand; one representative reasoning: "Simple: 100 * 1.10 = 110.
No tools needed." G and O both discovered and called `agent_a7f3`.

D has no session-ledger row because it made no tool call; the absence is the measurement,
not a missing file.

## Kill rules

- **G vs D: +100 percentage points.** The neutral digest clears the 10-point bar. Keep it.
- **O vs D: +100 points.** The directive clears the bar against no signposting.
- **O vs G: 0 points.** With one artifact and a purpose-bearing neutral list, the
  imperative adds no measured lift. This run supports the neutral list as sufficient for
  a single artifact; it does not show the directive is harmful.
- **Offer:** not exercised; no session made three identical calls.
- **Auto-draft:** not exercised; no session called `tool_mode_run`. Its functional gate is
  the suite, not this adoption run. The shipped default was flipped to true only after
  that suite passed; this report does not claim an adoption lift for it.
- **Correctness:** 10/10 in every arm.

## Interpretation

The digest is the lever: 0/10 without it, 10/10 with either form. The purpose metadata is
what makes a silent artifact discoverable without publishing the purpose in the tool
schema. The directive and neutral forms tie on a one-artifact task; a multi-artifact or
distractor task is needed to test whether the imperative improves selection.

## Evidence

- `arm-D/` (no ledger — zero calls), `arm-G/`, `arm-O/`
- `task-results.json`
- `arm-D.yml`, `arm-G.yml`, `arm-O.yml`, `run.ps1`

The previous ceiling run remains at `research/adoption-dgo-2026-11-19-phase8/`; this
report supersedes it as the Phase 8 result.

## Harness

The sessions ran with the isolated headless profile and
`DSH_PERMISSION_MODE=danger-full-access`. The `config-editor` warning from the previous
run was repaired before this run; the remaining activation warning does not affect
Tool Mode.
