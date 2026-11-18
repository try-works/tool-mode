# Adoption levers: implementation plan

Status: proposed, 2026-11-19. This plan implements the adoption findings in
`research/reports/2026-11-19-adoption-levers-after-run.md` with TDD and a
verification gate before any default-on rollout.

The findings are treated as **hypotheses to reproduce**, not as settled facts.
Phase 0 fails loudly if the reported counter behaviour cannot be reproduced on
this checkout.

## Implementation status

- **Phase 0 — implemented.** Direct contract calls carry the `direct` lane and
  caller session; discovery calls emit `discovery` receipts; artifact usage is
  durable per `(name, digest)` and survives receipt-ring pressure; five sessions
  and failed runs are covered by tests.
- **Phase 1 — implemented.** Workflow summaries expose `callableName`; get/run/
  delete accept either the stored name or `workflow_<name>`; quality is published
  only after five uses and otherwise says `insufficientEvidence`.
- **Phase 2 — implemented.** `tool_mode_run` and workflow runs return a
  top-level `runId`; `from-run` accepts only that id, infers the name/schema and
  needs no Code Mode. The existing capture store is used unchanged.
- **Phase 3 — implemented behind `adoption.saveOffer` (default ON; set false to disable).** Three
  identical argument shapes in one session produce one candidate with a
  shape-only schema and a runnable next command. The tracker stores no values;
  and the existing `tool_mode_list.authoring` surface carries the suggestion.
- **Phase 4 — implemented behind `adoption.digest` (default ON; set false to disable).** The
  feasibility gate succeeded: `systemPrompt.section` accepts a provider function.
  The digest is assembled per turn from workspace/global artifacts with both
  names, evidence after five uses, four lines and 600 characters. Session-scoped
  artifacts are deliberately omitted because the prompt section has no caller
  session identity.
- **Phase 5 — implemented for the explicit path.** `model_tools_manage` has a
  management-only `warm` action that restores from disk when possible and
  otherwise prepares; discovery rows carry `cold: true` when the extension's
  recorded readiness is `prepared-cold`. `tool_mode_list`/`tool_mode_describe`
  remain side-effect free. Optional background prewarm after enable is not wired.
- **Phase 6 — implemented for observation.** The session ledger records the
  D/G/O arm once, save offers surfaced, authored count and reuse; the
  `scripts/adoption-report.mjs` reads the ledger and prints per-arm sessions,
  calls, sessions with reuse, reuse rate, authored artifacts and offers. Digest
  impressions are not counted per session because the prompt section has no
  session identity; the D/G/O arm label is the join key instead.

## Outcome

An agent that already uses Tool Mode tools should be able to:

1. see the caller's existing artifacts without asking;
2. turn a successful run into a draft with one tool call, without Code Mode;
3. be offered a save when repeated calls make one obviously useful;
4. reuse an artifact because it was visible at the moment work started.

The change must not add prompt instructions. The instruction channel is already
saturated; every lever below is data or tool behaviour.

## Non-goals

- No new model prompting text that tells agents to "use tool mode".
- No synchronous warm-up inside `tool_mode_list` or `tool_mode_describe`;
  those tools are contractually read-only (DECL-07).
- No automatic promotion. Drafts are cheap; promotion keeps its existing
  evidence and human approval gates.
- No quality score invented from fewer than five uses, and no model-authored
  "this is weak on X" claims without receipt evidence.
- No change to the Code Mode execution gate, scoping rules or public names.

## Instrumentation contract

All new telemetry is metadata only. Never record arguments, results, prompts,
file paths or artifact program bodies.

### Receipt lanes

Extend `InvocationReceipt.kind` with:

| kind | source | artifact fields |
| --- | --- | --- |
| `direct` | a native catalog/model tool call outside any program | none |
| `discovery` | `tool_mode_list`, `tool_mode_describe` | none |
| `invocation` | existing contract invocation | existing |
| `nested` | a call made inside a program | existing |
| `external` | MCP lane | existing |
| `auxiliary` | harness provider calls | existing |

Rules:

- A direct call inside a program is **not** a `direct` receipt; the nested
  receipt already exists. Gate the direct lane on the absence of
  `programAgentContext` state.
- Discovery receipts carry `contract: 'tool_mode_list'` or
  `'tool_mode_describe'`, the caller's `rootSessionId`, and no result data.
- Receipts are best-effort for observability; a receipt write failure must not
  fail the tool call.

### Durable artifact usage

The invocation ring is bounded and may be evicted. Promotion evidence must not
depend on it alone.

Add a durable, append-only or compacted `artifact-usage` projection:

```ts
interface ArtifactUsageRow {
  readonly name: string
  readonly digest: string
  readonly uses: number
  readonly sessions: readonly string[] // bounded distinct root session ids
  readonly failures: number
  readonly lastAt: string
  readonly lastFailureClass: string | null
}
```

