# Adversarial review — spec/contract lens, plan v2

**Reviewer:** adversary-spec. **Target:** `dsh-tool-mode/docs/reuse-evidence-plan.md` (871 lines, read in full).
**Lens:** is every rule decidable by someone who was not in the room? I hunted undefined terms, unstated
preconditions, MUSTs with no observable, one word used for two things, and requirements that cannot be
told apart from their absence. Read-only: no plan, source or config file was modified. Citations are plan
lines (`:n`) unless a repo path is given; quotes are capped at 20 words.
Verdicts: SOUND / WEAK / BROKEN / UNVERIFIABLE.

## §0 — What changed in v2 (17–43) — **WEAK**

1. **MAJOR** — "unchanged, and now also the vocabulary of the skill report" (`:31`). The row claims one gate
   vocabulary, but §14.6 (`:684`) adds `gap-too-small` and `no-reference` — neither is among the five — and
   §11 adds `admitted-insufficient`. A reader cannot tell whether these are outcomes, sub-reasons of
   `insufficient`, or a second vocabulary. Fix: make them `insufficient(code)` reason codes and say so here.
2. **MINOR** — "the ten review corrections" (`:36`). §15 accounts for three reviews, 12+12+12 findings and 14
   blockers (`:734–736`); "ten" matches no list and no finding is identified by number, so the retention claim
   cannot be checked item by item. Fix: cite an F1–F12 disposition table, or say "the corrections listed in §15".

**Gets right:** the v1-said / v2-says / why table is the only part a returning reviewer can diff without rereading.

## §1 — Background (44–80) — **WEAK**

1. **MAJOR** — "CSPD, Zhang & Yang et al., Nov 2026" (`:49`). No venue, DOI, arXiv id or in-tree copy exists
   (`grep CSPD` matches only this plan), yet eight borrowed numbers are premises for §9.2, §10.4, §10.5 and all of
   Appendix B. No reader of this repository can check any of them. Fix: a reference entry with a locator and a
   frozen copy path, and each borrowed number marked "per that copy".
2. **MINOR** — "one evidence machine, two subjects" (`:79`). "Subject", "class", "artifact" and "ref kind" name the
   same partition: §0 says "Skills are not artifacts" (`:28`) while §5.4 makes `skill` an `ArtifactRef` kind
   (`:172`). Fix: fix "artifact" as any evidence ref, and use "not artifacts *for lifecycle purposes*" once.

**Gets right:** the three threads are independent grounds, so a review can attack one without collapsing the others.

## §2 — Goals and non-goals (81–102) — **WEAK**

1. **MAJOR** — "removing it changes family F by D … closes N% of the gap to expert use" (`:90–91`). Goal 3 is the
   programme's deliverable sentence, and D's unit, N's formula and the "reference" population are never defined;
   §10.3 gives only a sign convention and §10.6 only N's null conditions. Fix: define D as a rate difference in
   percentage points with its interval, and N = (base − treatment)/(base − reference) over one named population.
2. **MINOR** — "every phase has a pre-registered threshold and a null outcome" (`:93`). False for §14.8's Phase 3
   row (a three-item checklist whose "null outcome" is a `fail`) and Phase 6 ("parked", "no proposal ships").
   Fix: state the invariant for phases 0–2, 4 and 5 only.

**Gets right:** goal 1's "without ever claiming 'this works'" is the correct shape for a programme whose counter was falsified.

## §3 — Decisions in force (103–125) — **WEAK**

