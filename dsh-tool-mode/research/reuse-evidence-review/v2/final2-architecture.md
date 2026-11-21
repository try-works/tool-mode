# v2.7 diff recheck — architecture lens

Only A–R checked. Tree checks: `verification/phase3/REPORT.md` exists and its §3 records the `>= 2`
→ `>= 99` mutation and "mutation reverted | 26 pass, 0 fail" (REPORT.md:37,43,45); the laya manifest
still declares **no** `requiresTools` (`extension-laya/tool-mode.extension.json:145-152`), which is what
§9.1:449-450 and O11 now say; `skill-contract.ts:105-117` still has neither `requiresTools` nor a
declaration-subset constant, so §17:1002's status stays true.

**Verdicts: FIXED 13 · PARTIAL 5 · NOT FIXED 0.**

- **A FIXED** — plan:710-713; no self-negation, and the cited record exists with the mutation in it.
- **B FIXED** — plan:1037-1038; the orphan tail is gone.
- **C FIXED** — plan:1053 says "its intro gained the 'auto-edit a skill' carve-out", matching plan:628-629.
- **D FIXED** — plan:1082 (union + `requiresTools`) and plan:1092-1098 define artifact, scopeKey, gate,
  pass, recovery (`(withCard − base) / (reference − base)`), equivalence margin (±2 pp) and null outcome.
- **E PARTIAL** — the arithmetic is fixed at plan:1102, but the closed table now has **ten** rows for nine
  findings: O12 is printed twice, plan:1124 and plan:1125 (two different wordings of one row).
- **F FIXED** — plan:372-373: "Skill rows add `{applied, tokens, declarationDigest}` — and **no `failurePaths`**".
- **G PARTIAL** — substance right (plan:214-216 extension tuple + `requiresTools`; plan:222-227 declaration
  subset), but the sentence is spliced: "...adding an editable field without adding it to the constant"
  (plan:227) is followed by "equals the editable-field list." (plan:228), the tail of the clause already
  printed at plan:225.
- **H PARTIAL** — the status is now honest and tree-true (plan:448-450, O11), but the replacement left the
  orphan "The second decision family)." at plan:451.
- **I FIXED** — plan:661-663.
- **J FIXED** — plan:795-797: "blocks promotion **while that count is `null` or non-zero** (D19) — a
  `failures === 0` row is promotable", which is D19's rule.
- **K PARTIAL** — the question is gone and the parenthetical points at §10.3 (plan:992-993), but §10.3:556
  still ends "— not a post-hoc choice (§16 item 6)": the slot was deleted, so the pointer is dead and §10.3
  and §16 now point at each other.
- **L FIXED** — plan:354-356: store-derived rows only, suite matrix recomputed from its own runs.
- **M FIXED** — plan:822 ends `fail(programme-stop)`; plan:824 is a pass over stored failures, 3 consecutive.
- **N FIXED** — plan:581-583 uses one floor name (6, Appendix C) and states the formula at point of use.
- **O FIXED** — plan:596-601: `admission.json`, an explicit `pass` predicate, uncomputable → `insufficient`.
- **P FIXED** — plan:749-753: a per-row test in the phase suite from 2026-12-01, no unwritten script.
- **Q FIXED** — plan:839-840 says "retention"; plan:901 has T7 **fixed**; plan:906 closes O12; plan:1102
  reads "nine are closed ... three remain open".
- **R PARTIAL** — the block is present and matches the repairs (plan:955-974), but its input claim "zero
  'still wrong'" (plan:958) is false for this lens: `final-architecture.md` returned 1 STILL WRONG (App C).

## Adjacency damage (v2.7-created)

1. **plan:451 — orphan fragment.** "The second decision family)." is the tail of the sentence H replaced.
2. **plan:225 + 228 — duplicated clause.** "equals the editable-field list" is printed twice inside one
   paragraph, leaving "adding an editable field without adding it to the constant" dangling in between.
3. **plan:1124-1125 — duplicated row.** Appendix D's closed table carries O12 twice, in two wordings.

## Cross-section contradictions created by A–R

1. **§10.3:556 ↔ §16:992-993.** §16 says the floor question "is answered in §10.3"; §10.3 answers it by
   citing "§16 item 6", which K removed. Each now refers to the other and neither names the rule alone.
2. **§15:957-958 ↔ the recheck files.** The record says the final recheck returned "zero still wrong";
   `final-architecture.md` returned STILL WRONG for point 15 and `recheck-architecture.md` recorded the same
   class of finding, so the block understates its own input.