Key by `(name, digest)` because editing a program changes its digest and old
evidence must not accrue to the new content. Increment once per successful or
failed **artifact run**, deduplicated by receipt id. `sessions` is a bounded
set (for example 50 ids) plus a total count, so memory cannot grow forever.

`evidenceFromReceipts` remains as the pure receipt-level view. Promotion reads
`ArtifactUsageRow` first and uses receipts only for recent failure detail.

### Adoption events

Add a bounded session projection, not a new global log by default:

```ts
interface AdoptionEvents {
  digestShown: number
  artifactOffered: readonly string[]
  artifactCalled: readonly string[]
  saveOfferShown: number
  saveOfferAccepted: number
  fromRunOffered: number
  fromRunAccepted: number
}
```

These are counts and names, visible through `tool_mode_list.authoring.session`.
They are the D/G/O experiment's join keys.

## Phase 0 — Reproduce the two reported counter defects

**Goal:** prove or disprove U29 (direct/discovery calls have no receipt) and the
reported non-advancing artifact `uses` before changing anything.

**Tests written first**

- `tests/adoption-receipts.test.ts`
  - direct `lang_detect` call in one session produces exactly one receipt;
  - the receipt has `kind: 'direct'`, contract facts, and the root session id;
  - a call made through `tool_mode_run` produces nested receipts and **no**
    extra `direct` receipt;
  - `tool_mode_list` and `tool_mode_describe` each produce a `discovery`
    receipt;
  - receipt write failure does not fail the call.
- `tests/adoption-artifact-evidence.test.ts`
  - save `workflow_five_runs`; run it in five distinct root sessions;
  - `evidenceFromReceipts` reports `uses: 5, sessions: 5`;
  - `tool_mode_workflows list` and `tool_mode_tools list` show the same
    evidence;
  - run 250 unrelated calls, then assert the five remain in the durable
    projection;
  - a failed run increments `uses` and `failures`, not `sessions`;
  - editing the program changes the digest and does not inherit old uses.

**Implementation**

1. Add `kind: 'direct' | 'discovery'` to `receipt.ts`.
2. Add `onInvoked` to the model-tool registration seam in
   `registrar.ts` / the install path; the callback records a direct receipt
   only when no program context is active.
3. Pass a `recordDiscovery` callback into `discovery-control.ts`.
4. Add `artifact-usage.ts` with a durable store and a compacted reader.
5. Update `recordAuthoredRun` in `index.ts` to increment the projection
   transactionally with the receipt write; a failed increment must be visible,
   not silently swallowed.
6. Pass the projection into `authoring-surface.ts` as an `evidenceFor`
   dependency.

**Exit criteria**

- The new tests fail on the current tree for the expected reason.
- After implementation, both reported defects are either reproduced and fixed
  or explicitly disproved with the test that shows correct behaviour.
- No existing receipt schema consumer breaks.

**Verification**

```
npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json
npx tsx --test packages/dsh-tool-mode/tests/adoption-receipts.test.ts \
  packages/dsh-tool-mode/tests/adoption-artifact-evidence.test.ts \
  packages/dsh-tool-mode/tests/receipt-artifact-identity.test.ts
npm run test:integration:dsh
```

## Phase 1 — Name hygiene and honest quality metadata

**Goal:** make the stored name and the callable name impossible to confuse, and
give the agent only evidence-backed quality facts.

**Tests written first**

- `tests/adoption-artifact-identity.test.ts`
  - list/describe return `name: 'g1_lang_counts'` and
    `callableName: 'workflow_g1_lang_counts'`;
  - `get`, `run`, `delete` and `promote` accept either spelling;
  - an agent tool returns `name` and `callableName` as the same value;
  - a name collision reports both names.
- `tests/adoption-quality.test.ts`
  - zero to four uses: `quality` is absent or says `insufficientEvidence`;
  - five uses with one failure: `uses: 5, failures: 1`, no invented success
    percentage;
  - no failure class is invented when the receipt has none;
  - quality is scoped: a session artifact is not visible from another session.

**Implementation**

- Add `callableName` to workflow/authored-tool summaries.
- Keep stored `name` as the canonical persistence key.
- Centralise resolve-by-either-name in `agent-authoring.ts`; do not duplicate
  it in each handler.
- Build `quality` from `ArtifactUsageRow` with a minimum of five uses.

**Verification**

```
npx tsc --noEmit -p packages/dsh-tool-mode/tsconfig.json
npx tsx --test packages/dsh-tool-mode/tests/adoption-artifact-identity.test.ts \
  packages/dsh-tool-mode/tests/adoption-quality.test.ts \
  packages/dsh-tool-mode/tests/artifact-scoping-acceptance.test.ts
npm run build:host
```

## Phase 2 — One-call draft from a run

