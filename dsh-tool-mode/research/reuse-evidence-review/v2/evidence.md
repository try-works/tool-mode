# reuse-evidence-plan v2 — evidence / measurement adversarial review

Reviewer: adversary-evidence. Target: `dsh-tool-mode/docs/reuse-evidence-plan.md` (871 lines),
reviewed in order, one section at a time. Lens: denominators, thresholds, null outcomes, gates
satisfiable by inaction, tests asserting the implementation's own shape, prose-as-signal,
non-exchangeable arms, unreproducible numbers. Register: `research/reuse-evidence-review/evidence.md`;
posture: `docs/tool-mode/evaluation/laya-gates.json`. No builds or tests run; claims are source reads.

Sections are reviewed in order. Counts at the end.

## §0 — What changed in v2 (L17–43) — WEAK
- **MAJOR** — "gate vocabulary was `pass/fail/insufficient/evicted/unavailable` — unchanged" (L31).
  Two of the five states carry the whole honesty posture and neither is defined: `insufficient`
  has no required report shape (n, need, unit), so a report can say "insufficient" with no
  denominator and a reader cannot tell it from "never observed"; `evicted` has none either
  (rows lost, window start), so it is indistinguishable from `insufficient` in the rendered text.
  The plan's own D11 says the two must differ; the vocabulary alone does not make them differ.
  **Fix:** in §0 add the report shape — `insufficient(n=…, need=…, unit=…)`,
  `evicted(rowsLost=…, windowStart=…)` — and make rendering without those fields a test failure.
- **MINOR** — "the only call facts that are both mechanical and new" (L27). "Only" and "new" have
  no denominator: the population of candidate predicates and the count cut from it are stated
  nowhere in this section (the cut list is deferred to §15), so a reader cannot recompute the
  claim, and a later addition of one predicate would silently falsify it.
  **Fix:** state "5 candidate predicates; 3 cut, named here" and keep the count beside the list.
- **Gets right:** the provenance claim is auditable and audits clean — "36 findings, 14 blockers"
  (L5–6) recounts exactly from v1's three files (12 findings each; 6+3+5 blockers), which is
  rare enough to say so; and row 6 refuses to exempt skills from the floor rather than adding a
  gate that cannot fail.

## §1 — Background (L44–80) — WEAK
- **MAJOR** — "four composed prompts at 67.83 against 67.79 for multi-teacher distillation" (L52).
  A 0.04-point difference is presented in the same breath as 67.83 vs 65.17 (2.66 points) and as
  a "result that shaped this plan", with no interval, seed count or significance in either case.
  On the paper's own numbers the 0.04 comparison is almost certainly indistinguishable from zero,
  so the plan imports a null result as a positive finding; a reader cannot reproduce any of the
  six figures — the citation is "Zhang & Yang et al., Nov 2026" with no venue, DOI or arXiv id.
  **Fix:** one resolvable citation (DOI/arXiv + table), and either drop the 0.04 comparison or
  mark it "not distinguishable from zero, and the plan does not rely on it".
- **MAJOR** — "written instructions with the same intent close ≤2.1% of the teacher–student KL gap
  while the prompt closes 86.8%" (L53–55). This is the imported result most adverse to the
  plan's own intervention — skill text — at a ~41× ratio, and the plan never returns to it: §2
  goal 3 still promises gap closure, and no later section sets a minimum detectable effect
  against 2.1%. Either the CSPD setting does not transfer (then the plan owes the argument) or
  it does (then every skill effect is below any floor the programme is likely to set, and the
  gates need an MDE and n computed from it).
  **Fix:** one sentence reconciling the two, plus a pre-registered MDE per skill family with the
  n required to detect it.
- **MINOR** — "11 `SKILL.md` files in extensions" (L76). Recounts as 11 files, but one is
  `tool-mode-extension-sdk/templates/module-extension/skills/your-tool/SKILL.md` — a template,
  not shipped guidance, so the population the plan measures is 10. A one-off count error in the
  paragraph that establishes "nothing measures whether that text helps" weakens the baseline.
  **Fix:** "10 shipped `SKILL.md` files plus one SDK template".
