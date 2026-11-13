# Final verification — inventory (product)

3 components remain FIX; all other 20 PASS.

| Component | Score | FIX | Issue |
|---|---|---|---|
| Embedding Gemma 2 | 7 | FIX | The name is still set ~20px vs ~28px on the other cards to force one line; the card-row name scale is unchanged. |
| decision_choose | 6 | FIX | "MCP / EXPOSED" and "LAYA / 01" are still ~2.5:1 dark-on-orange at 5px; the status is unreadable at 1:1. |
| semantic_similarity | 7 | FIX | Regression: the restored outlined rings are now filled discs (black + slate with a dark rim), breaking the icon language and reading as stacked coins rather than a Venn overlap. |
