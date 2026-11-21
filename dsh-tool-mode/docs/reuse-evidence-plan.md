# Reuse evidence and skill measurement

**Status:** v2 — the v1 reuse-evidence programme, extended so that **skills** (the guidance
published with each tool) are measured by the same machine, and integrated with the
skill-evidence spec of 2026-11-21. v1 survived an adversarial review (three reviewers, 36
findings, 14 blockers); every adopted finding is retained and §0 records what integration
added, changed or refused. **Phase 3 is partially implemented (§17); nothing else has code
behind it yet.** Every phase is built test-first and verified by the loop in §14.1: a red
run whose output is kept, a mutation check, then the gate.

Terminology: the repo's word is **skill** — `SKILL.md` for extensions, a body rendered
from catalog + playbook for bundled tools. Earlier drafts of the skill work called it a
"card"; that word is retired here because it collides with the *model card* (a capability
summary) and with the *tool contract* returned by describe. "Artifact" means an authored
tool or workflow. "Skill" means the guidance text attached to a tool.

## 0. What changed in v2

v1 is not amended in place where the integration forces a different shape; the affected
statements are rewritten and listed here so a reviewer can diff behaviour, not prose.

| # | v1 said | v2 says | Why |
| --- | --- | --- | --- |
| 1 | the programme covers authored tools and contract-backed tools | it covers three ref kinds: `authored`, `contract`, **`skill`** | seams §5.4: "a new artifact class is a new resolver, not a new store". A skill is a new class, not a new programme. |
| 2 | evidence is keyed to a `declarationDigest` over the editable declaration | the same rule over the skill's editable surface, which is **two surfaces**: `DescribeSkill` (`name`, `description`, `whenToUse`) for bundled skills, `{name, description, body}` for extension skills, which register with no `whenToUse` at all | §5.5. `DescribeSkill` is produced for model-backed catalog skills only (`discovery-describe.ts:85-107`); extension skills register as `{name, description, content, path, source}` (`index.ts:5965-5973`). |
| 3 | one store for artifacts | the same store, with skill rows carrying `applied`, `tokens` and `declarationDigest` | §7. Two stores would be the duplication the seam rule forbids. |
| 4 | signals describe the fate of an artifact | signals additionally carry **two call-shape predicates** — `call_probe` and the derived `call_retry_changed` — over the same receipts | §6.1. Ordering and retry shape are the only call facts that are both mechanical and new; an earlier draft's three `call_craft_*` bundles were cut as redundant or as prose judgements (§15). |
| 5 | Phase 3 was the parked proposal pass | the proposal pass becomes **Phase 6**; new Phases 3–5 cover the skill module contract, skill ablation and skill admission | §9–§12. Skills are not artifacts; they need different gates and a different lifecycle. |
| 6 | promotion is the only lifecycle | **promotion** (artifacts, evidence floor, `evaluatePromotion`) is joined by **admission + demotion** (skills, `evaluateAdmission`) | §11. A bundled skill is born global with zero uses, so the artifact floor can never apply to it; exempting it would recreate the "gates that cannot fail" finding. |
| 7 | (open question) can the ablation be observational? | no — the counterfactual is a **suite execution pair**, and the store has no arm column (§10.1–10.3, D17) | the MDE calculation shows a 5-point field effect needs ~800 sessions per arm (`docs/tool-mode/ARMS-AND-MDE-DECISION.md`), so the observational design could not detect a real effect. |
| 8 | gate vocabulary was `pass/fail/insufficient/evicted/unavailable` | unchanged, and now also the vocabulary of the skill report | §5.3. One vocabulary; the earlier skill draft's `measured/regression` are outcomes, not a second vocabulary. |
| 9 | (absent) | a **decisions register** (§3) | requirement of this revision: the reasoning must survive the plan. |
| 10 | (absent) | background (§1) and goals (§2) | same. |
| 11 | verification was a list of named tests | a **development method**: the test-first loop, what counts as verification and what does not, a rule → test matrix, the commands and what each must show, and the phase-report format (§14) | the named tests said what to prove but not how to prove it, and this programme's failures are procedural rather than semantic. |
| 12 | the plan claimed its review blockers were fixed | a **fixed-or-not recheck** was run by the same three lenses on the changed sections only, and it rejected ~70% of the dispositions and found 22–25 new issues per lens, most of them edit damage | the v2.3 record and Appendix D. A stale-phrase grep cannot see a table that lost a column or a bullet cut mid-sentence. |

Retained without change: the review corrections recorded in §15 — counters are not a
correctness signal and the word "working" stays banned; no replay of failures; failures are
kept and counted `unreproduced`; the proposal pass stays parked; no session-log reader
(signals are a projection, §6.2); locality is checked per binding; the `correction` lane is
consent-based, never a fallback; evidence is keyed to a declaration digest, not the artifact
digest; the store is a store, not "not new storage"; every phase has a threshold and a null
outcome.

## 1. Background

Three threads lead here.

