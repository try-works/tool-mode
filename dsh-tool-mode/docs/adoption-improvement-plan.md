# Adoption improvement plan (2026-11-19 findings)

Status: proposed. This plan turns the three internal reports into implementation work,
with red-first tests and a verification gate per phase.

Sources:

- `D:\DEV\tool-mode-internal\research\reports\2026-11-19-performance-and-improvements.md`
- `D:\DEV\tool-mode-internal\research\reports\2026-11-19-tool-mode-usability.md`
- `D:\DEV\tool-mode-internal\research\plans\2026-11-19-experiment-programme.md`

## Sequence and gates

| Order | Phases | Why this order |
| --- | --- | --- |
| 1 | 0–2 | A measurement or delete defect invalidates every later number. |
| 2 | 3–4 | The product change: directive digest and auto-draft/promote. |
| 3 | 5–7 | The channel, first contact and evidence-backed quality. |
| 4 | 8 | The experiment; only after 0–4 are green. |

Do not start the experiment while Phase 0 or Phase 2 is red. A run on a broken
instrument produces another lower-bound result.

## What the evidence supports

1. **Directive framing beats a passive library listing.** Neutral digest was 0/2;
   a directive naming the artifact was 3/3.
2. **Agents do not initiate authoring.** 0/11 across five wordings, including explicit
   save instructions. They accept a cheap offered action when the work already exists
   and a concrete `runId` is supplied (E2b, 1/1).
3. **An unannounced draft is invisible.** E10 0/1; an announced host draft was
   promoted (E4/E13 1/1).
4. **Reuse is verification-heavy.** The reused workflow was wrong in 5/5 announced
   sessions. Quality metadata shortened verification to the named failure cases but did
   not create trust.
5. **Retention is a policy.** E6 kept a useless artifact; E9's discard framing
   suppressed creation entirely.
6. **Composition does not happen spontaneously.** E5: use 2/2, composition 0/1.
7. **Measurement is the bottleneck.** U29/U35/U36 make reach and reuse lower bounds;
   U31/U32 make volumes floors; U40/U37 can contaminate a condition.

The programme is small-n and its own reports say not to generalise. Treat every
number as a hypothesis for a new build.

## Relationship to the previous plan

The first plan implemented instrumentation, names, quality, `from-run`, a save offer,
a digest and warm/cold. It deliberately shipped a **neutral** digest and a
**list-surface** save offer. The internal evidence says those two are the wrong
surfaces:

- neutral digest: inert (0/2);
- offer in a list: no end-of-work channel; E2b needed a supplied handle.

The D/G/O run in `research/adoption-dgo-2026-11-19` also produced a ceiling effect:
D reused the artifact 10/10 because the callable tool was already visible and its
description matched the task. That run cannot distinguish the digest from tool
description. This plan fixes both the product and the experiment.

## Rules for this plan

- No more prompt instructions telling agents to use Tool Mode.
- Prefer defaults and one-call offers over requests.
- Never fabricate a session result or a metric.
- Each phase starts with a failing test, then the minimum implementation.
- Every phase keeps the flag-off path byte-identical where a flag exists.
- Read-only discovery is free of ARTIFACT state: `tool_mode_list`/`tool_mode_describe`
  never warm, prepare, register or mutate the authoring or usage stores. Their durable
  `discovery` receipts are observability records (measurement), not artifact state —
  keeping them is what lets "looked and declined" differ from "never looked".

## TDD protocol

For every phase:

1. Write the test file and the smallest failing cases before touching source.
2. Run only those tests and record the red output: the failure must be the intended
   missing behaviour, not a setup or type error.
3. Implement the minimum that makes those cases pass.
4. Run the phase tests plus the adjacent regression tests.
5. Run the full host suite and the build/verification gate.
6. Commit the tests and the implementation together. Do not weaken an assertion to
   make a phase pass; move the unresolved case to a later phase instead.

A test that passes before the implementation is not evidence. Delete it or rewrite it.

## Phase 0 — Reconcile the internal findings with this build

Several reported issues may already be fixed in the current checkout (U25/U26 and
parts of U37/U40). Do not assume either way.

**Tests first**

`tests/adoption-baseline-reconcile.test.ts`:

- direct top-level model call produces exactly one receipt, no duplicate inside a
  program;
- direct `workflow_<name>` invocation produces a parent workflow receipt, not only
  nested children;
- a subagent's `lang_detect` call is visible in the root session's reach counter;
- `tool_mode_tools delete` with a workflow name returns a pointing error, not
  `{deleted:false}` with no reason;
- deleting a session row with a workspace copy returns per-scope results and does not
  claim a complete delete;
- list/describe show both stored and callable names.

**Implementation**