- **Gets right:** Thread 2's use of the falsified counter (61 uses / 0 failures) is the right
  citation shape — named experiment, named artifact, conclusion stated as a permanent ban — and
  Thread 3's "measurement, not learning" budget correctly bounds what the host can support.

## §2 — Goals and non-goals (L81–102) — WEAK
- **MAJOR** — "it closes N% of the gap to expert use" (L91). A gap-closure fraction needs an
  expert reference measured on the same cases; the parenthetical "(only where a reference
  exists)" admits none exists, so N is computable for zero skills today and goal 3 is
  unachievable as written. Worse, the qualifier turns an undefined metric into an optional one,
  so the goal can be "met" by a report that never mentions N.
  **Fix:** replace with the two reportable quantities — `tokens=T` and `D` with its interval or
  `insufficient(n, need)` — and state that gap closure is out of scope until the reference bank
  in §14/§17 has an owner and a path.
- **MINOR** — "a store that can answer 'did anything change'" (L85–86). No baseline or window is
  specified, so "changed" is relative to whatever the reader picks: yesterday, the previous
  digest, or the whole history. Two reports can both be correct and disagree.
  **Fix:** name the baseline in the goal (previous declaration digest, trailing N days) so the
  answer is a function of stored fields.
- **Gets right:** goal 4 states the null/zero distinction as a goal, and the non-goal list bans
  the two contamination routes this kind of store usually takes — LLM-judge ground truth and
  synthetic-suite scores merged into observational counts.

## §3 — Decisions in force (L103–125) — WEAK
- **MAJOR** — "A semantic rule proves precision ≥ 0.9 on a labelled set" (L122). A bare point
  estimate: no n, no lower bound, no independence between labellers and rule authors. At n=10,
  9/10 carries a one-sided 95% lower bound near 0.66, so the reopen condition would fire on
  evidence far below the bar it advertises; at n=200 a point estimate of 0.90 is still ~0.85 at
  the bound. This is the exact failure the plan criticises elsewhere.
  **Fix:** "one-sided 95% Clopper–Pearson lower bound ≥ 0.90 over ≥50 double-labelled cases
  generated after the rule was frozen; publish the interval, not the estimate."
- **MAJOR** — "Arms are derived from a hash of the session id, never stored" (L113). The decision
  fixes the assignment mechanism but not the unit of analysis. Outcomes are per call, arms are
  per session: that is a cluster design, and analysing calls as independent observations
  understates the interval by roughly the design effect (~1 + (m−1)ρ). D5 as written licenses the
  wrong test.
  **Fix:** append "analysis is at session level (cluster-robust difference or session-level
  permutation); arm sizes are published with every ablation report."
- **MINOR** — "Receipts are capped at 200 in memory and on disk" (L115). The cap is correctly
  identified as a loss mechanism, but no decision requires the loss to be counted, so the
  "lower bound" never reports its own tightness, and selective loss (long sessions evict early
  receipts) biases composition metrics in an unstated direction.
  **Fix:** require `receiptsDropped` and the session-length distribution of drops in every report.
- **Gets right:** D11 (`null ≠ 0`, `evicted ≠ insufficient`) states, as a permanent decision with
  no reopening, the distinction v1's review demanded — and D9's `unreproduced === 0` correctly
  keeps a non-reproducing failure from being deleted into a manufactured zero.

## §4 — What this programme is (L126–136) — WEAK
- **MAJOR** — "Every number it produces is a **lower bound**" (L133). False for the numbers later
  phases actually produce: a ratio of two undercounts is not a bound (bias direction unknown),
  a gap-closure fraction is a point estimate, and a precision from a labelled sample is an
  estimate with an interval. The sentence also over-reads its source, which says "treat every
  number as a hypothesis", not "lower bound".
  **Fix:** "every **count** is a lower bound and the report states the drop rate; every **ratio or
  contrast** is a point estimate with an interval and is never called a bound."
