# Adoption red-first evidence

This file preserves the red counts reported while implementing
`docs/adoption-improvement-plan.md` on 2026-11-19. Raw terminal transcripts were
not retained by every task owner; the counts below are the task reports, and the
independent verifier replayed Phase 0/1 exactly. Where a replay is not possible,
the gap is stated rather than hidden.

Baseline: `d4baacd`. Final code for phases 0-7: `b573ff3` plus the fix commits after
independent verification.

| Phase | Red evidence | Green evidence | Gap |
| --- | --- | --- | --- |
| 0 reconcile | 7 tests, 3 pass / 4 fail (program duplicate, workflow orphan, root reach, stored name) | 7/7 after Phase 2 unskip | verifier replayed 7/3/4 exactly |
| 1 truthful verbs/delete | 10 tests, 2 pass / 8 fail (wrong-kind, both-kinds, unknown arrays, promoted copy, per-scope) | 10/10 | verifier replayed 10/2/8 exactly |
| 2 receipt tree/reach | 7 tests, 3 pass / 4 fail plus a purge-suite load error | 9/9 tree+purge | behavioural replay 16/6/10; no saved transcript |
| 3 directive digest | 3 new host tests failed (neutral section still emitted); the module API was absent before implementation | 17/17 digest+ranking+quality | the first red was partly an import failure; only the host-section red is behavioural |
| 4a auto-draft | 6 tests, 2 pass / 4 fail; first behavioural message `the draft must be listed as draft: true` | 6/6 after runtime hook | 2 absence cases passed on the base (no file was written); labelled |
| 4b retention | 8 tests, 1 pass / 7 fail on an explicit `draft support is not implemented yet` stub | 8/8 | skeleton red for a new store API; stated |
| 5 offer channel | 9 tests, 3 pass / 6 fail | 9/9 | absence cases passed on base; labelled |
| 6 first contact | 7 tests, 4 pass / 3 fail | 7/7 | prewarm outcome and log red were behavioural |
| F1 callable drafts | 4 behavioural fails (draft and no-input promotion); replaying the final suite against `0dad8cb` gives 9 tests, 6 pass / 3 fail. The readable-name promotion test passed pre-fix via the define fallback, so it is a regression test, not red evidence. | 9/9 | added by independent verification; corrected after replay |
| F3 failure evidence | 4 tests, 1 pass / 3 fail (class not derived; no class after five runs; management offered) | 5/5 | added by independent verification |
| F6 prewarm | 8 tests, 6 pass / 2 fail (always started; failure not logged) | 8/8 | added by independent verification |
| F8 evidence gate | 27 tests, 24 pass / 3 fail (known failure at 1/4 uses; 0 sessions) | 27/27 | added by independent verification |

## What this does not prove

- It is not a byte-for-byte terminal log. The counts are task-owner reports.
- A test that passes before the fix is a regression test, not red evidence. The
  table labels the known cases.
- The independent verifier's reports `docs/adoption-verification-report.md` and
  `docs/adoption-reverification-report.md` are the authority on what replayed and
  what did not. F4 remains **partial**: there are no raw transcripts for phases
  2, 4b, 5 or 6, and phase 3's first failure was partly an import error.

## Verification replay

The verifier replayed `d4baacd` for Phase 0/1 and confirmed the same failing test
names and counts. Phase 2's behavioural failures replayed against the base, but the
original red transcript was not saved. Phases 3-6 were reconstructed from the task
reports above and the commits.
