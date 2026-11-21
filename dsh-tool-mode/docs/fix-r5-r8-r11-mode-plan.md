# Fix plan — R8 describe, R11 perItem mode, R5 offer visibility

Target: 0.5.115. TDD: red (or mutation-checked) → minimum implementation → focused green →
adjacent suites → full dsh suite → typecheck → build/evidence → verify gates → publish →
install from npm. No live-GUI restart by the agent.

## R8 — describe carries the artifact's declared facts
Root cause: describeOne built only from the registry schema/definition, so an authored row
lost `verifiability` and reported `outputSchema: {}` (typescript.output = unknown).
Fix: describe reads the caller-visible authoring snapshot (the same list source) and adds
`verifiability` and `perItem`; an authored program's output schema is a described
"any JSON value / perItem labelled rows" instead of an empty object.
Test: tests/describe-per-item.test.ts (R8 group).

## R11 (mode) — perItem:true is a declared, validated one-call contract
Define accepts `perItem: true`. The stored input schema gains the `perItem` boolean, so
the model sees the switch and validation enforces it. At run time, `input.perItem === true`
requires the declaration and a row array whose length equals the input's first array
argument; otherwise the call is refused. The digest names `<name> using perItem: true`
instead of the nested-tool loop, and the supporting bracket follows.
Tests: tests/describe-per-item.test.ts (R11 group) — rows, mismatch, undeclared, digest.
Mutation check: removing the run-time validation makes the mismatch case pass, so the
test detects the defect.

## R5 — offers were stored under an identity the list never filters by
Root cause: the offer was built with the LEAF session id while pendingOffers is filtered by
the ROOT session id, so a subagent's offer was invisible (and R5's acceptance test could
not run). Fix: store the offer under `rootSessionId ?? sessionId` — the same identity the
list uses. Equivalent-artifact suppression is unchanged: when auto-keep already produced a
single-tool wrapper, no offer is correct.
Test: tests/offer-session-key.test.ts — repeat a bindable authored tool 3× as leaf with a
root parent; the offer is visible and its command defines a bindable artifact.
Mutation check: reverting the key to the leaf makes pendingOffers empty (red).

## Gate
Focused suites → full dsh suite → typecheck → build + confinement evidence →
verify:built / docs / verification → npm publish 0.5.115 → install into the web profile.