- **MINOR** — "refuses to claim anything the data cannot support" (L129). A policy with no
  enforcement point: nothing in the plan names what rejects an over-claiming report, so the rule
  is satisfied by the author's restraint. It is the same shape as the gates this plan is
  designed to avoid.
  **Fix:** name the enforcement — one renderer with a closed set of output shapes and a test that
  an unbacked claim cannot be rendered.
- **Gets right:** the section states plainly what the programme is not (no proposal loop, no
  training pipeline) and inherits the "treat every number as a hypothesis" discipline from the
  programme it extends.

## §5 — The seams (L137–200) — WEAK
- **MAJOR** — "a reason string with a number in it" (L167). The five-state gate contract is a
  string, so nothing can check that `insufficient` carries n and need or that `evicted` carries
  what was lost; the constant `"0"` satisfies "a number", and a report is auditable only by
  reading the gate's source. The section's own insistence that "no data" and "no regression"
  differ is unimplementable from this interface.
  **Fix:** the gate returns a record — `{state, n, need, unit, statistic, interval?, referenceId,
  rowsLost?}` — and `insufficient` without `need` is a type error, not a style preference.
- **MAJOR** — "the model is an *input hash*, not the subject of measurement" (L179–180) against
  "the catalog-entry digest" inside the skill digest (L195). Whether model identity is inside
  the declaration digest is undecidable from this section, and the readings have opposite
  consequences: inside, every model bump retracts all skill evidence; outside, the skill's
  measured effect is pooled across a model mix that is plausibly larger than the effect
  being measured. A reader cannot tell which experiment §10 will report.
  **Fix:** state that model identity is recorded on the row as a stratifier and is *not* in the
  digest, and that ablation is reported per model family (or model as a covariate), never pooled.
- **MINOR** — "A test asserts that set equals the set of editable declaration fields" (L191).
  If both sides derive from the same declaration registry the test cannot fail; the section
  never says where the editable set's ground truth lives, so it cannot be distinguished from
  a tautology. This is the lens's named hazard — a test asserting the implementation's shape.
  **Fix:** the editable set is a test-local literal the digest function does not import, plus a
  mutation check: adding a field to the type alone must turn the test red.
- **Gets right:** "A source that cannot decide emits nothing — never a zero-strength observation,
  because a zero is indistinguishable from 'not observed' downstream" (L154–156) is the correct
  primitive, and §5.2's refusal to let the two rules share a denominator is the right instinct.

## §6 — Phase 0, signals (L201–316) — WEAK
- **MAJOR** — "names a tool with no prior `tool_mode_describe` for it in the session" (L219).
  This reads a *missing* event as a behaviour, which the plan forbids two rows above
  (`unexplained`: no edge "may not be read as 'not consumed'"). It is crossed by the 200-receipt
  cap the plan itself relies on (D7), by knowledge carried from a previous session, and by a
  describe issued under a different name. No unit or denominator is given — per session, or per
  naming — so probe counts are not comparable between a 5-call session and a 50-call session.
  **Fix:** unit = first naming of a tool in a session, emitted only when the session's receipt
  count is below the cap; report probes as a rate over naming events, and count unattributable
  cases as their own column rather than dropping them.
- **MAJOR** — "A `stateVersion` bump re-folds to `null`, which is correct for a cache" (L256–257).
  The projection is the only durable record of signals once receipts are pruned, so a bump (or a
  refold whose session history was disposed) discards evidence and renders it exactly as "never
  measured" — precisely the `null` vs `evicted` confusion D11 exists to forbid.
  **Fix:** a bump writes `evicted(reason: stateVersionBump, rowsLost=n)` per ref; `null` is
  reserved for "no session has ever been observed for this ref".
