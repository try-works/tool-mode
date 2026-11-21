# Architecture recheck (P5) — fixed-or-not on the changed sections

Scope: the 33 findings from my v2 pass that touch the changed sections (§4, §12 and Appendix B are
out of scope). One verdict each; §15's v2.2 disposition table is checked against the text it cites,
not accepted as the record. Code-dependent fixes re-checked against the tree: §6.2's new anchors
(`index.ts:4344` is `recordAuthoredRun`, `:4391-4392` is where `dataFlow` enters the receipt — both
verified), the laya manifest (still no `requiresTools` on `decision-decomposition`), `bindings.ts:110-112`
(still defaults to `'host'`), `skill-contract.ts:105-117` (digest still hashes renderer + source + body).

**Totals: FIXED 7 · PARTIAL 7 · NOT FIXED 19 · NEW ISSUES 25.**

## Change log sections

### §0 (17-44)
- **FIXED** — "the skill's editable surface, which is **two surfaces**" (plan:25); the extension shape and its missing `whenToUse` are now stated with both anchors.
- **NOT FIXED** — the `call_probe` row is unchanged (plan:27, 231): no receipt field names the tool a `tool_mode_describe` covered, so "over the same receipts" is still unobservable.
- **FIXED** — the store row is gone; its replacement reads "`unavailable` until the script exists — never `pass`" (plan:26).
- **New:** row 3's "v1 said" column was rewritten to a `verify:skills` statement v1 never made, so the table no longer diffs v1 against v2 for that row (plan:26).

### §1 (45-84)
- **NOT FIXED** — still "11 `SKILL.md` files in extensions" (plan:79); one of the 11 is the SDK template, so 10 ship.
- **NOT FIXED** — still `index.ts:5928-5932` for the wrong-card drop (plan:81); that window is the disabled-branch and unknown-skill log, the body failures are at `:5957-5980`.
- **New:** "vendoring the PDF ... is a precondition for citing any of them again (§16)" (plan:51-53) is contradicted in the same document: §9.2, §10.4, §10.5 and Appendix B still cite eight of its numbers, and §16 contains no such precondition.

### §2 (85-107)
- **FIXED** — "where a pre-registered reference exists, it closes `N`% of the gap" (plan:96-97); goal 3 is conditional and names the paired suite difference (D17).
- **New:** goal 3 still promises "the suite's success rate on family `F`" (plan:94-95), while §10.3 and §14.8 define the unit as the pre-registered **task list**, not a family — the goal kept the old unit through the rewrite.

### §3 (108-133)
- **NOT FIXED** — D4 still says "one test asserting digest fields == editable fields" (plan:117); interfaces are erased, so the only runtime key list is the authoring tool's schema.
- **FIXED** — "An arm is a **suite run condition**, never a production assignment" (plan:118).
- **New:** D7 (plan:120) and D18 (plan:131) sit in one table and say opposite things — "a session projection at run completion" versus "not folded into a session projection".
- **New:** D9 (plan:122) still requires `unreproduced === 0` for promotion while D19 (plan:132) makes it `null` until a pass exists — two live decisions, two rules.

### §5 (145-212)
- **NOT FIXED** — §5.4's skill ref is unchanged (plan:187-190) and still has no receipt or event carrying a skill identity.
- **NOT FIXED** — `scopeKey` still duplicates the receipt's `artifactScope` under a second name (plan:182).
- **PARTIAL** — §5.3 now names reason codes under `insufficient` (plan:175-178), but the existing `E_*` codes of `evaluatePromotion` remain unmapped apart from one example.
- **New (damage):** the artifact bullet is cut off mid-sentence — "`inputSchema`, `purpose`, `verification` and" (plan:200) then a new bullet; `verifiability` and the equality assertion are gone from the artifacts half of §5.5.
- **New (damage):** "the catalog-entry digest (bundled), the playbook digest or file bytes, and the body digest" is printed twice, leaving a dangling "digest." (plan:205-209).

