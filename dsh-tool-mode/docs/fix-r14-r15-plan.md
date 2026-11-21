# Fix plan — R14 evidence-first selection, R15 stale-draft cleanup

Target: 0.5.116. R14/R15 were downgraded to P2 after E43/E44 (the E42 symptoms were
transient), but both rules were still wrong; E44 also showed correctness improves when the
digest is clean.

## R14 — evidence outranks scope/recency
Root cause: rankAdoptionCandidates sorted by scope first (session > workspace > global),
then recency, so a 0-use session draft could displace a 100-use workspace artifact.
Fix: uses desc → fewer failures → kept over draft → author verification clause → sessions
desc → scope → recency → callable name. Recency and caller scope are late tie-breaks.
Tests: adoption-digest-ranking R14 group + a digest-level "100 uses vs fresh 0-use" case.
Mutation: forcing the uses key to 0 makes both R14 tests fail (red).

## R15 — deleting an artifact removes its stale auto-kept wrappers
Root cause: deleting the wrapped artifact left draft rows whose `tools` still named it; the
drafts stayed listed and failed as "unauthorized" when obeyed.
Fix: (1) when the LAST row for a name is deleted, cascade-delete auto-kept DRAFTS (never
kept artifacts) whose declared tools include the deleted callable name; (2) the digest
drops any draft whose nested tool is not bindable for the caller, covering rows that vanish
by other paths (session disposal, extension deactivation).
Tests: r14-r15.test.ts — cascade after a seeded auto-keep draft; digest exclusion of a
draft wrapping a ghost tool.
Mutation: disabling the cascade and the guard makes both R15 tests fail (red).

## Gate
Focused suites → typecheck → build + confinement evidence → verify:built/docs/verification
→ full dsh suite → npm publish 0.5.116 → install into the web profile. No live-GUI restart.