**Thread 1 — a paper that measured capability as an input-space module.** Composable Soft-Prompt
Distillation (CSPD, Zhang & Yang et al., Nov 2026; ⟨https://www.alphaxiv.org/abs/2611.composable-soft-prompt-distillation⟩).
**There is no in-tree copy.** The numbers tabulated in Appendix B are premises for §9.2, §10.4, §10.5 and
Appendix B; they are restated here as reported by the paper, and vendoring the PDF under
`research/papers/` with a digest is a precondition for relying on any of them outside this plan
(§16). The paper freezes a backbone and
distils each RL expert into its own 256-vector soft prompt, composed by concatenation:
≥90% of the teacher's gain recovered in 22 of 23 settings, four composed prompts at 67.83
against 67.79 for multi-teacher distillation, out-of-domain 56.6 against 53.5, and — the
part that matters for us — **written instructions with the same intent close ≤2.1% of the
teacher–student KL gap while the prompt closes 86.8%**. Two further results shaped this
plan: independently trained modules compose better than modules fitted to each other
(67.83 vs 65.17, with an early capability destroyed on the way), and a removal matrix, not
a per-module self-report, is what attributes capability (removing the math module costs
6.5 points on a *science* benchmark). Appendix B records what was borrowed and what was
refused.

**Thread 2 — a counter experiment that failed.** The repository has already measured that
usage counters cannot establish correctness: a draft with 61 uses and 0 failures was wrong
(`library-digest.ts:215-219`; `research/verification-field/REPORT.md:6-8`). Any programme
that reintroduces volume as "what counts as working" would be repeating a falsified
experiment with better filing. Hence the guardrail discipline throughout.

**Thread 3 — what this host can and cannot support.** Training and fine-tuning are an
explicit non-goal of the release (spec v1.2 §1), the usage plane deliberately stores no
argument or result bodies (`docs/tool-insights-proposal.md` §2), and there is no job model
for idle preparation (`harness-budgets.ts:11-12`). The budget is therefore **measurement,
not learning**: record what happened, keep the few facts that can be checked later, and
refuse to claim what the data cannot support.

The skill half of this plan started from a different question: every tool ships instruction
text — 10 shipping `SKILL.md` files in extensions (the SDK template is not a shipped tool), plus one rendered body per catalog tool
(`renderSkillBody`, `skills.ts:26`) — and **nothing measures whether that text helps**. A
card that is wrong is a warn-and-drop log line across the load path (`index.ts:5912-5943`) and nothing else. It
also has no per-skill switch: `registerSkills` is global, and `exclude` removes the model
and therefore the tool. The merge: one evidence machine, two subjects.

## 2. Goals and non-goals

**Goals.**

1. Record, per use, **what happened** to an artifact or a skill, in a store that never claims
   "this works" and never claims "this changed" — the store is descriptive, and the suite (§10)
   is the only instrument allowed to say a skill helps.
2. Make every skill a **module**: identified by a digest of the inputs that produced it,
   classified as a tool skill or a flow skill, bounded by a token budget, droppable by an
   operator without disabling its tool, and linted for conflicts with its neighbours.
3. Give a reviewer one sentence per skill: *this text costs `T` tokens; with it suppressed the
   suite's pass rate over family `F`'s tasks falls by `D` percentage points (interval attached); and,
   where a pre-registered reference exists, it closes `N`% of the gap from no-skill to expert
   use.* `D` is a **paired suite difference**, never an observational contrast (D17).
4. Keep the programme falsifiable: every phase has a pre-registered threshold and a null
   outcome that is a **named guard** (`insufficient(n, need)`, `evicted`, `unavailable`, a recorded
   `admission.json` entry, or `fail(programme-stop)`), and "no data" is never rendered as a zero.
   which were reviewed, and which were guesses.

**Non-goals.** Training or fine-tuning of any kind; soft prompts or any gradient access;
LLM-judge scores as ground truth; synthetic suite scores mixed into the observational
store; a second evidence store; a second promotion authority; auto-editing tool
declarations (parked, §12).

## 3. Decisions in force

These are load-bearing. Each states the decision, why, and what would reopen it.

| # | Decision | Why | Reopens if |
| --- | --- | --- | --- |
| D1 | Evidence is **observational only**. Synthetic capability suites are measured elsewhere and cited, never merged. | v1's store is a lower bound over real sessions; mixing suites would launder a score into a count. | A suite whose executions are recorded as sessions by the host itself. |
| D2 | Counters never establish correctness; the word "working" is banned in reports, and the ban is **tested**: a renderer test greps every report renderer (`library-digest.ts`, the evidence renderer, the skill report) for `working` and `works`. | `library-digest.ts:215-219` falsified the counter-as-correctness claim. | Never — a new predicate would need its own falsification. |
| D3 | One store, one writer per scope key, append-only. | `artifact-usage` cannot carry the job (no scope, 100-session cap, no schema version, whole-file rewrite; `artifact-usage.ts:23-31, 42-56, 173-185, 217`). | Never for this host. |
| D4 | One identity rule, two digests (`declarationDigest` for artifacts, skill declaration digest for skills), one test asserting digest fields == editable fields. | An editable field outside the digest orphans evidence (§5.5). | A field becomes editable through a path the test does not cover. |
| D5 | An arm is a **suite run condition**, never a production assignment: the same tasks run with the skill injected and with it suppressed through the static disabled set. | A per-session arm would be a label nobody applies (the v2 review's T1), and a field-observational arm cannot reach a plausible effect at the sample sizes this product sees (§17, MDE). | A production seam assigns arms *and* a field effect becomes affordable to detect. |
| D6 | **Promotion** (artifacts) is not **admission/demotion** (skills). Two authorities, neither able to bypass the other. | A bundled skill is born global with zero uses; the artifact floor cannot apply, and exempting it recreates the "gates that cannot fail" finding. | Skills ever ship non-global by default. |
| D7 | Counter signals fold at run completion into a session projection; edge signals are written where the receipt is built, never folded later (D18). No signal is computed by a deferred reader. | Receipts are capped at 200 in memory and on disk (`receipt.ts:35`); a deferred join silently loses the edge and reports "not consumed". A projection also cannot see `dataFlow` or `receiptId`. | Receipts become unbounded, or the projection gains the edges (D18 reopens). |
| D8 | The `correction` classifier is consent-based, default off, one local lane plus one declared lane; **never a fallback**. | Fallback-on-unavailability is BASE-08/SEC-10's prohibited pattern; lane 2 sends conversation text off the machine. | The release authority changes for BASE-08/SEC-10. |
| D9 | A failure that does not reproduce is **retained** and counted `unreproduced`; promotion requires that count to be **known and zero**, which by D19 means `failures === 0` or a reproduction pass that ran and returned 0. | Deleting it would manufacture `failures === 0`, the promotion floor (`artifact-promotion.ts:163`). | Never. |
| D10 | Skills are measured by **call craft and ablation**, not by usage volume. | Volume says the tool was reached for; only call craft says the guidance changed the call. | A skill exists whose only claim is discoverability. |
| D11 | `null` ≠ `0`, and `evicted` ≠ `insufficient`. | A frozen set built on an evicting store would otherwise report "not enough data" forever. | Never. |
| D12 | A new artifact class is a new **resolver**, not a new store, vocabulary or promotion path. An **admission authority is not a promotion path**: it decides a release-time lifecycle (D6), not an artifact's move between scopes. | The seam rule that made skills land in this plan instead of beside it. | A class cannot be expressed as (ref, observations, gate). |
| D13 | Nothing in a report may render free prose as evidence. | `artifact-usage`'s own contract rejects free prose; the ledger's no-counterfactual rule stands. | A field becomes mechanically checkable. |
| D14 | Conflict detection is static over playbooks, semantic comparison is advisory only. | A build must not fail on a cosine score; the static rules (C1–C9, §9.5) can. | A semantic rule proves precision ≥ 0.9 on a labelled set. |
| D15 | A call-shape observation is a mechanical predicate over receipts, or a derived rule over observations that already exist — never a second observation of one fact and never a reading of the agent's prose. | Three bundled `call_craft_*` rows were cut on exactly these grounds (§6.1, §15): two re-derived `tool_error`/`repeat_*`, one required reading a summary. | A prose predicate becomes decidable from a stored field. |
| D16 | Every change is built test-first (§14.1), and a test that does not fail when its behaviour is reverted is not verification. | The programme's failure modes — a counter as correctness, a gate that cannot fail, a prose judgement dressed as a signal — pass review and fail only under a red-first loop. | A test framework makes the mutation check impossible to perform. |
| D17 | Deletion and admission are decided by a pre-registered capability suite (paired per task, exact sign test, minimum 6 pairs), never by observational Δ; below the MDE or the pair floor the answer is `insufficient(n, need)`. | The MDE table in `docs/tool-mode/ARMS-AND-MDE-DECISION.md` shows a 5-point effect needs ~800 sessions per arm; at this product's scale the observational design cannot detect a real effect, so a store-based deletion rule deletes everything or nothing. | The sample sizes or the product's effect-size floor change. |
| D18 | Edge-derived signals (`consumed`, `unexplained`) are written where the receipt is built — the composition path that already holds the report and the edges — not folded into a session projection; the projection keeps counters only. | A projection's folded event subset carries no `dataFlow` and no `receiptId` (`tool-usage-projection.ts:254-288`), so the edge signals were unreachable; the projection is also a cache whose `stateVersion` bump re-folds to `null`, which is data loss for evidence. | The projection contract gains the edges and is declared non-cache. |
| D19 | `unreproduced` is `null` until a reproduction pass exists; promotion needs `failures === 0` or a pass that ran with `unreproduced === 0`, and is refused with `EVIDENCE_UNREPRODUCED_UNKNOWN` while the count is unknown. | Requiring `unreproduced === 0` without scheduling the pass made the gate pass by default — the same manufactured-zero the plan forbids elsewhere. Requiring `failures === 0` outright would recreate the pressure to delete failures (D9). | The reproduction pass ships, or a product decision accepts `failures === 0` as the only route. |
| D20 | A model may **veto** (a boolean refusal with a reason that blocks a promotion) and may never **grade** (produce a score, ranking or percentage that a gate or report consumes as a number). | A judge that can grade can enable a promotion, which the proposal pass forbids; a veto can only block. | A judge's score is calibrated against a held-out reference and gated. |

## 4. What this programme is

A measurement and corroboration programme: it records what happened after a tool or a
skill was used, keeps the few facts that can be checked later, and refuses to claim
anything the data cannot support. It is **not** a proposal or self-improvement loop — §12
explains what would have to exist first — and it is not a training data pipeline.

Every number it produces is a **lower bound**, as the programme it extends already says of
its own numbers ("treat every number as a hypothesis for a new build",
`docs/adoption-improvement-plan.md:42-43`).

## 5. The seams

Three interfaces, each with exactly one implementation per class in this programme and a
stated contract, so a second signal, a second artifact class or a second classifier is an
implementation rather than a rewrite:

- **`SignalSource`** — folds one class of session event into zero or more observations
  `{kind, strength, sessionId, turn, callId, at}`. A new signal is a new source.
- **`EvidenceRule`** — turns observations into one corroborated fact about an
  `ArtifactRef`. A new class is a new resolver, not a new store.
- **`Gate`** — consumes a pre-registered reference and returns
  `pass | fail | insufficient | evicted | unavailable`. Five outcomes, because "no data"
  and "no regression" are different answers.

### 5.1 `SignalSource`

One source per event class. Sources never decide anything; they emit observations with a
strength in `{lower, raise, informational}` and a pointer back to the receipt. A source
that cannot decide emits nothing — never a zero-strength observation, because a zero is
indistinguishable from "not observed" downstream.

### 5.2 `EvidenceRule`

Maps (observations, ref) → one fact with a `state` and a `counts` block. The rule is
monotone: observations can only lower a guardrail or raise a corroboration count, never
assert correctness. Two rules exist at v2: the artifact rule and the skill rule (§10.2).
They share the store and the gate; they do not share a denominator.

### 5.3 `Gate`

`pass`, `fail`, `insufficient`, `evicted`, `unavailable` — and a reason string that carries the
number the decision turned on, when there is one (`insufficient(7, 8)`), and only the cause when
there is not (`no-reference`).
Reason **codes are not outcomes**: `gap-too-small`, `no-reference`, `insufficient(n, need)`,
`admitted-insufficient` and `EVIDENCE_UNREPRODUCED_UNKNOWN` all ride under `insufficient` and name why
it is insufficient. A gate that cannot fail is not a gate; a gate without a null outcome is.

An `admitted-insufficient` marker is not prose: it is an entry in
`verification/release/<version>/admission.json` — `{skill, digest, status, reason, admittedBy, at}`
— checked by `verify:release` against the shipped skill set, so a marker whose digest no longer
matches the shipped body is a release failure rather than a stale note.

### 5.4 `ArtifactRef` — three kinds

`{kind: 'authored' | 'contract' | 'skill', name, digest?, scopeKey}`.

- `authored` — an authored tool or workflow, carrying a `declarationDigest`.
- `contract` — a contract-backed tool (extension, recipe, MCP), carrying what a receipt
  already gives it: `implementationId`, `extensionContentDigest`, `contractVersion`.
- `skill` — the guidance body published with a tool. Its ref is
  `{kind: 'skill', toolName, skillName, declarationDigest, scopeKey}`. The identity is
  **(tool, skill declaration)**, not the model. A bundled skill is rendered from a model's catalog entry and playbook, so
  the model is an *input hash*, not the subject of measurement.

### 5.5 The identity rule

A field an agent or operator may edit is either inside the digest the evidence is keyed to,
or the evidence is keyed to a digest that includes it.

- **Artifacts.** The artifact digest covers description, program, tools and inputSchema only
  (`agent-authoring.ts:1168-1214`), and promotion copies it unchanged, deliberately (`:1197-1213`).
  Evidence is therefore keyed to a `declarationDigest` covering description, program, tools,
  `inputSchema`, `purpose`, `verification` and `verifiability`.
- **Skills.** The editable surface is the **union** of two shapes. A bundled skill's public surface
  is `DescribeSkill` — `name`, `description`, `whenToUse` (`discovery-describe.ts:85-107`) — plus
  the rendered body. An extension skill registers as `{name, description, content, path, source}`
  with **no `whenToUse` at all** (`index.ts:5965-5973`), and its manifest declaration adds
  `requiresTools`; so for it the surface is `name`,
  `description`, `requiresTools` and the `SKILL.md` bytes.
- **The skill digest** covers the shape the skill actually has: `rendererVersion`, `toolName`,
  `contractId`/`contractVersion` when contract-backed, `requiresTools` (it decides kind and
  publication, so an edit to it must orphan evidence), the catalog-entry digest for bundled skills
  or the file bytes for extension skills, and the body digest.

The digest field list is a **runtime constant**, not an interface: TypeScript erases interfaces, so a
test can only compare what exists at run time. One function computes both digests' canonical
tuples; one exported constant enumerates each digest's fields; and one test asserts that the
**declaration subset** of that constant equals the editable-field list (the renderer version, tool,
contract ids and source/body digests are fixed inputs, not editable fields, and are out of that
comparison). Adding an editable field without adding it to the constant fails the build rather
than silently orphaning evidence (D4).

## 6. Phase 0 — signals (M)

### 6.1 The set, extended

v1's names describe the fate of an artifact. v2 adds two `call_*` entries describing how the
agent shaped the call. They are the only observations that can show guidance text did
something, and they are deliberately the only ones: an earlier draft carried three
`call_craft_*` bundles and all three were cut (§15).

| signal | how it is observed | it may | it may not |
| --- | --- | --- | --- |
| `tool_error` | the receipt carries an error class | lower a guardrail | prove the output was wrong |
| `failed_result` | a composed run failed after the call, joined by `runId`/`parentReceiptId` | same | same |
| `repeat_same_shape` | the same tool called again with an equal argument-key fingerprint | nothing (informational) | be read as an error |
| `repeat_changed_shape` | same tool, different key fingerprint | nothing (informational) | be read as a correction |
| `consumed` | a `dataFlow` edge from the result into a later call's arguments | raise the guardrail | be read as correctness |
| `unexplained` | no edge, `complete: false` | nothing | be read as "not consumed" |
| `correction` | a classifier over the operator's next message (§6.3) | create an observed check (§8) | open a gate |
| `call_probe` | a composed run in a session that contains **no `tool_mode_describe` call at all** (a receipt carries `argumentPaths`, not argument values, so it cannot say *which* tool a describe covered — see Appendix D, O1; the decidable form is presence or absence) | lower a skill guardrail | prove the skill caused it |
| `call_retry_changed` | **a derived rule, not a source**: a `tool_error` followed by the same tool with a *different* argument-key fingerprint (that is, `tool_error` + `repeat_changed_shape`) | lower a skill guardrail | be read as a fix |


Two facts force `consumed` and `unexplained`. Data-flow edges exist only inside a Code Mode
composition — one tracker per program run (`data-flow.ts:2,47-48`) — and a direct call has
none, so consumption is observable **only** for composed use. The report therefore prints
direct and composed shares separately and counts a direct call as `unresolved`, never
`unexplained`. The direct lane is measured from the session ledger's reuse counter instead
(`session-ledger.ts:55`).

`call_*` predicates are deliberately few and mechanical, and the cut matters more than the
kept ones:

- `call_schema` (missing a `required` property) is already `tool_error` with a validation
  class — the tool validates its own input, so re-deriving it adds a second observation of
  one fact.
- `call_shape`'s "`dimensions` mixed within a run" is **not a violation**: each call takes one
  width, and a run may legitimately embed at 768 and then at 128. The rule would have failed
  correct behaviour. "`top_k > candidates.length`" is refused by the tool, so it is another
  `tool_error`.
- `call_honesty` ("`coverage: false` summarised as complete", "a result asserted without
  qualification") is a judgement about prose, which this programme does not make (D1). The
  receipts carry `outcome`, `warnings` and `argumentPaths`, not result bodies, so it was not
  observable either.

D15 states the rule that survived: a call-shape observation is a mechanical predicate over
receipts or a derived rule over observations that already exist — never a second observation
of one fact, and never a reading of the agent's prose.

### 6.2 Where they are computed

Signals are written **where the receipt is built**, at run completion, not derived later and not
folded from the log: receipts are bounded at 200 in memory and on disk (`receipt.ts:35`), so a
deferred join would silently lose the edge it needed and report "not consumed" for a call that was
consumed. Edge-derived signals (`consumed`, `unexplained`) are emitted in the composition path,
which already holds the run report and the edges (`index.ts:4344, 4391-4392`), and persisted into
the evidence store keyed `(session, call, ref)` (D18). The **session projection** keeps only what a
projection can actually see — tool name, error class, `isError` and the counters that derive from
them — because the folded event subset carries no `dataFlow` and no `receiptId`
(`tool-usage-projection.ts:254-288`). A projection `stateVersion` bump re-folds the counters to
`null`, which is correct for a cache; it does not touch the stored evidence, and the report
distinguishes `null` from `0`.

### 6.3 The `correction` lane

**The window.** A `correction` label is a judgement about the operator's **next message in the same
session** — the first operator message after the tool result, before any further tool call. A message
from another session, or one that arrives after another tool call, is out of window: it is recorded
as `out_of_window` and creates nothing.

**The reader.** The pass runs at the **next prompt assembly**: it reads the session's restored
message projection (the host serves stored history through `sessionPersistence`,
`index.ts:1647-1671`) and takes the first operator message after the tool result. No log-file
reader is introduced, and a missing projection is `unavailable` with a reason, not an empty label.

**Lane 1 — the local decision checkpoint, when the binding is local.** The host dispatches the
implementation behind the `decision.choose` contract — `resolveImplementationByContract` and
`createDispatchForContract` (`extension-dispatch.ts:205,239`) — rather than invoking the
caller-facing tool, so this is not one tool calling another. Before any text is passed, the
resolved binding must report `executionLocationOf(route) === 'host'`
(`bindings.ts:100-114`); the `remote` route maps to `team-server`, not to this machine. A
non-host binding is **not** lane 1. Fail closed.

**Lane 2 — a declared remote classifier, never a fallback.** Lane 2 runs only when an
operator has set a separate `correctionClassification` setting (default **false**,
independent of `harnessModel`) **and** the destination is named in the authority grant the
pass runs under — the host's own grant, which a caller request cannot widen
(`authority.ts:75-88, 356-364`). Otherwise the pass records
`skipped: 'lane-2-not-authorized'` and classifies nothing. A lane-1 failure never selects
lane 2: that is a fallback keyed on local unavailability, which is the pattern this
repository forbids (spec v1.2 BASE-08, SEC-10).

**Provenance, honestly.** The decision contracts do not require `meta`, so the host stamps
no receipt for the answer (`docs/flows/semantic-gate.md:133, 145-152`). The label therefore
records `{lane, at, extensionVersion, extensionContentDigest, provenance: 'absent'}` from
the installed extension store, and is **advisory only** until the contract declares
`meta`. Lane 2 records `provenance: 'absent'` for the same reason.

**Precision before evidence.** A false `correction` writes a wrong corroboration onto an
artifact or a skill. Before labels may create evidence, a double-labelled sample of at
least 50 operator messages is scored and the one-sided lower bound on `correction`
precision is published; below 0.90 the label stays informational and creates nothing. An
abstention stores `null` — never "not a correction" — and the classifier's confidence is
never used as a threshold: the flow rule is not to threshold on it at all
(`docs/flows/semantic-gate.md:162`).

**Cost.** Each classification runs under a narrowed budget — one model call, a deadline, an
output-token cap, and the lane-2 destination only when authorized — and records usage with
`'unknown'` where the cost cannot be measured (`harness-budgets.ts:20-30, 53-67`). A
per-pass session cap and its skip count are printed by the report; an unbounded background
model pass is exactly the silent spend that module exists to prevent.

**`classifier: 'unavailable'` is a state, not a zero.** An uninstalled decision extension, a
non-host binding, a missing transcript or an unauthorized lane 2 all report `unavailable`
with a reason. The one stop condition of an earlier draft — "signal rate ≈ 0" — would
otherwise be reached by accident the day an extension is uninstalled, and the programme
would be declared finished.

### 6.4 Retention and erasure

The `correction` label is derived from the operator's own words, so it needs the same
lifecycle as the thing it came from: a retention window per signal row;
`forget(sessionId)` on the signal store, a `forget(ref)` on the evidence store, both wired
to the existing session disposal handler (`index.ts:4279-4297`, `session-ledger.ts:221-227`);
and a cascade: a label whose session is forgotten retracts the observed check it produced,
and a skill row whose session is forgotten is removed from every store-derived report; the suite
matrix is recomputed from its own runs, not from the store. The pointer
`(session, turn, callId)` is itself declared retained personal data with the same window,
because it is what relinks a label to deleted conversation. Deleting the conversation and
keeping the label is not erasure.

## 7. Phase 1 — the use store (L)

A **store**, because `artifact-usage` cannot carry the job: it is keyed by `(name, digest)`
with no scope and no per-use record, keeps at most 100 session ids and 3 failure classes,
rewrites the whole file per record, and has no schema version
(`artifact-usage.ts:23-31, 42-56, 173-185, 217`). Two scoped copies of one artifact already
share a row, and a session that used two digests of one name is counted twice.
- `schemaVersion`, one row per **use**:
  `{ref, scope, scopeKey, name, digest, sessionId, outcome, signals[], at, receiptId}`, where
  `outcome` is `ok | error | failed` (from the receipt's class) and `signals[]` is a subset of the
  §6.1 vocabulary, never free text.
- **Skill rows add** `{applied, tokens, declarationDigest}` — and **no `failurePaths`**, because a
  skill has no `inputSchema` (§8). `applied` is a
  **fact about the use**, not an arm: whether the body was injected for that call, which is
  determined by the static disabled set (§9.4) exactly the way the tool set is. It is recorded so
  a report can separate the uses that had the guidance from those that did not; it never assigns
  a treatment (D17). `tokens` is the rendered size, so the cost curve of §10.5 needs no second
  measurement.
- Append-only, one writer per scope key. A second process is refused at open, not merged: the
  store records which pid and generation holds the scope key, and a second writer fails with
  `EVIDENCE_STORE_LOCKED` rather than interleaving rows. A restore is a copy of the file, not a
  merge.
- **There is no arm column.** An arm is a property of a **suite execution**, not of a production
  session (D17): the store records what happened, the suite supplies the counterfactual. A stored
  or hash-derived per-session arm would be a label nobody applies — the exact defect the v2
  review found (§15, T1).
- Retention: **90 days** for tool, error and edge rows; **30 days** for rows derived from operator
  words (`correction` labels and their `(session, turn, callId)` pointers) and for `failurePaths`,
  which are argument metadata. Eviction is **reported**: `evicted` is a distinct outcome from
  `insufficient`, because a frozen set built on an evicting store otherwise reports "not enough
  data" forever and nobody can tell the two apart.

**What the store is for, and what it is not.** It is the non-regression guardrail: volume,
sessions, consumption, observed checks and call-craft rates per `ArtifactRef`. It is
**never** the acceptance reference, and its report may not say an artifact or a skill
"works". This store is authoritative after Phase 1; `evidence()` reads it and nothing else,
so no second store exists to disagree with it about one number.

## 8. Phase 2 — the observed check (S)

One field, not a phase-sized machine. When a use fails, copy up to three **argument paths**
from that call's receipt (`receipt.ts:93-94, 231`), restricted to paths declared in the
artifact's own `inputSchema` — so a path is metadata by construction and an artifact with
free-form input simply records none — into `failurePaths` on the use row, joined to the
failure class that is already stored. A **skill has no `inputSchema`**, so a skill row records no
`failurePaths` at all; its failure evidence is the pair's outcome and the observed check on the
tool it guides.

**No replay of the failing call.** An earlier draft replayed a synthetic call to prove the failure;
the store keeps no argument values, and a re-read of an archived transcript makes the evidence expire
with the log. What §14.8's Phase 2 gate names as "reproduced" is therefore a **reproduction pass**
over a stored failure — a work item that does not exist yet (§12), never a silent re-execution.

**A failure that does not reproduce is retained, not deleted.** It is counted `unreproduced` and
rendered only as a count. Deleting it would have manufactured `failures === 0`, the promotion floor
(`artifact-promotion.ts:163`), so the plan's own evidence rule would have created eligibility to
promote. Until the pass exists, `unreproduced` is **`null`, not 0** (D19): promotion is allowed when
`failures === 0` or when the pass ran and `unreproduced === 0`, and refused with
`EVIDENCE_UNREPRODUCED_UNKNOWN` while the count is unknown.

**Rendering.** One clause per artifact, inside the existing budget: the directive digest is
capped at 1000 characters and 6 lines, the verification value at 240
(`library-digest.ts:19-40`), and the evidence line is already suppressed whenever a
verification note exists (`:240`). **Precedence, decided:** when a verification note exists it
wins and the observed check is *not* rendered — it stays a field on the row and a line in the
report. When no note exists the check renders in place of the evidence line. The two never render
together, and a red-first test asserts the worst-case digest length — raising that budget is what
produced the dropped-entry regression the code's own comment records (`:20-28`).
Evidence is keyed to `declarationDigest`, so it cannot survive an edit to the note it sits
next to.

## 9. Phase 3 — the skill module contract (M)

Ships independently of the store; no model calls, no fixtures. It is the half of the skill
work that is a *product* change rather than a measurement.

### 9.1 Kinds

A tool skill covers exactly one tool and is derivable from that tool's own contract and
traces. A **flow skill** declares two or more tools, is a composition, and is exempt from
the independence rule but must name the composition it assumes. The declarative field is
`requiresTools` in the manifest skill declaration (`manifest.ts:137`). It is a **visibility gate,
not a dependency declaration**: the lifecycle publishes a skill only when its declared tools are
visible, so the field says "this guidance applies to these tools", never "this guidance composes
them". The **kind** is still derived from that declaration (`flow` at two or more declared tools),
which is why an edit to it must orphan evidence (§5.5); the field's other job is visibility. A flow
skill whose guidance mentions fewer than two of the tools it declares is a lint finding (C7), not a
runtime surprise. The repo ships one tool skill (`identify-language`, 60 lines, one tool) and one
flow-shaped skill (`decision-decomposition`, 113 lines, the decision family) that **does not yet
declare `requiresTools`**, so C7 currently has no live subject (Appendix D, O11).

### 9.2 The independence rule

A tool skill is authored from its own tool's contract and traces only. Anything that
depends on a neighbour is a flow skill. This is not style: modules fitted to each other end
2.7 points lower and destroy an early capability (Appendix B), and a skill authored "after
`semantic_rank` returns, do X" is exactly that failure in text form.

### 9.3 Budgets

Two, enforced at render time: `perSkill` (default 1200 tokens) and `aggregate` (default
4000 across injected skills), estimated as `ceil(utf8Bytes / 4)` and labelled an estimate.
Per-skill overflow is an error; aggregate overflow is an error naming the composing skills
and their sizes. A skill is never silently truncated.

The economics here invert the paper's and must not be copied: its 256 positions are
prefilled once and KV-cached (−0.8% to +2.2% throughput), while every skill is billed input
tokens on every request. The `MAX_SKILL_BYTES = 512 * 1024` cap (`index.ts:203`) is a crash
guard, not a budget.

### 9.4 The kill switch

`skills.disabled: string[]` in config plus `DSH_TOOL_MODE_DISABLE_SKILLS` in the
environment. Semantics: the skill is not registered, **the tool stays registered** — the
whole difference from `exclude`. Operator-only; never on a model-visible tool, because a
model must not be able to switch off the guidance that constrains it (same posture as
credential generation being refused on the model-visible surface). The list command reports
`disabled: true` and the reason, so a missing skill is never a mystery.

### 9.5 The conflict lint

Static over playbooks and rendered bodies; semantic comparison is advisory only (D14).
`error` fails `verify:skills`; `warn` reports; `comment` is advisory.

| rule | check | severity |
| --- | --- | --- |
| C1 | the same tool named in skill A's `whenNotToUse` and skill B's `whenToUse` (sources: playbook fields for bundled skills; extension frontmatter when declared; an extension skill with no structured fields is reported `unstructured` and the rule **skips** it — never passes it) | error |
| C2 | two skills with a near-identical `whenToUse` line after normalization | error |
| C3 | contradictory recovery directives across skills ("retry once" vs "do not retry") | error |
| C4 | `pairsWith` naming an unknown tool, or a cycle | error / warn |
| C5 | body mentions a tool that `requiresTools` does not declare | warn |
| C6 | skill or aggregate over budget (§9.3) | error |
| C7 | a flow skill whose guidance mentions fewer than two of the tools it declares | warn |
| C8 | cross-skill trigger similarity ≥ threshold via `text_embed` cosine (default 0.86) | comment |
| C9 | a tool named in a skill is unavailable on this platform | warn |

C2 is the rule that catches the text-space version of two experts writing into the same
weights. C8 may use Tool Mode's own `text_embed`/`semantic_similarity` — dogfooding, not a
new dependency — and can only ever route a skill to a human.

C7 was reformulated during implementation. The kind is derived from `requiresTools`
(`skillKindOf`), so "a tool skill naming two tools" cannot exist: the derived kind would
already be `flow`. The implemented rule checks reference coverage instead — a flow skill
that declares two tools but only ever mentions one is the copy-paste declaration failure
the original rule was aiming at (§17).

### 9.6 What this phase does not do

It does not measure anything. A digest and a budget make a skill *identifiable* and
*affordable*; only §10 says whether it helps.

## 10. Phase 4 — skill measurement (M)

Built entirely on Phases 0–1: no replay, no synthetic call, no new store.

### 10.1 The counterfactual is a suite pair, not a session arm

Volume is not evidence (D10), and a production session cannot be its own control. The
counterfactual is a **suite execution pair**: the same pre-registered tasks, the same model,
the same fixtures, run once with the skill body injected and once with it suppressed through
the static `skills.disabled` switch (§9.4). Nothing in production is randomized, so nothing in
production is claimed to be causal. The observational store still reports call-shape rates;
those are descriptions, never deltas.

### 10.2 The skill evidence rule

Two inputs, two outputs. From **observations**, the rule may lower a skill guardrail on a
`call_*` signal, and may not conclude that the skill caused it. From **suite pairs**, the rule
may produce a causal verdict for the skill on those tasks — and says "on these tasks", never
"in the field". The store cannot vote on the suite, and the suite cannot raise a store
guardrail.

### 10.3 The ablation, and what may be deleted

Run the suite with the skill, and again without it, over the same task list. Outcomes are
paired **per task**; the unit of analysis is the task, not the session or the call. Report:

- the exact one-sided sign test over discordant pairs (minimum 6 pairs, as §11 already requires),
  with the Clopper-Pearson lower bound;
- the paired difference in percentage points with its interval;
- the pre-registered MDE for that suite size.

A skill is a **deletion candidate** only when the paired difference shows harm whose interval
excludes the equivalence margin and clears the MDE. Below the pair floor the cell is
`insufficient(n, need)`, and a difference whose interval spans zero is **"no evidence"**, printed
as such — never "no effect". Cross-family effects are measured by running the *other* families'
suites with this skill suppressed: the removal matrix survives as a **suite** matrix, and the
observational one is gone.

The matrix is many comparisons. One family is pre-registered as **primary** and carries the
decision; every other cell is reported with a **Holm correction** across the family × skill grid,
and a cell without that correction is labelled exploratory and may not support a deletion.

The pair floor is **registered at 6 for every family**. A different floor for a rarely used family
is a dated amendment to a frozen gate, recorded before the run, never a post-hoc choice.

### 10.4 Order sensitivity

The same suite in three arrangements: alone, composed in catalog order, and composed last
(nearest the model's attention). Report the spread. Rationale unchanged — the paper's
composition fell from 107.5 to 87.0 recovery without prefix-robust training — and a skill that
only works in one arrangement is not composable and does not ship.

### 10.5 Length sweep

The same suite at the skill's current length and at ~25% and ~10% of its tokens, dropping the
lowest-value sections. Report the paired difference and the token delta. "Matches" means the
paired difference's interval lies inside the pre-registered **equivalence margin**, never a
non-significant result — absence of evidence is not equivalence, and reading it as such ships
the cheapest text every time the sweep is underpowered. The paper's knee is 32 vectors (90.0%
of the 256-vector recovery); ours is measured, not inherited.

### 10.6 The report is a view

`SkillReport` = `{schema, version, generatedAt, skill, environment, suites[], verdict}`, where
`environment` records the model, route, harness version, catalog revision, renderer version and
signals version (plus seed and temperature when they apply), and `suites` holds the ablation matrix,
the order spread and the length curve. It is produced by the suite runner and the store, and stores
nothing itself. `recovery` appears only where a pre-registered reference exists (§11), is `null`
whenever the base-to-reference gap is below `gapFloor` (default 0.05) or the pair count is below
the **pair floor** (6, Appendix C), and is always printed next to absolute rates. The formula is
`(withCard − base) / (reference − base)`; nothing else is called recovery. Following
`laya-gates.json`'s posture:
coverage is gated, accuracy is reported with intervals, and no threshold is tuned on its own
fixture.

## 11. Phase 5 — skill admission and demotion (L, blocked on a reference bank)

**Why this is not promotion.** A bundled skill ships inside the package and is already
global with zero uses; an extension skill ships inside the extension. The artifact floor
(`DEFAULT_MIN_USES`, `artifact-promotion.ts:163`) can therefore never apply, and exempting
skills from it would recreate the "gates that cannot fail" finding that v1's review killed.
So skills get a different lifecycle:

- **Admission at release.** `evaluateAdmission` requires either a `SkillReport` whose
  verdict is `pass`, or an explicit `admitted-insufficient` entry in
  `verification/release/<version>/admission.json` with a reason (§5.3), never silent, and checked by
  `verify:release`. `pass` means: on the suite, no family's harm interval falls below the equivalence
  margin, and where a reference exists recovery meets its pre-registered bound. An uncomputable
  predicate is `insufficient`, never `pass`; a `fail` blocks admission.
- **Demotion on evidence.** A skill whose suite paired difference shows harm — interval
  excluding the equivalence margin, cleared against the MDE — becomes a deletion candidate; a
  cross-family harm blocks the next admission until explained; the kill switch (§9.4) is the
  emergency path and needs no release.
- **One authority each way.** `evaluatePromotion` remains the only authority for
  artifacts; `evaluateAdmission` is the only one for skills; neither can be used to bypass
  the other, and `force` still cannot reach global for artifacts.

**Blocked on the reference bank** that v1 §6 already requires for the proposal pass: a
pre-registered set with positives and negatives, an owner, a path frozen before the edit,
and a decision rule (exact one-sided sign test of paired outcomes against p = 0.5, minimum 6
pairs, Holm-corrected across the suite matrix's pre-registered family, Clopper-Pearson lower bound
reported against 0.5, no peeking). Without it, §10.6 reports `recovery: null` and admission
is `insufficient` by construction. That is acceptable and must be stated in the release
report rather than hidden behind a plausible number.

**What the bank must never be.** Not the card's own history (a counter laundered into a
score), and not a positives-only set (over-selection is the failure mode a positives-only
bank rewards).

## 12. Phase 6 — the proposal pass (parked)

Renumbered from v1's Phase 3; content unchanged apart from the carve-out at the end. The draft's headline was a proposal pass:
draft a declaration edit, replay it, judge it, promote it. The review showed the gate could
not be built as described, so it is **parked rather than planned**, and the preconditions
are named so a future attempt starts honestly. No proposal pass ships in this programme.
The same parking applies to "auto-edit a skill from its evidence": it is the same missing
fixture and the same missing bank.

1. **A frozen two-snapshot replay fixture.** The planning surface captures its schema
   snapshot lazily and freezes it for the tool's life; the offered set is intersected with
   the live caller grant at call time (`index.ts:5559-5585, 5715`). A draft is never
   registered, so a replay through the live tool would show the incumbent twice. The
   fixture must load two frozen snapshots and one byte-identical request in a single
   process, recording engine bytes, snapshot generation and prompt digest.
2. **A pre-registered reference bank with an owner and a path, frozen before the edit.**
   Positives with expected outcomes and **negatives that must not select the artifact** —
   over-selection is the failure mode a positives-only bank rewards. The decision rule is
   the one in §11; below the minimum, `insufficient(n, need)`.
3. **One promotion authority and a real restore path.** `evaluatePromotion` is the only
   authority; auto-keep and draft promotion must be reconciled with it or excluded. A
   freshly drafted declaration has zero uses, so it cannot pass that floor without
   `force` — and `force` to `global` is refused outright
   (`artifact-promotion.ts:160-186`). `demote` deletes the resolved row
   (`agent-authoring.ts:1943-1958`) and no previous version is retained, so "rollback" is
   only true if the draft stores `replacesDigest` plus the incumbent declaration bytes.

Two rules carry over unchanged and are worth stating because they were the draft's best
part: the judge may **veto only** — a model's "loss" can block a promotion, never enable
one, and it must not be the same implementation that produced the labels; and the counters a
drafter can see are part of the problem, not just the proof (they are already rendered into
the prompt at `index.ts:4090-4104, 4182-4195`).

Edits target the fields an authored tool actually has: `description`, `purpose`,
`verification`. `whenToUse` is not one of them — it belongs to skill and model declarations
(`discovery-describe.ts:84-107`).

## 13. Not in this programme

Each item below is a **pointer to the decision that forbids it**; the reasoning lives in the decision
row, not here. Each bullet states only the minimum needed to be intelligible; the rule it points at
lives in the decision.

- **Weight-level learning, soft prompts, fine-tuning.** Out of scope for the release; if
  wanted, a separate product reading this host's logs. The log is the asset, the learned
  artifact is a cache. No trainer in this plugin. Appendix B records why the paper's
  mechanism does not transfer.
- **Suite scores inside the store.** Suites are the decision basis for admission and deletion (D17) and are therefore very much in this programme — but their scores never become store rows. A verdict is cited by digest; the store stays observational (D1).
- **Idle preparation slices.** The scheduler shape assumes a job model this host does not
  have; a foreground invocation is cancelled or finishes and is never replayed
  (`harness-budgets.ts:11-12`). Whoever needs it next should design it against this host
  rather than inherit a transplanted one.
- **Prose lessons in the digest.** Nothing renders a sentence nobody can check;
  `artifact-usage`'s own contract rejects free prose and the ledger's no-counterfactual
  rule stands.
- **Training on real sessions.** Every session here is a real task.
- **A second store, vocabulary or promotion path for a new class.** D12.
- **LLM-judge scores as a measurement.** A model may veto — a boolean refusal with a reason that blocks a promotion (§12) — and may not grade; D20 is the decision.

## 14. Development method — test-first, and gates that can fail

Every slice in this programme is built the same way. The method is part of the plan, not a
convention left to each implementer, because the interesting failures here (a counter read as
correctness, a gate that cannot fail, a signal that is really a prose judgement) all look fine
in review and only show up when someone tries to make them fail.

### 14.1 The loop, per slice

1. **Name the defect.** The test file opens with the defect it prevents, the way
   `tests/extension-skills.test.ts` does: what silently went wrong before, and what would go
   wrong again without this test.
2. **Write the failing test first.** One test per observable behaviour, plus a negative
   fixture for every rule — the set that must NOT trigger C2 is as much a test as the set that
   must. Run it and keep the output: `npx tsx --test packages/dsh-tool-mode/tests/<file>.test.ts`.
   A test that passes before the implementation exists is not testing the implementation.
3. **Implement the minimum.** No refactor while red, and no second behaviour in the same step.
4. **Green, then rewind.** Re-run the file, then remove the behaviour and confirm the test
   fails (the mutation check, §14.2). Re-apply it.
5. **Widen.** Adjacent suites, then `npm run typecheck`, then `npm run verify:static`
   (typecheck, build, `lint:effect`, `verify:built`, confinement evidence).
6. **Record.** Write `verification/<phase>/REPORT.md` (§14.6) while the numbers are fresh.

### 14.2 What counts as verification

- **The real mounted plugin.** A test that mocks the skill or tool registry proves the mock.
  `mountPlugin` from `tests/helpers.ts` mounts the shipping service stack, and
  `ctx.skills.list()` is the same surface a model sees — that is what the assertions read.
- **A test that fails when the behaviour is reverted.** The mutation check in step 4 is the
  whole point. A revert result is now on record: `verification/phase3/REPORT.md` §3 shows the flow
  threshold mutated from `>= 2` to `>= 99`, the named test failing, and the revert restoring 26/26.
  Before that, the record held only a red run and two corrected expectations; the practice exists
  for this phase, and the next phase owes its own.
- **Determinism.** No fixed sleeps; a wait must poll a condition with a deadline.
  `tools-plan-hosting.test.ts:660` waits 600 ms for a restore pass and is the single test
  that failed in a full run while passing 27/27 in isolation (§17).
- **No network, no clock, no absolute path in an assertion.** A digest test runs under two
  different working directories and demands one value; a signal test replays a fixture ledger.
- **Both directions for every rule.** One fixture that must fire and one that must stay
  silent. For C1 the negative is a skill that contradicts only itself; for C8 it is the same
  pair of skills with no similarity function supplied.

### 14.3 What is not verification

- asserting that a function was called, or that a config value was read;
- a green targeted suite standing in for the gate (step 5);
- `anti_slop_lint` reported as passing when it reports `oxlint-not-found` — it does in this
  environment, so the honest record is "not run", not "clean";
- a number taken from a usage counter and rendered as if it were measured (D2);
- a screenshot of prose.

### 14.4 Rule → test matrix

| behaviour | proof | command |
| --- | --- | --- |
| skill digest is stable, order-insensitive, and changes on every editable field | `skill-contract.test.ts` digest suite | `npx tsx --test packages/dsh-tool-mode/tests/skill-contract.test.ts` |
| budgets: per-skill error names the skill, aggregate names the composing skills, warn band before the cap | same file, budgets suite | same |
| C1–C9 fire and stay silent (both directions) | same file, conflict lint suite | same |
| a disabled skill is unpublished while its tool stays registered | `skill-disable.test.ts` | `npx tsx --test packages/dsh-tool-mode/tests/skill-disable.test.ts` |
| the environment list overrides nothing but adds to the config list | same file | same |
| classification lanes: non-host binding classifies nothing; abstention stores `null` | Phase 0 tests (to be added) | `npx tsx --test packages/dsh-tool-mode/tests/<phase0>.test.ts` |
| `unreproduced` blocks promotion and is never deleted | Phase 2 tests (to be added) | targeted |
| the skill is suppressed for exactly one suite run, and the tool stays registered | Phase 4 tests (to be added) | targeted |
| paired outcomes below the **pair floor** (6, Appendix C) report `insufficient(n, need)`, never a Δ | Phase 4 tests (to be added) | targeted |
| a suite cell whose interval spans zero prints "no evidence", never "no effect" | Phase 4 tests (to be added) | targeted |
| admission requires a `pass` report or an `admitted-insufficient` entry in `admission.json` | Phase 5 tests (to be added) | targeted |

The phases marked "to be added" are a commitment with **an owner, a date and a gate that notices
absence**: the owner is the phase's implementer, the date is that phase's start, and from
2026-12-01 a test asserts that each row's named test file exists (one assertion per row, in the
phase's own suite — no new script, because a gate that names an unwritten command is the failure this
plan keeps finding). Until the date passes, the row is listed in every phase report under "not yet
implemented", which is the only reason a plan can legitimately carry one.

### 14.5 Commands, and what each one must show

| step | command | must show |
| --- | --- | --- |
| the red run | `npx tsx --test packages/dsh-tool-mode/tests/<file>.test.ts` | the failure the test was written to produce: for a new module `ERR_MODULE_NOT_FOUND` naming it, for a behaviour the assertion that names it. A red run that fails for another reason is re-run, not recorded |
| the green run | same | every test in the file passing, with the count |
| adjacent suites | targeted list of the suites sharing the touched surface | pass, with the count |
| types | `npm run typecheck` | exit 0 across every workspace package |
| the gate | `npm run verify:static` | exit 0 |
| full suite | `npm test` as a **background job** — roughly 11 minutes, real model loads | no new failure; a known flake is named, re-run in isolation, and **recorded** in the phase report. A flake that recurs after that is a defect: it opens a task against the harness and is no longer tolerated |
| docs | `npm run verify:docs` | exit 0; a failure must name its cause and is never waived silently |
| lint | `anti_slop_lint` on every changed file, when installed | a recorded result; `oxlint-not-found` is recorded as not run |
| the report script | `node scripts/evaluate-<phase>.mjs --out verification/<phase>/<name>.json` | measured values, or `null` with the guard that produced it |

The full suite is not run inside a 120-second tool deadline: it takes long enough that the
run must be started as a background job and collected, which is also how a developer should
run it.

### 14.6 The phase report

`verification/<phase>/REPORT.md` is the artifact a reviewer reads instead of re-running
everything. It contains, in this order:

1. the command that went red, and its verbatim failure line;
2. the command that went green, with counts;
3. the gate command and its output;
4. every measured value, or `null` **and the name of the guard that produced it** —
   `insufficient(n, need)`, `evicted`, `gap-too-small`, `no-reference`;
5. the tests added, each with the rule or behaviour it pins;
6. what was not run (lint, network-dependent checks) and why.

A report that contains a number without its command, or a `null` without its guard, is
incomplete rather than optimistic.

### 14.7 Named tests the review demanded, plus the integration's

- a decision binding whose resolved location is not `host` classifies **nothing** and
  records the refusal; setting only `harnessModel` produces no harness classification;
- an abstaining classifier stores `null`, not an approval; an uninstalled classifier
  reports `unavailable`, not zero signals;
- a failing use whose class does not reproduce leaves `failures` unchanged, is counted
  `unreproduced`, and blocks promotion **while that count is `null` or non-zero** (D19) — a
  `failures === 0` row is promotable;
- a digest whose worst-case observed check exceeds the budget fails; a verification note
  and an observed check never both render;
- adding an editable declaration field without adding it to `declarationDigest` fails the
  identity test — for artifacts **and** for skills;
- a forged `force` to `global` is still refused when the proposal path is enabled;
- a projection `stateVersion` bump reports `null`, never `0`;
- editing a `whenToUse` line changes the skill digest and orphans its prior evidence
  rather than inheriting it;
- disabling a skill leaves its tool registered and callable;
- an aggregate budget overflow names the composing skills and their sizes and fails the
  gate;
- a C1–C9 finding at `error` severity fails `verify:skills` **once that script exists** — until
  then the gate is `unavailable`, not passing (§14.8 row 3); C8 in `comment` mode never fails a
  build;
- a suite cell below the pair floor reports `insufficient(n, need)`, never `0`, and `evicted`
  prints differently from `insufficient`;
- a skill with no reference bank reports `recovery: null` and an `insufficient` verdict;
- admissions without a `pass` report are refused unless an explicit `admitted-insufficient` entry
  exists in `admission.json`, checked by `verify:release`.

### 14.8 Phase gates

| phase | pre-registered threshold | null outcome |
| --- | --- | --- |
| 0 | `correction` precision lower bound ≥ 0.90 on ≥ 50 labelled messages; ≥ 8 distinct sessions carrying any signal | `unavailable(reason)` or `insufficient(n, need)` while gathering; `fail(programme-stop)` when the bound is measured and missed |
| 1 | ≥ 8 distinct sessions per `ArtifactRef` for a guardrail to be readable | `insufficient` or `evicted`, distinct |
| 2 | a reproduction pass over the stored failures of the declaration reproduces the observed check in 3 consecutive cases | `unavailable` until the pass exists — the failure is counted and promotion is refused while `unreproduced` is `null` (D19), not waived |
| 3 | `verify:skills` exits 0 with C1–C9 wired over the registered set; every registered skill reports a digest and a token count; aggregate within budget | `unavailable` until `verify:skills` exists — never `pass` |
| 4 | the suite runs both conditions over the pre-registered task list; ≥ 6 discordant pairs before a cell is readable; the MDE is fixed before the run; the floor is registered per family and changed only by a dated amendment | `insufficient(n, need)`; a cell whose interval spans zero prints "no evidence" |
| 5 | admission requires a `pass` report — an explicit predicate over the suite (no harm interval below the equivalence margin; recovery meets its bound where a reference exists) — or an `admitted-insufficient` entry in `admission.json` | `insufficient` by construction without a reference bank |
| 6 | parked; without the reference bank the gate is `insufficient` by construction | `insufficient` — a proposal is refused with a reason, never silently dropped |

## 15. Review record

v1 review files (the review itself, not this plan, is the record of what was wrong):

- `research/reuse-evidence-review/spec.md` — accept-with-fixes; 12 findings, 5 blockers.
- `research/reuse-evidence-review/architecture.md` — reject; 12 findings, 3 blockers.
- `research/reuse-evidence-review/evidence.md` — reject; 12 findings, 6 blockers.

Adopted without change from that review: the ban on the counter-as-correctness predicate
and the word "working"; the removal of the replay and the **retention** of unreproducible evidence
(counted, never deleted — D9/D19); the parked proposal pass; the withdrawal of the log-file reader; the locality
check on lane 1; the declaration-keyed evidence; the storage rewrite; the falsifiable
gates; the retention and erasure section; the renaming.

Adopted with a correction: the review's advice to drop lane 1 for lack of a dispatch path
is not taken — the host does dispatch contract implementations in process
(`extension-dispatch.ts:205,239`) — but the locality and provenance caveats are.

**Not adopted, deliberately:** an automatic "else the session's model" fallback. The review
is right that it is BASE-08/SEC-10's prohibited pattern; the operator's instruction is not
overridden so much as routed through consent — the second lane exists, and it is switched
on rather than fallen into. If that is not acceptable, the honest alternative is one lane,
and no correction signal on a machine without a local decision checkpoint.

Rejected as unverified rather than chased: the session-log path cited by an earlier draft
does not exist in this tree; the host reads stored history through `sessionPersistence`
(`index.ts:1647-1671`), which is why §6.2 is a projection and not a reader.

**v2 integration record (this revision).** The skill work arrived as a separate spec and is
merged rather than referenced, so the substrate is decided once. Changes it forced are
listed in §0; the substantive ones are: skills as a third ref kind (§5.4), the skill digest
over the narrower declaration surface (§5.5), `call_*` signals (§6.1), skill rows in
the one store (§7), Phases 3–5 (§9–§11), and admission/demotion as a separate lifecycle
with its own authority (D6). The skill draft's own claims that did **not** survive
integration, and why:

- its "removal matrix by forced replay" — replaced by suite-run arms (D5, D17);
- its "recovery for every skill" — restricted to skills with a pre-registered reference,
  because the paper's own §5 warns that small gaps make the ratio noisy and our report
  would otherwise print large numbers over one-point gaps;
- its "promotion into global scope" — replaced by admission/demotion, because a bundled
  skill is born global;
- its second store and second gate vocabulary — dropped (D12, §5.3).

**v2.1 amendment — the call-shape signals (2026-11-21).** The integration added three
`call_craft_*` signals. Review found two of them re-derived facts the store already records
and the third to be a judgement about the agent's prose, which §6.1 and D1 both forbid. They
are replaced by `call_probe` (ordering over receipts: a bind with no prior describe) and
`call_retry_changed` (a derived rule over `tool_error` + `repeat_changed_shape`), and the
family is renamed `call_*`. D15 records the rule this settled. Nothing in code referenced the
old names — `skill-contract.ts` is about skill bodies, not signals — so the change is
documentation only.

### v2.2 record — the adversarial review of this plan (2026-11-21)

Three independent reviewers (spec / architecture / evidence) adjudicated all twenty sections
section by section; the files are the record, this table is the index:

- `research/reuse-evidence-review/v2/spec.md` — 50 findings, 8 blockers.
- `research/reuse-evidence-review/v2/architecture.md` — 36 findings, 2 blockers.
- `research/reuse-evidence-review/v2/evidence.md` — 47 findings, 5 blockers, 1 unverifiable.
- `research/reuse-evidence-review/v2/SYNTHESIS.md` — seven blocker themes (T1–T7).

| theme | lens | disposition | where |
| --- | --- | --- | --- |
| T1 arms were labels nobody applied | arch, evidence | **fixed** — arms are suite run conditions | D5, D17, §7, §10.1–10.3 |
| T2 the projection cannot see `dataFlow` | arch | **fixed** — edge signals persist in the composition path | D18, §6.2 |
| T3 `unreproduced === 0` by default | evidence | **fixed** — `null` until the pass exists | D19, §8 |
| T4 `pass` undefined | evidence | **fixed** — explicit suite predicate, unreachable → `insufficient` | §11, §14.8 |
| T5 the Phase 3 gate satisfied by not running the lint | evidence | **fixed** — §14.8 row 3 is now "`verify:skills` exits 0", with `unavailable` until the script exists | §14.8 |
| T6 the deletion rule was a bare point estimate | evidence | **fixed** — interval, MDE, multiplicity | §10.3, §11 |
| T7 eight undecidable definitions | spec, arch | **fixed** — union surface, window, retention, reproduction, `requiresTools` semantics, reason codes and red-run shape; the red half is now persisted in `verification/phase3/REPORT.md`, and the digest's missing `requiresTools` is a code task in §17, not an open definition | §5.5, §6.1, §6.3, §7, §8, §9.1, §9.5, §14.5, §17 |

Majors and minors that are **not** fixed by this pass are tracked one per row in **Appendix D**, and
are not waived:

- §8's precedence between an observed check and a verification note is **closed**: the note wins,
  the observed check stays a field and a report line, and the two never render together.
- Every other deferred finding from the three lens files is either in Appendix D or belongs to the
  next review round; §14.4 applies to any that carries a test.


### v2.3 recheck record — fixed-or-not (2026-11-21)

> The three recheck files were written against the text **before** the repair pass below, so their
> verdicts on T5 and T6 describe the pre-repair document. What they found is still the right input;
> what they say about those two rows is superseded by this revision's repair and by Appendix D.

The three lenses were sent **only the changed sections**, with the v2.2 disposition table as input,
and told to return FIXED / PARTIAL / NOT FIXED plus the new issues their edits introduced.

| lens | findings re-adjudicated | FIXED | PARTIAL | NOT FIXED | new issues |
| --- | --- | --- | --- | --- | --- |
| spec / contract (`recheck-spec.md`) | 44 | 7 | 7 | 30 | 22 |
| architecture (`recheck-architecture.md`) | 33 | 7 | 7 | 19 | 25 |
| evidence (`recheck-evidence.md`) | 42 | 8 | 11 | 23 | 25 |

The recheck did what the first pass could not: it found **edit damage** the stale-phrase greps were
blind to, and it rejected several disposition claims. Repaired in this revision (and in v2.6, which
closed nine of the twelve open findings and recorded the first mutation check in
`verification/phase3/REPORT.md`):

- §0 row 3 had three cells in a four-column table (a gate row had overwritten it) — restored, and the
  gate text moved to §14.8 row 3, which is what T5 claimed all along;
- §5.5's artifacts bullet was cut mid-list and the skills bullet duplicated itself twice — both
  rebuilt, with `requiresTools` added to the skill digest;
- §6.3's lane-1 sentence had lost its subject and the first function name — restored;
- §7 repeated its eviction sentence and `applied` read as an arm label — rewritten, with a
  refuse-second-writer rule replacing "a documented merge rule";
- §10.3's report list was cut mid-sentence after the first bullet — the sign test, the paired
  difference, the MDE, the deletion rule and the Holm correction are all back;
- §13's suites bullet argued the section's opposite — retitled and rewritten;
- D7 contradicted D18 and D9 contradicted D19 — both decisions now state the same rule;
- §17's identity row claimed one declaration shape for two, and now says the digest lacks
  `requiresTools`;
- goals 1 and 4 were false against §10.1 and §14.8 — reworded.

**Still not fixed, recorded rather than waived:** 30/19/23 findings respectively, dominated by
pre-existing majors (the unindexed correction list, `scopeKey` and `artifact` definitions that only
now exist in Appendix C, D2's unrendered ban on "working", C1/C3's unstated sources, §11's
`admitted-insufficient` marker having no owner or verifier, §14.8's remaining checklist-shaped
rows). They are the backlog for the next round; the disposition table above is corrected where a
recheck disproved it, and T7 there is **fixed** after the v2.6 repairs.


### v2.7 pass — the final recheck's damage and contradictions

A third pass sent the three lenses the repair list only; they returned FIXED 8–11 of 15 points, one
"still wrong" (the spec's Appendix C), and 14 pieces of adjacency damage plus 26 cross-section
contradictions. The damage was
again in the record layers, not the rules. Repaired here:

- §14.2's self-denying revert sentence and §17's orphaned duplicate line;
- Appendix A's §12 carve-out moved to §12's intro, where it actually is;
- Appendix C now defines every term its preamble names — including `artifact`, `scopeKey`, `gate`,
  `pass`, `recovery`, the **equivalence margin** (±2 pp, pre-registered) and the null outcome — and
  its skill-declaration row matches §5.5's two shapes;
- Appendix D's arithmetic: nine closed, three open, with the missing O12 row restored;
- §7 no longer claims `failurePaths` for a skill; §5.5's equality test now compares the **declaration
  subset**, not the fixed digest inputs; §9.1 states that the flow exemplar declares no
  `requiresTools`; §11's admission entry is the `admission.json` record with an explicit `pass`
  predicate; §13's intro says each bullet is a pointer; §14.7 blocks promotion only while
  `unreproduced` is null or non-zero; §14.8 rows 0 and 2 use `fail(programme-stop)` and a stored-failure
  reproduction pass; §10.6 uses one name for the floor and states the recovery formula; §14.4's gate is
  a test in the phase suite, not an unwritten script; §15's T7 row is fixed, its O12 deferral is
  closed, and its adopted list says "retention", not "deletion".

## 16. Decisions this plan does not make for you

1. **Is lane 2 switched on anywhere?** Recommendation: no, until someone needs it, because
   it is the only path in this plan that sends conversation text off the machine.
2. **Who owns the reference bank, and where does it live?** Without a named owner and a path
   fixed before the edit under test, Phases 5 and 6 cannot be audited and stay blocked /
   parked.
3. **May the counter surface stay visible to a drafting model?** It is already rendered into
   the prompt (`index.ts:4090-4104, 4182-4195`); if a proposal pass is ever built, hiding or
   accepting that is a product decision, not a detail.
4. **Does the aggregate skill budget belong to the operator (a product cap) or to the
   profile (a per-deployment cap)?** Until an owner decides, the 4000-token operator default in
   §9.3 applies and a profile cannot raise it — the narrower of the two readings.
5. **Who runs the skill suites, and how often?** Ownership of the *bank* is question 2; this is
   the separate question of who executes the runs and records their digests, without which a
   deletion has no author.

   The former item 6 — whether the pair floor may differ per family — is answered in §10.3: the floor
   is registered at 6 for every family and a change is a dated amendment before the run.

## 17. Implementation status (2026-11-21)

**Landed — the first slice of Phase 3.** The mechanical half of the skill contract, without
the store:

| Piece | Where | What it does |
| --- | --- | --- |
| Identity | `src/skill-contract.ts` → `skillDigest` | sha256 over the renderer version, the tool, the source digest, the body digest and the declaration the skill actually has (`name`, `description`, `whenToUse` for bundled; `name`, `description` for extension skills). **`requiresTools` is not yet in the digest** — §5.5 now requires it, so the module needs the field added |
| Size | `estimateSkillTokens` | four bytes per token, rounded up, labelled an estimate wherever it is reported |
| Budgets | `checkSkillBudgets` | per-skill error naming the skill; aggregate error naming the composing skills and their sizes; a warning band at 80% of either cap |
| Kind | `skillKindOf` | `flow` at two or more declared tools, `tool` otherwise |
| Conflict lint | `lintSkills` | C1–C7 and C9 as implemented; C8 only when a similarity function is supplied, and comment-only |
| Kill switch | `Config.skills.disabled` plus `DSH_TOOL_MODE_DISABLE_SKILLS`, wired into both registration paths in `src/index.ts` | a disabled skill is not published; its tool stays registered and callable |

**Verified on this change.** The module was written red-first: the first run of
`tests/skill-contract.test.ts` failed with `ERR_MODULE_NOT_FOUND` for `src/skill-contract.ts`,
and that output is the red half of the §14.6 report, now **persisted** in
`verification/phase3/REPORT.md` together with the green counts, the mutation check and what was not
run. Two of the file's expectations were then
wrong about the code — a C1 fixture whose second skill did not declare the tool it argued
about, and a C6 case that also breached the aggregate cap — and both were corrected in the
test, not by loosening the rule. `tests/skill-contract.test.ts` → 26 pass.
`tests/skill-disable.test.ts` → 3 pass: the disabled skill is absent, the tool set is
unchanged, the environment override is honoured, and an unknown name changes nothing. The
adjacent suites (`extension-skills`, `tool-description-surfaces`,
`tool-description-registration`, `plugin`) → 32 pass across 11 suites. `npm run typecheck`
passes for every workspace package. The full `npm test` run reported 4084 tests, 4058 pass,
25 skipped and **one** failure — `tools-plan-hosting.test.ts:660` ("refuses at publication a
`tools_plan` contribution WITHOUT the planning input shape"), which asserts an extension's
`observedActivation` after a fixed 600 ms restore sleep and stayed `active`. That suite passes
27/27 in isolation and on two repeat runs, the failing path never reads the skill
configuration, and the disabled set is empty in that test, so it is recorded as a pre-existing
timing flake (§14.2). That classification rests on the isolation passes, **not on a pre-change
baseline** — none was run on an unmodified tree, so "pre-existing" is an inference and is recorded
as one. `anti_slop_lint` could not run here — it reports `oxlint-not-found` — so no lint result is
claimed from it.

**Not built yet.** Budgets are not enforced at render time (the functions exist, the wiring
does not); the digest is computed but not yet reported on any surface (`skills list`, or a
`model_tools` action), so the Phase 3 gate "every registered skill reports a digest and a
token count" is not yet met; the digest also lacks `requiresTools`, which §5.5 now requires;
`verify:skills` does not exist, so the lint cannot fail a build; C8 has no embedding wiring; and
Phases 0-2 and 4-5 are untouched. Phase 4's design changed after this slice shipped (D17): it is now
a suite experiment, and nothing built so far depends on that choice.

**Deliberate residue.** A disabled skill is logged at info level on each mount, so a missing
skill is not a mystery before the list surface exists. Open findings are tracked in Appendix D.

## Appendix A — v1 → v2 section map

| v1 | v2 |
| --- | --- |
| §0 what the review changed | §0 (integration changes appended; v1 corrections retained) |
| §1 what this programme is | §4, with §1 Background and §2 Goals new above it |
| §2 the seams | §5, extended with §5.4 skill ref kind and §5.5 the identity rule |
| §3 Phase 0 signals | §6, extended with `call_*`; edge signals now persist where the receipt is built (D18) |
| §4 Phase 1 store | §7, extended with skill row fields |
| §5 Phase 2 observed check | §8, unchanged |
| §6 Phase 3 parked proposal | §12 Phase 6 — renumbered; its intro gained the "auto-edit a skill" carve-out; the three preconditions are unchanged |
| §7 not in this programme | §13, extended |
| §8 verification | §14, rewritten as the development method: the loop, what counts as verification, the rule → test matrix, the commands, the phase report |
| §9 review record | §15, extended with the v2 and v2.1 records |
| §10 decisions not made | §16, extended |
| (new) | §1 Background; §2 Goals; §3 Decisions in force; §9 Phase 3 skill contract; §10 Phase 4 skill measurement; §11 Phase 5 admission and demotion; §17 implementation status; Appendix C Definitions; Appendix D open findings |

## Appendix B — what the CSPD paper gave us, and what it did not

| CSPD result | Number | This plan |
| --- | --- | --- |
| one soft prompt recovers an expert | ≥90% of the teacher's gain in 22/23 settings | borrowed as a *shape*: a small module can carry a capability. Not as a claim about text. |
| independent modules compose | 67.83 vs 67.79 (MOPD); out-of-domain 56.6 vs 53.5 | borrowed: the independence rule (§9.2). |
| progressive fitting is worse | 67.83 vs 65.17; IFBench 66.71 → 52.71 → 50.88 → 61.42 | borrowed: author each skill alone, test it in composition. |
| prefix-robust training matters | 107.5 → 87.0 recovery without it | borrowed: order sensitivity (§10.4). |
| removal matrix attributes capability | removing Math costs 6.5 points on GPQA; removing Science costs 1.1 | borrowed: leave-one-out across families (§10.3). |
| length knee | 2→51.2%, 8→74.1%, 32→90.0%, 256→93.1%, 512→87.8% | borrowed: the length sweep (§10.5). |
| **written instructions do not reproduce it** | **86.8% of the KL gap by prompt vs ≤2.1% by same-intent text** | **the boundary of this plan.** Nothing here may present a skill's measured effect as a soft prompt's, and no report may call a skill's guidance a distilled capability. |
| serving cost | −0.8% to +2.2% throughput, 256 cached positions | inverted for us: skills are billed input tokens per request (§9.3). |
| checkpoint selection | peak 92.6% at update 180, final 85.7% | borrowed as a habit: re-measure after every edit; keep the previous measured version so a regression is visible. |

## Appendix C — Definitions

One canonical statement per term; every other section references it. Referenced from §5.3 (gate,
reason code), §5.4 (artifact), §7 (scopeKey), §9.1 (`requiresTools`), §10.3 (equivalence margin),
§10.6 and §11 (recovery, pass), and §14.8 (null outcome).

| term | canonical meaning |
| --- | --- |
| skill declaration | what an author may edit and what the digest covers. Bundled: `DescribeSkill` (`name`, `description`, `whenToUse`) plus the rendered body. Extension: `name`, `description` and `requiresTools` from the manifest declaration, plus the `SKILL.md` bytes (the registration's `content`, `path` and `source` are delivery, not editable, and are not hashed) |
| window | a correction is the **first operator message after the tool result, before any further tool call, in the same session**; a message from another session, or one that arrives after another tool call, is `out_of_window` |
| arm | a **suite run condition** (skill injected vs suppressed), never a production assignment (D17) |
| MDE | the pre-registered minimum detectable effect; below it the answer is `insufficient(n, need)` |
| pair floor | ≥ 6 discordant task pairs before a suite cell is readable |
| reproduction | a pass over a stored failure; until it exists `unreproduced` is `null`, not 0 (D19) |
| reason code | a named cause under `insufficient` (`gap-too-small`, `no-reference`, `admitted-insufficient`, `EVIDENCE_UNREPRODUCED_UNKNOWN`), never a sixth gate outcome |
| retention | 90 days for tool/error/edge rows; 30 days for rows derived from operator words and for `failurePaths` |
| `requiresTools` | a visibility gate on the skill, not a dependency declaration |
| evidence vs store | the store is observational and authoritative for use rows (D3); suites are the causal instrument and never write store rows (D1) |
| artifact | any evidence ref: an authored tool or workflow, a contract-backed tool, or a skill (§5.4). "Skills are not artifacts" is about lifecycle (§11), not the ref kind |
| scopeKey | the key a row belongs to: the session id for `session`, the workspace root for `workspace`, the constant `global` for `global` (§7) |
| gate | the five-outcome check (`pass`, `fail`, `insufficient`, `evicted`, `unavailable`) with reason codes underneath (§5.3). §14.8's phase table is a threshold table, not this interface |
| pass | the admission predicate (§11): no family's harm interval below the equivalence margin, and recovery at its bound where a reference exists |
| recovery | `(withCard − base) / (reference − base)` (§10.6), where `base` is the suite score with the skill suppressed, `withCard` the score with it injected, and `reference` the expert score for the same tasks; `null` under `gapFloor` (0.05) or below the pair floor |
| equivalence margin | the pre-registered band within which two rates are treated as the same. Default **±2 percentage points**, fixed before the run; the pivot of the deletion rule, the admission predicate and the length sweep's "matches" |
| null outcome | the named guard a gate reports when it cannot decide: `insufficient(n, need)`, `evicted`, `unavailable`, or `fail(programme-stop)` when the gate's own stop condition is met |

## Appendix D — Open findings register

The v2.3 recheck left twelve findings; **nine are closed in v2.6 and three remain open**, each
blocked on something this plan cannot supply. A finding leaves this table only by being fixed and recorded,
or by a decision that rejects it.

| # | finding | lens | why still open |
| --- | --- | --- | --- |
| O5 | the `admitted-insufficient` entry is stored and checked, but no `verify:release` exists to check it | spec | the script is a Phase 6 precondition; the plan now specifies the file and the fields |
| O7 | Appendix B rests on a slug URL with no arXiv id, DOI or in-tree copy | spec, evidence | vendoring the PDF is the operator's call; until then the numbers are "as reported" (§1) |
| O11 | Laya's flow skill declares no `requiresTools`, so the C7 rule has no live subject | arch | an extension-side change, outside this plan |

Closed in v2.6, with where:

| was | closed by |
| --- | --- |
| O1 `call_probe` unobservable | the signal is now presence/absence of any `tool_mode_describe` in the session, and the receipt limitation is stated (§6.1) |
| O2 no reader for the operator's message | the pass runs at the next prompt assembly over `sessionPersistence` (§6.3) |
| O3 D12 vs `evaluateAdmission` | D12 now says an admission authority is not a promotion path |
| O4 undeclared `outcome`/`signals[]` domains | both enumerated in §7 |
| O6 MDE vs the paper's 2.1% | reconciled in the decision paper §2 (different quantities: KL closure vs task success) |
| O8 no revert result | `verification/phase3/REPORT.md` §3 records a real mutation check |
| O9 §13 restating §2 | §13 now says it is a pointer table |
| O10 the pair floor as an open question | registered at 6; a change is a dated amendment (§10.3, §14.8 row 4) |
| O12 §8 check-vs-note precedence | decided: the verification note wins, the observed check stays a field and a report line (§8) |
