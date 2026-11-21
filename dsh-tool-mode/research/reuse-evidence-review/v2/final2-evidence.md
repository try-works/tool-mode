# Final2 recheck — evidence lens (v2.7 diff)

Checked A–R only, against the 1125-line plan. Read-only; no builds.

## A–R
- **A FIXED** (L709–713) — "A revert result is now on record: … the revert restoring 26/26"; the "not … is" self-negation is gone.
- **B FIXED** (L1037–1038) — §17 ends once at "nothing built so far depends on that choice."
- **C FIXED** (L1053) — "its **intro** gained the 'auto-edit a skill' carve-out".
- **D FIXED** (L1076–1098) — `artifact`, `scopeKey`, `gate`, `pass`, `recovery`, "equivalence margin … Default **±2 percentage points**" and `null outcome` are all defined; the skill row states the union with `requiresTools`.
- **E FIXED** (L1102–1103, L1116–1125) — "**nine are closed in v2.6 and three remain open**"; O12 is in the closed table.
- **F FIXED** (L372–373) — "Skill rows add … — and **no `failurePaths`**, because a skill has no `inputSchema`".
- **G PARTIAL** (L225–228) — the declaration-subset comparison is stated, but the sentence then repeats its own tail: "; adding an editable field without adding it to the constant equals the editable-field list."
- **H FIXED** (L448–450) — "one flow-shaped skill … that **does not yet declare `requiresTools`**, so C7 currently has no live subject (O11)".
- **I FIXED** (L661–663) — "Each bullet states only the minimum needed to be intelligible; the rule it points at lives in the decision."
- **J FIXED** (L795–797) — "blocks promotion **while that count is `null` or non-zero** … a `failures === 0` row is promotable".
- **K FIXED** (L992–993) — "(The former item 6 … is answered in §10.3: …)".
- **L FIXED** (L354–356) — "removed from every store-derived report; the suite matrix is recomputed from its own runs".
- **M FIXED** (L822, L824) — row 0 "**`fail(programme-stop)`** when the bound is measured and missed"; row 2 "a reproduction pass over the **stored** failures … in 3 consecutive cases".
- **N FIXED** (L580–583) — "the **pair floor** (6, Appendix C)"; "The formula is `(withCard − base) / (reference − base)`".
- **O FIXED** (L596–601) — an `admission.json` entry "checked by `verify:release`"; "`pass` means: …"; "An uncomputable predicate is `insufficient`, never `pass`".
- **P FIXED** (L748–753) — "a test asserts that each row's named test file exists (one assertion per row, in the phase's own suite — no new script …)".
- **Q FIXED** (L838–840, L901, L929) — "the **retention** of unreproducible evidence (counted, never deleted — D9/D19)"; T7 "**fixed**"; "closed **nine** of the twelve".
- **R FIXED** (L955–974) — the v2.7 block records the pass and its list matches the repairs above.

**Counts:** FIXED **17** · PARTIAL **1** · NOT FIXED **0**.

## Adjacency damage
- **§5.5 L227–228** — the replaced digest-test sentence kept its old tail: "adding an editable field without adding it to the constant equals the editable-field list." It has no subject and duplicates the next sentence.
- **§9.1 L450–451** — an orphan clause survives the exemplar rewrite: "The second decision family)." (the old sentence's tail).
- **Appendix D L1124–1125** — the O12 row appears **twice**, so the closed table has ten rows under L1102's "nine are closed".
- **§16 L992–993** — the former item 6 is a bare parenthetical with no blank line after item 5, so it renders inside item 5 instead of as its own note (the numbered item is eaten).

## Cross-section contradictions
- **§15 L901 vs L952** — T7 is "**fixed**" in the disposition table and "T7 is now **partial**" two paragraphs later.
- **§10.6 L582 vs §14.4 L744** — "one name for the floor" is claimed, but §14.4 still says "below `minPairs`", a term nothing defines (Appendix C calls it "pair floor", 6).
- **§5.3 L185 vs §2 L101–102, §14.7 L815–816, §14.8 row 5 L827** — §5.3 says the marker "is not prose: it is an entry in … `admission.json`"; three places still say "printed marker".
- **Appendix C L1082 vs §5.5 L213–216** — App C calls `{name, description, content, path, source}` the **editable surface**; §5.5 narrows the surface to `name`, `description`, `requiresTools` and the bytes, and the digest covers no `path`/`source` — so by D4 those two fields would orphan evidence.

**Counts:** adjacency damage **4** · cross-section contradictions **4**.