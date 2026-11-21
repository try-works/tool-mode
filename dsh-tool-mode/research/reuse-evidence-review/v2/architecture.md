# Reuse evidence plan v2 — architecture / feasibility review

Lens: does each section fit the real tree, and can the seams carry what is put on them. Every
citation below was read in this checkout; a claim I could not check in one read is marked
UNVERIFIABLE and is itself a finding. Register follows research/reuse-evidence-review/architecture.md (v1).

Verdict vocabulary: SOUND / WEAK / BROKEN / UNVERIFIABLE.

### §0 — What changed in v2 (17-43)

**Verdict: WEAK**
- **MAJOR** — "the digest is over that plus its inputs ... The skill's public surface is
  `DescribeSkill`" (plan:25). `DescribeSkill` is `{name, description, whenToUse}`
  (`discovery-describe.ts:85-89`) and is produced only for model-backed catalog skills; an
  extension skill is registered as `{name, description, content, path, source:'extension'}` with
  **no `whenToUse` at all** (`index.ts:5965-5973`, manifest `ManifestSkill` =
  id/name/description/path/requiresTools, `tool-mode-extension-sdk/src/manifest.ts:137-143`).
  The row asserts one public surface for a class that has two. Fix: state the digest covers the
  union — `DescribeSkill` for bundled skills, `{name, description, body}` for extension skills —
  and let §5.5's test assert per-source, not per-class.
- **MINOR** — "signals additionally carry two call-shape predicates ... over the same receipts"
  (plan:27). `call_probe` is an ordering fact over `tool_mode_describe`, and a receipt carries
  `contract`, `implementationId`, `argumentPaths` — no field names the tool a discovery call
  described (`receipt.ts:38-115`); `kind:'discovery'` exists (`:88`) but not the subject.
  UNVERIFIABLE as a receipt predicate. Fix: say where the (described tool, call id) pair lives
  before the row claims receipts suffice.
- **MINOR** — the table's "the same store, with skill rows carrying `skillEnabled`, `position`
  and `tokens`" (plan:26) records as settled a store that §7 still schedules; `artifact-usage`'s
  row has none of those fields and cannot take them without the migration §7 describes
  (`artifact-usage.ts:42-56`). Fix: "the same *planned* store (§7)".

**Gets right:** it is an honest diff table — three of the eleven rows name a real in-tree anchor
(`discovery-describe.ts:85`, the receipt bound, `evaluatePromotion`) and it states the renames.

### §1 — Background (44-80)

**Verdict: WEAK**
- **MINOR** — "11 `SKILL.md` files in extensions" (plan:76). There are 11 `SKILL.md` files in the
  repo but one is the SDK template (`tool-mode-extension-sdk/templates/module-extension/skills/your-tool/SKILL.md`),
  so 10 ship; `extension-laya` ships `decision-decomposition` and `extension-ear-recipe` ships
  `identify-language` (both 60/113 lines, exactly as §9.1 says). Fix: "10 shipping skills plus the
  SDK template" — the template is a fifth place a stale claim can hide.
- **MINOR** — "A card that is wrong is a warn-and-drop log line (`index.ts:5928-5932`)"
  (plan:77). That window is the *disabled-by-configuration* info line (`:5928`) and the
  *declares-no-skill* warn (`:5931-5933`); a malformed body is dropped at `:5957-5963` /
  `:5974-5980`. The claim is right, the citation lands on the wrong two branches. Fix: cite
  `index.ts:5903-5981` for the drop path.

**Gets right:** it names the real asymmetry — `renderSkillBody` produces a body per catalog tool
(`skills.ts:26`) and nothing anywhere measures it; that is true and is the reason Phase 3+ exists.

### §2 — Goals and non-goals (81-102)

**Verdict: SOUND**
- **MINOR** — goal 3 asks for "closes N% of the gap to expert use" (plan:90-92) as one of five
  goals, while §11 concedes that without a reference bank the verdict is `insufficient` by
  construction (plan:526-527). A goal that cannot be met by any phase in the plan is a wish. Fix:
  demote to "where a pre-registered reference exists" in the goal line itself, as §10.6 already does.