- **MAJOR** — "one-sided lower bound on `correction` precision is published; below 0.90" (L287–288).
  The shape is right and is the model D14 should have copied (lower bound, n ≥ 50), but the
  confidence level is unstated and the sample's frame is unstated, so the gate cannot be run:
  at n = 50, 47/50 gives a one-sided 95% Clopper–Pearson lower bound of ≈0.86 and fails, while
  the same data at a 90% level passes. "Double-labelled" also fixes nothing without an
  agreement floor, so the sample may be wrong in the same way twice.
  **Fix:** fix the level (95%), draw a random frame from the trailing window, require a stated
  inter-labeller agreement (e.g. κ ≥ 0.7) before scoring, and publish n beside the bound.
- **Gets right:** the cut list in §6.1 is real evidence discipline — two cut predicates are shown
  to re-derive an existing observation or to judge prose — and §6.4's cascade (a forgotten
  session retracts the check it produced; the pointer is declared retained personal data) is the
  correct lifecycle for a label derived from the operator's own words.

## §7 — Phase 1, the use store (L317–346) — WEAK
- **MAJOR** — "`position` is the ordinal of the skill among the injected set, which is what makes
  order sensitivity (§10.4) a query rather than an experiment" (L329–331). Position is a function
  of the injected set, so it co-varies with composition: an order effect is indistinguishable
  from a which-skills-were-present effect, and the "query" answers a question it cannot identify.
  **Fix:** rotate injected order by a hash of the session id (the arm mechanism already in D5), so
  position varies within a fixed set and the effect is a within-set contrast.
- **MAJOR** — "one row per **use**" (L325). "Use" is never defined (a call? a session–tool pair? a
  consumption event?), and rows carry no weight, so every gate's n is a row count whose unit a
  reader cannot reproduce; a 40-call session contributes 40 rows but one independent unit, which
  is the cluster problem D5 leaves unstated. Two operators quoting "n" will mean different things.
  **Fix:** define a use as one receipt joined to one ref, and require every gate report to print
  rows and distinct sessions side by side.
- **MINOR** — "Retention with an explicit number" (L337). The bullet promises a number and omits
  it, so the eviction horizon this section makes load-bearing cannot be reproduced from the plan.
  **Fix:** give the number in the bullet (rows, days, or both) and name the eviction order.
- **Gets right:** "It is **never** the acceptance reference" (L342–343), with the store
  authoritative only for counts, is the guardrail v1 needed; and making `evicted` a distinct
  outcome rather than letting an evicting store report "not enough data" forever is D11 done
  properly.

## §8 — Phase 2, the observed check (L347–373) — BROKEN
- **BLOCKER** — "Promotion additionally requires `unreproduced === 0`" (L362–363). `unreproduced`
  is set only by a reproduction pass the plan itself calls "a work item with a reference bank
  (§12)" (L357) and does not schedule. Until it does, every failure is `unreproduced = 0` and the promotion gate is
  satisfied by default. The plan guards against deleting failures to manufacture
  `failures === 0` and then manufactures `unreproduced === 0` by never running the check.
  **Fix:** store `unreproduced: null` until the pass exists and refuse promotion while it is
  `null` (D11), or drop the allowance and require `failures === 0` outright.
- **MAJOR** — "the observed check **replaces** the evidence line, never joins it" (L368–369) read
  with "the evidence line is already suppressed whenever a verification note exists". The
  precedence is unstated: if the note wins, the check is invisible on exactly the curated
  artifacts; if the check wins, an operator's verification note is suppressed. Either way
  what is rendered is selected by something other than the evidence. "A red-first test asserts
  the worst-case digest length" is also a length-only assertion, satisfiable by a truncated clause.
  **Fix:** state the precedence (check > note > evidence line) and assert the clause contains its
  failure class and path, not just that the digest fits the budget.
- **MINOR** — "copy up to three **argument paths**" (L349). The cap has no selection order and no
  rendered "n omitted", so a failure mode at the fourth path renders as if it were the only one.
  **Fix:** fix the ordering (schema order, or sorted) and render `+k more`.
