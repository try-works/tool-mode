# Round 1 — Art Director Review

Judged from `overview.png`, `models-row.png`, `tools-grid.png`, `function-code.png`, `function-mcp.png`. Lens: contrast, micro-type, optical alignment, icon distinctiveness, density, and whether CODE MODE and MCP read as different functionality types.

## Component scores

### Model cards

**Laya — 8/10.** Strongest colour block, but the cropped five-bar collage repeats `decision_choose` and bleeds off two edges with no focal point. **Fix:** one flat indigo field plus a single orange mark; stop reusing tool-icon geometry in headers.

**Needle — 7.5/10.** Bars and a brace compete, and both are already tool icons. **Fix:** keep only the brace, make it the sole motif at optical centre.

**Embedding Gemma 2 — 6/10.** The two-line title drops count, pill and hash ~30px below the rest of the row; the hash nearly collides with the pill. **Fix:** reserve a 64px title block on every card and pin pill/hash to a 24px bottom inset.

**Tongue — 7/10.** Equally weighted purple stripes read as a palette card, not language ID. **Fix:** segment one stripe into syllable blocks or add an IPA tick so the stripes encode something.

**Voz — 6.5/10.** Two rounded squares are the least specific header and duplicate `semantic_deduplicate`. **Fix:** a waveform resolving into three text rules — speech → text.

### Tool icons (set)

**6/10.** At grid scale the 6–8px lowercase names are the smallest text in the layout, so the set reads as colour texture rather than an inventory. Stroke/fill language is mixed, and 13/16 tint shapes fall under 3:1 (e.g. `#B55A37` on `#ED7445` = 1.6:1; `#7A729A` on `#C4B7FA` = 2.45:1). Weakest four: **decision_score** (bars crowd its name; duplicates semantic_rank), **structured_extract** (lone brace already means CODE MODE), **semantic_classify** (2.5:1 mid bars, top-heavy), **dedupe_and_rank** (same bars+arrow as semantic_rank). **Fix:** one 48px optical box, 4px stroke grid, black ink plus one ≥3:1 tint, names at 11–12px.

### CODE MODE — 7.5/10

Reads as composition: console, three named calls, trace chips. Biggest issue: 8px chips and giant foreground braces; the braces reuse the `structured_extract` motif and dominate the panel. **Fix:** right-align trace chips against each code line at 10px and drop the braces to a 15% background ornament.

### MCP — 6/10

Reads as a topology, so the pair does read as different functionality types — but only after deciphering 6px annotations. The 1px boxes sit near 2:1, the dot is unexplained, and the identical dark two-up card makes them siblings, not types. **Fix:** invert MCP to the cream field with real connectors and 12px labels; parallel labels CODE MODE / MCP TRANSPORT.

## Top 5 fixes

1. Set an 11px/1.4 type floor for names and 9px for meta; raise gray-on-cream and brown-on-orange to ≥4.5:1, non-text to ≥3:1.
2. Rebuild all 16 icons on one 48px/4px grid with a single ink and one compliant tint.
3. Fix the model row: 64px reserved title area and a fixed footer baseline; Embedding is the only card breaking it.
4. Give each family one hue across header and tiles; currently Embedding spans four hues and Laya three, so colour does not encode family.
5. Make CODE/MCP structurally distinct and correct the taxonomy: the "18" contradicts 5+16+2=23.
