# Adversarial review of the reuse-evidence plan v2 — synthesis

Three independent reviewers, run one after another, each adjudicating all twenty sections of
`dsh-tool-mode/docs/reuse-evidence-plan.md` **section by section, in order, one at a time**.
They were read-only on the plan and wrote disjoint files; the evidence reviewer was told not to
read the other two reports, so agreement between them is not borrowed.

| lens | file | BLOCKER | MAJOR | MINOR | verdicts |
| --- | --- | --- | --- | --- | --- |
| spec / contract | `v2/spec.md` (307 lines) | 8 | 28 | 14 | BROKEN 8, WEAK 12 |
| architecture / feasibility | `v2/architecture.md` (388 lines) | 2 | 14 | 20 | SOUND 7, WEAK 11, BROKEN 2 |
| evidence / measurement | `v2/evidence.md` (≈400 lines) | 5 | 30 | 12 | SOUND 1, WEAK 14, BROKEN 4, UNVERIFIABLE 1 |
| **total** | | **15** | **72** | **46** | |

The plan is not shippable in this state, but the shape survives: no reviewer attacked the
premise (observational evidence, one store, no trainer), and the parts that were argued hardest
— the decisions register, the gate vocabulary, the "no prose as evidence" rules, the parked
proposal pass — came back SOUND where the architecture and evidence lenses agreed.

## Verdict matrix

| § | spec | architecture | evidence |
| --- | --- | --- | --- |
| 0 what changed | WEAK | WEAK | WEAK |
| 1 background | WEAK | WEAK | WEAK |
| 2 goals | WEAK | SOUND | WEAK |
| 3 decisions | WEAK | WEAK | WEAK |
| 4 what it is | WEAK | SOUND | WEAK |
| 5 seams | BROKEN | WEAK | WEAK |
| 6 Phase 0 signals | BROKEN | BROKEN | WEAK |
| 7 Phase 1 store | BROKEN | WEAK | WEAK |
| 8 Phase 2 observed check | BROKEN | WEAK | BROKEN |
| 9 Phase 3 skill contract | BROKEN | WEAK | WEAK |
| 10 Phase 4 measurement | BROKEN | BROKEN | BROKEN |
| 11 Phase 5 admission | WEAK | WEAK | BROKEN |
| 12 Phase 6 parked | WEAK | SOUND | SOUND |
| 13 not in programme | WEAK | SOUND | WEAK |
| 14 development method | BROKEN | WEAK | BROKEN |
| 15 review record | WEAK | WEAK | WEAK |
| 16 open decisions | WEAK | SOUND | WEAK |
| 17 implementation status | BROKEN | WEAK | WEAK |
| App A section map | WEAK | SOUND | UNVERIFIABLE |
| App B paper table | WEAK | SOUND | WEAK |

§10 is the only section all three call BROKEN. §12 is the only section two lenses call SOUND.

## The seven blocker themes

The fifteen blockers collapse to seven defects. Each is stated once, with the fix the reviewers
converge on.

**T1 — The arms are labels, not a manipulation (arch §7, arch §10.1, evidence §10).** Nothing in
the tree withholds a skill from a hash-selected session: the disabled set is static config plus
env, parsed once, and consulted at **registration**, which happens per plugin mount, not per
session. So both arms receive the skill body, every Δ is exactly 0, and the plan's own rule then
classifies 0 as "not helping" — the matrix would mark every shipped skill a deletion candidate, a
null that looks like a finding. Two honest fixes: (a) the arm gates injection **at render time**
(test: a control session renders no body while its tool stays registered), or (b) delete the
within-deployment ablation and measure **cross-configuration** — the operator runs two configs and
the report joins them by config digest. (b) is buildable now; (a) needs a render-time seam.

**T2 — The projection cannot see `dataFlow` (arch §6.2).** The events a session projection folds
carry turn/step/callId/name/arguments/isError/error.code/content — no `dataFlow`, no `receiptId`
(`tool-usage-projection.ts:254-288`). `consumed` and `unexplained` are unreachable from a re-fold,
so §6.2's premise (receipts are bounded) is right and its conclusion is wrong. Fix: emit those
signals where the receipt is built — the composition path already has the report and the edges
(`index.ts:4344, 4391-4392`) — persist them into the evidence store keyed (session, call, ref), and
use the projection only for the counters it can actually see.

**T3 — `unreproduced === 0` is manufactured by never running the check (evidence §8).**
`unreproduced` is set only by a reproduction pass the plan calls "a work item" and does not
schedule, so it is 0 by default and the promotion gate passes by default. The plan guards against
deleting failures to manufacture `failures === 0` and then manufactures `unreproduced === 0`.
Fix: store `unreproduced: null` until the pass exists and refuse promotion while it is null (D11),
or require `failures === 0` outright.

