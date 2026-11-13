# Round 2 — brand review

| Component | R1 | R2 |
|---|---|---|
| Laya | 8 | 8 |
| Needle | 7 | 7 |
| Embedding Gemma 2 | 8 | 8 |
| Tongue | 5 | 7 |
| Voz | 6 | 7 |
| Tool icons (set) | 6 | 7 |
| CODE MODE | 8 | 9 |
| MCP | 6 | 7 |

## What materially improved

1. **Card anatomy is now a system** — fixed title slot, descriptor, count, readiness, footer slug. Embedding's two-line title no longer drops its baseline; the row reads as one component.
2. **One inset figure per card** — Tongue and Voz gained real marks; Laya's art composes instead of cropping.
3. **Tile labels are legible** (~7px, family + index) with a family key in the 02 header, and family tints turn sixteen randoms into five groups.
4. **CODE MODE earned its panel** — braces gone, per-call durations and a 143ms total. MCP nodes now aligned and counted.

## Five remaining fixes

1. **Break motif collisions.** Three tiles are "geometry + arrow" (semantic_rank, multimodal_embed, dedupe_and_rank), two are braces (structured_extract, extract_with_repair). The latter is illegible at 160px — one closing bracket, not two plus a loop.
2. **Tint by modality, not family.** Embedding owns 6 of 16 tiles, so blue dominates and the banding looks accidental at row breaks.
3. **Finish the micro-type.** Card kicker (~5px, ≈2.3:1) and footer slug (~4.5px) still fail; 9px mono or delete.
4. **Fix Laya's badge row.** "3 TOOLS" and "MCP 3" state one count twice. Use "3 OF 3 EXPOSED" in the footer; pill stays status-only.
5. **Make the panels rhyme.** CODE MODE traces semantic_rank, decision_choose, structured_extract; MCP shows the decision trio. Use the same three calls, arrow the connector, align nodes to the trace rows.