**Gets right:** "a second evidence store / a second promotion authority" are named as non-goals
(plan:100-101) and D12 gives them a test — that is the discipline the v1 review asked for.

### §3 — Decisions in force (103-125)

**Verdict: WEAK**
- **MAJOR** — "one test asserting digest fields == editable fields" (plan:112), and §5.5 repeats
  "adding a field without adding it to the digest fails the build". The editable surface is a
  TypeScript interface (`ArtifactDigestInput`, `agent-authoring.ts:1168-1174`) and interfaces are
  erased; the only runtime key list is the authoring tool's published input schema
  (`authoring-surface.ts:131-163, 670`), which also carries non-declaration keys (`scope`,
  `scopeKey`, `force`, `expectedRevision`). "Equals" is therefore not implementable; "every digest
  field is a declared input property" is, and it still catches the real defect (a digest field
  missing from the tool) without failing on keys that are not declaration. Fix: state the weaker
  direction and name the anchor (the tool's input schema), not the interface.
- **MINOR** — D5 "Arms are derived from a hash of the session id, never stored" (plan:113) is
  contradicted by §7's own row shape (plan:326 names a per-use row of ref, scope, scopeKey,
  name, digest, sessionId, arm, outcome, signals, at, receiptId). If `arm` is written into a row it **is**
  stored, and the rationale ("cannot be rewritten by a later pass") stops being structural. Fix:
  drop `arm` from the row and recompute it from `sessionId` at every read — the hash is cheap and
  it makes D5's claim true.

**Gets right:** D3's evidence is exact — `artifact-usage` really has no scope, 100 sessions,
  3 failure classes and a whole-file rewrite (`artifact-usage.ts:23-31, 42-56, 173-185`), so
  "a store, not a field" is the correct call.

### §4 — What this programme is (126-136)

**Verdict: SOUND**

- No findings. The lower-bound framing and its citation (`docs/adoption-improvement-plan.md:42-43`)
  are used consistently in §14.8 and §12, and "not a proposal or self-improvement loop" matches
  the parked §12.

**Gets right:** it refuses the framing the repo already falsified rather than restating it.

### §5 — The seams (137-200, incl. 5.1-5.5)

**Verdict: WEAK**
- **MAJOR** — the skill ref cannot join anything: `{kind:'skill', …}` over toolName, skillName,
  declarationDigest and scopeKey (plan:177-179). A receipt carries `contract`,
  `implementationId`, `artifactScope/Name/Digest` and never a skill (`receipt.ts:38-115`), and the
  session event subset carries `name`, `callId`, `isError` only
  (`tool-usage-projection.ts:254-288`). So no observation in §5.1 can name a skill, and §10.2's
  "skill evidence rule" has no key to group by. Fix: make the observation about the *tool call*
  and put the injected-skill set on the use row (`skillsInjected: [digest...]`) — the arm is then
  a property of the row, not of the observation.
- **MINOR** — `scopeKey` in `ArtifactRef` is the receipt's `artifactScope` under a second name
  (`receipt.ts:109-114`). Two spellings of one fact is how digests drift. Fix: reuse
  `artifactScope`/`scopeKey` consistently or state the alias in one place.
- **MINOR** — `Gate` adds a third outcome vocabulary beside `E_SCOPE_UNKNOWN`-`E_FORCE_TO_GLOBAL`
  (`artifact-promotion.ts:179-211`) and `withheld.code` (`publication.ts:231-247`), with no
  mapping rule. Fix: one table, `code → gate outcome`, or the report will print three words for
  "refused".

**Gets right:** the seam list is genuinely minimal — three interfaces, one of which (`Gate`) has a
  null outcome, which is the property v1's review found missing everywhere.

### §6 — Phase 0 signals (201-316, incl. 6.1-6.4)

