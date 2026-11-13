# Round 2 — component inventory review (vs round 1)

**6.5/10, up from 5.0.** The family system is now real; the data layer is not.

**Scores, R1 → R2:** Laya 6.0→7.5 · Needle 6.0→7.5 · Embedding Gemma 2 4.5→6.0 · Tongue 5.5→7.0 · Voz 4.5→7.0 · tool icons (set) 4.9→6.5 · CODE MODE 6.0→6.5 · MCP 4.5→5.5.

## Materially improved

- **Color is a declared rule:** "ONE HUE PER FAMILY" plus LAYA 3 / NEEDLE 4 / EMBEDDING 7 / TONGUE 1 / VOZ 1. One tint per family on tiles and matching cover hues; the grid reads as five groups.
- **Covers became glyphs:** Needle's brace, Tongue's A, Voz's waveform; Laya's orange blocks tie its blue cover to its orange tools. The unexplained hex is gone.
- **Status split shipped:** Laya is "READY" + a black "MCP 3" pill; "EXPOSED" is gone.
- **Tool labels:** names now sit in a clear bottom zone at ~10px; both label collisions (decision_score, semantic_rank) are fixed.
- **Icon repairs:** decision_score → scale; structured_extract → brace + field; extract_with_repair → brace + loop; multimodal_embed → dots/arrows; tools_plan → boxed steps. One bar chart remains.
- **Systems:** trace times map to their call lines; MCP is light and legible with indexed boxes; the footer totals 23.

## Five remaining fixes

1. **Fix the numbers.** 44+39+61 = 144ms, but the footer says 143MS. Each MCP box's "3" and the card's "MCP 3" are unexplained.
2. **Unify state.** The card shows READY + MCP; tools show MCP *instead of* READY; the rail says 3 exposed / 13 ready. All 16 are ready, 3 also exposed → "16 ready · 3 exposed" everywhere.
3. **Raise the metadata floor.** Section meta, family legend, card and code footers, MCP rail remain 5–7px at ~3:1 on cream. Tiles improved; metadata did not. Embedding's two-line name still lifts its descriptor/count ~8px off the row.
4. **Finish the systems as contracts.** CODE lacks a wrapper, bound tools, return envelope, budget; MCP lacks a descriptor, and the dot stops short of the boxes. The pair is now black vs beige, and MCP nearly vanishes into the page.
5. **Normalize the icons.** Live-text 1 2 3 / A / {}; two checks; semantic_deduplicate and dedupe_and_rank still misread; classify still reads as chat; Embedding and Voz tints are near-identical. One stroke/fill system, one base glyph per family.
