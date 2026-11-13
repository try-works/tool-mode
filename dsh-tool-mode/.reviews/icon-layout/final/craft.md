# Final icon-layout verification

Two tiles remain outside (80,75) ±2 or 11px clearance.

| Tile | Measured center | Clearance | FIX issue |
|---|---|---|---|
| semantic_rank | (75.8, 78.8) | 11px | Mass is 4px left and 4px low. Move right 4px, up 4px; center becomes (79.8,74.8) and clearance 15px. |
| dedupe_and_rank | (80.3, 71.8) | 17px | Mass is 3px high. Move down 3px; center becomes (80.3,74.8) and clearance 14px. |

All other 14 tiles are within ±2px and ≥11px clearance. No size or baseline changes.