**T4 — `pass` is undefined (evidence §11).** Admission requires a report "whose verdict is
`pass`", but no section states the statistic that makes a report pass, while §10.2 forbids the
rule to conclude causation. The one authority that admits skills therefore has no evaluable pass
or fail condition. Fix: define `pass` as an explicit predicate over the report's numbers (no
family's Δ interval has its upper bound below the MDE; where a reference exists, recovery meets its
pre-registered bound) and make an uncomputable predicate `insufficient`, never `pass`.

**T5 — The Phase 3 lint gate is satisfied by never running it (evidence §14).** "Zero
`error`-severity lint findings" is true of a checker that does not exist — and §17 admits
`verify:skills` does not exist. Fix: the threshold is "`verify:skills` exits 0 with C1–C9 wired
over the registered set", and the gate is `unavailable` until the script exists.

**T6 — The deletion-candidate rule is a bare point estimate (evidence §10.3).** "A row
non-negative across every family" is the sign of a point estimate with no interval, no minimum
detectable effect and no multiplicity correction; a cell of +0.001, or one produced by noise,
marks a helpful skill for deletion, and across a skills × families matrix the chance that at least
one good skill is wrongly marked tends to 1. Fix: deletion only when the cell's interval upper
bound is below the pre-registered MDE; a cell whose interval spans 0 is "no evidence", printed as
such; family-wise correction across the matrix.

**T7 — Definitions that cannot be evaluated (spec §5, §6.3, §7, §8, §9, §10, §14, §17; arch
§0/§5.5).** Each of these is a rule a reader cannot apply: the identity rule is circular as
written (§5.5); "the operator's next message" has no window (§6.3); §7 says retention has "an
explicit number" and never gives it; §8 says "no replay" and then requires a failure "reproduced on
the next three failing uses"; §9 makes `requiresTools` the kind discriminator when it actually
gates **visibility** in the SDK lifecycle; §10 says a positive cell "blocks admission" while
defining no direction for a negative one; §14's "not a syntax error by accident" makes the red-run
rule undecidable; §17's "red half of the §14.6 report" is not persisted anywhere a reviewer can
read. The architecture lens adds that extension skills have no `whenToUse` at all — they register
as `{name, description, content, path, source}` — so §5.5's single "public surface" is really two.
Fix: one definitions pass, one sentence each, no new machinery.

## Majors worth fixing with the blockers

- §1: the CSPD paper has no locator and no in-tree copy, yet eight borrowed numbers are premises
  for §9.2, §10.4, §10.5 and Appendix B. Add a reference entry, a frozen copy path, and mark each
  borrowed number "per that copy".
- §2: goal 3's sentence ("removing it changes family F by D … closes N% of the gap") never defines
  D's unit, N's formula or the reference population.
- §6.1: `call_probe`'s window ("in the session") is the same undefined-window defect as §6.3.
- §10.5: "the short variant matches the long" is defined as a non-significant difference —
  absence of evidence read as equivalence, which ships the cheapest text every time the sweep is
  underpowered.
- §14.4: the rows marked "to be added" are commitments with no owner, date or phase gate that can
  notice they never arrived.
- §14.5: `npm test` tolerance for the known flake is stated as a count with no expiry.

## What the review says the plan gets right

The decisions register (D1–D16) is the part every lens used as an anchor rather than a target.
The `pass | fail | insufficient | evicted | unavailable` vocabulary, the ban on counters as
correctness, the refusal to invent a second store, the parked proposal pass, and §14.6's report
format (red command, verbatim failure, guard name with every null) were not attacked once. The
adversarial weight landed almost entirely on the two places where the plan asks a *measurement* to
do the work of a *mechanism*: arms (§7/§10) and admission (§11).

## Recommendation

1. **Do not start Phase 0 or Phase 4 code until T1, T2, T3, T4, T6 are settled in the text.** Those
   five make a gate or a delta unevaluable; code written against them would be rework.
2. **T1 and T4 need an operator decision, not an edit:** within-deployment arm gating (a real
   render-time seam) versus cross-configuration measurement; and the pass predicate's MDE. I can
   draft both, but the choice changes what the product measures.
3. **T5 and T7 are documentation fixes** — one paragraph each, no new machinery. Do them this
   week.
4. **Re-review after the fixes**: a second pass with the same three lenses on the changed sections
   only. The review files are the record; this synthesis is the index.

## Files

- `v2/spec.md` — 50 findings, section by section.
- `v2/architecture.md` — 36 findings with repo citations.
- `v2/evidence.md` — 47 findings on denominators, gates and null outcomes.