### §6 (213-335)
- **FIXED** — "Signals are written **where the receipt is built**, at run completion" (plan:263), with the projection limited to what it can see (plan:269-273); both new anchors check out.
- **NOT FIXED** — lane 1 is unchanged (plan:282-287): no environment exists outside the registrar closure, and "Fail closed" still rides `executionLocationOf`, which returns `'host'` for every unknown route (`bindings.ts:110-112`).
- **NOT FIXED** — erasure still cites `index.ts:4279-4297` (plan:329), the pre-step digest hook; the disposal handlers are `:3715-3719` (unconditional) and `:4301-4337` (gated).
- **New (damage):** the lane-1 paragraph lost its subject — "The host dispatches / and `createDispatchForContract`" (plan:282-283); `resolveImplementationByContract` vanished, so the sentence no longer says what is dispatched.
- **New:** §6.4 still says "a skill row whose session is forgotten is removed from the ablation matrix" (plan:331), but §7 and §10.1 establish there is no per-session arm and the matrix is a suite matrix — the cascade retracts from nothing.

### §7 (336-363)
- **NOT FIXED** — "`evidence()` reads it and nothing else, so the two stores never disagree" (plan:361-362) stands beside §6.1's direct lane from the session ledger (plan:239-240), whose counter is prefix-based and structurally zero for contract tools.
- **FIXED** — "Retention: **90 days** for tool, error and edge rows" (plan:354), with 30 days for operator-derived rows and `failurePaths`.
- **NOT FIXED** — "a documented merge rule for a second process" (plan:349) still defers the only hard part; no store in the tree has a lock or a merge rule.
- **New (damage):** the eviction sentence is duplicated — "`evicted` is a distinct outcome from `insufficient` ..." appears twice, the second copy starting mid-line (plan:354-356).
- **New:** skill rows carry "`applied` ... whether the body was injected for that use" (plan:345), which is a per-use arm label — the field the very next bullet says the store does not have.

### §8 (364-392)
- **NOT FIXED** — the rendering rule is unchanged (plan:384-391): the line the observed check replaces only renders at `uses >= 5` (`library-digest.ts:240`), so a first-use check still prints nothing.
- **PARTIAL** — `unreproduced` is now `null` with a named refusal (plan:380-382), but no caller of `evaluatePromotion` is named that supplies it, and `artifact-promotion.ts:202` is unchanged.
- **New:** the reproduction pass is deferred to "§12" (plan:374-375), which is the parked proposal pass and defines no such work item.

### §9 (393-470)
- **PARTIAL** — §9.1 now states the gate semantics ("a **visibility gate, not a dependency declaration**", plan:403-406), but kind is still derived from the same field (`skillKindOf`, plan:460-461), so the two roles remain fused.
- **NOT FIXED** — the flow exemplar is still `decision-decomposition` (plan:407-409) and its manifest still declares no `requiresTools` (`extension-laya/tool-mode.extension.json:145-152`), so it classifies `tool`.
- **NOT FIXED** — C8 still uses `text_embed` (plan:453, 457-458) under a phase that opens "no model calls, no fixtures" (plan:395-396).
- **New:** the new gate paragraph implies a 2-tool flow skill is withheld unless both tools are visible (`publication.ts:229-242`) — an availability rule §9.1 never states and §11 admission never checks.
- **New:** line 407 says "one flow skill of each shape" and then names a one-tool skill, contradicting the paragraph directly above it.

### §10 (471-525)
- **FIXED** — "Nothing in production is randomized, so nothing in production is claimed to be causal" (plan:480-481); the suite pair replaces the session arm.
- **PARTIAL** — the design changed, but §10.3's rule list is cut off mid-sentence — "minimum 6 pairs, as §11 already" (plan:497-498) then §10.4 — so what may be deleted is unstated.
- **NOT FIXED** — the length sweep still does not say who authors the 25%/10% variants or that each variant carries its own digest (plan:507-509).
- **New:** §10's premise line is unchanged — "no replay, no synthetic call, no new store" (plan:473) — and now contradicts the suite execution pairs the same section specifies.

