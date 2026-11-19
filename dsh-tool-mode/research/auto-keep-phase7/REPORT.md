# Auto-keep Phase 7 — release and A/B experiment

Date: 2026-11-20. Package **0.5.97** (source after Phases 0-6).
Plan: `docs/auto-keep-plan.md`.

## Release verification

The packed artifact was installed into the disposable `autokeep` profile, then a
fresh DSH process was used for the probe.

- Installed version: **0.5.97**
- Patch: `autoKeep: session`, `digest: false`, `saveOffer: false`
- Real `tool_mode_run` twice with the same program/input:
  - `rcpt_000001` → `{ doubled: 4 }`
  - `rcpt_000002` → `{ doubled: 4 }`
- The second success produced one **workspace** draft:
  - name `agent_from_draft_462e422e`
  - `scope: workspace`, `scopeKey: e:\tmp\autokeep-phase7`
  - `status: draft`, 24 h TTL
  - `promotedFrom: { scope: session, version: 2 }`
- **Restart** (new process): the workspace draft was visible and described as
  workspace-scoped.
- Delete with `scope: workspace`: `deleted: true`, `complete: true`,
  `remainingScopes: []`.
- **Restart after delete**: `tool_mode_tools list` returned `total: 0`.

This verifies the install, restart boundary, evidence promotion, workspace visibility and
truthful delete on the packed build.

## A/B experiment

10 fresh sessions per arm, same task:

> Call `tool_mode_run` with `return { doubled: input.value * 2 }`, tools [], input
> `{"value": 2}`. Then obtain a reusable tool for that program and call it with value 4.

| Arm | autoKeep | Sessions | Correct final 8 | Direct draft use | from-run use | tool_mode_run calls | tool_mode_tools calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | session (auto-draft) | 10 | 10/10 | 2 | 8 | 15 | 14 |
| B | off (explicit) | 10 | 10/10 | 0 | 10 | 10 | 10 |

### What happened

- Both arms answered correctly in every session.
- A made the draft available automatically, but the solver called `from-run` in **8/10**
  sessions anyway. Only **2/10** reused the existing draft directly.
- B, with auto-keep off, called `from-run` in **10/10** sessions, as expected.
- A used **more** total calls (39 vs 30) because several sessions ran the program twice
  or listed twice before promoting.
- The task allowed the solver to choose how to “obtain” the tool. It did not force direct
  draft reuse, so this measures the default behavior, not the best possible use.

### Conclusion

Auto-keep is installed and works at the storage/lifecycle level. In this task it did **not**
reduce the number of save calls, because agents still preferred the familiar `from-run`
path. A useful follow-up is a directive pointing at the existing draft (the digest/offer
surface), or a task that explicitly says “reuse the saved draft; do not save again.”

This is a null-to-small behavioral result, not a failure of the storage implementation.

## Evidence

- Installed profile: `E:\tmp\dsh-exp-f838ffd2a4d64f09b3c0da1d97fad8a1\profiles\autokeep`
- Release probes: `E:\tmp\autokeep-phase7\probe1.log` … `probe4.log`
- Experiment logs: `E:\tmp\autokeep-experiment\arm-A|B\task-*.log`
- Experiment ledgers: `arm-A|B\session-ledger.json`

The raw files live outside the repo for this run; the summary above is derived from them,
not simulated.