**Verdict: BROKEN**
- **BLOCKER** — "The fold is registered as a **session projection** ... so the host's stored-history
  restore fills it" (plan:253-256). A projection folds `SessionEvent`s, and the event subset this
  host folds carries `turn/step/callId/name/arguments/isError/error.code/content` — no `dataFlow`,
  no `artifactId`, no `receiptId` (`tool-usage-projection.ts:254-288`). `consumed` and
  `unexplained` are therefore **unreachable** from the projection, and a re-fold from the log can
  never recover them. The section's own premise (receipts are bounded, `receipt.ts:35`) is right
  and its conclusion is wrong. Fix: persist the signal where the receipt is built — the
  `recordAuthoredRun`/composition path already has the report and the edges
  (`index.ts:4344, 4391-4392`) — into the evidence store keyed `(session, call, ref)`; use the
  projection only for the counters it can actually see.
- **MAJOR** — "the host dispatches the implementation behind the `decision.choose` contract ...
  (`extension-dispatch.ts:205,239`)" (plan:263-265). The dispatch is real, but
  `createDispatchForContract` needs a `DispatchEnvironment` built by `environmentFor(extensionId)`
  **inside the registrar closure** (`index.ts:5857, 5866`) and an `AbortSignal` supplied by a live
  invocation (`extension-dispatch.ts:244`); a pass at session close has neither. And the locality
  test fails open: `executionLocationOf` returns `'host'` for every unknown route
  (`bindings.ts:110-112`), so "fail closed" (plan:268) is not what the code does. Fix: name the
  owner of the background environment (a queued job with its own signal and a hard deadline) and
  invert the default to a refusal.
- **MAJOR** — "both wired to the existing session disposal handler (`index.ts:4279-4297`,
  `session-ledger.ts:221-227`)" (plan:310). `index.ts:4279-4297` is the pre-step digest hook; the
  disposal handlers are `:3715-3719` (unconditional ledger `forget`) and `:4301-4337` (artifact
  expiry, gated by `scopingEnabled` **and** `expireSessionArtifacts`). Riding the gated one makes
  erasure a config flag. Fix: cite and extend `:3715-3719`, which is already unconditional and is
  exactly the shape §6.4 wants.

**Gets right:** 6.1's refusal to invent a second observation (the three cut `call_craft_*` rows are
  listed with the reason each fails) is the strongest reasoning in the document.

### §7 — Phase 1 the use store (317-346)

**Verdict: WEAK**
- **MAJOR** — "This store is authoritative after Phase 1; `evidence()` reads it and nothing else"
  (plan:344-345) contradicts §6.1, which measures the direct lane "from the session ledger's reuse
  counter" (plan:227-228). That counter increments only for `agent_`/`workflow_` names
  (`session-ledger.ts:203`), so for every contract tool — the tools skills are written for — the
  direct lane is structurally 0, not "unresolved". Fix: delete the ledger lane; count direct calls
  in the use store from the same receipt that produces the row, and let the ledger keep only
  `offered`.
- **MINOR** — "Retention with an explicit number" (plan:337) gives no number, while D11 and the
  §14.8 gates ("`evicted` ≠ `insufficient`") are decided by it. Fix: state it (`artifact-usage`
  uses 100 sessions / 500 rows, `artifact-usage.ts:23-27`) and make it config with a default.
- **MINOR** — "Append-only, one writer per scope key; a documented merge rule for a second process"
  (plan:332) defers the only hard part: no store in this tree has a lock or a merge rule — both
  rewrite the whole file and last-writer-wins (`artifact-usage.ts:173-185`,
  `receipt-store.ts:167-171`). Fix: one file per `scopeKey` (or JSONL) chosen in this section, not
  deferred, or two host processes will silently halve the counts.

**Gets right:** it finally names the defect in `artifact-usage` precisely (no scope, 100 sessions,
  no version) and decides a store instead of a field — the v1 blocker is answered.

### §8 — Phase 2 the observed check (347-373)

**Verdict: WEAK**
- **MAJOR** — "The observed check **replaces** the evidence line, never joins it" (plan:369). The
  line it replaces is only rendered when `top.uses >= 5` (`library-digest.ts:240`), so for a
  first-use failure the check is recorded and **prints nothing** — the same silence the section is
  built to avoid. Fix: give the observed check its own, lower floor and a red-first test that a
  one-use check is rendered, not suppressed.
- **MINOR** — "Promotion additionally requires `unreproduced === 0`" (plan:362-363) needs a new
  field on `PromotionEvidence` and a change to the shared floor at `artifact-promotion.ts:202`;
  that function also serves auto-keep and draft promotion. Fix: schedule the signature change and
  say which callers default the field (absent must not mean zero).

