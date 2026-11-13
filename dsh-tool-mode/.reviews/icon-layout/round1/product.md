# Tool-tile layout audit — 16 tiles

Measured at 2x, reported in logical px. The label stack is consistent on all 16: family baseline 19.5, name 138.5, status 148.5, left inset 12. No tile meets the optical target (±1px), so all 16 are FIX. All fixes are translations — every bbox fits the 116×88 well, so nothing needs scaling.

Pad = top / right / clearance-to-name / left.

| tile | icon bbox @x,y · pad T/R/C/L | label | verdict | exact fix |
|---|---|---|---|---|
| decision_choose | 112×54 @24,42 · 42/24.5/37.5/24 | OK | FIX | +0.3, +7.3 |
| decision_score | 94×75.5 @24,54 · 54/42.5/4/24 | OK | FIX | +9.3, −15.5 |
| decision_test | 45.5×52.5 @57,34 · 34/57.5/46.5/57 | OK | FIX | +0.3, +15.8 |
| tools_plan | 87.5×20.5 @25,61 · 61/47.5/51.5/25 | OK | FIX | +11.3, +4.8 |
| structured_extract | 28×59.5 @66,33 · 33/66.5/40.5/66 | OK | FIX | +0.3, +13.3 |
| validate_record | 55.5×52.5 @50,33 · 33/54.5/47.5/50 | OK | FIX | +2.3, +16.8 |
| extract_with_repair | 39.5×36.5 @59,36 · 36/61.5/60.5/59 | OK | FIX | +1.3, +21.8 |
| lang_detect | 107.5×76.5 @26,33 · 33/26.5/23.5/26 | OK | FIX | +0.3, +4.8 |
| multimodal_embed | 85.5×78.5 @26,33 · 33/48.5/21.5/26 | OK | FIX | +11.3, +3.8 |
| semantic_rank | 113.5×86 @24,43 · 43/22.5/0.5/24 | OK | FIX | −0.8, −10.0 |
| semantic_similarity | 103.5×61.5 @22,40 · 40/34.5/31.5/22 | OK | FIX | +6.3, +5.3 |
| semantic_classify | 103.5×65.5 @22,36 · 36/34.5/31.5/22 | OK | FIX | +6.3, +7.3 |
| semantic_deduplicate | 81.5×70.5 @32,33 · 33/46.5/29.5/32 | OK | FIX | +7.3, +7.8 |
| dedupe_and_rank | 72.5×84.5 @24,33 · 33/63.5/15.5/24 | OK | FIX | +19.8, +0.8 |
| media_find_moments | 111.5×66.5 @24,33 · 33/24.5/33.5/24 | OK | FIX | +0.3, +9.8 |
| stt_transcribe | 73.5×65.5 @22,36 · 36/64.5/31.5/22 | OK | FIX | +21.3, +7.3 |

**Shared rule:** 160px tile; text inset 12px; baselines family 19.5 / name 138.5 / status 148.5. Icon well 116×88 at x22–138, y32–120; center each icon mass at (80,76) ±1px; keep ≥13px clearance to the name top (133). Effective padding: 32 top / 22 sides / 40 bottom. Largest bbox is 113.5×86, so the well holds every icon without rescaling.