- **Gets right:** "**No replay.**" is correctly reasoned — replay needs stored values the store
  will not keep or a transcript that expires with the log — and keying the evidence to
  `declarationDigest` so it cannot survive an edit to the note it sits next to is the right
  identity rule.

## §9 — Phase 3, the skill module contract (L374–448) — WEAK
- **MAJOR** — "`perSkill` (default 1200 tokens) and `aggregate` (default 4000 across injected
  skills)" (L398). Neither number is derived from anything, and the corpus already violates the
  first: `decision-decomposition`, the plan's own example at L386, is 5405 bytes ≈ 1352 estimated
  tokens by §9.3's formula (>1200 even with its 4-line frontmatter stripped, ≈1291). Nothing
  enforces it because `verify:skills` does not exist. A cap its named example already exceeds and
  no script checks is not a budget. The `ceil(utf8Bytes / 4)` estimator also under-counts any
  non-Latin body, so the error direction is known and unmeasured.
  **Fix:** derive `perSkill` from the current corpus (report p50/p95 and the headroom chosen),
  derive `aggregate` from the host context budget as a percentage, and calibrate the estimator
  against a real tokenizer on the 11 bodies, publishing estimated versus actual.
- **MAJOR** — "two skills with a near-identical `whenToUse` line after normalization" (L425) and
  "contradictory recovery directives across skills" (L426). The shipped checks are exact equality
  after trim/lowercase/whitespace collapse (`skill-contract.ts:274-276`) and two regexes covering
  five retry phrasings against three no-retry phrasings (`:278-279`). So C2 misses a reworded
  duplicate and C3 misses "avoid retrying" — at `error` severity, where a build fails. The stated
  rule is broader than the implemented one and neither precision nor recall is measured.
  **Fix:** state each predicate exactly in §9.5 and either measure the catch rate on a labelled
  pair set or hold these at `warn` until that set exists.
- **MINOR** — "The repo already ships one flow skill of each shape" (L385–386). The examples are a
  tool skill (`identify-language`, 60 lines, one tool) and a flow skill (`decision-decomposition`,
  113 lines); the label contradicts §9.1's own discriminator. Both line counts verify exactly.
  **Fix:** "one of each kind".
- **Gets right:** §9.6's "It does not measure anything" keeps a product change from being booked as
  evidence, and making C8 `comment`-only respects D14's advisory rule instead of letting a cosine
  score fail a build.

## §10 — Phase 4, skill measurement (L449–502) — BROKEN
- **BLOCKER** — "the treatment arm and the control arm of §7" (L456) and "Δ rate when that skill
  is disabled" (L468). Nothing in §7 or here says the arm decides whether the skill body is
  *rendered*: `arm` is derived from the session hash and `skillEnabled` is a recorded field, so
  if the arm is only a label then both arms received the skill, every Δ is exactly 0, and 0 is
  classified below as "not helping". The entire phase would return "every skill is a deletion
  candidate" — a null by construction that looks like a finding.
  **Fix:** state that the arm gates injection at render time, and add the test: a control-arm
  session renders no skill body while its tool stays registered.
- **BLOCKER** — "A row non-negative across every family is a deletion candidate" (L471). The
  rule is the sign of a point estimate: a cell of +0.001, or one produced by pure sampling
  noise, makes a shipped skill a deletion candidate, and over a skills × families matrix the
  chance that at least one genuinely helpful skill is wrongly marked tends to 1. The cells also
  carry no interval, and the matrix is many comparisons with no correction.
  **Fix:** deletion candidate only when the cell's interval upper bound is below the MDE
  (equivalently, absence is measurably worse), with the MDE pre-registered and a family-wise
  correction across the matrix; a cell whose interval spans 0 is "no evidence", printed as such.
