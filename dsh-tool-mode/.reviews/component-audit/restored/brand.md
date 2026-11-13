# Component audit — restored inventory

Graded at 1:1 on the restored art and icon language. One system defect runs through both sections: card kickers/hexes and tile name/status are 5px (≈2.3:1 on bone, ≈2:1 on orange and pink). It is counted on every row it touches.

| component | score | PASS/FIX | issue |
|---|---|---|---|
| Laya | 7 | FIX | Kicker and hex 5px, ≈2.3:1. |
| Needle | 7 | FIX | Brace starts 12px from top, bars 30px down — no shared horizontal. |
| Embedding Gemma 2 | 6 | FIX | Title auto-fits to ≈18px vs the row's 22px. |
| Tongue | 6 | FIX | "1 TOOL" full-size black, not gray 5px "TOOLS". |
| Voz | 6 | FIX | Art 18px from left, 80px from right — leans left. |
| decision_choose | 7 | FIX | Two muted bars at ≈1.5:1; reads as one bar. |
| decision_score | 6 | FIX | Name label struck through by the two left bars. |
| decision_test | 7 | FIX | 5px name only. |
| tools_plan | 7 | FIX | 2px middots read as dust at 1:1. |
| structured_extract | 7 | FIX | 5px name only. |
| validate_record | 7 | FIX | 5px name only. |
| extract_with_repair | 7 | FIX | 5px name only. |
| multimodal_embed | 7 | FIX | Three rings at ≈2:1; reads as two rings. |
| semantic_rank | 6 | FIX | Label struck by the first bar; arrow detached. |
| semantic_similarity | 7 | FIX | Gray ring ≈2:1 against blue. |
| semantic_classify | 7 | FIX | Pills read as text lines, not categories. |
| semantic_deduplicate | 7 | FIX | Gray square ≈2:1; duplicate cue nearly invisible. |
| dedupe_and_rank | 7 | FIX | Arrow 58px from the bars; reads as two glyphs. |
| media_find_moments | 7 | FIX | 5px name only. |
| lang_detect | 7 | FIX | 5px name only. |
| stt_transcribe | 7 | FIX | 5px name only. |
| CODE MODE | 7 | FIX | "3 calls / 100ms" stated twice; "HOST-RECEIPT LOCAL" vs "HOST-REPORTED" conflict. |
| MCP | 6 | FIX | Host link 3px, branch arms 1px — two diagrams. |

No component is clean at 1:1. The fastest lift is one 9px type floor and a 2:1 contrast floor for muted marks, not new art.
