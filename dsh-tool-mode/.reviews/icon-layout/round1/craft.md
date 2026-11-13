# Tool-icon layout audit — 16 tiles (logical px)

All crops measured at 2×; values below are logical. Shared label geometry today: 12px left inset; family baseline 19.5; name baseline 138.5; status baseline 148.5; 3px name–status gap. Every label is aligned; only icon placement varies. “Clr” is icon-bottom to name-top. Target optical center is (80,75); audit tolerance is ±8px and minimum 11px clearance.

| Tile | Icon bbox x / y; pad T/R/B/L | Δcenter | Label/status | V | Exact fix |
|---|---|---|---|---|---|
| decision_choose | 24–136 / 42–96; 42/24/64/24 | 0/−6 | aligned; clr 36 | PASS | — |
| decision_score | 24–118 / 54–126; 54/42/34/24 | −9/+15 | name only 5px under bars | FIX | right 9, up 15 |
| decision_test | 57–103 / 34–87; 34/57/73/57 | 0/−15 | aligned; clr 45 | FIX | down 15 |
| tools_plan | 25–113 / 61–82; 61/47/78/25 | −11/−4 | aligned; clr 50 | FIX | right 11, down 4 |
| structured_extract | 66–94 / 31–93; 31/66/67/66 | 0/−13 | aligned; clr 39 | FIX | down 13 |
| validate_record | 50–106 / 32–86; 32/54/74/50 | −2/−16 | aligned; clr 46 | FIX | right 2, down 16 |
| extract_with_repair | 59–100 / 36–73; 36/60/87/59 | −1/−21 | aligned; clr 59 | FIX | down 21 |
| lang_detect | 26–134 / 28–110; 28/26/50/26 | 0/−6 | aligned; clr 22 | PASS | — |
| multimodal_embed | 26–112 / 26–112; 26/48/48/26 | −11/−6 | aligned; clr 20 | FIX | right 11, down 6 |
| semantic_rank | 24–138 / 44–126; 44/22/34/24 | +1/+10 | name only 5px under bars | FIX | up 10 |
| semantic_similarity | 22–126 / 40–102; 40/34/58/22 | −6/−4 | aligned; clr 30 | PASS | — |
| semantic_classify | 22–126 / 36–102; 36/34/58/22 | −6/−6 | aligned; clr 30 | PASS | — |
| semantic_deduplicate | 32–114 / 32–104; 32/46/56/32 | −7/−7 | aligned; clr 28 | PASS | — |
| dedupe_and_rank | 24–97 / 28–118; 28/63/42/24 | −20/−2 | aligned; clr 14 | FIX | right 20 |
| media_find_moments | 24–136 / 33–100; 33/24/60/24 | 0/−9 | aligned; clr 32 | FIX | down 9 |
| stt_transcribe | 22–96 / 36–102; 36/64/58/22 | −21/−6 | aligned; clr 30 | FIX | right 21, down 6 |

Five tiles already sit inside the ±8px optical tolerance. The other 11 need translation only; no art or size changes.

## Shared rule

Tile 160×160. Text inset 12px left; family baseline 20; tool-name baseline 138; status baseline 148; status bottom 149.5; name/status 8px type. Icon mass optical center (80,75), inside an x22–138 / y30–120 field; keep ≥11px clearance to the 131px name band. Small icons stay small (do not scale up); oversized silhouettes keep their current scale and are only translated. All labels stay put.