### §11 (526-556)
- **NOT FIXED** — `evaluateAdmission` still has no caller: no script, no exit code, and §14.5's gate row is still only `verify:static` (plan:534-536, 692).
- **NOT FIXED** — "blocks the next admission until explained" (plan:538-539) still makes prose the deciding artefact, which D13 forbids.
- **New:** "Holm-corrected across a pre-registered family of one" (plan:547-548) contradicts the multi-cell reporting §10.3 and §14.8 now require — multiplicity cannot be both one and many.

### §13 (594-611)
- No findings from pass 1 (verdict SOUND); nothing to adjudicate. The new suite bullet (plan:600) is consistent with D1 and D17.

### §14 (612-756)
- **PARTIAL** — §0 row 3 and §14.4 now admit missing scripts, but §14.7 still says a C1-C9 `error` "fails `verify:skills`" (plan:737) and §14.8's phase 3 gate still names it, with no command in §14.5 and no script in `package.json`.
- **PARTIAL** — §14.5 now makes a recurring flake a defect (plan:693), but §14.2 still lists the 600 ms sleep under "Determinism" as an example rather than a violation (plan:644-646).
- **New:** §14.4 gives a not-yet-defined script a hard start date — "from 2026-12-01 `verify:research-tests` ... a script this plan still has to define" (plan:680-681) — a gate that cannot fail, by the section's own rule.
- **New:** §14.8's phase 2 gate ("reproduced on the next 3 failing uses", plan:751) depends on the reproduction pass §8 says does not exist — an unreachable gate in the table D19 was added to fix.

### §15 (757-837)
- **NOT FIXED** — "the host does dispatch contract implementations in process (`extension-dispatch.ts:205,239`)" (plan:771-773) still presents the correction as closed; the closure and live-signal requirement (`index.ts:5857, 5866`; `extension-dispatch.ts:244`) is unmentioned.
- **New:** T5's disposition says the gate "is `verify:skills` exits 0" (plan:826) while §14.8's phase 3 row says something else and §17 says the script does not exist — the record cites a fix the text does not contain.
- **New:** line 783 still ends "which is why §6.2 is a projection and not a reader", while §6.2 and D18 now say the edge signals are deliberately not a projection.

### §16 (838-854)
- **NOT FIXED** — question 3 still cites `index.ts:4090-4104, 4182-4195` (plan:845-846); the `...evidence` spread is at `:4100-4107`.
- **New:** Q2 (reference bank) and the new Q5 (skill suites) split one dependency across two questions without saying which phase each blocks; §11 calls the bank the blocker for both.

### §17 (855-900)
- **NOT FIXED** — the identity row still describes "sha256 over the renderer version, the tool, the source digest, the body digest" (plan:862; `skill-contract.ts:105-117` unchanged): a renderer comment edit still re-keys every skill.
- **PARTIAL** — the red run's non-persistence is now disclosed (plan:871-873), but the pass counts (26/3/32/4084) still carry no captured output path.
- **New:** the same row lists `whenToUse` as a digest field while §5.5 and Appendix C now say an extension skill has none — the table describes one of the two surfaces as if it were both.

### Appendix A (901-917)
- No findings from pass 1. **New:** the map still says "§5 Phase 2 observed check | §8, unchanged" (plan:910), but §8 gained the reproduction-pass paragraph and D19 (plan:372-382).

### Appendix C (932-949)
- **New:** it defines `requiresTools` as "a visibility gate on the skill, not a dependency declaration" (plan:946) and never says the same field is also the kind discriminator (`skillKindOf`), so the canonical definition is half true.
- **New:** "the store is observational and authoritative for use rows (D3)" (plan:947) contradicts §6.1, which still measures the direct lane from `session-ledger.ts:55`.


