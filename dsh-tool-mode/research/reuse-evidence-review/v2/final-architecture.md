# Final architecture recheck (v2.6) — repairs, not the whole plan

Checked against the text and, where the claim is code-dependent, against the tree: 
`verification/phase3/REPORT.md` exists and its `§3` does record `skillKindOf`'s `>= 2` → `>= 99`
mutation with "mutation reverted | 26 pass, 0 fail" (REPORT.md:37,43,45); `sessionPersistence` at
`index.ts:1647-1671` and the `agent/pre-step` prompt-assembly hook (`index.ts:4275`) support §6.3's
reader; the laya manifest still declares **no** `requiresTools` (`tool-mode.extension.json:145-152`);
`skill-contract.ts:105-117` still hashes renderer + source + body and no `requiresTools`; the
warn-and-drop branches really are at `index.ts:5912-5943`.

**Point verdicts: FIXED 11 · PARTIAL 3 · STILL WRONG 1.**

## Numbered points

1. **FIXED** — §0 row 3 is four-column again (plan:26), row 12 is the recheck row (plan:35), and
   "the review corrections recorded in §15" now points where the list lives (plan:37).
2. **FIXED** — 10 shipping bodies (plan:80), "The numbers tabulated in Appendix B" and "no in-tree
   copy" (plan:51), drop path `index.ts:5912-5943` (plan:82, matches the warn branches).
3. **FIXED** — goals 1, 3 and 4 (plan:90-92, 96-99, 100-102); the store is now descriptive and the
   suite is the only causal instrument.
4. **FIXED** — D2 names its test (plan:118), D7 agrees with D18 (plan:123), D9 defers to D19
   (plan:125), D12 excludes admission from "promotion path" (plan:128).
5. **FIXED** — §5.3 keeps codes under outcomes with a numeric example (plan:178-183) and adds the
   admission file (plan:185-188); §5.5 has both declaration shapes, `requiresTools` in the digest, and
   the runtime-constant rule (plan:211-225).
6. **FIXED** — `call_probe` is presence/absence of any `tool_mode_describe` with the receipt
   limitation stated (plan:245); the window and the `sessionPersistence` reader are stated (plan:291-299).
7. **FIXED** — `outcome`/`signals[]` domains (plan:364-366), `applied` as a use fact (plan:367-372),
   `EVIDENCE_STORE_LOCKED` (plan:373-376), one retention sentence (plan:381-385), "no second store" (plan:390-391).
8. **FIXED** — `unreproduced` is null until a pass (plan:411-413), replay vs reproduction separated
   (plan:403-406), skills record no `failurePaths` (plan:399-401), precedence decided (plan:418-420).
9. **FIXED** — `requiresTools` is a visibility gate and the kind is still derived from it (plan:436-441);
   C1 names its sources and skips `unstructured` rather than passing it (plan:481); C7 wording (plan:487, 495-499).
10. **PARTIAL** — suite pair, sign test + paired difference + MDE, deletion rule, Holm and the
    equivalence margin are all back and the floor is registered (plan:510-517, 532-535, 537-546, 560-563, 548-549);
    but the **recovery formula** is still only a null-guard (plan:573-575) and Appendix C has no `recovery` row.
11. **PARTIAL** — suite demotion (plan:590-593), Holm family (plan:601) and the `admitted-insufficient`
    file+fields (plan:185-188) are in; the **pass predicate** is only in §14.8 row 5 (plan:813) and is
    never stated in §11 itself (plan:587-589 says only "a `SkillReport` whose verdict is `pass`").
12. **FIXED** — §13 is a pointer table (plan:647-650) and the weight-level bullet is restored (plan:652-655).
13. **PARTIAL** — 14.1 red shape (plan:680-683), 14.4 owner/date (plan:736-740), 14.5 flake expiry (plan:751),
    14.7 `verify:skills` "once that script exists" (plan:795-796) and 14.8 rows 2/3/4/6 (plan:810-814) are in;
    but **14.2's revert sentence is corrupted** (see damage 1) and 14.4 gives a hard date to a script it admits
    does not exist ("a script this plan still has to define", plan:738-739).