Only fixes the tests prove missing. Do not change behaviour by reading the reports.

**Exit criteria**

A written table: each U-number → current result → test name. Anything still failing
moves into the phase below; anything fixed gets a regression test.

## Phase 1 — Truthful artifact operations (U40, U37)

**Goal:** an agent cannot believe a cleanup or a cross-kind call succeeded when it did
not.

**Tests first**

`tests/adoption-artifact-verbs.test.ts`:

- `tool_mode_tools delete {name:'workflow_x'}` returns an error naming
  `tool_mode_workflows` and does not mutate;
- `tool_mode_workflows delete {name:'agent_x'}` returns the reverse pointing error;
- a name that exists in both kinds is resolved by the correct verb, never guessed;
- delete without `scope` reports `deletedScopes`, `remainingScopes` and
  `complete: false` when a copy survives elsewhere;
- delete with `scope:'workspace'` removes only that row and says what remains;
- a promoted artifact cannot survive a default delete without that fact being in the
  response.

`tests/adoption-delete-regression.test.ts`:

- cleanup per scope then `list({scope:'all'})` is empty;
- a session delete does not delete a workspace row;
- deletion receipts name the scope actually removed.

**Implementation**

- A shared artifact-kind resolver used by both authoring tools.
- Pointing errors for the wrong verb.
- Per-scope delete result; `deleted:true` only when no visible row survives.
- Update output schemas and list/describe types.

**Verification**

`npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json`

`npx tsx --test packages/dsh-tool-mode/tests/adoption-artifact-verbs.test.ts \
  packages/dsh-tool-mode/tests/adoption-delete-regression.test.ts \
  packages/dsh-tool-mode/tests/scoped-authoring-store.test.ts`

## Phase 2 — Measurement that can see the session tree (U29, U35, U36)

**Goal:** "looked and declined" and "never looked" are different observations.

**Tests first**

`tests/adoption-receipt-tree.test.ts`:

- direct `workflow_<name>` run creates one parent receipt with
  `artifactName`, `artifactDigest`, `rootSessionId`, and children parented to it;
- direct model call creates a `direct` receipt; a call inside a program creates only
  nested receipts, no duplicate direct row;
- discovery calls create `discovery` receipts;
- a root session with two subagents sees the union of their tool calls in
  `reach.called`, with per-agent counts, without exposing arguments;
- after 250 unrelated calls, the artifact's durable uses still equal the number of
  artifact runs;
- a failed run increments uses and failures, not sessions;
- a failed receipt is not lost when the tool throws before returning.

`tests/adoption-receipt-tree-purge.test.ts`:

- session-tree reach is removed when the root session is disposed;
- no other session's counts leak.

**Implementation**

- Add a session-tree counter keyed by root session id, updated by the existing
  post-execute hook for every tool call.
- Emit direct workflow parent receipts in the direct-run path.
- Keep the direct/discovery lanes already added; test them rather than recreating.
- Extend the durable usage projection only if the tests show a gap.

**Verification**

`npx tsx --test packages/dsh-tool-mode/tests/adoption-receipt-tree.test.ts \
  packages/dsh-tool-mode/tests/adoption-receipt-tree-purge.test.ts \
  packages/dsh-tool-mode/tests/receipt-enrichment.test.ts`

## Phase 3 — Directive digest, not a neutral listing

**Goal:** turn the existing neutral section into a directive that names one artifact,
what it is for, and its known failure mode.

**Tests first**

`tests/adoption-directive-digest.test.ts`:

- with one artifact, text contains an imperative `Use workflow_<name>` and the
  artifact's purpose;
- with a known failure mode in usage evidence, text says
  `Known failure: ...` and does not overstate success;
- with no failure evidence, no invented caveat;
- with more than one candidate, only the highest-ranked candidate gets an imperative;
  the rest are a compact list, not equally directive;
- text remains under 600 characters and four lines;
- caller-scope isolation holds; no session artifact leaks;
- digest is recomputed per assembly, not frozen at mount;
- flag off emits no section and no text.

`tests/adoption-digest-ranking.test.ts`:

- ranking prefers a caller-scope artifact, then workspace, then global;
- within a scope, recent use beats old use; ties are deterministic;
- a low-quality artifact (failures >= uses/2) is not the imperative candidate.

**Implementation**

- Replace `buildLibraryDigest`'s neutral bullets with one directive line plus
  optional supporting lines.
- Add a `failureMode` field to artifact usage/evidence, bounded and evidence-backed.
- Ranking is a pure function; the system-prompt provider calls it per assembly.

**Verification**

