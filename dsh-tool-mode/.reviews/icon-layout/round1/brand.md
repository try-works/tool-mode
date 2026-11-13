# Tool-icon layout audit — 16 tiles, measured at 2x

Values are logical px on a 160×160 tile; bbox = non-fill pixels above the name band. The text frame is identical on all 16 tiles and needs no change: family cap-top 12 / baseline 20; name cap-top 131 / baseline 138; status cap-top 142 / baseline 148; left edge 12; bottom 148.

| tile | icon bbox · L/R/T/B pads · centre | label/status | PASS/FIX | pixel fix |
|---|---|---|---|---|
| a1 decision_choose | 24–136 × 42–96 · 24/24/42/35 · 80,69 | clean | PASS | — |
| a2 decision_score | 24–118 × 54–130 · 24/42/54/1 · 71,89 | merges into name band | FIX | +9x, −12y |
| a3 decision_test | 56–104 × 34–86 · 56/56/34/45 · 80,60 | clean | FIX | +9y |
| a4 tools_plan | 25–112 × 61–82 · 25/48/61/49 · 69,71 | clean | FIX | +11x, −2y |
| a5 structured_extract | 66–94 × 31–92 · 66/66/31/39 · 80,62 | clean | FIX | +7y |
| a6 validate_record | 50–106 × 32–86 · 50/54/32/45 · 78,59 | clean | FIX | +2x, +10y |
| a7 extract_with_repair | 59–100 × 36–72 · 59/60/36/59 · 79,54 | clean | FIX | +15y |
| a8 lang_detect | 26–134 × 27–110 · 26/26/27/21 · 80,68 | clean | PASS | — |
| b1 multimodal_embed | 26–112 × 26–112 · 26/48/26/19 · 69,69 | clean | FIX | +11x |
| b2 semantic_rank | 24–138 × 43–130 · 24/22/43/1 · 81,84 | merges into name band | FIX | −12y |
| b3 semantic_similarity | 22–126 × 40–102 · 22/34/40/29 · 74,71 | clean | FIX | +6x, −2y |
| b4 semantic_classify | 22–126 × 36–102 · 22/34/36/29 · 74,69 | clean | FIX | +6x |
| b5 semantic_deduplicate | 32–114 × 32–104 · 32/46/32/27 · 73,68 | clean | FIX | +7x, +1y |
| b6 dedupe_and_rank | 24–96 × 28–118 · 24/64/28/13 · 60,73 | clean | FIX | +20x, −4y |
| b7 media_find_moments | 24–136 × 32–100 · 24/24/32/31 · 80,66 | clean | FIX | +3y |
| b8 stt_transcribe | 22–96 × 36–102 · 22/64/36/29 · 59,69 | clean | FIX | +21x |

Only a1 and a8 hold the grid. Worst drift is horizontal — b8 −21px, b6 −20px, a4/b1 −11px read as left-aligned rather than placed — and vertical: the single-glyph icons sit 7–15px high while the two bar charts sit low enough to touch the name.

## The rule the grid should use

1. **Icon area:** x 12–148, y 20–119; mass centred at **(80, 69)**, ±2 on both axes.
2. **Clearance:** ≥12px above the name cap-top (bottom ≤119) and ≥6px below the family label (top ≥26).
3. **Optically, not by bbox:** asymmetric marks (arrow, playhead) may offset ±6, but visual weight must land on x=80.
4. **Text frame as built:** name cap-top 131, status cap-top 142, 4px cap gap, left 12.
