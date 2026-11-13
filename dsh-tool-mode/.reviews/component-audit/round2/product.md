# Verification — restored inventory (round 2)

Six of the nine prior FIXes are clean: Laya now reads READY · MCP; Tongue/Voz counts match; decision_score and semantic_rank labels clear the bars; multimodal_embed and the Embedding family are contiguous. Four rows remain.

| Component | Score | FIX | Issue |
|---|---|---|---|
| Embedding Gemma 2 | 7 | FIX | The name is still set ~20px vs ~28px on the other cards to force one line; the card-row name scale is unchanged. |
| decision_choose | 6 | FIX | "MCP / EXPOSED" and "LAYA / 01" are still ~2.5:1 dark-on-orange at 5px; the status is unreadable at 1:1. |
| CODE MODE | 7 | FIX | The footer drops the 100ms total and repeats HOST-REPORTED at both ends; print "3 CALLS · 100MS" once. |
| MCP | 7 | FIX | 13 READY / 3 EXPOSED / 16 TOTAL partitions the set, but Laya is READY · MCP and its tiles are MCP only; choose one model. |

All other 19 components PASS — no alignment, clipping, count or panel regression.

Note: the embedding-family crop filenames are shifted by one relative to content (tool-semantic_rank.png shows multimodal_embed); that band was verified against the overview.
