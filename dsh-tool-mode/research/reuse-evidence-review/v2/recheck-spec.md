# Recheck — spec/contract lens, changed sections only (P5)

**Reviewer:** adversary-spec. **Target:** `dsh-tool-mode/docs/reuse-evidence-plan.md` (948 lines read in full).
**Method:** each finding in `v2/spec.md` that touches a changed section gets one verdict (FIXED quotes the closing text and line); new issues are confined to the changed range and capped at two per section. Read-only.
**Counts:** 44 verdicts — **FIXED 7, PARTIAL 7, NOT FIXED 30**; **new issues 22**.

### §0 — What changed (17–44)

- **§0.1 MAJOR — FIXED.** §5.3 now puts the old guard names under the five outcomes: "Reason **codes are not outcomes**" (:176).
- **§0.2 MINOR — NOT FIXED.** "the ten review corrections" (:37) is still unindexed; v2.2 indexes seven themes, not findings, so the ten remain unmatched.
- **NEW** — the row-3 table entry has three cells in a four-column table, so its "why" is silently absent (:26).

### §1 — Background (45–84)

- **§1.1 MAJOR — PARTIAL.** A locator and an honest "no in-tree copy" now exist, but the vendoring precondition is said to live in §16 and §16 contains no such item, so nothing owns or dates it.
- **§1.2 MINOR — NOT FIXED.** "one evidence machine, two subjects" (:83) still sits beside "Skills are not artifacts" and §5.4's `skill` ref kind; Appendix C does not define "artifact".
- **NEW** — "a precondition for citing any of them again" (:52) is contradicted by the same paragraph, which keeps citing all eight numbers.

### §2 — Goals and non-goals (85–107)

- **§2.1 MAJOR — FIXED.** Goal 3 now gives D a unit and a population: "the suite's success rate on family `F` falls by `D` percentage points" (:95).
- **§2.2 MINOR — NOT FIXED.** Goal 4's "every phase has a pre-registered threshold and a null outcome" (:98–99) is still false of §14.8 rows 3 and 6.
- **NEW** — goal 1's store must answer "did anything change" (:89–90), but §10.1 says the store's rates "are descriptions, never deltas" (:481–482); the store can no longer answer its own goal.

### §3 — Decisions in force (108–133)