**Goal:** turn a successful run into a saved draft without entering Code Mode.

**Tests written first**

- `tests/adoption-from-run.test.ts`
  - `tool_mode_run` returns a top-level `runId` (and the same value in
    `meta.receiptId` for compatibility);
  - `tool_mode_tools { action: 'from-run', runId }` with no `program`
    creates a draft;
  - the inferred name is stable, `agent_`-prefixed only for tools, and
    collision-safe;
  - the observed input schema is shape-only and does not contain input values;
  - the same operation works while `hostedCode: false` (storing is free;
    running remains gated);
  - an unknown/evicted `runId` returns an actionable `runId not found; run
    tool_mode_run again or pass a program`.
  - no `from-run` exists when run capture is disabled; the refusal says how
    to enable it.

**Implementation**

- Add `runId` to the run report at the result boundary, not only inside
  `meta`.
- Extend `tool_mode_workflows`/`tool_mode_tools from-run` to accept
  `runId` and omit `program`.
- Reuse `RunCaptureStore`; never infer values.
- Keep the existing save/define validation and registration path.

**Verification**

```
npx tsx --test packages/dsh-tool-mode/tests/adoption-from-run.test.ts \
  packages/dsh-tool-mode/tests/run-capture.test.ts \
  packages/dsh-tool-mode/tests/agent-authoring.test.ts
npm run test:integration:dsh
```

## Phase 3 — Repetition detection and the save offer

**Goal:** offer saving when repeated calls prove the shape, at a moment a turn
can still act on it.

**Design decision:** there is no reliable end-of-session turn in which to ask.
`session/disposed` runs after the session is gone. The offer therefore lands
mid-task and is persisted in `pending[]` for the next turn.

**Tests written first**

- `tests/adoption-repetition.test.ts`
  - three identical `(tool, canonical arguments)` calls produce one
    suggestion, not three;
  - a fourth and fifth call do not duplicate it;
  - different arguments do not share a counter;
  - an existing artifact with the same shape suppresses the suggestion;
  - canonicalisation sorts object keys and bounds the hash input;
  - no raw arguments are stored.
- `tests/adoption-save-offer.test.ts`
  - `tool_mode_list` returns the candidate in `authoring.suggestions` with
    `why`, `callableName`, `fromRun` command and `runId`;
  - if the post-execute hook can return a result, the next result carries one
    short line and no second line on the following call;
  - accepting the suggestion increments `saveOfferAccepted` and clears it;
  - the feature flag off restores byte-identical old output.

**Implementation**

- Add `adoption-candidates.ts` (pure canonicalisation and threshold).
- Extend the existing `tools/post-execute` handler; it already sees the tool
  name and session. Add the invocation id/arguments only if the host exposes
  them; otherwise use the session ledger's call count and the run-capture map.
- Persist candidates in the session ledger with a bounded size.
- Merge candidates into `authoringSnapshot`/`pending`; no schema change to
  the existing pending rows beyond additive fields.
- Feature flag: `config.adoption.saveOffer` (default ON; set false for the D baseline).

**Verification**

```
npx tsx --test packages/dsh-tool-mode/tests/adoption-repetition.test.ts \
  packages/dsh-tool-mode/tests/adoption-save-offer.test.ts \
  packages/dsh-tool-mode/tests/session-ledger.test.ts
npm run test:integration:dsh
```

## Phase 4 — Session-visible library digest

**Goal:** put 3–5 caller-scoped artifact lines in front of the agent without a
prompt instruction.

**Feasibility gate (spike, time-boxed):**

- Confirm whether the DSH `systemPrompt` section can be replaced or updated
  after artifact changes. The current registration is static text at mount.
- If it cannot, fall back to a bounded digest appended to the
  `tool_mode_run`/`tool_mode_list` **tool description**, re-registered on
  save/delete. Tool descriptions are visible every turn; this still avoids a
  prompt instruction.
- Do not ship the digest until one mechanism is proven by a test.

**Tests written first**

- `tests/adoption-library-digest.test.ts`
  - zero artifacts: no digest, no empty heading;
  - three to five artifacts: exactly those lines, caller-scoped;
  - more than five: hard cap, deterministic order (recency, then uses);
  - both stored and callable names appear;
  - save/delete changes the digest on the next registration;
  - another session's artifact never appears;
  - no program body, input value or absolute path appears;
  - flag off: no digest and byte-identical prior description.
- `tests/adoption-digest-budget.test.ts`
  - rendered digest stays under 600 characters;
  - truncation is by whole line, never mid-name.

**Implementation**

- `library-digest.ts`: pure `buildLibraryDigest(rows, options)`.
- Source rows from `authoringStore` through the existing scope resolver.
- Hook digest refresh into the save/delete/promote paths.
- Feature flag `config.adoption.digest` (default ON; set false for the D baseline).

