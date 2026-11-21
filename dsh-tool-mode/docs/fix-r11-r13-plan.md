# Fix plan — R11–R13 (E37 follow-ups)

Source: D:\DEV\tool-mode-internal\research\reports\2026-11-20-fix-requirements-0.5.106.md §R11–R13.
Target: 0.5.114. TDD per requirement: red → minimum implementation → focused green →
adjacent tests → full suite → typecheck → build/evidence → verify → publish → install from npm
→ (operator restarts) → live check. No fabricated results.

## R11 (P1) — the per-item route must be ONE call, not N round trips
Measured on 0.5.112 (60 texts): aggregate artifact call 7.2 s (unverifiable); one Code Mode
program looping lang_detect 7.8 s (60 labelled rows, verifiable); looping the artifact
per-item ~118 s (120 s deadline). The digest named the worst route ("one item at a time").
Fix: VerifiabilityCandidate carries the artifact's DECLARED nested tools; the aggregate
caveat names the cheapest executable route the host knows:
- nested tool declared → "verify with one Code Mode program looping <tool> over the list."
- no nested tool → do not invent a route: "verify each item against an independent source
  (no per-item route is declared)."
Supporting-row bracket gets the same route, bounded.
Red: pure digest test with verifiability aggregate + nestedTools ['lang_detect'] → caveat
names the one-program route and never "one item at a time"; no-tools case names no route.

## R12 (P2) — receipts carry the calling session, not only the root
Every artifact receipt from parallel subagents used sessionId = root; nested rows had none,
so 76 receipts could not be partitioned by run. Fix: thread the LEAF session id
(sessionIdOfAgent(exec.agent)) through recordAuthoredRun; receipt rows carry
sessionId = caller leaf and rootSessionId = the root session. Nested rows carry both too.
Red: mount with a sessions service mapping leaf→root; run a workspace artifact as
leaf-a (root-1); model_tools receipts must show sessionId 'leaf-a' AND rootSessionId
'root-1' (currently both are 'root-1').

## R13 (P1) — the evidence badge must not read crash-free as correct
"Evidence: 9 uses, 0 failures" presented exception counts as trust evidence while every
run was wrong. Fix: rename what the line measures — "Completed without a recorded error:
9 uses, 0 failures across 1 session." No correctness implication; no new signal invented.
Red: pure digest test with uses 9/failures 0 → line starts "Completed without a recorded
error:" and the old "Evidence:" prefix is gone.

## Outcome (0.5.114)
- R11: caveat now renders "verify with one Code Mode program looping <nested tool> over the
  list" (or "no per-item route is declared" when none); the per-item artifact loop is never
  named. The "perItem:true" mode was not added: authored programs are arbitrary, so the
  host cannot synthesize a per-item result; the declared-tools route is the executable one
  the amendment requires.
- R12: composition and nested receipts carry sessionId = the leaf caller and rootSessionId
  = the root. Red test showed sessionId "root-1" for caller "leaf-a"; green splits them.
- R13: "Evidence:" renamed to "Completed without a recorded error:"; no correctness claim.
- Focused: 30/30 across the six adjacent suites; typecheck clean.

## Gate
Focused reds → greens → verifiability-digest-wiring updated to the R11 wording → full dsh
suite → typecheck → build + evidence + verification → npm publish 0.5.114 → install into
the web profile → live check after the operator's restart (no live-GUI restart by the agent).