`npx tsx --test packages/dsh-tool-mode/tests/adoption-directive-digest.test.ts \
  packages/dsh-tool-mode/tests/adoption-digest-ranking.test.ts \
  packages/dsh-tool-mode/tests/adoption-digest.test.ts`

## Phase 4 — Auto-draft, one-call promote, retention

**Goal:** the agent never has to initiate authoring; keeping the useful draft costs
one call, and unuseful drafts expire.

**Design choice:** a "draft" is an artifact with `status: 'draft'` and
`expiresAt`. It is callable but is not treated as a promoted library member. This
requires an additive authoring-store field and a migration that leaves existing rows
as `status: 'kept'`.

**Tests first**

`tests/adoption-auto-draft.test.ts`:

- every successful `tool_mode_run` leaves exactly one draft with the runId, program,
  tools and shape-only schema;
- a failed run leaves no draft;
- the draft is callable under a stable name and reports `draft: true`;
- `from-run` on a draft is one call and promotes it to the caller scope;
- a second successful run updates the draft rather than accumulating duplicates;
- `captureRunPrograms:false` disables drafts and the refusal says how to enable them.

`tests/adoption-draft-retention.test.ts`:

- an unkept draft expires after the configured session/age bound;
- a kept/promoted draft never expires by this policy;
- expiry records a bounded authoring event and does not delete a promoted copy;
- the default retention policy is visible in list output;
- no draft leaks across caller scopes.

**Implementation**

- Auto-capture in the run path after success, using the existing shape-only capture.
- Add draft status/expiry to the authoring store with an additive schema version.
- `from-run` accepts a draft runId and promotes it; keep the existing auth/gate.
- Add `adoption.draftTtlMs` and `adoption.autoDraft` (default on after validation).
- A scheduled cleanup at mount and on session dispose; bounded.

**Verification**

`npx tsx --test packages/dsh-tool-mode/tests/adoption-auto-draft.test.ts \
  packages/dsh-tool-mode/tests/adoption-draft-retention.test.ts \
  packages/dsh-tool-mode/tests/run-capture.test.ts`

## Phase 5 — The offer channel for a one-shot solver

**Goal:** make the offer reach the agent after the work exists, without relying on a
finished subagent accepting a message (U34).

**Tests first**

`tests/adoption-offer-channel.test.ts`:

- after the threshold of repeated shapes, the next tool result carries exactly one
  bounded offer line with the callable name and a one-call command;
- the same offer is not repeated in the next result;
- the offer is also present in `authoring.pending` for the next `tool_mode_list`;
- the offer is suppressed when an equivalent artifact already exists;
- flag off is byte-identical to the current output.

`tests/adoption-offer-acceptance.test.ts`:

- accepting the offer clears it and increments `saveOffersAccepted`;
- rejecting/ignoring it does not create a draft;
- an offer on a non-applicable shape does not silently create an artifact.

**Implementation**

- Use the existing post-execute hook; return a result whose text includes the offer
  when the host allows result augmentation.
- If augmentation is not supported, persist the offer and surface it in the next
  `tool_mode_list`; document the limitation instead of claiming delivery.
- Do not add a prompt instruction.

**Verification**

`npx tsx --test packages/dsh-tool-mode/tests/adoption-offer-channel.test.ts \
  packages/dsh-tool-mode/tests/adoption-offer-acceptance.test.ts \
  packages/dsh-tool-mode/tests/adoption-save-offer.test.ts`

## Phase 6 — First contact

**Goal:** a cold first call is not a reason to abandon tools.

**Tests first**

`tests/adoption-first-contact.test.ts`:

- list/describe remain side-effect free;
- a cold row says `cold: true` and gives the first-call expectation;
- `warm` is management-only and warms exactly one model;
- an optional prewarm after enable runs once, is bounded, and logs failure;
- a warm failure does not mark the tool callable.

`tests/adoption-first-contact-race.test.ts`:

- two concurrent warms coalesce;
- shutdown drains or cancels a warm without an unhandled rejection.

**Implementation**

- Wire `adoption.prewarmAfterEnable` (existing config field, currently unused).
- Coalesce by extension id; use the existing prepare surface.
- No warming inside list/describe.

**Verification**

`npx tsx --test packages/dsh-tool-mode/tests/adoption-first-contact.test.ts \
  packages/dsh-tool-mode/tests/adoption-first-contact-race.test.ts \
  packages/dsh-tool-mode/tests/adoption-warm.test.ts`

## Phase 7 — Quality metadata that changes verification cost

**Goal:** state the failure mode, not a made-up success rate.

**Tests first**

`tests/adoption-quality-metadata.test.ts`:

- fewer than five uses: no percentage and no invented caveat;
- five uses with one failure: `uses/failures` and a bounded `knownFailure`;
- a failure class present in receipts appears; absent class stays absent;
- a low-quality artifact is not the directive digest candidate;
- the metadata is scoped and never leaks another session.