14. **FIXED** — v2.2, the pre-repair note, the counts table (which matches `recheck-architecture.md`: 33/7/7/19/25)
    and the v2.6 line (plan:869-917); §16 items 4/5/6 (plan:951-959); §17 persisted report, flake-as-inference
    and "`requiresTools` is not yet in the digest" (plan:968, 977-978, 993-995) — all true against the tree.
15. **STILL WRONG** — A's "(new)" row and the §12 note are present (plan:1025, 1020) but the §12 claim is
    misplaced (damage 3); B never says the numbers are as reported (its table starts at plan:1029); C fixes the
    window (plan:1050) but its preamble promises five terms the table does not define (contradiction 5); D's
    arithmetic is off (damage 5).

## Adjacency damage (eaten or duplicated by a replacement)

1. **§14.2:697-701 — spliced sentence.** "— **not** a revert result **is** on record:
   `verification/phase3/REPORT.md` §3 shows ...". The old fragment survived the replacement, so the
   sentence denies and asserts the same fact. Delete "**not** a revert result".
2. **§17:1004-1005 — orphan duplicate.** "...nothing built so far depends on that choice." is followed by a
   line reading "far depends on that choice." — the tail of the replaced sentence.
3. **Appendix A:1020 — claim points at the wrong place.** It says §12's "item 3 gained the 'auto-edit a
   skill' carve-out"; item 3 (plan:629-635) has no carve-out — it is in the preamble (plan:616-617).
4. **Appendix C:1043-1045 — promised rows are missing.** The preamble says C is referenced for `gate`,
   `artifact`, `scopeKey`, `recovery` and `pass`; the table (plan:1047-1058) defines none of the five.
5. **Appendix D:1062 — arithmetic contradiction.** "twelve findings; ten are closed ... three remain open"
   with nine rows in the closed table (plan:1075-1084): 3 + 9 = 12, so "ten" is wrong.

## Contradictions created or left live by this pass

1. **§7:390-391 vs §6.1:253-254.** The repair made §7 absolute — "no second store exists to disagree with
   it about one number" — while §6.1 still measures the direct lane from the session ledger's reuse counter.
   Either the ledger lane goes or §7's sentence does; the counter is prefix-based (`session-ledger.ts:203`).
2. **§8:418-421 vs §15:892-894 and Appendix D:1084.** §8 now *decides* the precedence (note wins, check
   stays a field); §15 still calls it open ("the two sentences still disagree") and C records O12 as closed.
   One fact, three states.
3. **§9.1:442-444 vs §9.1:439-441 and Appendix D O11:1070.** The section keeps the exemplar sentence "one
   flow skill of each shape ... `decision-decomposition`" one paragraph after stating the kind rule, and the
   register admits that skill declares no `requiresTools` (tree: manifest:145-152 confirms). The exemplar
   contradicts the rule it is offered to illustrate.
4. **§2:100-102 vs §5.3:178-183 and §14.6:768-769.** Goal 4 lists `evicted` and `unavailable` as "named
   guards"; §5.3 defines both as gate **outcomes** and reserves reason codes for causes under `insufficient`.
   The repaired goal mixes the two vocabularies the same document separates.
5. **§0 row 4:27 vs §6.1:245.** Row 4 still says the two call predicates are "over the same receipts";
   §6.1 now defines `call_probe` as a session-level presence/absence fact — not a receipt field.
6. **§10:508 vs §10.1:513-515.** Carried, not repaired: "no replay, no synthetic call, no new store"
   still introduces the section that specifies suite execution pairs.
7. **§15:842 vs §6.2/D18.** Carried: "why §6.2 is a projection and not a reader" — §6.2 now says the
   opposite for the edge signals.
8. **D2:118's enforcement test cannot fail for the right reason.** A grep for the substrings `working` and
   `works` in renderers also matches `workflow`/`workspace`, which those surfaces print (`artifact-usage`
   kinds, authoring surfaces). The test needs token-aware matching or a whitelist; a whitelist reopens the ban.

Nothing else in the changed ranges was read or judged; §4 and Appendix B's table rows were not re-reviewed.