**Gets right:** the argument-path restriction ("metadata by construction", plan:350-353) is the
  right way to keep a failure countable without storing argument values.

### §9 — Phase 3 the skill module contract (374-448)

**Verdict: WEAK**
- **MAJOR** — "The discriminator is `requiresTools` in the manifest skill declaration"
  (plan:384). In this tree `requiresTools` is the **publication gate**: a usage skill is withheld
  unless every entry is a visible tool (`publication.ts:229-244`), and the entries are manifest
  tool **ids**, not caller names (`index.ts:5476`; `identify-language` declares
  `requiresTools:["identify-language"]` while the tool is `identify_language`). Repurposing it as
  the kind discriminator makes a flow skill's *availability* the intersection of its tools' models
  and makes C3/C5 compare ids to names. Fix: add a separate `kind`/`coversTools` field; leave
  `requiresTools` as the gate.
- **MAJOR** — "The repo already ships one flow skill of each shape: ... `decision-decomposition`
  (113 lines, the decision family)" (plan:386-387). That skill declares **no `requiresTools`**
  (`extension-laya/tool-mode.extension.json:145-152`), so `skillKindOf` classifies it `tool`
  (`skill-contract.ts:60`): the plan's only flow exemplar is not one under its own rule. Fix:
  either delete the claim or declare the family on that skill and show the lint firing on it.
- **MAJOR** — "C8 may use Tool Mode's own `text_embed`/`semantic_similarity` — dogfooding, not a
  new dependency" (plan:434-436), in a phase whose opening promise is "no model calls, no fixtures"
  (plan:376). `text_embed` is served by an installed extension through a prepared model asset, so
  `verify:skills` would depend on that extension being installed and its model prepared — the
  build fails for a reason unrelated to the skill. Fix: make C8 read a precomputed similarity file
  or keep it out of the gate (it is already `comment`-only).

**Gets right:** the kill switch is real and already correct — `registerSkill` returns a no-op
  disposer and logs "its tool stays registered" (`index.ts:5903-5908`), and both registration paths
  consult the same set (`:3131-3135`, `:5905`, `:5927`).

### §10 — Phase 4 skill measurement (449-502)

**Verdict: BROKEN**
- **BLOCKER** — "the control arm is a session whose hash put it there, not a replay" (plan:336) and
  "a `call_*` rates compared between the treatment arm and the control arm" (plan:455-457). No
  seam in this plan or this tree withholds a skill from a hash-selected session: the disabled set
  is a static list from config plus env, parsed once (`index.ts:1926`) and consulted at
  **registration** (`:5905`, `:5927`), which happens per plugin mount, not per session. Arms
  therefore never differ within a deployment, and every Δ in §10.3 is session-to-session noise.
  Fix: either assign the arm at registration time from the *deployment* (operator runs two
  configurations and the report joins them by config digest), or delete the ablation and say the
  measurement is cross-configuration.
