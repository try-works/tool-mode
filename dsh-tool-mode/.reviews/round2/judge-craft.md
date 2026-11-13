# Round 2 — Art Director Review

Judged against round 1 from the five section images plus individual crops.

## Scores

| Component | R1 | R2 |
|---|---|---|
| Laya | 8 | **7.5** |
| Needle | 7.5 | **7.5** |
| Embedding Gemma 2 | 6 | **7.5** |
| Tongue | 7 | **7** |
| Voz | 6.5 | **8** |
| Tool icon set (16) | 6 | **7** |
| CODE MODE | 7.5 | **7.5** |
| MCP | 6 | **7.5** |

## What materially improved

- Model cards now share one footer baseline; Embedding no longer breaks the row.
- Tongue's A+text rules and Voz's waveform→text now say what each model does.
- Tool families hold one background hue, statuses are reduced to MCP/READY, and names are near-black instead of vanishing into peach.
- decision_score, tools_plan, structured_extract, extract_with_repair and multimodal_embed are now individually readable; the chart duplication is gone.
- CODE MODE traces are aligned to their calls and the giant braces are gone. MCP inverted to cream, so at arm's length the pair finally reads as different types — dark composed program vs light transport schematic.

## Five most important remaining fixes

1. **Microtype and contrast still fail.** Model meta is #9F9F9F on white (≈2.7:1) at 6px; card footers, section meta, tool status and CODE trace are 5–8px. Set 10–11px names, 9px meta, ≥4.5:1, and collapse the three redundant IDs (#01 / MODEL 01 / TOOL MODE·CARD 01).
2. **The fixed title block made hollow bodies.** Four one-line cards carry a 55–70px void between title and descriptor; only Embedding looks balanced. Tighten title→description to 24px and anchor only the pill/footer to the bottom.
3. **Icons still mix languages.** 2px outlines sit beside heavy solids, and four tints are under 3:1 (decision_choose outer bars ≈1.6:1, semantic_rank light bars, semantic_classify lower lozenge, lang_detect second rule). Standardise a 48px optical box, 4px strokes, black ink plus one compliant tint.
4. **Family hierarchy is inconsistent.** Laya's header is indigo while its tiles are peach; Embedding and Voz tile blues are nearly identical; Tongue/Voz enlarge their tool glyphs while Laya/Embedding do not. One family hue and one header rule across all five.
5. **CODE/MCP composition is unfinished.** CODE now leaves its lower 40% empty; MCP's connector stops at a dot and never forks to the three boxes, and each box's "3" is unexplained. Fill or compress CODE, branch the MCP connectors, drop redundant counts — and reconcile the top-right "17" with the footer's "23 COMPONENTS".
