# Silent Phase 8 D/G/O run — 2026-11-19

Status: **valid silent result.** D had no usable signposting, G had the neutral list, O
had the directive. No result was simulated.

Thirty real headless sessions were run (10 per arm) on the local build at
`3ac8df3` + the purpose-surface fix. All 30 answers were correct within one cent.

## The silent artifact

- Name: `agent_a7f3`
- Published description: `A helper.`
- Purpose (digest-only): "Computes the amount due from a base and a proportional rate.
  Arguments: a is the base amount, b is the rate."
- Input schema: opaque names `a` and `b`.
- The purpose is **not** returned by `tool_mode_tools list/get`,
  `tool_mode_list`'s authoring block, promote or demote. It reaches only the digest.
- D sees the opaque name, description and `a`/`b`; no digest.
- G sees the neutral list, including the purpose.
- O sees the imperative line and the purpose.

## Results

| Arm | Sessions | Sessions with artifact use | Artifact calls | Session reuse | Correct within 1 cent | Exact cents |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| D | 10 | **1** | 1 | **10%** | 10/10 | 9/10 |
| G | 10 | 10 | 10 | **100%** | 10/10 | 10/10 |
| O | 10 | 10 | 10 | **100%** | 10/10 | 10/10 |

D made one extra `pwsh` call in a different session; it never called the artifact in
that session. The artifact call rate is 1/10 sessions; the report script's call-level
`reuseRate` for D is 0.5 (1 reused of 2 total calls), which is not the session metric.

D's one artifact session is the only non-silent event: a solver guessed that
`agent_a7f3` with `a`/`b` might compute the total. The other nine answered by hand.
G and O called it in every session.

D's ninth answer was `52.325` (mathematically correct, not rounded to cents); G and O
returned `52.33`. That is why D is 9/10 exact cents but 10/10 within one cent.

## Kill rules

- **G vs D: +90 percentage points** (100% vs 10%). The neutral digest clears the
  10-point bar. Keep it.
- **O vs D: +90 points.** The directive clears the bar against no signposting.
- **O vs G: 0 points.** With one artifact and a purpose-bearing neutral list, the
  imperative adds no measured lift. This run supports the neutral list as sufficient for
  a single artifact; it does not show the directive is harmful.
- **Offer:** not exercised; no session made three identical calls.
- **Auto-draft:** not exercised; no session called `tool_mode_run`. Its functional suite
  is green and the shipped default is true; this run claims no adoption lift for it.
- **Correctness:** no regression; D's one unrounded answer is recorded above.

## Interpretation

The digest is the lever: 10% without it, 100% with either form. Hiding the purpose from
every non-digest surface is what makes D silent. The directive and neutral forms tie on a
one-artifact task; a multi-artifact or distractor task is needed to test whether the
imperative improves selection.

## Evidence

- `arm-D/` (ledger with one `agent_a7f3` call, one `pwsh` call), `arm-G/`, `arm-O/`
- `task-results.json` — expected, answer, within-cent and exact-cents per task
- `logs/` — all 30 raw task logs
- `seed-agent_a7f3.json` — the exact artifact
- `prompts.txt`, `arm-D.yml`, `arm-G.yml`, `arm-O.yml`, `run.ps1`

The previous visible-tool ceiling is retained at
`research/adoption-dgo-2026-11-19-phase8/`; this report supersedes it as the Phase 8
result.

## Harness

The sessions ran with the isolated headless profile and
`DSH_PERMISSION_MODE=danger-full-access`. The previous `config-editor` warning was
repaired; it did not affect Tool Mode.
