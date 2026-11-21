# Skill-card evidence spec — SUPERSEDED

**Status:** superseded on 2026-11-21 by the integrated plan in
[reuse-evidence-plan.md](reuse-evidence-plan.md) (v2). This file is kept as a pointer only;
its content lives in git history.

Why it was folded in: the programme it described and the reuse-evidence programme share one
substrate — signals, a per-use store, an identity rule, a gate vocabulary and a promotion
authority. Keeping two documents would have produced two stores, two digests and two
vocabularies for the same observations.

Where each part went:

| This spec | Integrated plan |
| --- | --- |
| card = skill; tool skill vs flow skill | §5.4 (ref kinds), §9.1 (kinds) |
| provenance digest | §5.5 (identity rule, two digests) |
| token budgets, kill switch, conflict lint | §9.3, §9.4, §9.5 |
| behavioural signals from receipts | §6.1 (`call_craft_*⟫) |
| removal matrix, order sensitivity, length sweep | §10.3, §10.4, §10.5 |
| report schema | §10.6 (a view over the store, not a store) |
| promotion to global | §11 (admission + demotion; bundled skills are born global) |
| six slices | Phases 3–5 in §9–§11 |

Three claims from this spec did not survive: forced-replay ablation (replaced by arms
derived from a session-id hash), recovery for every skill (restricted to skills with a
pre-registered reference, guarded against small gaps), and a second store with its own gate
vocabulary.
