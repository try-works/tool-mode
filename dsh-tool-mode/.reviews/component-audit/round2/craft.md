# Component Inventory — Round 2 Verification

Prior fixes verified: model meta, icon tints, MCP counts, and the Laya READY · MCP pill. All unlisted components PASS.

| Component | Score | FIX | Issue |
|---|---|---|---|
| Laya | 8.5 | FIX | Status pill and #01 still ≈2.5:1; meta/field copy now passes. |
| Needle | 8.5 | FIX | READY pill and #01 at ≈2.5:1; baselines aligned. |
| Embedding Gemma 2 | 8.5 | FIX | READY pill at ≈2.5:1; title one line, no clipping. |
| Tongue | 8.5 | FIX | READY pill at ≈2.5:1; no other issue. |
| Voz | 8.5 | FIX | READY pill at ≈2.5:1; no other issue. |
| decision_choose | 8.0 | FIX | Laya family/status label #9E4F31 on #ED7445 ≈2.1:1; tool name now black. |
| decision_score | 8.0 | FIX | Same 2.1:1 family/status label; bars now high-contrast. |
| decision_test | 8.0 | FIX | Same 2.1:1 family/status label; check icon clean. |

All 15 other components PASS, including CODE MODE and MCP (13 READY / 3 EXPOSED / 16 TOTAL now reconciles).

Export note: from tile 8 the tool crop filenames are one slot behind the new grid order — `tool-semantic_rank.png` is Embedding / 01, and `tool-lang_detect.png` is Embedding / 07. Rename the crops; verdicts above use the image content, not the filename.
