# Icon-layout verification — round 2

Measured at 2x, reported in logical px. Target (80,75), tolerance ±2px per axis, name clearance ≥11px. 13 of 16 pass; 3 remain:

| tile | measured center | clearance | FIX issue |
|---|---|---|---|
| decision_score | (80.25, 80.75) | 13.5 | +5.75px low; shift icon up 5.75px. |
| semantic_rank | (49.25, 75.25) | 12.5 | −30.75px left; bbox starts at x3, outside the 22px field; shift right 30.75px. |
| dedupe_and_rank | (80.25, 72.25) | 18.5 | −2.75px high; shift icon down 2.75px. |

All other 13 tiles are within ±2px of (80,75) with ≥11px clearance.
