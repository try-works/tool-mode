# Final recheck — evidence lens (v2.6)

Fifteen repair points verified against the text, then damage. Read-only; no builds. I also opened
`verification/phase3/REPORT.md` (67 lines), because §14.2, §17 and Appendix D O8 now rest on it.

## Repair points
1. **FIXED** (L26) — row 3 is a four-cell row again ("one store for artifacts | the same store, with skill rows carrying `applied`, `tokens`…"); row 12 is the recheck row (L35); "the review corrections recorded in §15" (L37).
2. **FIXED** (L80) — "10 shipping `SKILL.md` files in extensions (the SDK template is not a shipped tool)"; "The numbers tabulated in Appendix B" and "There is no in-tree copy" (L51); drop-path citation `index.ts:5912-5943` (L82).
3. **FIXED** (L90–102) — goal 1 "the store is descriptive"; goal 3 "the suite's pass rate over family `F`'s tasks falls by `D`"; goal 4 "a null outcome that is a **named guard**".
4. **FIXED** (L118, L123, L125, L128) — D2's renderer test; D7 matches D18; D9 defers to D19; D12 "an admission authority is not a promotion path".
5. **FIXED** (L178–225) — numeric reason string with `insufficient(7, 8)`; two declaration shapes; `requiresTools` in the digest; "The digest field list is a **runtime constant**".
6. **FIXED** (L245, L291–299) — `call_probe` is "no `tool_mode_describe` call at all"; §6.3 has the window and the reader over `sessionPersistence`.
7. **FIXED** (L364–391) — `outcome`/`signals[]` domains; `applied` "is a **fact about the use**, not an arm"; `EVIDENCE_STORE_LOCKED`; one retention sentence; "no second store exists".
8. **FIXED** (L399–422) — a skill records no `failurePaths`; no replay vs a reproduction pass; `unreproduced` null; "**Precedence, decided:**" the note wins and the check stays a field.
9. **FIXED** (L436–440, L481) — `requiresTools` is a visibility gate with the kind still derived; C1 names its sources and skips `unstructured`.
10. **PARTIAL** (L532–549) — the three-bullet list, deletion rule, Holm grid and registered pair floor are back; but "the pre-registered MDE for that suite size" gives no value anywhere, and §10.6's `recovery` (L573–574) states when it is `null`, not how it is computed — "recovery formula" is absent.
11. **PARTIAL** (L587–601) — suite demotion and "Holm-corrected across the suite matrix's pre-registered family" are in; the pass predicate is not in §11 (it is §14.8 L813) and the admission bullet still describes the marker as prose "printed in the release report", while the file and fields live in §5.3 (L185–188).
12. **PARTIAL** (L649–665) — the weight-level bullet is back, but §13 is still a bullet list, not the "pointer table" claimed; and its preamble says "the reasoning lives in the decision row, not here" while four of seven bullets carry their own reasoning and name no decision.
13. **PARTIAL** (L736–814) — 14.4 owners/date, 14.5 flake as defect, 14.7 `verify:skills` "once that script exists" and row 3 "`unavailable` … never `pass`" are all fixed; but 14.1 is unchanged (the red-run shape is §14.5 L746), the 14.2 revert sentence is mangled (below), and row 2 still mixes "the next 3 failing uses" with "by a reproduction pass".
14. **FIXED** (L901–1001) — the pre-repair note (L901–903), the v2.6 line (L915–917), §16 items 4–6 (L951–959), the report "now **persisted**" (L977–978), the flake "is an inference" (L992–995), the digest "lacks `requiresTools`" (L968, L1001).
15. **PARTIAL** (L1010–1083) — A's "(new)" row lists §1/§2/App C/App D; D has three open rows and a closed table; but B has no provenance sentence of its own (only §1 L51 has one), C's intro promises five terms it does not define, and A misattributes §12's change.

**Counts:** FIXED 10 · PARTIAL 5 · STILL WRONG 0.

## Adjacency damage
- **§14.2 L696–701, eaten words:** "— **not** a revert result **is** on record:" — the replacement left the negation and the verb, so the sentence denies the revert result it then cites; the cited report (REPORT.md §3) does contain the mutation `>= 2` → `>= 99` and the 26/26 revert.
- **§17 L1004–1005, duplicated fragment:** "nothing built so far depends on that choice." followed by "far depends on that choice."
- **Appendix C L1043–1045, phantom definitions:** the intro says the appendix is referenced from §5.3 (gate), §5.4 (artifact), §7 (scopeKey), §10.6/§11 (recovery, pass), but the table defines none of those five terms.
- **Appendix C L1049 vs §5.5 L213–215:** the canonical "skill declaration" row says extension skills are `{name, description, body}`; §5.5 says they register as `{name, description, content, path, source}` and that `requiresTools` is part of the editable surface — the row omits the field the repair just added to the digest.
- **Appendix A L1020, wrong location:** "its item 3 gained the 'auto-edit a skill' carve-out" — the carve-out is §12's unnumbered intro (L616–617); item 3 is the promotion authority.
- **§15's counts, three answers:** L915 "ten of the twelve open findings", L934 "30/19/23 findings respectively" still not fixed, Appendix D L1062 "twelve findings; ten are closed … three remain open" (10 + 3 = 13) with a nine-row closed table.

## Contradictions between sections
- **§15 T7 (L887) vs §17 (L977):** the v2.2 row still says "the red half is marked unpersisted"; §17 now says it is "now **persisted**".
- **§11 (L587–589) vs §5.3 (L185–188):** Appendix D O5 says "the plan now specifies the file and the fields", but §11 still admits on a marker "printed in the release report" and never references `admission.json` or `verify:release`.
- **§8 (L405–406) vs §14.8 row 2 (L810):** §8 says the gate is "a **reproduction pass** over a stored failure"; row 2 says "an observed check is reproduced on the next 3 failing uses of the same declaration, **by a reproduction pass**" — a past-failure pass cannot produce the next three failing uses.
- **§13 preamble (L649–650) vs its bullets (L652–665):** "Nothing in this section is a rule of its own" while four bullets state their own reasoning.
- **§6.4 (L351) vs D17/§10.3:** a forgotten session still removes "a skill row … from the ablation matrix", but the matrix is now a suite matrix with no store rows.
- **§15's adopted list (L824–826) vs D9/D19/§8:** "the deletion of unreproducible evidence" is still the canonical list that §0 now points at, and it is the opposite of "retained and counted".
- **§14.8 row 0 (L808) vs §2 goal 4 / D11:** Phase 0's null outcome is "programme stops", so the named guard that means "no data" terminates the programme — `insufficient` doing the work of `fail`.
- **Appendix C's promise (L1043) vs §10.3/§10.5/§11/§14.8:** "One canonical statement per term" while the **equivalence margin** — the pivot of both the deletion and admission predicates, and of the length sweep's "matches" test — has no definition or value anywhere in the plan.
- **§10.6 (L574) vs Appendix C (L1053):** the formula's floor is called `minPairs` in one place and "pair floor" in the other, and neither gives the value (6 lives only in §10.3/§14.8).

**Reading.** The repair list is largely executed: 10 of 15 points hold, and the suite statistics are now
internally better than any earlier draft (paired unit, sign test, MDE hook, Holm over the grid, a
registered floor, an evaluable deletion rule once "equivalence margin" is given a value). The damage
is again in the record layers — the recheck counts, the Appendix C intro, the §15 disposition — and in
one sentence in §14.2 that a replacement left negated.