**Implementation**

- Add `failureClass`/bounded `knownFailure` to durable usage, from failed receipts
  and the authoring error code; never from model prose.
- Render `Known failure: ...` only with evidence.
- Keep the digest under the existing character cap.

**Verification**

`npx tsx --test packages/dsh-tool-mode/tests/adoption-quality-metadata.test.ts \
  packages/dsh-tool-mode/tests/authoring-quality.test.ts`

## Phase 8 — The experiment that can actually test the levers

**Goal:** test directive framing and auto-draft against a genuine silent baseline,
not a visible-tool ceiling.

**Arms** (10 sessions each, fresh solver, same tasks). All three arms are the same
build, selected by config; `adoption.digestMode` defaults to `directive`.

- **D — unannounced.** Artifact exists and is callable, but no digest, no offer, no
  auto-draft announcement. Config: `adoption.digest: false`, `saveOffer: false`,
  `autoDraft: false`. If its tool name/description already matches the task, this is
  a ceiling check, not a silent baseline; record that in the report.
- **G — neutral.** The old neutral list, no offer. Config: `adoption.digestMode: "neutral"`,
  `saveOffer: false`, `autoDraft: false`.
- **O — directive + auto-draft.** Directive names the artifact and its failure mode;
  successful runs leave a draft; promote is one call. Config: `digestMode: "directive"`,
  `saveOffer: true`, `autoDraft: true` (explicit until the Phase 8 gate flips the
  shipped default).

**Task design requirements**

- Artifact description must not reuse the task wording.
- The task must be solvable by hand, so non-use is a real choice.
- A separate repetition task set must produce three identical call shapes for the
  offer test.
- Same model, same temperature, same cwd, same artifact in every arm.
- Start each arm with an empty ledger and verify the library is empty before launch.

**Primary metric:** reuse rate per eligible session (an artifact was called at least
once).

**Guardrails:** correctness, verification cost, drafts kept vs discarded, offers
shown/accepted, first-call latency, digest characters.

**Pre-registered kill rules**

- G does not beat D by at least 10 percentage points over 10 sessions/arm: drop the
  neutral digest.
- O does not beat D by at least 10 points: drop the directive/draft claim.
- More than one third of O drafts are non-applicable and kept: add retention or
  expire.
- Any correctness regression: stop and revert.

**Verification**

`node scripts/adoption-report.mjs --session-ledger <arm> --usage <arm>`

The report must include per-arm reuse, correctness, offers, drafts and the raw ledger
paths. No results without the files.

## Phase 8 run result (2026-11-19)

The silent run is recorded in
[REPORT.md](../research/adoption-dgo-2026-11-19-silent/REPORT.md). Outcome: 30 real
sessions, 10/arm. D **0/10** tool calls; G and O **10/10**; all 30 answers correct.

D was genuinely silent: an opaque tool name/description and opaque `a`/`b` arguments,
with the purpose visible only in the digest. The digest is the lever (+100 pp for both
G and O over D). O and G tie at 100%, so the single-artifact run supports the neutral
list and does not show an incremental directive lift. Offers and auto-draft were not
exercised (one call per session; no `tool_mode_run`); their defaults are decided by the
functional suites, not this run. `autoDraft` shipped on by default after its suite passed;
this run does not claim an adoption lift for it. The earlier visible-tool ceiling is retained at
[adoption-dgo-2026-11-19-phase8](../research/adoption-dgo-2026-11-19-phase8/REPORT.md).

## Verification matrix (every phase)

```
npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json
npx tsx --test <phase tests> <adjacent tests>
npm run test:integration:dsh
npm run build:host
npm run verify:built
npm run verify:docs
Call the anti_slop_lint tool with target `packages/dsh-tool-mode/src`.
```

Run `npm run verify` only at release. If an output schema changes, run
`npm run verify:mcp` too.

## Non-goals

- No new prompt instruction.
- No side-effecting list/describe.
- No automatic promotion: a draft becomes a kept artifact only through the one-call
  promote path.
- No model-generated quality claims; metadata comes from receipts/authoring errors.
- No generalisation beyond the tested tasks and model.

## Definition of done

- U40/U37 behaviours are truthful and covered.
- Direct/discovery/workflow receipts and session-tree reach are measurable.
- The digest is directive, names one artifact and its evidence-backed failure mode.
- Successful runs leave one draft; promote is one call; unkept drafts expire.
- The offer has a real channel or its limitation is documented and tested.
- First contact is warm or explicitly labeled.
- A fresh D/G/O run has a silent baseline and reports a real result, including a null
  one.