- **MAJOR** — "A skill whose short variant matches its long variant ships short" (L489).
  "Matches" is undefined and is evidently a non-significant difference — absence of evidence
  read as equivalence. That is the reading that ships the cheapest text every time the sweep is
  underpowered, which at three lengths per skill it will be.
  **Fix:** pre-register an equivalence margin and require the 95% interval inside it (TOST);
  otherwise report "not distinguished at this n" and ship the long form.
- **Gets right:** §10.6 inherits `laya-gates.json`'s posture correctly — coverage gated, accuracy
  reported with intervals, no threshold tuned on its own fixture — and §10.2's "observed with the
  skill enabled, never 'the skill did this'" is the right ceiling on an observational claim.

## §11 — Phase 5, admission and demotion (L503–532) — BROKEN
- **BLOCKER** — "requires either a `SkillReport` whose verdict is `pass`" (L511). `pass` is never
  defined: §10.6 says verdict is "the §5.3 vocabulary with reasons" and §10.2 forbids the rule to
  conclude causation, so no section states what statistic makes a skill report `pass`. The one
  authority that admits skills therefore has no evaluable pass condition — and no evaluable
  `fail` condition either.
  **Fix:** define `pass` as an explicit predicate over the report's numbers (e.g. no family's Δ
  interval has its upper bound below the MDE, and `recovery` meets its bound where a reference
  exists), and make an uncomputable predicate `insufficient`, never `pass`.
- **MAJOR** — "or an explicit `admitted-insufficient` marker with a reason" (L512). A universal
  bypass: every skill can be admitted by printing a reason, so the gate is satisfied by writing
  a sentence. That is the "gate that cannot fail" shape this section says v1's review killed,
  reintroduced one paragraph below the claim.
  **Fix:** bound the marker (only a skill below the session floor, at most once, auto-expiring
  after one release, counted in the release report), and refuse admission of a skill that has
  enough data and no `pass`.
- **MAJOR** — "minimum 6 pairs" (L523). At n = 6 the one-sided exact test can only pass at 6/6
  (p = 0.016), whose power against the programme's own 0.90 target is 0.9^6 ≈ 0.53 — a coin flip
  against the effect it is meant to certify, while the CP lower bound at 6/6 is 0.607, not 0.90.
  **Fix:** state the power at the target effect and set n from it (10 pairs gives ≈0.95 power
  against 0.90); label any lower n as "can only reject a perfect effect".
- **Gets right:** "What the bank must never be" (L529–531) is exactly right — not the card's own
  history and not positives-only — and admission without a bank being `insufficient` "by
  construction" is the honest null rather than a plausible number.

## §12 — Phase 6, the parked proposal pass (L533–569) — SOUND
- **MINOR** — "the judge may **veto only** — a model's 'loss' can block a promotion" (L560–561).
  Veto-only is directionally safe, but a filter that can only block has an unmeasured
  false-block rate and no cost when it is wrong; "must not be the same implementation that
  produced the labels" controls correlation, not accuracy.
  **Fix:** report the veto rate against the pre-registered bank alongside the promotion rate, and
  refuse to run the judge while that rate is unmeasured.
- **Gets right:** every precondition is a named, checkable artifact (frozen two-snapshot fixture,
  bank with owner and path, one authority, a restore path that stores the incumbent bytes), and
  parking the phase instead of planning it is the correct response to "the gate could not be
  built as described".

## §13 — Not in this programme (L570–587) — WEAK
- **MAJOR** — "LLM-judge scores as a measurement. A model may veto (§12); it may not grade" (L586).
  §6.3's `correction` label is a model judgement over the operator's words that creates a durable
  observed check rendered to future callers — a third role the two-way carve-out (veto yes, grade
  no) does not cover. Either the label is grading or the taxonomy is incomplete; as written the
  section's boundary contradicts the phase that ships above it.
  **Fix:** name the third role — "classify: advisory, may create an observed check, may never gate
  or promote" — in §13 and in §6.3's table row, or drop the lane.
