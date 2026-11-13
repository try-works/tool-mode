# Final 2 — brand verification

| component | score | FIX | issue |
|---|---|---|---|
| Embedding Gemma 2 | 7 | FIX | Title now wraps to two lines, pushing its descriptor and count ~18px below the other four cards — the row's text baselines no longer align (a regression from the previous state, where all five titles were one line). |

All other 22 components PASS.

Notes: the panel crops are byte-identical to the passing set; semantic_similarity's rings are restored with full contrast; the tile status line is now dark (≈5:1 on orange), closing the residual I had carried.