**Verification**

```
npx tsx --test packages/dsh-tool-mode/tests/adoption-library-digest.test.ts \
  packages/dsh-tool-mode/tests/adoption-digest-budget.test.ts \
  packages/dsh-tool-mode/tests/discovery-provenance.test.ts
npm run build:host
npm run test:integration:dsh
```

## Phase 5 — Cold-start UX without breaking read-only discovery

**Goal:** stop an agent abandoning tools after a 120 s first call, without
making `list`/`describe` prepare anything.

**Tests written first**

- `tests/adoption-warm.test.ts`
  - `tool_mode_list` and `tool_mode_describe` perform no install, prepare or
    activate call;
  - a `prepared-cold` row says `cold: true` and
    `note: 'first call may take ~120 s; retry once'`;
  - `model_tools_manage { action: 'warm', model }` invokes prepare exactly
    once and is management-gated;
  - `warm` on an already-prepared model is a no-op;
  - a failed warm reports the reason and does not mark callable.
- `tests/adoption-prewarm-after-enable.test.ts`
  - enable schedules at most one background warm for the top listed tool;
  - background failure is logged, never thrown into enable.

**Implementation**

- Add `warm` to the management action set only.
- Add `cold` to discovery rows, derived from the existing readiness state.
- Optional background prewarm after enable behind
  `config.adoption.prewarmAfterEnable` (default off).

**Verification**

```
npx tsx --test packages/dsh-tool-mode/tests/adoption-warm.test.ts \
  packages/dsh-tool-mode/tests/adoption-prewarm-after-enable.test.ts \
  packages/dsh-tool-mode/tests/extension-preparation.test.ts
npm run test:integration:dsh
```

## Phase 6 — Experiment harness and rollout

**Goal:** settle whether the digest and the save offer cause reuse.

**Design:** three arms over the same instance set:

- **D** baseline: flags off.
- **G** digest only.
- **O** digest + save offer.

Use at least **10 sessions per arm** (not 5). Randomise task order. Keep the
system prompt, model, tool set and instances identical across arms. Record the
arm in the session ledger; never infer it from behaviour.

**Primary metric:** reuse rate per session — a session in which an existing
artifact is called at least once, divided by eligible sessions (a relevant
artifact existed at start).

**Guardrails:** output correctness, first-call latency, tool-call count, digest
characters added, false-positive save offers, and drafts that are never reused.

**Pre-registered kill rules:**

- G does not exceed D by at least 10 percentage points in reuse over 10
  sessions/arm: drop the digest.
- O drafts are not reused within two sessions at least once in three drafts:
  drop the save offer rather than promoting drafts.
- Any correctness regression or read-only side effect: stop and revert the
  phase, regardless of reuse.

**Implementation**

- Feature flags: `adoption.digest` and `adoption.saveOffer` are ON by default;
  `adoption.prewarmAfterEnable` remains off. The D arm sets the first two false
  explicitly.
- `scripts/adoption-report.mjs`: read the session ledger and artifact usage;
  emit per-arm counts and reuse rate. No model calls.
- Document the run procedure and freeze the prompt text in the report.

**Verification**

```
npm run typecheck
npm run test:integration:dsh
npm run build:host
npm run verify:built
npm run verify:architecture
npm run verify:docs
npm run verify:mcp
node scripts/adoption-report.mjs --dry-run
```

Run the full `npm run verify` only at release, not per phase.

## Red-first workflow (every phase)

1. Add the test file with the failing assertions.
2. Run only that file and capture the expected failure.
3. Implement the minimum to pass.
4. Re-run the phase file, then the adjacent suites listed above.
5. Run the full host suite and build.
6. Run anti-slop lint on every new module.
7. Commit the phase independently so a failed lever can be reverted without
   touching the others.

No phase may be committed with a skipped new test or with a flag-on-only test
that never exercises the flag-off path.

## Definition of done

- Direct, discovery, artifact-run and reuse lanes are all observable.
- Artifact `uses` is durable and monotonic across 250+ unrelated calls.
- `from-run` needs one call and no Code Mode.
- A save suggestion appears once, with a runnable next command.
- The library digest is caller-scoped, capped and absent when empty.
- Read-only discovery remains side-effect free.
- All flags off reproduces the current output byte-for-byte.
- Full host suite, build, static checks and anti-slop lint pass.
- The D/G/O run is executed and its kill rules are reported honestly, including
  a null result.

## Open questions to resolve in Phase 0/4 spikes

1. Does the DSH post-execute hook allow a result to be augmented, or only
   observed?
2. Can the system-prompt section be updated after mount, or must the digest use
   the always-visible tool description?
3. Does the direct-call path expose the root session id, or only the leaf id?
4. What is the actual eviction policy of the receipt store in the deployed
   profile? The durable projection is required only if the ring is bounded.
