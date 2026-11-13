# Icon layout — round 2 verification

Measured on the 2x crops (logical px, 160×160 tile): icon-mass bbox excluding the label bands. Target centre (80, 75) ±2; minimum name clearance 11px (name cap-top 131).

| tile | measured centre | clearance | FIX issue |
|---|---|---|---|
| a2 decision_score | 80.2, 80.8 | 10 | 5.8 low and touching the name. Raise 6px (−6y): bars 36–114, centre 75, clearance 16. |
| b2 semantic_rank | 49.8, 75.2 | 10 | The arrow has drifted to the left edge (x 4–45); it was right of the bars in round 1. Move it to x 104–134, y 52–64, then raise the group 1px: centre 79, clearance 11. |
| b6 dedupe_and_rank | 80.2, 68.8 | 16 | Bars start at y 24, 6px above the 30px field top, pulling the mass up. +5y: centre 73.8, bars 29–119, clearance 11. |

The other 13 tiles sit inside tolerance: a1 79.8/74.8, a3 79.8/75.2, a4 79.8/75.2, a5 79.8/74.8, a6 79.8/74.8, a7 79.2/76.2, a8 79.8/74.2, b1 80.2/74.8, b3 79.8/74.8, b4 79.8/74.8, b5 80.2/75.2, b7 79.8/75.2, b8 79.2/74.8 — all clearances 12–44.

13 PASS, 3 FIX.
