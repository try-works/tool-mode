# Active Run V3 — Craft Review

**Concept 9 · Craft 8.5 · Clarity 8.5** (R2: 8.5 / 8 / 8)

V3 earns the concept: intent, attempt, calls, trace rows, result and actions make “a run is a job” demonstrated rather than declared. Reducing the dome and adding the CALL/MS table fixed the round-2 focus problem; removing the ghost panel and adding “Every run keeps” stabilises the left.

## Blockers

1. **Metadata is still 7–9px.** Table labels, DONE/QUEUED, call names and ms, COPY ID, recent-run rows, chips and footer all sit below a usable floor. Raise them to 11px (run ID 12px mono), test at 4.5:1, and make COPY ID a real button. This is the only accessibility blocker.

2. **Lifecycle semantics collide.** RESULT “running” repeats STATUS “Running” — it should be pending or omitted. “TOOLS IN RUN 3” speaks tools while status says “2 of 3 calls”; use CALLS 3, or “3 tools / 3 calls”. Recent-run times `00:14` also don’t match `STARTED 14:32:08`; label them “14s ago” or use clock times.

3. **The dome is now ornamental and unlabeled.** The real trace moved into a tiny table to its right; the three branches are not tied to decision_choose / decision_score / decision_test. Give each branch its call label and DONE/QUEUED mark, or remove the dome and let the trace table lead.

Fix 1–3 and ship; no structural changes needed.
