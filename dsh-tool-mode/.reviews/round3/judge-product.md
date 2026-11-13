# Round 3 — component inventory review

**7.5/10, up from 6.5.** V3 fixed the data and state errors; the sheet is close.

**Scores (R2 → R3):** Laya 7.5→8.0 · Needle 7.5→8.0 · Embedding Gemma 2 6.0→7.0 · Tongue 7.0→8.0 · Voz 7.0→8.0 · tool icons (set) 6.5→7.0 · CODE MODE 6.5→7.0 · MCP 5.5→7.0.

**Fixed since R2:** Laya's cover now uses its family orange; counts dropped below the descriptor so the hierarchy is right (cards align within ~3px); every Laya tile reads "READY · MCP"; Voz no longer shares Embedding's tint; the trace total is 144ms and matches 44+39+61; the MCP bus now connects the host dot to all three boxes; counts read "16 READY / 3 EXPOSED"; boxes say "MCP"; the stray "17/" is gone and V3 is labelled.

**Three remaining blockers:**

1. **Microcopy is still 5–6px.** Section meta, family legend, card labels/footers, MCP rail and code footer stay below legibility; the model count moved from 18px straight to 5px, so "3 TOOLS" is now unreadable. Fix: 10px floor at 4.5:1, or scale the sheet 1.5×.
2. **The systems are topology, not contract.** CODE still has no wrapper, bound-tool list or budget; MCP has no descriptor or payload. Worse, the new receipt bar repeats the `return` line and the 144ms already in the footer, and adds a second provenance phrase ("HOST-RECEIPT LOCAL" vs "HOST-REPORTED"). Fix: one receipt, plus the wrapper/return contract; one real MCP descriptor.
3. **Icons still need their labels.** Two checks (decision_test, validate_record); semantic_deduplicate reads "copy", dedupe_and_rank is squares plus a detached arrow, classify reads as chat; live-text 1 2 3 / A / {}. Fix: one geometric system, and let test vs validate differ by domain glyph, not the same check.