- **Gets right:** excluding weight-level learning and idle preparation against the host's actual
  limits (no trainer, no job model) is honest scope, and "the log is the asset, the learned
  artifact is a cache" is the right framing for a programme that cannot train.

## §14 — Development method and phase gates (L588–729) — BROKEN
- **BLOCKER** — "zero `error`-severity lint findings" (L725). The gate is satisfied by never
  running the lint, and by the plan's own status section it is never run: "`verify:skills` does
  not exist, so the lint cannot fail a build" (§17, L835). Zero findings from a checker that does
  not run is the cleanest example of the failure this plan exists to prevent.
  **Fix:** the Phase 3 threshold is "`verify:skills` exits 0 with C1–C9 wired over the registered
  set", and the gate is `unavailable` until the script exists.
- **MAJOR** — "order spread reported with the arrangements named" (L726). A pass condition that
  any output satisfies: printing three numbers is not a result. Phase 4's threshold is the only
  row with no numeric criterion, and it is the row the phase's product claim rests on.
  **Fix:** pre-register a spread bound or an interval-overlap rule, and make "reported" a
  precondition of that numeric gate rather than the gate.
- **MAJOR** — "≥ 8 distinct sessions per arm cell" (L726), "≥ 8 distinct sessions per
  `ArtifactRef`" (L723), "the next 3 failing uses" (L724). All three floors lack a power basis;
  the 8 traces to `laya-gates.json`'s "8 held-out items", which that file labels small and pairs
  with an interval requirement — a fixture limit, not a readability floor. Eight sessions at a
  few calls each leaves ±20 pp on any rate, so "readable" arrives before it is true; and Phase 0's
  null outcome "programme stops" makes a data shortfall terminate the programme, which D11 says
  `insufficient` must never do.
  **Fix:** state the MDE and derive n (or label 8 as "below this, nothing is reported — not the
  point at which a rate becomes a measurement"), keep intervals on every rate, and split
  `insufficient` (wait) from `fail` (stop).
- **Gets right:** §14.6's report contract — every number with its command, every `null` with the
  guard that produced it — is the strongest evidence rule in the plan, and §14.2's mutation check
  with the refusal to count `oxlint-not-found` as clean is exactly the register everything else
  should be held to.

## §15 — Review record (L730–782) — WEAK
- **MAJOR** — "the deletion of unreproducible evidence" (L739). The review record says deletion was adopted without change; §8 and D9 retain and count it, and D9's reopening is "Never". An implementer who follows §15 deletes the evidence and manufactures `failures === 0` — the exact outcome the plan says it forbids.
  **Fix:** strike the phrase (the review deleted the *replay*, not the evidence) or cite the v1 finding it refers to.
- **MINOR** — "print large numbers over one-point gaps" (L768–769) beside "gapFloor (default 0.05)" (L499). The section names small denominators as the danger, then uses a five-point floor with no derivation; at the floor a one-point Δ still renders "20% of the gap closed".
  **Fix:** gate on the absolute gap (≥ 15 points) and print Δ in points next to the ratio.
- **Gets right:** all three v1 counts verify exactly (12/5, 12/3, 12/6 → 36 findings, 14 blockers), and "rejected as unverified rather than chased" is the correct treatment of an input the tree does not contain.

## §16 — Decisions this plan does not make (L783–798) — WEAK
- **MAJOR** — "Is the session floor (8 distinct sessions) the same number for skills as for artifacts?" (L795). §14.8 lists the same 8 as a "pre-registered threshold"; a threshold cannot be both fixed before measurement and an open policy question in the same document.
  **Fix:** fix it in §14.8 and delete the question, or mark it provisional and forbid any report from citing it as pre-registered.
- **Gets right:** naming the reference bank's owner and path as a requirement, with the consequence stated (Phases 5–6 unauditable without it), is the right way to leave a decision open.

## §17 — Implementation status (L799–840) — WEAK
- **MAJOR** — "failed with `ERR_MODULE_NOT_FOUND`" (L814). §14.5's own rule is that a red run must show "a failure naming the missing behaviour, not a syntax error or a missing import path by accident"; the programme's only recorded red run is the exception the rule names, and §17 offers it as the red half of the report.
  **Fix:** revert one behaviour now that the module exists and capture the assertion failure; keep the module-not-found run as chronology, not verification.
- **MAJOR** — "recorded as a pre-existing timing flake rather than a regression" (L828). Nothing offered supports "pre-existing": passing in isolation and not reading the skill config show the failure is *unrelated*, not *older than this change*. §14.2 also forbids fixed sleeps while naming this 600 ms sleep, so the waiver runs against the method.
  **Fix:** call it unattributed, replace the sleep with poll-and-deadline in the same change, or list it with an owner and an expiry.
- **MINOR** — "4084 tests, 4058 pass, 25 skipped and **one** failure" (L823–824). The arithmetic reconciles (4058+25+1=4084), but §14.6 requires every number to carry its command; no command, commit or timestamp is given, so the run is not reproducible.
  **Fix:** record the command, commit and date beside the counts.
- **Gets right:** the "Not built yet" block names the unmet Phase 3 gate (digest unreported, `verify:skills` absent) instead of letting a reader infer completion, and refusing to claim a lint result from `oxlint-not-found` is precisely the honesty posture `laya-gates.json` asks for.

## Appendix A — v1 → v2 section map (L841–857) — UNVERIFIABLE
- **MAJOR** — "every adopted finding is retained" (L5–6), with this map as the evidence. The plan cites no v1 finding id anywhere (grep: zero occurrences of `F<n>`), so the disposition of all 36 findings — and of 14 blockers in particular — cannot be audited from the artifact. The map gives locations, not adopt/refuse decisions.
  **Fix:** add a 36-row finding-id → v2-section → disposition table, or delete the retention claim.
- **Gets right:** the map is complete (v1 §0–§10 all mapped) and names which v2 section supersedes each v1 section, which is what a reviewer needs to diff behaviour rather than prose.

## Appendix B — what the paper gave us (L858–871) — WEAK
- **MAJOR** — "86.8% of the KL gap by prompt vs ≤2.1% by same-intent text" (L868) against "gapFloor (default 0.05)" (L499). The report's smallest printable gap is 2.4× the entire text effect the paper measured, so `recovery` is null by design for every text skill and 0.05 has no basis beyond roundness.
  **Fix:** state in what units, and why a KL-distillation gap does not bound skill guidance — or scale the floor to the measured 2.1%.
- **MAJOR** — "removing Math costs 6.5 points on GPQA; removing Science costs 1.1" (L866) against "a positive cell in a family other than the skill's own is a regression and blocks admission" (L472). The source's cross-family leakage is ~1.1 points; at 8 sessions per cell an observational rate cannot resolve 1 point, so a sign-only rule fires on noise.
  **Fix:** give the cross-family rule a minimum effect and an interval test, not a sign.
- **Gets right:** tabulating the adverse result in the same table as the borrowed ones — and calling it "the boundary of this plan" — is the honest way to carry a paper into a plan.

## Counts
| severity | count |
| --- | --- |
| BLOCKER | 5 |
| MAJOR | 30 |
| MINOR | 12 |
| **total** | **47** |

Verdicts (20 sections): SOUND 1 (§12) · WEAK 14 · BROKEN 4 (§8, §10, §11, §14) ·
UNVERIFIABLE 1 (Appendix A).

**Verdict:** accept-with-fixes. The plan's honesty machinery is unusually good — the report
contract, the null/zero rule, the cut lists — and its weakest points are exactly where the
machinery is asserted rather than mechanised: gates whose pass condition is a printed line
(§8, §11, §14), thresholds with no denominator (§11, §14), a statistic whose arms may not be
wired to the thing they compare (§10), and a red run that fails for the reason the method
forbids (§17).
