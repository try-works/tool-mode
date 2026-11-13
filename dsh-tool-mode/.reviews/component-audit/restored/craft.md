# Component Audit — Restored Inventory (Craft)

Art and icon shapes are treated as locked; findings are 1:1 alignment, clipping, contrast, counts and panel structure only.

| Component | Score | Verdict | Issue |
|---|---|---|---|
| Laya | 8.0 | FIX | Pill reads MCP EXPOSED, not READY; 5–6px meta at ≈2.7:1. |
| Needle | 8.5 | FIX | 5–6px MODEL/#01 and TOOLS at ≈2.7:1; baselines and count otherwise match. |
| Embedding Gemma 2 | 8.5 | FIX | Same 5–6px meta contrast; title now fits one line with no clipping. |
| Tongue | 8.5 | FIX | Same 5–6px meta contrast; stripe bleed at corners is intentional. |
| Voz | 8.5 | FIX | Same 5–6px meta contrast; body baselines and pill match the row. |
| decision_choose | 7.0 | FIX | Laya labels ≈2:1; outer bars 1.6:1 and 1.35:1. |
| decision_score | 7.0 | FIX | Name clears bars by <3px; secondary bars 1.6–2.6:1. |
| decision_test | 8.0 | FIX | Laya labels/status ≈2:1; icon is centred and unclipped. |
| tools_plan | 9.0 | PASS | — |
| structured_extract | 9.0 | PASS | — |
| validate_record | 9.0 | PASS | — (hand-drawn check overshoot is intentional, no tile clip) |
| extract_with_repair | 9.0 | PASS | — |
| multimodal_embed | 8.0 | FIX | Lightest ring 2.25:1. |
| semantic_rank | 7.5 | FIX | Light bars 1.86:1; label sits 3px under the bar. |
| semantic_similarity | 9.0 | PASS | — (gray ring 3.4:1) |
| semantic_classify | 7.5 | FIX | Lower lozenge 2.48:1. |
| semantic_deduplicate | 9.0 | PASS | — (gray square 3.2:1) |
| dedupe_and_rank | 7.5 | FIX | Light bar 2.51:1. |
| media_find_moments | 9.0 | PASS | — |
| lang_detect | 7.5 | FIX | Second rule 2.45:1. |
| stt_transcribe | 9.0 | PASS | — |
| CODE MODE | 9.0 | PASS | — (3 calls, timings sum to 100ms, no clipping) |
| MCP | 8.0 | FIX | Panel says 16 READY / 3 EXPOSED; grid shows 13 READY + 3 MCP/EXPOSED. Reconcile. |

Counts check: model totals 3+4+7+1+1 = 16 tools; footer 5 models + 16 tools + 2 types = 23. Both correct. “16 / COMPONENT INVENTORY” reads as a total; label it “16 tools” or use 23 so it cannot be mistaken for the component count.

Every FIX above is type/colour/grid or copy; no icon or model art needs replacing.
