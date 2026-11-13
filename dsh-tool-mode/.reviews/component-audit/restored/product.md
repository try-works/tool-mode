# Component audit — restored inventory (product)

Restored card art and icon language accepted as given. Shared caveat, not re-counted per row: the 5–6px captions (model index/hash, tile name/status, panel footers) remain sub-legible at 1:1, and the neutral gray ones sit below 4.5:1 — one systemic typography fix.

| Component | Score | Verdict | Issue |
|---|---|---|---|
| Laya | 7 | FIX | "MCP EXPOSED" replaces READY, so the card reads 13 ready while the MCP panel says 16 READY / 3 EXPOSED. |
| Needle | 9 | PASS | 4 TOOLS matches its four icons; descriptor, count, chip and hash all share baselines. |
| Embedding Gemma 2 | 7 | FIX | Name is shrunk to ~20px (siblings ~28px) to fit one line, breaking the model-name scale across the row. |
| Tongue | 7 | FIX | "1 TOOL" renders at ~18px while 3/4/7 counts are ~7px; counts must use one size. |
| Voz | 7 | FIX | Same "1 TOOL" count-size break as Tongue. |
| decision_choose | 6 | FIX | "MCP / EXPOSED" and "LAYA / 01" are ~2.5:1 dark-on-orange at 5px; the status is unreadable at 1:1. |
| decision_score | 5 | FIX | Bars run through "decision_score"; the right half of the name is overprinted. |
| decision_test | 8 | PASS | Check centered, label below, no clipping. |
| tools_plan | 8 | PASS | Numerals centered, label clear. |
| structured_extract | 8 | PASS | Brace centered, label clear. |
| validate_record | 8 | PASS | Check-box centered, label clear. |
| extract_with_repair | 8 | PASS | Loop centered, label clear. |
| multimodal_embed | 7 | FIX | EMBEDDING / 01 is stranded at the end of row 1; 02–07 start row 2, splitting the family block. |
| semantic_rank | 5 | FIX | The tallest bar overprints "semantic_rank"; the name is unreadable where they cross. |
| semantic_similarity | 8 | PASS | Rings clear the label; alignment clean. |
| semantic_classify | 8 | PASS | Capsules clear the label. |
| semantic_deduplicate | 8 | PASS | Squares clear the label. |
| dedupe_and_rank | 8 | PASS | Icon left, arrow clear, label below. |
| media_find_moments | 8 | PASS | Timeline ends inside the 24px margin; label clear. |
| lang_detect | 8 | PASS | Glyph centered, label clear. |
| stt_transcribe | 8 | PASS | Waveform centered, label clear. |
| CODE MODE | 7 | FIX | "3 CALLS / 100MS" is repeated in the trace divider and the footer, and HOST-RECEIPT LOCAL competes with HOST-REPORTED. |
| MCP | 8 | PASS | Host → bus → three boxes connect correctly; MCP labels and 16 READY / 3 EXPOSED align. |
