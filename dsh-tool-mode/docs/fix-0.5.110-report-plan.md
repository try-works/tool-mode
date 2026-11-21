# Fix plan — 0.5.110 report findings (E35/R4 follow-ups)

Source: D:\DEV\tool-mode-internal\research\sources\repo\2026-11-21-0.5.110-reregistration-dedupe-verifiability.md
Target release: 0.5.112. Protocol per finding: red test → minimum implementation → focused green →
adjacent tests → full suite → typecheck → build/evidence → verify gates → pack/publish →
install from npm → restart host → live verification → commit.

## Findings

### F1 (E35): verifiability "aggregate" invisible in the digest
Symptom: agent_agg_ws stored verifiability (returned by get/list) but the solver's digest
never named the artifact, so no caveat was seen. Rendering itself is proven green by
tests/verifiability-digest-wiring.test.ts — the defect is SELECTION (F3). No separate code
change; F3's regression test asserts the aggregate caveat IS rendered for the visible
workspace artifact.

### F2 (R4 partial): bind rejection names nothing on the model surface
runtime-surface.ts throws a MULTI-line error; the per-name detail sits on line 2+. The
model surface showed only the first line ("the program requested tools it cannot bind:")
and stopped. Fix: make the FIRST line self-contained — one line carrying every unresolved
name with reason, scope and action. No new information, a format change that survives
first-line truncation anywhere downstream.
Red: tool_mode_run with an unregistered tool → error text has NO newline and matches
name + reason + scope + action. Existing u42/authored-program-binding expectations updated
to the single-line contract.

### F3 (E35): digest named a dead route, omitted the callable one
Root cause: the digest's candidate rows are store-visible (agent-authoring resolveAll)
but NOT required to be bindable. A session-scope workflow survives in the store across a
restart while its registration is gone (durable*Entries exclude session rows at boot), so
the digest recommended workflow_g1_lang_counts — callable:false for the solver — while the
workspace artifact the solver COULD call was never named. The suggestions lane already
filters through bindableName (index.ts:4133); the digest does not.
Fix: digestForAgent drops any candidate whose callableName is not bindable for the
caller's resolved scope (bindableName, the same resolver the dispatcher and discovery use).
Red: mount A, define a session-scope workflow + a workspace aggregate tool; remount B on
the same store (session row stays stored, unregistered); assemble the digest for the
defining agent — red shows the dead workflow named. Green: dead row absent, workspace
artifact named WITH its aggregate caveat (covers F1).

### F4 (E35): dataHandling boilerplate lies about stored artifacts
discovery-control.ts:244 renders "This host-owned discovery tool reads the local
registry…" for ANY tool without a catalog model item — including stored device-execution
artifacts whose input really does flow to their program and bound tools.
Fix: authored tools/workflows (deps.authoredToolNames / deps.workflowToolNames) get an
honest line: the stored program runs on-device through Code Mode; input goes to the
program and its declared tools; the host sends nothing to a remote provider. Host-owned
discovery tools keep the existing line.
Red: describe a defined authored tool → dataHandling must NOT match /host-owned discovery
tool/ and must state the on-device Code Mode path.

## Out of scope
- E35 receipt-gap guess (U29): the report itself marks it unresolved/method-limit.
- E36 clause-ablation method confound: a measurement note, not a code defect.

## Outcome (0.5.112)
- F1/F3: red reproduced the report verbatim ("Use workflow_g1_dead_route … Pass the whole
  list in one call." as the imperative while the callable workspace aggregate sat in
  "Also available"). Fix: digest candidates pass through the same bindableName resolver as
  the suggestions lane. Green: dead row absent; agent_agg_deadroute named WITH
  "Aggregate-only output (not per-item verifiable)".
- F2: rejection is one self-contained line: name (reason at scope (scopeKey) — action).
- F4: authored tools/workflows describe their real data path (stored program on-device
  through Code Mode); the host-owned-discovery line now only covers host-owned tools.
- Failing-then-green adjacent suites: final-report, ptc-confinement-bundled,
  receipt-enrichment, u26-list, verification-generator (44/44 after artifact regen; the
  failures were stale evidence/report artifacts, not regressions).

## Gate
Focused tests → full dsh suite → typecheck → build + confinement evidence →
verify:built / verify:docs / verify:verification → npm publish 0.5.112 → install into the
web profile from the registry → scheduled restart → live checks:
1. served client bundle unchanged from 0.5.111 (no client change in this release),
2. probe: define + restart-simulated digest excludes the dead row (probe fixture home),
3. tool_mode_run bind rejection is one line naming the tool.