1. **MAJOR** — "One store, one writer per scope key, append-only" (`:111`). `scopeKey` is load-bearing (D3, D12,
   §5.4, §7's row and merge rule) and never defined; "one writer" names no owner. Two implementers will choose
   different keys and neither can be called wrong. Fix: define `scopeKey` ("global" or the workspace key) and name
   the writer, citing §7's merge rule.
2. **MAJOR** — "the word "working" is banned in reports" (`:110`). "Reports" is not enumerated and no test in §14.4
   or §14.7 asserts an absent word; §8's digest is prose nobody checks. A banned word with no checker is a style
   preference. Fix: name the renderers and add one fixture assertion that the literal "works"/"working" is absent.
3. **MINOR** — "not a new store, vocabulary or promotion path" (`:120`). §11 adds `evaluateAdmission` as a second
   lifecycle and D6 calls it a second authority; as written D12 forbids §11 and a reader cannot tell which wins.
   Fix: amend D12 to admit "a named second lifecycle when the existence floor cannot apply".

**Gets right:** every decision carries a "reopens if" cell, which is the right falsification hook even where it is loose.

## §4 — What this programme is (126–136) — **WEAK**

1. **MAJOR** — "Every number it produces is a **lower bound**" (`:133`). False of `recovery` (§10.6), a ratio
   printed with an interval, and of the pass counts the plan itself reports (§17). The unqualified claim makes the
   section's central posture unfalsifiable. Fix: "every observational count is a lower bound; every ratio prints
   its interval", and delete "number".

**Gets right:** "measurement, not learning" is stated once and the debt it creates is not dressed up.

## §5 — The seams (5.1–5.5) (137–200) — **BROKEN**

1. **BLOCKER** — "A field an agent or operator may edit is either inside the digest … or the evidence is keyed to a
   digest that includes it" (`:184`). The landed skill digest covers renderer, tool, source, body, name,
   description and whenToUse (`skill-contract.ts:105–117`) and omits `requiresTools`, an editable manifest field
   (`extension-manifest.schema.json:239–243`) that decides kind (`skill-contract.ts:60–62`) and gates publication.
   An edit the rule says must change identity does not, and the promised equality test has no enumerated
   "editable fields" to compare against. Fix: include the manifest skill id and `requiresTools` in the digest, or
   declare them immutable in the manifest schema and test that.
2. **MAJOR** — "consumes a pre-registered reference and returns `pass | fail | insufficient | evicted | unavailable`"
   (`:147`). "Gate" also means a phase exit criterion (§14.8), a command exiting 0 (§14.5) and a lint threshold
   (§9.5); none of those consume a reference. With no reference bank (§11) every reference-based gate is
   `insufficient` by construction, and `pass` is never given a meaning. Fix: keep "Gate" for the seam, call phase
   exits "exit criteria", and define `pass` as a predicate over a named reference.
3. **MAJOR** — "a reason string with a number in it" (`:167`). The one stated obligation on Gate output has no
   consumer and no check, and §14.8's own null outcome is `unavailable(reason)` (`:722`), whose reason carries no
   number. Fix: make the output `{code, n?, need?}` and add a report-lint assertion that a non-null outcome carries
   `n` or `need`.

**Gets right:** §5.1's "a source that cannot decide emits nothing — never a zero-strength observation" is unambiguous and testable.

## §6 — Phase 0: signals (201–316) — **BROKEN**

1. **BLOCKER** — "a classifier over the operator's next message" (`:218`). "Next" has no window (same session? next
   user turn? before any later call?) and the plan names no reader for the text: the session-log reader was
   withdrawn (§15 `:754–756`) and the fold is a run-completion projection (§6.2). Attribution point and data source
   are both undefined, so §14.8's 0.90 precision gate measures an unspecified population. Fix: define the window
   ("the next user-role message in the same session before any later tool call, else no label"), record
   `gapTurns`, and name the host surface that supplies the text.
2. **MAJOR** — "At run completion and persisted, not derived later" (`:250`). The correction label exists only after
   the *next* message, while §7 makes the use row append-only, one row per use (`:325–326`). Nothing says which row
   absorbs a late label or when; two writers are implied and D3 permits one. Fix: specify a second append-only row
   (`{kind:'label', ref, turn, at}`) the report joins, and say the use row is never rewritten.
3. **MAJOR** — "a `tool_error` followed by the same tool with a *different* argument-key fingerprint" (`:220`). Keys
   only: the common correction (same keys, corrected value) is invisible, and "followed by" has no adjacency rule.
   The name claims a fix was attempted where the predicate only sees a reshaped call. Fix: define adjacency (next
   call, same session) and rename it `call_retry_reshaped`, stating that value corrections are unobservable.

**Gets right:** §6.2's bounded-receipt argument for computing at run completion is the best-mechanised constraint in the plan.

## §7 — Phase 1: the use store (317–346) — **BROKEN**

1. **BLOCKER** — "Retention with an explicit number" (`:337`). The number is absent here and at §6.4 (`:308`, "a
   retention window per signal row"), so erasure is indistinguishable from unlimited retention and §6.4's cascade
   has no trigger. Fix: one named constant with a value, read from config and printed in every report; a `null`
   window must be refused.
2. **MAJOR** — "`{ref, scope, scopeKey, name, digest, sessionId, arm, outcome, signals[], at, receiptId}`" (`:326`)
   against "**derived from a hash of the session id**, not stored" (`:334`) and D5 (`:113`). The row both carries
   and does not carry `arm`; `outcome` and `signals[]` have no domain, so "when a use fails" (§8) and arm-split
   rates (§10) are not computable from the schema as written. Fix: mark `arm` "materialized, derived, never
   authoritative", and give `outcome ∈ {ok, error, refused, unknown}` and typed signal names.
3. **MAJOR** — "`evidence()` reads it and nothing else, so the two stores never disagree about one number" (`:344`).
   This admits two stores over D3's one, with no statement of who writes `artifact-usage` during phases 0–2, and
   "never disagree" has no enforcement. Fix: stop the `artifact-usage` writes in the slice that starts the new store,
   or state and test the projection rule.

**Gets right:** the list of `artifact-usage` defects (`:319–323`) is specific enough to falsify, which is the right form for a replacement argument.

## §8 — Phase 2: the observed check (347–373) — **BROKEN**

1. **BLOCKER** — "**No replay.**" (`:355`) against §14.8 (`:724`) "an observed check is reproduced on the next 3
   failing uses of the same declaration". After the replay is deleted, "reproduced" has no procedure: nothing says
   whether the same failure class must recur in real use, or which join decides. The Phase 2 exit is
   indistinguishable from satisfied. Fix: restate the exit as "the same failure class observed on three later uses
   of the same `declarationDigest`", name the join, or delete the row.
2. **MAJOR** — "restricted to paths declared in the artifact's own `inputSchema`" (`:351`). Skills have no
   `inputSchema` (§5.4, §10), yet §6.3 says a false correction writes evidence onto "an artifact or a skill"
   (`:285`). The observed check is vacuous for half the programme by construction. Fix: state that observed checks
   are artifact-only and name the skill equivalent (the tool's schema for a tool skill, none for a flow skill).
3. **MAJOR** — "When a use fails, copy up to three argument paths" (`:349`). "Fails" has no predicate on the row and
   "up to three" has no selection order, so two implementers produce different `failurePaths` from the same
   receipts. Fix: define failure as `outcome ∈ {error, refused}` and select the first three schema-valid paths in a
   stated order.

**Gets right:** "the observed check replaces the evidence line, never joins it" is the one rendering rule a test can pin exactly.

## §9 — Phase 3: the skill module contract (374–448) — **BROKEN**

1. **BLOCKER** — "The discriminator is `requiresTools` in the manifest skill declaration" (`:384`). `requiresTools`
   is optional and absent from every shipped skill (`extension-laya/tool-mode.extension.json:145–152`), and bundled
   skills are rendered from catalog + playbook with no manifest skill declaration at all — so no shipped skill is a
   flow skill, C7 has no subject, and `:386`'s "the repo already ships one flow skill of each shape" is contradicted
   by the discriminator it cites. Fix: define the kind for both classes (absent = tool for extensions; catalog
   operations for bundled) and correct or delete the example.
2. **MAJOR** — "the same tool named in skill A's `whenNotToUse` and skill B's `whenToUse`" (`:424`). A skill
   declaration has no `whenNotToUse` (`extension-manifest.schema.json:228–244`; `DescribeSkill` carries only
   `whenToUse`), and §9.5 never says where the lint's two fields come from. The landed input takes them from the
   tool playbook (`skill-contract.ts:176–177`), which makes C1 a statement about tools, not skills. Fix: state the
   provenance in the rule, or drop C1 for the extension class.
3. **MAJOR** — "contradictory recovery directives across skills" (`:426`). The landed rule fires when any skill
   matches the retry pattern and any skill matches the no-retry pattern, including one correct skill that says both
   ("retry once on a transient error, never on a validation error") — `skill-contract.ts:395–404`. "Across skills"
   is not implemented, and "contradictory" is an enumerated two-regex notion whose scope is unstated. Fix: require
   the two patterns in *different* skills and state that only the enumerated directives are covered.

**Gets right:** §9.6 ("it does not measure anything") draws the identifiability/efficacy line in the right place.

## §10 — Phase 4: skill measurement (449–502) — **BROKEN**

1. **BLOCKER** — "cell = Δ rate when that skill is disabled" (`:468`) and "a positive cell … blocks admission to the
   next release" (`:471–472`). The baseline arm, the family assignment, the session floor's unit and the handling of
   `null` cells are unstated; with the floor at 8 most cells are `null`, and "non-negative across every family" has
   no null rule, so neither a deletion nor a regression verdict is decidable. Fix: define the cell as (treated rate
   in family F) − (control rate in F) over §7 rows, floor 8 per arm, and "any null cell blocks a deletion verdict".
2. **MAJOR** — "A skill that only works in one position is not composable and must not ship" (`:481`). "Works" and
   the disqualifying spread have no threshold, and §11's admission conditions never mention order spread, so the
   ship rule has no gate at all. Fix: name the disqualifying pattern (sign change with both cells above the floor)
   and add it to §11.
3. **MAJOR** — "is `null` whenever the base-to-reference gap is below `gapFloor` (default 0.05)" (`:498`).
   `recovery` is goal 3's headline number whose formula, unit and reference population are never defined, so
   `gapFloor`'s units are undefined too and 0.05 cannot be checked. Fix: define recovery and its denominator once,
   in the units of the rates it divides.

**Gets right:** the sign convention ("negative means the skill was helping", `:470`) is the one place the direction of the claim is unambiguous.

## §11 — Phase 5: admission and demotion (503–532) — **WEAK**

1. **MAJOR** — "an explicit `admitted-insufficient` marker with a reason — printed in the release report, never
   silent" (`:512`). The marker has no owner, no storage and no verifier; §14.7's test ("refused unless the marker is
   printed") cannot distinguish a printed marker from an absent one. Fix: make it a release-record field
   `{admission:'admitted-insufficient', reason, principal}` and assert the field, not the print.
2. **MAJOR** — "Holm-corrected across a pre-registered family of one" (`:524`). With one hypothesis Holm is the
   identity: the stated correction cannot change a decision, so the sentence reads as rigour and adds none. Fix:
   delete the clause, or pre-register a family of more than one (order spread, length sweep, family deltas).
3. **MINOR** — "A skill whose row is non-negative across every family becomes a deletion candidate" (`:514`) repeats
   §10.3's verdict rules without reference, so a threshold change must be made twice. Fix: "as §10.3", keeping only
   the admission consequences here.

**Gets right:** "a bundled skill is born global with zero uses" is a real reason the artifact floor cannot apply, and it is stated where the gate is.

## §12 — Phase 6: the proposal pass (parked) (533–569) — **WEAK**

1. **MAJOR** — "the judge may **veto only** … and it must not be the same implementation that produced the labels"
   (`:560–561`). Two MUSTs on a component this section says will not ship, with no owner, test or observable;
   "same implementation" is checkable only by an implementation id the plan never says is recorded. Fix: move both
   to §16 as preconditions, and phrase the second as the observable ("the vetoing implementation id differs from the
   labelling implementation id").
2. **MINOR** — "No proposal pass ships in this programme" (`:538`) while §0 row 5 calls it "Phase 3" and §9 is titled
   "Phase 3", so one phase number names two artifacts. Fix: "the parked pass (§12)" everywhere outside §14.8's table.

**Gets right:** naming the frozen-fixture preconditions is the honest form of parking rather than planning.

## §13 — Not in this programme (570–587) — **WEAK**

1. **MAJOR** — "A model may veto (§12); it may not grade" (`:586`). "Grade" is undefined and observationally
   indistinguishable from the permitted veto (a model score thresholded into a block); the boundary the bullet rests
   on cannot be tested. Fix: define grading as "a model-produced number that enters a report or a gate
   arithmetically", and record a veto only as a block reason.
2. **MINOR** — the section restates §2's non-goals and D1/D2/D12 item for item (weights, suites, second store,
   judge); only "the log is the asset, the learned artifact is a cache" is new. Fix: delete the section, or replace
   it with the deliverables deliberately not built.

**Gets right:** "the log is the asset, the learned artifact is a cache" is the sharpest one-line boundary in the plan.

## §14 — Development method (588–729) — **BROKEN**

1. **BLOCKER** — "not a syntax error or a missing import path by accident" (`:661`). "By accident" makes the red
   run's acceptance a judgement rather than a criterion, and the plan's only recorded red is exactly
   `ERR_MODULE_NOT_FOUND` (§17 `:814`), which this sentence excludes by its plain reading. Fix: require the red to
   fail an assertion, and record a load-time failure as "scaffolding, not the red run".
2. **MAJOR** — "Two runs of it are already on record: the red run … and the two `skill-contract` expectations that were
   wrong about the code" (`:617–619`). A red run and two corrected fixtures are not the mutation check of step 4
   ("remove the behaviour and confirm the test fails"), so the method's central requirement has no recorded instance
   and D16 (`:124`) is unverified. Fix: report one revert result per landed behaviour, or state that the loop is
   incomplete.
3. **MAJOR** — "zero `error`-severity lint findings; every registered skill reports a digest and a token count" with
   null outcome "gate fails naming the finding" (`:725`). A checklist is not a pre-registered threshold, and a
   `fail` is not a null outcome; Phase 6's null outcome is "no proposal ships" (`:728`). This contradicts goal 4
   (`:93`). Fix: give Phase 3 a real threshold and `insufficient(n_reported, need)`, or say it has no gate because
   it has no measurement.

**Gets right:** the command table's "must show" column is the correct way to make a verification step checkable.

## §15 — Review record (730–782) — **WEAK**

1. **MAJOR** — "Adopted without change from that review: the ban on the counter-as-correctness predicate" (`:738`).
   No finding is identified by number, so the v1 review's 12 findings / 5 blockers (`:734`) are not individually
   dispositioned; "every adopted finding is retained" (`:6`) cannot be checked, and a dropped finding looks exactly
   like an unlisted one. Fix: an F1–F12 table with disposition and where it now lives.
2. **MINOR** — "**v2.1 amendment — the call-shape signals (2026-11-21).**" (`:774`) is an implementation/changelog entry
   inside a review record whose counts describe v1 only. Fix: move it to §17.

**Gets right:** the "Not adopted, deliberately" paragraph argues the decision instead of hiding it, which is what a review record is for.

## §16 — Decisions this plan does not make for you (783–798) — **WEAK**

1. **MAJOR** — "Is the session floor (8 distinct sessions) the same number for skills as for artifacts?" (`:795`).
   §14.8 already pre-registers "≥ 8 distinct sessions per arm cell" as the Phase 4 threshold (`:726`), so the plan
   both decides and asks, and the pre-registered number has no decision behind it. Fix: delete §16.5 and record the
   floor as a decision with its "reopens if".
2. **MINOR** — "Does the aggregate skill budget belong to the operator … or to the profile?" (`:793`) while §9.3 ships
   "default 4000" (`:399`): a default with no owner. Fix: record the default as provisional in §3 with a reopen
   condition.

**Gets right:** asking who owns the reference bank is the right open question, because §11 already requires an owner it does not have.

## §17 — Implementation status (799–840) — **BROKEN**

1. **BLOCKER** — "the first run … failed with `ERR_MODULE_NOT_FOUND` … and that output is the red half of the §14.6
   report" (`:814`). §14.5 (`:661`) disqualifies a missing-import failure as the red run, so the only recorded proof
   for the landed slice fails the plan's own criterion and "verified red-first" is not established. Fix: record a red
   that fails an assertion about the digest or a budget, keep that output as the red half, and label the load
   failure as scaffolding.
2. **MAJOR** — "`tests/skill-contract.test.ts` → 26 pass" (`:818`). No mutation-check result appears for any of the
   six landed pieces, though §14.1 step 4 requires one per slice and D16 says a test that does not fail on revert is
   not verification; §14.3 (`:632–636`) says pass counts are not verification. Fix: add the revert results, or report
   the loop as incomplete.
3. **MINOR** — "it is recorded as a pre-existing timing flake" (`:828`). No pre-change run of that suite is cited, so
   "pre-existing" is asserted; §14.5's flake rule (name it, re-run in isolation) is satisfied by a new regression too.
   Fix: cite the parent commit's result or drop "pre-existing".

**Gets right:** "not built yet" is listed explicitly rather than left to inference, and the flake is named rather than buried.

## Appendix A — v1 → v2 section map (841–857) — **WEAK**

1. **MINOR** — "| (new) | §3 … §17 |" (`:856`) omits §1 Background and §2 Goals, which §0 row 10 says are new
   (`:33`). Fix: add §1 and §2 to the new row.
2. **MINOR** — "§12 Phase 6, unchanged content, renumbered" (`:851`). §12's item 3 adds the `replacesDigest`
   requirement and the no-previous-version finding, neither of which was v1 content. Fix: "content plus the review's
   corrections in item 3".

**Gets right:** mapping every v1 section to a v2 home is the right instrument; it needs to be complete rather than approximate.

## Appendix B — what the CSPD paper gave us (858–871) — **WEAK**

1. **MAJOR** — "Nothing here may present a skill's measured effect as a soft prompt's" (`:868`). A MUST with no
   surface: no report field, lint rule or §14.4 row enforces it, and §10.6's `recovery` is one sentence away from the
   86.8% comparison. Fix: add a §14.4 row asserting a `SkillReport` fixture contains no paper number and no
   "distilled capability" wording.
2. **MINOR** — "keep the previous measured version so a regression is visible" (`:870`) contradicts §12
   (`:556–558`): no previous version is retained and "rollback" exists only if a draft stores one. Appendix B claims
   a practice the plan cannot perform. Fix: add the retained previous measured version to §7's rows, or delete the
   borrowed habit.
3. **MINOR** — the "Number" column mixes units and populations (KL-gap %, benchmark points, throughput %, recovery %)
   without labelling them, inviting the comparison the last row forbids. Fix: label each number's unit and
   population, or collapse the column to "borrowed as".

**Gets right:** the negative result is the last row and is stated without hedging.
