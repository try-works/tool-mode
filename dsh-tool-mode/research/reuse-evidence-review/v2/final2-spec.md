# v2.7 diff recheck — spec lens

**Reviewer:** adversary-spec. **Target:** `dsh-tool-mode/docs/reuse-evidence-plan.md` (1125 lines read in full). Read-only; only A–R checked.
**Counts:** 18 points — **FIXED 17, PARTIAL 1, NOT FIXED 0**; adjacency damage 3; cross-section contradictions 5.

## Repairs

- **A FIXED** (:709–713) — the revert sentence now states the result once: "A revert result is now on record: `verification/phase3/REPORT.md` §3 shows…", with the earlier record described as "only a red run and two corrected expectations".
- **B FIXED** (:1037–1038) — §17's tail reads "…nothing built so far depends on that choice." once; the duplicate "far depends on that choice." is gone.
- **C FIXED** (:1053) — Appendix A now attributes the carve-out to §12's intro ("its intro gained the 'auto-edit a skill' carve-out"), which matches :627–629.
- **D FIXED** (:1082–1098) — Appendix C gains `artifact` (:1092), `scopeKey` (:1093), `gate` (:1094), `pass` (:1095), `recovery` (:1096), the equivalence margin ±2 pp (:1097) and null outcome (:1098); the skill-declaration row states both shapes including `requiresTools` (:1082).
- **E FIXED** (:1102) — "nine are closed in v2.6 and three remain open"; the O12 row is present (:1124) and O5/O7/O11 are the three open.
- **F FIXED** (:372–373) — skill rows add "`{applied, tokens, declarationDigest}` — and **no `failurePaths`**".
- **G FIXED** (:213–216, :225–226) — the extension tuple plus `requiresTools` is stated, and the test "asserts that the **declaration subset** of that constant equals the editable-field list".
- **H FIXED** (:448–450) — "one tool skill (`identify-language`, 60 lines, one tool)" and a "flow-shaped skill … that does not yet declare `requiresTools`", citing O11.
- **I FIXED** (:661–663) — "Each item below is a **pointer to the decision that forbids it** … the rule it points at lives in the decision."
- **J FIXED** (:795–797) — "blocks promotion **while that count is `null` or non-zero** (D19) — a `failures === 0` row is promotable".
- **K FIXED** (:992–993) — item 6 is replaced by the parenthetical pointing at §10.3, which registers the floor at 6.
- **L FIXED** (:355–356) — "removed from every store-derived report; the suite matrix is recomputed from its own runs, not from the store."
- **M FIXED** (:822, :824) — row 0 ends in `fail(programme-stop)`; row 2 is "a reproduction pass over the stored failures … in 3 consecutive cases".
- **N PARTIAL** (:582–583, :1096) — one name ("the **pair floor** (6, Appendix C)") and the formula "`(withCard − base) / (reference − base)`" are present, but `withCard`, `base` and `reference` are defined nowhere, so the formula cannot be computed from the text.
- **O FIXED** (:597–601) — the entry is `verification/release/<version>/admission.json` with `verify:release`; `pass` is "no family's harm interval falls below the equivalence margin, and … recovery meets its pre-registered bound"; "An uncomputable predicate is `insufficient`, never `pass`".
- **P FIXED** (:748–752) — "from 2026-12-01 a test asserts that each row's named test file exists (one assertion per row, in the phase's own suite — no new script…)".
- **Q FIXED** (:839–840, :901, :929) — the adopted list says "the **retention** of unreproducible evidence"; T7 is **fixed**; the repair record says "closed nine of the twelve".
- **R FIXED** (:955–974) — the v2.7 block exists and describes the damage, the Appendix C/D repairs and the record corrections.

## Adjacency damage

- **D1 — §5.5 (:227–228): duplicated tail.** "…adding an editable field without adding it to the constant / equals the editable-field list." — the old sentence's ending survives the replacement and leaves an ungrammatical clause.
- **D2 — §9.1 (:450–451): orphaned fragment.** "…so C7 currently has no live subject (Appendix D, O11). The second / decision family)." — the tail of the replaced sentence ("decision family)") was not deleted.
- **D3 — Appendix D (:1124–1125): duplicated row.** O12 appears twice with different closings ("stays a field and a report line" vs "stays a field"), so the closed table has ten rows against "nine are closed" (:1102).

## Cross-section contradictions created by v2.7

- **X1 — Appendix A (:1053) vs §12 (:624).** Appendix A says §12's "intro gained the 'auto-edit a skill' carve-out"; §12 still opens "content unchanged".
- **X2 — §10.3 (:556) vs §16 (:992–993).** §10.3 cites "not a post-hoc choice (§16 item 6)", but §16 no longer has an item 6 — the pointer dangles.
- **X3 — §11 (:597–598) vs §14.4 (:746) and §14.7 (:815–816).** §11 and §5.3 make the marker an `admission.json` entry checked by `verify:release`; §14.4 and §14.7 still say the marker is "printed" in the release report.
- **X4 — §13 (:661–663) vs (:679).** The intro says "the rule it points at lives in the decision", but the judge bullet is the only statement of the grade rule and no decision row contains it.
- **X5 — §15 (:929) vs Appendix D (:1124–1125).** §15 says nine of twelve were closed; the closed table now lists ten rows because O12 is duplicated.
