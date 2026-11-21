# Final recheck — spec lens, v2.6 repairs only

**Reviewer:** adversary-spec. **Target:** `dsh-tool-mode/docs/reuse-evidence-plan.md` (1084 lines read in full). Read-only. I checked the 15 listed repair points against the text and then looked only for damage the replacements left behind.
**Counts:** 15 points — **FIXED 8, PARTIAL 7, STILL WRONG 0**; adjacency damage 3; contradictions created by the repairs 9.

## Repair points

1. **FIXED** — §0: row 3 is a four-cell row again (:26), row 12 is the recheck record (:35), and "ten review corrections" is now "the review corrections recorded in §15" (:37).
2. **PARTIAL** — §1: "10 shipping `SKILL.md` files" (:80), "The numbers tabulated in Appendix B" and "There is no in-tree copy" (:51), and the drop-path citation (:82) are all in; but the vendoring precondition points at §16 (:54) and §16 has no vendoring item (:941–959), and the repaired sentence now makes the tabulated numbers premises for "§9.2, §10.4, §10.5 and Appendix B" (:51–52).
3. **FIXED** — §2: the store is descriptive (:90–92), D is a suite pass rate over family tasks (:96–99), and a null outcome is a named guard (:100–102).
4. **FIXED** — §3: D2 names its renderer test (:118); D7 cites D18 and states the same split (:123); D9 defers to D19 (:125); D12 excludes admission from "promotion path" (:128).
5. **FIXED** — §5.3 codes are not outcomes, with numeric examples (:178–183); §5.5 has two declaration shapes (:211–215), `requiresTools` in the digest (:217), and the runtime constant (:221–225) — though that last sentence is now wrong (C2).
6. **FIXED** — §6.1 `call_probe` is presence/absence of any describe with the receipt limitation stated (:245); §6.3 has the window (:291–294) and a named reader via `sessionPersistence` (:296–299).
7. **FIXED** — §7 enumerates `outcome` and `signals[]` (:364–366), makes `applied` a per-use fact (:367–371), refuses a second writer with `EVIDENCE_STORE_LOCKED` (:373–376), has one retention sentence with numbers (:381–385), and says "no second store" (:390–391).
8. **FIXED** — §8 keeps `unreproduced` `null` (:411–413), separates no-replay from the reproduction pass (:403–406), says a skill records no `failurePaths` (:399–401), and decides precedence (note wins, check stays a field: :418–422) — but §7 contradicts the `failurePaths` rule (C1).
9. **PARTIAL** — §9.1 has `requiresTools` as a visibility gate with kind still derived (:436–440) and C1 names its sources (:481); C7's row is unchanged ("fewer than two", :487) and the one-tool "flow skill" example remains (:442–444).
10. **PARTIAL** — §10 has the suite pair (:510–517), sign test / paired difference / MDE list (:532–535), the deletion rule (:537–542), Holm (:544–546), the length equivalence margin (:560–565) and the registered floor (:548–549); `recovery` still has no formula at its point of use (§10.6 :573–575, and Appendix C has no row).
11. **PARTIAL** — §11 has suite demotion (:590–593) and the Holm family (:600–601), but the marker's file, fields and `verify:release` live in §5.3 (:185–188) while §11 still says "printed in the release report, never silent" (:588–589), and the pass predicate exists only in §14.8 row 5 (:813).
12. **PARTIAL** — §13 is a pointer list, not a table, and its own bullets state rules ("very much in this programme", :656; the operational definition of grade, :666) against "Nothing in this section is a rule of its own" (:650); the weight-level bullet is restored (:652–655).
13. **PARTIAL** — §14.1's loop is unchanged, so the red shape lives only at :746; §14.2's revert claim is present but its sentence is mangled (:696–701); §14.4 has owner and date but still depends on "a script this plan still has to define" (:736–740); fixed: flake expiry (:751), `verify:skills` once it exists (:795–797), §14.8 rows 2/3/4/6 (:810–814).
14. **FIXED** — v2.2 and v2.3 records with the pre-repair note (:869–903), the v2.6 line (:915–916), §16 items 4/5/6 (:951–959), and §17's persisted report, flake-as-inference and missing `requiresTools` (:977–1004, :968).
15. **PARTIAL** — Appendix A's new row (:1025) and §12's item-3 note (:1020) are in; Appendix B is untouched with no "as reported" note (:1027–1039); Appendix C's window is fixed (:1050) but the claimed `artifact`, `scopeKey`, `gate`, `pass` and `recovery` rows are absent (:1047–1058); Appendix D exists but contradicts itself (C3).

## Adjacency damage

- **D1 — §14.2 (:696–701): a sentence eaten by its own replacement.** "…and two expectations corrected in the test rather than in the implementation — **not** a revert result **is** on record: `verification/phase3/REPORT.md` §3 shows…" — the repair inserted the new claim without removing the negation, so the paragraph now asserts both that no revert result exists and that one does.
- **D2 — §17 (:1004–1005): a duplicated tail.** "…nothing built so far depends on that choice." is followed by a repeated "far depends on that choice." — the re-wrap kept the old last line.
- **D3 — §1 (:51–52): a self-referential clause.** "premises for §9.2, §10.4, §10.5 and Appendix B" — replacing "eight borrowed numbers" left Appendix B as a premise for itself.

## Contradictions created by the repairs

- **C1 — §7 (:367) vs §8 (:399–401).** The skill row still adds `failurePaths?`, while §8 now says a skill "records no `failurePaths` at all"; one of the two must go.
- **C2 — §5.5 (:221–225) vs (:216–219).** The new paragraph says a test "asserts that constant equals the editable-field list", but the digest constant enumerates `rendererVersion`, `toolName`, contract ids and the source/body digests, none of which are editable; the equality cannot hold as written.
- **C3 — §15 (:915–916) vs Appendix D (:1062).** "closed ten of the twelve" and "ten are closed in v2.6 and **three remain open**": 10 + 3 = 13, and the closed table has nine rows (9 + 3 = 12). One of the three numbers is wrong, and both statements are unreconcilable.
- **C4 — §11 (:588–589) vs §5.3 (:185–188).** §11 still says the `admitted-insufficient` marker is "printed in the release report, never silent"; §5.3 now says it "is not prose: it is an entry in `verification/release/<version>/admission.json` … checked by `verify:release`".
- **C5 — §9.1 (:442–444) vs Appendix D O11 (:1070).** §9.1 says "The repo already ships one flow skill of each shape"; O11 records that Laya's flow skill declares no `requiresTools`, and the cited identify-language is "one tool", so the rule's only subject is the example the plan itself disowns.
- **C6 — §13 (:650) vs (:656, :666).** "Nothing in this section is a rule of its own" against a bullet saying suites are "very much in this programme" and a bullet that operationally defines "grade" for every report and gate.
- **C7 — §14.7 (:782–783) vs §8/D19 (:411–413, :810, retained).** §14.7 still says a non-reproducing failure "blocks promotion"; §8/D19 and §14.8 row 2 now allow promotion when `failures === 0`, which is exactly the state that sentence says it leaves.
- **C8 — §16 item 6 (:957–959) vs §10.3 (:548–549).** The question "May the pre-registered pair floor be amended per family?" is already answered by "A different floor for a rarely used family is a dated amendment"; the open question is moot as asked.
- **C9 — §5.5 (:213–215).** The bullet cites the extension registration as `{name, description, content, path, source}` and then says the surface is "`name`, `description`, `requiresTools` and the `SKILL.md` bytes"; the cited tuple does not contain the field the sentence adds.
