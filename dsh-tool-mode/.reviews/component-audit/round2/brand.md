# Verification pass — round 2

Re-checked at 1:1 against my restored-inventory defects. Cards' kickers and hexes now read (7px cap, dark); all five titles share a 15px cap, so the Embedding title no longer shrinks; the count rows unify; tile names are 7px and clear of their glyphs; decision_choose's bars and the label collisions on decision_score/semantic_rank are resolved.

**19 of 23 PASS.** Four remain:

| component | score | FIX | issue |
|---|---|---|---|
| semantic_similarity | 6 | FIX | The gray ring sits at ≈1.3:1 on the blue fill and drops out at 1:1, leaving one ring. |
| dedupe_and_rank | 7 | FIX | The arrow is still 58px from the bars, so the tile reads as two glyphs. |
| CODE MODE | 8 | FIX | Provenance repeats: the left stamp says "HOST-REPORTED" and the summary line ends "3 CALLS / HOST-REPORTED". |
| MCP | 7 | FIX | The host link is a 2px dark rule while the three rail arms are 1px light, so one path is emphasised with no stated reason. |

Residual, not blocking: tile status lines stay 5px at ≈2.5:1 on the orange and pink tiles — intended tertiary, legible only when zoomed.
