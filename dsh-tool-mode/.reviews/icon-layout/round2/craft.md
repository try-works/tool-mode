# Icon-layout verification — Round 2

Target: optical center (80,75), ±2px; clearance ≥11px. Three tiles remain; the other 13 are within tolerance.

| Tile | Measured center | Clearance | FIX issue |
|---|---|---|---|
| decision_score | (80.3, 80.8) | 11px | 6px too low; the bars sit on the name. Move up 6px to (80,75); clearance becomes 17px. |
| semantic_rank | (49.8, 75.3) | 11px | Arrow is clipped by the left edge; mass is 30px left. Move the whole icon right 30px to (80,75); clearance stays 11px. |
| dedupe_and_rank | (80.3, 68.8) | 17px | Composite is 6px high. Move down 6px to (80,75); clearance becomes 11px. |

No icon exceeds the 22–138 / 30–120 field after those moves. All label baselines remain unchanged.
