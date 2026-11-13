# Active Run V2 — Craft Review

**Concept 8.5 · Craft 8 · Clarity 8** (R1: 8 / 7.5 / 6.5)

The intent title, full lifecycle, real actions and labelled trace rails close the round-1 gap. It now reads as a job you can operate, not a poster about one.

## Three remaining blockers

1. **Metadata is still below the legibility floor.** Table labels, “COPY ID”, trace labels, recent-run rows and footers are 7–9px; several sit below 4.5:1. Raise metadata to 11px, the run ID to 12px mono, make “COPY ID” a real 11px button with an icon, and test every gray-on-black pair at 4.5:1. This is the only accessibility blocker.

2. **The trace says 2/3 twice and labels its rails three ways.** “Running · 2/3” and “Trace 2 of 3” are one counter. The left label is right-aligned to its node, the centre is centred, the right is left-aligned; at a glance they detach from their rails, and the queued dashed rail is nearly invisible. Use one progress statement, align all labels beneath their endpoints (or add 1px leaders), and lift “queued” while keeping it visibly inactive.

3. **The left column and ghost layer still feel unfinished.** Below the recent-runs rail sits ~250px of empty black, while the ghost “RECENT RUNS” panel is too faint to read yet says the same category of thing as the live rail. Either remove the ghost or give it distinct content at 10–12% and a clear role, and anchor stats + recent runs to a shared bottom grid with the card.

Close these three; no other blockers.