- **§3.1 MAJOR — NOT FIXED.** `scopeKey` is still load-bearing and undefined (only D3, §5.4 and §7's row mention it; Appendix C omits it).
- **§3.2 MAJOR — NOT FIXED.** D2's ban on "working" still names no renderer and no test, so the ban is indistinguishable from its absence.
- **§3.3 MINOR — NOT FIXED.** D12 still forbids a "new … promotion path" while §11 ships `evaluateAdmission`; D6 says that is a second authority, and no rule reconciles them.
- **NEW** — D9 still says promotion "requires `unreproduced === 0`" (:122) while D19 makes the count `null` until a pass exists and refuses with `EVIDENCE_UNREPRODUCED_UNKNOWN` (:132); the register now holds both requirements.

### §5 — The seams (145–212)

- **§5.1 BLOCKER — NOT FIXED.** The skill digest still lists renderer/tool/contract/source/body (:205–207) and omits `requiresTools`, the editable manifest field that decides kind and publication; the promised equality test still has no enumeration.
- **§5.2 MAJOR — NOT FIXED.** "Gate" still names the five-outcome seam and the phase exit table (§14.8 is titled "Phase gates"); reason codes fix the vocabulary collision, not the word.
- **§5.3 MAJOR — NOT FIXED.** "a reason string carrying a number" (:175) still has no consumer, and the listed codes include ones with no number (`no-reference`, `admitted-insufficient`).
- **NEW** — §5.5's artifacts bullet is cut mid-list: "…`purpose`, `verification` and" then jumps to Skills, losing `verifiability` and the test sentence (:200–201).
- **NEW** — §5.5 duplicates itself: "catalog-entry digest (bundled), the playbook digest or file bytes, and the body digest." appears twice, then a stray "digest." fragment (:207–209).

### §6 — Phase 0: signals (213–335)

- **§6.1 BLOCKER — PARTIAL.** §6.3 now defines the window precisely, but still names no reader that supplies the operator's message; the only reader was withdrawn (§15), and §6.2 fires signals at run completion.
- **§6.2 MAJOR — NOT FIXED.** "written where the receipt is built, at run completion" (:263) cannot include a label drawn from the *next* message (:277–279), and no late-write row is defined.
- **§6.3 MAJOR — NOT FIXED.** `call_retry_changed` is still key-only (:232), so a same-keys/value-changed retry is invisible, and "followed by" still has no adjacency rule.
- **NEW** — the dispatch sentence is broken: "The host dispatches / and `createDispatchForContract`" (:282–283) lost its object and the first function name.
- **NEW** — "it is recorded as `out_of_window`" (:279–280) has no home: §5.1 says a source that cannot decide emits nothing, and §7's row has no state for a negative label.

### §7 — Phase 1: the use store (336–363)

- **§7.1 BLOCKER — FIXED.** "Retention: **90 days** for tool, error and edge rows; **30 days** for rows derived from operator words" (:354).
- **§7.2 MAJOR — PARTIAL.** The arm column is gone, but the row still has `outcome` and `signals[]` with no domain (:344), so "when a use fails" remains undecidable.
- **§7.3 MAJOR — NOT FIXED.** "the two stores never disagree about one number" (:361–362) still admits two stores over D3's one, with no transition rule and no enforcement.
- **NEW** — "Eviction is **reported**…" repeats immediately: the sentences at :354–356 say the same thing twice ("nobody can tell the two apart" appears twice).
- **NEW** — `applied` "whether the body was injected for that use" (:345–346) is a per-session arm label, which "There is no arm column" (:350) forbids in the same section.

### §8 — Phase 2: the observed check (364–392)

- **§8.1 BLOCKER — PARTIAL.** §8 now says the gate's "reproduced" is a reproduction pass over a stored failure, but §14.8 row 2 still names "the next 3 failing uses" (:751), a different and unbuilt procedure.
- **§8.2 MAJOR — NOT FIXED.** "restricted to paths declared in the artifact's own `inputSchema`" (:367–368) is still vacuous for skills, which have no schema, and no artifact-only statement was added.
- **§8.3 MAJOR — NOT FIXED.** "When a use fails" (:366) has no predicate on the row, and "up to three" still has no selection order.
- **NEW** — §8 allows promotion "when `failures === 0`" (:381) while D9 and §14.7 (:724–725) still say a non-reproducing failure "blocks promotion"; the three sentences cannot all hold.

### §9 — Phase 3: the skill module contract (393–470)

- **§9.1 BLOCKER — PARTIAL.** `requiresTools` is now called "a visibility gate, not a dependency declaration" (:403–405), but the kind is still "declares two or more tools" and the example "identify-language (60 lines, one tool)" as a flow skill remains (:407–409).
- **§9.2 MAJOR — NOT FIXED.** C1 still reads "the same tool named in skill A's `whenNotToUse`" (:446), and no section says where a skill's `whenNotToUse` comes from.
- **§9.3 MAJOR — NOT FIXED.** C3 still says "across skills" (:448) while the landed rule fires on one skill that says both, and "contradictory" remains an unstated two-regex notion.
- **NEW** — §9.5's "error fails `verify:skills`" (:442) contradicts §0 row 3's "unavailable until the script exists — never `pass`" (:26) and §17's "verify:skills does not exist" (:893).
- **NEW** — §9.1 says `requiresTools` is not a dependency declaration (:403) while C5/C7 treat it as one and §17 derives kind from it (:865); "says 'this guidance applies to these tools'" (:405) closes nothing.

### §10 — Phase 4: skill measurement (471–525)

- **§10.1 BLOCKER — FIXED.** "The counterfactual is a **suite execution pair**" (:478) with D17's pair floor and MDE.
- **§10.2 MAJOR — NOT FIXED.** "only works in one arrangement … does not ship" (:502–503) still has no threshold, and §11's admission predicate never mentions arrangement.
- **§10.3 MAJOR — PARTIAL.** §2 now names the gap's endpoints, but `recovery` still has no formula or unit at its point of use, and `gapFloor` 0.05 still has none.
- **NEW** — §10.3 is cut mid-bullet: "the exact one-sided sign test over discordant pairs (minimum 6 pairs, as §11 already" then §10.4 begins (:494–498); the report list it introduces is missing.

### §11 — Phase 5: admission and demotion (526–556)

- **§11.1 MAJOR — NOT FIXED.** The `admitted-insufficient` marker still has no owner, storage or verifier (:534–536).
- **§11.2 MAJOR — NOT FIXED.** "Holm-corrected across a pre-registered family of one" (:548) is still the identity; the correction cannot change a decision.
- **§11.3 MINOR — FIXED.** The demotion rule is now its own suite-based statement: "A skill whose suite paired difference shows harm" (:537), not a copy of §10.3.

### §13 — Not in this programme (594–610)

- **§13.1 MAJOR — NOT FIXED.** "it may not grade" (:610) is still undefined and indistinguishable from the permitted veto.
- **§13.2 MINOR — NOT FIXED.** The section still restates §2's non-goals and D1/D2/D12 item for item; only the suites bullet changed.
- **NEW** — the bullet headed "Synthetic capability suites in the store" now says those suites are "the decision basis for admission and deletion" (:600): a section titled "Not in this programme" argues the thing is in it.

### §14 — Development method (612–756)

- **§14.1 BLOCKER — FIXED.** "for a new module `ERR_MODULE_NOT_FOUND` naming it" (:688) is now the stated red, and a red for another reason is re-run, not recorded.
- **§14.2 MAJOR — NOT FIXED.** The "two runs … already on record" (:640–643) are still a red run and two corrected fixtures, not a revert result.
- **§14.3 MAJOR — NOT FIXED.** §14.8 row 3 is still a three-item checklist whose null outcome is "gate fails naming the finding" (:752), and row 6 still "no proposal ships" (:755).
- **NEW** — v2.2 says T5 is "fixed — gate is '`verify:skills` exits 0'" (:826), but §14.8 row 3 did not change to that gate; the record and the table disagree.
- **NEW** — the "owner, a date and a gate that notices absence" (:678–680) depends on `verify:research-tests`, "a script this plan still has to define" — one undefined command replaced by another.

### §15 — Review record (757–837)

- **§15.1 MAJOR — NOT FIXED.** v2.2 indexes seven themes and defers "the remaining majors … backlog" (:835); no v1 or v2 finding is dispositioned by number, so retention is still unverifiable.
- **§15.2 MINOR — NOT FIXED.** The v2.1 amendment (:801) is still a changelog entry inside a review record whose counts describe v1.

### §16 — Decisions this plan does not make for you (838–854)

- **§16.1 MAJOR — PARTIAL.** The old session-floor question is gone, but item 6 now asks whether "the pair floor of 6 discordant pairs" is right (:852) while §14.8 already pre-registers "≥ 6 discordant pairs" (:753).
- **§16.2 MINOR — NOT FIXED.** The aggregate budget still ships a default (4000) while its owner is open (:848–849).
- **NEW** — item 5 asks who owns the skill suites and answers "the same answer as the reference bank" (:850–851), duplicating item 2 two lines above.

### §17 — Implementation status (855–900)

- **§17.1 BLOCKER — FIXED.** "**It is not persisted yet:** the run lives in this session's transcript only" (:871–872) stops the unpersisted red being reported as a finished report.
- **§17.2 MAJOR — NOT FIXED.** Still no revert result for any landed piece; only pass counts, which §14.3 says are not verification.
- **§17.3 MINOR — NOT FIXED.** "pre-existing timing flake" (:886) still cites no pre-change run, and the new flake rule is satisfied by a regression too.
- **NEW** — the Identity row still says the digest covers "(`name`, `description`, `whenToUse`)" (:862) while §5.5 now says extension skills have no `whenToUse` and the digest covers "the shape the skill actually has" (:205–206).

### Appendix A — v1 → v2 section map (901–917)

- **A.1 MINOR — NOT FIXED.** The "(new)" row (:916) still omits §1 and §2.
- **A.2 MINOR — NOT FIXED.** "§12 Phase 6, unchanged content" (:911) still misstates §12's item 3 additions.
- **NEW** — the map's "(new)" row (:916) also omits Appendix C, so the new definitions section has no v1 home.

### Appendix C — Definitions (932–949, new)

- **NEW** — "window | a **session**" (:939) contradicts §6.3, where the window is "the first operator message after the tool result, before any further tool call" (:277–279); `out_of_window` covers the other-session case.
- **NEW** — "One canonical statement per term; every other section references it" (:934) is false: no section cites Appendix C, and `scopeKey`, `artifact`, `gate`, `pass` and `recovery` are absent from it.