- **MAJOR** — "Rows = skills, columns = tool families, cell = Δ rate when that skill is disabled"
  (plan:467-469) inherits the same defect, and the §14.8 floor ("≥ 8 distinct sessions per arm
  cell") cannot be met for a rarely used family in either arm. A matrix that is mostly `null` is
  not a measurement. Fix: make the unit one skill × one arm pair over the whole store, not
  per family, or state that cross-family cells exist only for the three or four families with
  volume.
- **MINOR** — "Evaluate the skill ... at ~25% and ~10% tokens" (plan:485-488) requires authored short
  variants (a second editable surface, a second digest) and nothing in Phase 3 produces them. Fix:
  say who writes the variant and that its evidence keys to its own digest — otherwise the sweep
  compares a body to itself.

**Gets right:** 10.6's guard vocabulary ("`recovery` is `null` whenever the gap is below
  `gapFloor` or an arm is below the session floor") is exactly the shape `laya-gates.json` uses
  (`docs/tool-mode/evaluation/laya-gates.json`), and it is printed next to absolute rates.

### §11 — Phase 5 admission and demotion (503-532)

**Verdict: WEAK**
- **MAJOR** — "`evaluateAdmission` requires either a `SkillReport` ... or an explicit
  `admitted-insufficient` marker" (plan:511-513). Nothing in this repo would call it: the only
  wired gate is `evaluatePromotion` (`artifact-promotion.ts:168`), `verify:skills` does not exist
  (§17 concedes it), and §14.5's gate row lists only `verify:static`. A second authority with no
  caller is the "gate that cannot fail" this plan was written to avoid. Fix: name the script that
  calls it and its exit code in §14.5 before the phase starts.
- **MINOR** — "a cross-family regression blocks the next admission **until explained**"
  (plan:515-516). "Explained" is free prose deciding a gate, which D13 forbids. Fix: require a
  recorded decision id (`memory_decision`-shaped) or a `waiver` field with an author — either is
  checkable; "explained" is not.

**Gets right:** the reason the artifact floor cannot apply is correct and well argued — a bundled
  skill is born global with zero uses, so `DEFAULT_MIN_USES` + `failures === 0`
  (`artifact-promotion.ts:163, 202`) could never be satisfied.

### §12 — Phase 6 the proposal pass (parked) (533-569)

**Verdict: SOUND**
- **MINOR** — "the offered set is intersected with the live caller grant at call time
  (`index.ts:5559-5585, 5715`)" (plan:543-544). Line 5715 in this checkout is a doc comment and
  the planning server begins at `:5718`; the substance holds ("kept INSIDE registration so it
  closes over ... the snapshot state", `:5711-5713`), so only the numbers drifted. Fix: re-anchor
  to the `servePlanningCall` definition and the snapshot capture, or cite by symbol.
- **MINOR** — "Edits target the fields an authored tool actually has: `description`, `purpose`,
  `verification`" (plan:566-567) omits `program`, `tools`, `inputSchema` and `verifiability`, all
  editable and all inside the digest (`agent-authoring.ts:309-340, 1168-1174`). The narrowing is
  sound as policy but is stated as a fact about the schema. Fix: "a proposal pass would be
  restricted to the prose fields even though the schema allows more".

**Gets right:** it names the three real preconditions (frozen two-snapshot fixture, reference bank,
  one authority + restore) instead of restating the ambition, and neither precondition is
  pretendable.

### §13 — Not in this programme (570-587)

**Verdict: SOUND**

- No findings. Each exclusion cites the mechanism that would be needed and does not exist: no job
  model (`harness-budgets.ts:11-12`), no prose evidence (D13), no second store (D12).

**Gets right:** "the log is the asset, the learned artifact is a cache" is the sentence that keeps
  this programme from becoming a training project by accident.

### §14 — Development method (588-729)

**Verdict: WEAK**
- **MAJOR** — "an `error`-severity C1–C9 finding fails `verify:skills`" (plan:420, 710) and the
  Phase 3 gate "zero `error`-severity lint findings" (plan:725). No `verify:skills` script exists
  in `dsh-tool-mode/package.json` (`verify:static`/`verify:docs`/`verify:built` do, lines 29-61),
  and §14.5's gate row names only `verify:static` — so the gate this section is built around
  cannot be run. Fix: add the script in Phase 3's first slice and put it in the §14.5 table with
  its exit code.
- **MINOR** — "a wait must poll a condition with a deadline" (plan:620) is stated, then
  `tools-plan-hosting.test.ts:660`'s fixed 600 ms wait is waived as a pre-existing flake
  (plan:824-829). The rule's only live violation is the one the plan excuses. Fix: state the waiver
  in §14.2 itself, or replace the sleep with a poll (the file is already the named flake).

**Gets right:** the red-run-then-revert mutation check and "a test that passes before the
  implementation exists is not testing the implementation" (plan:603) are the two rules that would
  have caught this programme's earlier failures.

### §15 — Review record (730-782)

**Verdict: WEAK**
- **MINOR** — "Adopted with a correction: the review's advice to drop lane 1 ... is not taken — the
  host does dispatch contract implementations in process (`extension-dispatch.ts:205,239`)"
  (plan:744-746). True as written, but what is proven is that dispatch exists *inside a registrar
  closure with a live signal* (`index.ts:5857, 5866`; `extension-dispatch.ts:244`) — the §6.3
  background pass is still owed an environment. Fix: record the correction as "the dispatch exists;
  the seam from a session-close pass does not" so the next reviewer is not told the question is
  closed.

**Gets right:** the v1 review artefacts it cites exist and are the right ones
  (`research/reuse-evidence-review/{spec,architecture,evidence}.md`), and the "rejected as
  unverified rather than chased" paragraph is the honest handling of the withdrawn log reader.

### §16 — Decisions this plan does not make (783-798)

**Verdict: SOUND**
- **MINOR** — question 3 cites "already rendered into the prompt" at `index.ts:4090-4104` and
  `:4182-4195` (plan:790-791); the `...evidence` spread is at `:4100-4107` in this checkout. The
  fact holds, the window drifted. Fix: re-anchor or cite by symbol.

**Gets right:** it hands the one genuinely product-shaped question (lane 2 off by default) back to
  a human instead of deciding it inside a measurement programme.

### §17 — Implementation status (799-840)

**Verdict: WEAK**
- **MAJOR** — the landed identity hashes *both* the source and the body, plus a renderer version
  (`skill-contract.ts:105-117`: renderer, tool, source, body, name, description, whenToUse). Two
  consequences the plan does not state: any edit to the renderer's comments or line order changes
  every skill's digest even when the published bytes are identical, and because the source digest
  and body digest are both present, a source change that produces the same body still orphans
  evidence. Fix: digest the published body plus the declaration; record `rendererVersion` as
  provenance in the report (`environment`, as §10.6 already promises).
- **MINOR** — the reported counts (26 pass, 3 pass, 32 across 11 suites, 4084/4058/25/1) are
  UNVERIFIABLE from this lens (no test run permitted). The files exist — `tests/skill-contract.test.ts`,
  `tests/skill-disable.test.ts`, `src/skill-contract.ts` (510 lines) — so the claim is plausible but
  is a record, not evidence. Fix: attach the command and the captured output path to the table.

**Gets right:** "Not built yet" is the most valuable paragraph in the document — it states plainly
  that budgets are not enforced at render time, the digest reaches no surface, and the lint cannot
  fail a build, which is exactly what §9.3–§9.5 read as if it were done.

### Appendix A — v1 → v2 section map (841-857)

**Verdict: SOUND**

- No findings; every arrow matches the actual headings (`§6 Phase 3 parked` → `§12 Phase 6`,
  `§9 review record` → `§15`, new `§3`/`§9`-`§11`/`§17`).

**Gets right:** it is a diff a reviewer can walk without holding both documents.

### Appendix B — what the paper gave (858-871)

**Verdict: SOUND**
- **MINOR** — last row borrows "keep the previous measured version so a regression is visible"
  (plan:870), while §12 states no previous version is retained and `demote` deletes the row
  (`agent-authoring.ts:1943-1958`). A borrowed habit the tree cannot support yet. Fix: mark it as
  a Phase 6 precondition (it is already listed there) rather than a habit.

**Gets right:** the boundary row (86.8% by prompt vs ≤2.1% by same-intent text) is carried into
  §9.2 and §10 as a limit on claims, not as a claim — the one place the paper is used correctly.

## Summary

| verdict | sections |
| --- | --- |
| SOUND (7) | §2, §4, §12, §13, §16, App A, App B |
| WEAK (11) | §0, §1, §3, §5, §7, §8, §9, §11, §14, §15, §17 |
| BROKEN (2) | §6 (Phase 0), §10 (Phase 4) |
| UNVERIFIABLE (0) | — |

| severity | count |
| --- | --- |
| BLOCKER | 2 — §6.2 the projection cannot see `dataFlow`; §10.1 hash arms have no assignment seam |
| MAJOR | 14 |
| MINOR | 20 |

Both blockers are the same shape: the plan takes a correct diagnosis from v1 and routes it into a
mechanism that cannot carry it (a projection over events that never held the edge; an arm derived
from a hash that nothing acts on). Delete the ablation and persist the signal at receipt time and
the programme is smaller, not weaker.
