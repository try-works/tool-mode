# What AgentRun / Pi-vision teaches Tool Mode

**Status:** research report, 2026-10-20. No product code was changed. Revised
after an independent review (`research/agentrun/CRITIQUE.md`); all nine must-fix
items were applied.
**Question:** what should `dsh-tool-mode` learn from AgentRun's open-sourced
Pi-vision work, and what should be added to Tool Mode?
**Short answer:** the transferable asset is not "eyes on a local model". It is a
*typed, budgeted perception workflow with a receipt per look*. Tool Mode is
missing the pieces that make that structure work: measured usage and price,
media ingress, image-to-words, typed image questions, a reusable workflow
artifact, and an evaluation that can falsify the savings claim.

Two external findings are load-bearing and correct the premise:

1. **Jev is not a language in any documented sense.** It is TypeSafe's hosted
   "System One" model/API: one HTTP request of `state` + typed questions
   (`noul`, `choice`, `score`, `box`) returning probabilities. No grammar,
   compiler or language spec was found in the docs or repository; the workflow
   language is AgentRun's JSON DSL (`EXTERNAL-FINDINGS.md:54-84`).
2. **Pi-vision adds no tool, and no model inference in it runs locally.** It
   extends the existing `read` tool and exposes `vision.see`/`vision.judge`/
   `vision.transcribe` as code-mode *globals* plus five skills. What *does* run
   locally is the deterministic half: PDF/office text extraction, page rendering,
   image fitting and frame cutting. The eyes are a hosted VLM, Jev is a hosted
   judge, transcription is third-party. A plain `pi install` loads only the
   skills; a pi-durable host must wire the primitives
   (`EXTERNAL-FINDINGS.md:86-153`, `:18`).

So the tweet's "Jev does the analysis while your Pi agent orchestrates" is
directionally true, but the code teaches something more useful and more modest:
**how to make cheap perception decisions auditable, bounded and cacheable**, and
where the frontier model is still unavoidable.

---

## 1. Bottom line

AgentRun turns a repeated procedure into a workflow document interpreted by a
host: typed nodes, host-supplied adapters for every model call and side effect,
bounded control flow, and one agent-facing tool per workflow (`README.md:3-5`;
`docs/host-integration.md:5-10`). pi-vision composes that with media handling:
deterministic extraction, media fitted to the target model's limits, selective
looks, and a receipt for every look carrying the source SHA-256, the question,
the answer, the model and the price (`packages/pi-vision/README.md:3-5,57-62`).
The vision demo stops a run past $1 unless `--max-usd` raises it; one measured
live run cost about $0.54 and took about 8 minutes
(`packages/pi-vision/README.md:44-45`).

There is **no savings benchmark**: no baseline, no percentage, no accuracy
evaluation. The cost argument is per-look pricing plus contract-versioned
memoization, with two n=1 measurements (a live document-check run and a per-step
film table) and no comparison (`EXTERNAL-FINDINGS.md:120-126,221-235`).
That is exactly the kind of claim Tool Mode can make credible: a corpus and a
comparison are bounded work, and the repository's own culture already demands the
honest version.

Tool Mode's gaps against this design, in value order:

1. **No measured usage or price in a tool result.** The broker carries
   `LlmUsage`; the declarative path returns only `outcome.text`; the tool output
   is a string; no receipt is written for declarative tools
   (`LOCAL-SURFACE.md §6, §8b`). "Did this save frontier tokens?" is
   currently unanswerable, and "cheap vs frontier" cannot be logged.
2. **No packaged, pinned workflow artifact.** Composition exists (`tool_mode_run`
   and RCP-09 draft authoring), but there is no digest-pinned artifact with
   inspect/dry-run, one tool identity and an escalation outcome. The spec defers
   saved programs (`Tool_Mode_DSH_Implementation_Spec_v1.2.md:505`), so every
   repeat is a fresh prompt plus fresh code.
3. **No media ingress at the declarative boundary.** `describe_image`'s
   contract says `image_path`, its recipe says typed `image`, and the live tool
   advertises JSON image bytes. The local embedding/retrieval tools do accept a
   host `path` part and decode it themselves, but nothing checks that path
   against a root allow-list, and the harness-model boundary has no file
   admission at all. That custody hole, not a missing decoder, is the gap
   (`LOCAL-SURFACE.md §5, §8b`).
4. **No local image-to-words tier.** No catalog model captions or OCRs; `eye`
   is closed-beta frame scoring with no SDK; `describe_image` is a frontier
   call and its prompt refuses OCR (`LOCAL-SURFACE.md §1, §7`). A
   deployment that wants cheap local eyes has nowhere to route.
5. **No typed image questions.** `decision_*` is text-only; nothing in the
   repository can return a yes/no probability, a choice distribution or a box
   about image bytes (`standard.ts:347-354,380-387,419-426`). A frontier
   structured-output recipe is the only near route, and it is not cheap.
6. **No evaluation corpus**, so "verified" still means "it runs"
   (`docs/tool-mode-comparison.md:115-120`).

Recommended order: accounting first (A1), then media ingress (A2) and typed
image questions (A3), then the workflow artifact (A4), then the evaluation (A5)
that can falsify the savings claim. Priced routing (A6) folds into A1/A4. The seven additions, at a glance:

| Add | One line | Slice |
| --- | --- | --- |
| A1 ACC | usage, price, source digest and the decision rule in every result and receipt | 1 |
| A2 MEDIA | media-reference admission, `document.extract`, `media.sample`, fit and miss rules | 2 |
| A3 VIS | `image.ask` / `image.locate`: typed questions and a normalized box | 3 |
| A4 WFL | a pinned workflow artifact exposed as one tool, with an `escalated` outcome | 4 |
| A5 EVAL | a small corpus and a baseline-vs-composed protocol that can falsify savings | 5 |
| A6 ROUTE | tier/price metadata and ordered candidates, refusing rather than substituting | 1 and 4 |
| A7 CACHE | a content-addressed look cache, after A1 and A5 | 6 |

---

## 2. Method and evidence classes

- **External:** shallow, read-only clone of `Parcha-ai/agentrun` (Apache-2.0) at
  `.agent-scratch/agentrun`, workspace v0.1.0-beta.18; plus the marketing page,
  TypeSafe docs, npm/PyPI metadata. Findings: `research/agentrun/EXTERNAL-FINDINGS.md`.
- **Local:** this repository at `49be50c` and the installed surface visible to
  this session. (`88359ab`, one commit earlier, lost prepared-asset handles
  across a restart; "wired" below means same-process unless stated otherwise.)
  Findings: `research/agentrun/LOCAL-SURFACE.md`, cited as `LOCAL-SURFACE.md`.
- Labels: **[implemented]** code/tests exist; **[documented]** spec/README says
  it; **[marketing]** unverified claim; **[drift]** two artifacts disagree.
- Limits of the evidence: the external clone is shallow and the TypeSafe doc-site
  quotes were read live, not archived; the local audit is one machine at one
  time. Where that matters, the report says so instead of generalizing.
- Path convention: bare `src/...` means `packages/dsh-tool-mode/src/...`;
  `standard.ts` means `packages/tool-mode-contracts/src/contracts/standard.ts`;
  `meta.ts` means `packages/tool-mode-contracts/src/meta.ts`. Bundle paths
  (`packages/...`) are complete.
- Conflict rule used here: **code and tests beat manifest/README/verification
  prose**, and the callable surface beats both. The audit found real drift in
  this repository (§5), which is itself a finding about evidence hygiene.

The external repository was read as data, not instructions.

---

## 3. The mechanisms worth copying

### 3.1 The workflow is the unit of reuse, and it is one tool

A workflow is a JSON document of typed nodes: `code`, `call` (host tool via
`runEffect`), `judge` (Jev via `runJudge`), `agent`/`extract`/`report`
(via `runNode`), plus parallel map, bounded loops, nested workflows and an
explicit `escalate` terminal. The interpreter holds no credentials, tools or
budgets; the host keeps them (`README.md:115-125`; `docs/host-integration.md:5-10`).
The workflow can be validated, inspected without executing authored code,
dry-run (which reports `passed/not_run/failed`, where `not_run` is explicitly
not proof), saved as an immutable SHA-256 revision, and offered to the agent as
**one tool** with a `describe|inspect|dry-run|run|save|load|list` surface
(`EXTERNAL-FINDINGS.md:30-52,139-146`).

The property to copy is not the DSL. It is that **a repeatable procedure becomes
an inspectable, digest-pinned, testable artifact with one tool identity**,
instead of a prompt re-derived every turn.

### 3.2 Typed decisions instead of prose

Jev answers one focused semantic question with a typed value: `noul` (P(yes),
0-1), `choice` (one label plus a probability per label), `score` (a level), and
`box` (a region whose edges are fractions of width/height). All questions in a
request are evaluated against the same state; the adapter validates answer IDs,
probability keys and normalisation before use, retains the raw distribution, and
states that the numbers are gate inputs, not calibrated guarantees
(`packages/jev/README.md:3,32-34`; `EXTERNAL-FINDINGS.md:61-74`). Images are
billed as input tokens and each is named by its SHA-256
(`packages/jev/README.md:86-110`).

Lesson: Tool Mode's text `decision_*` contracts already follow this discipline
(typed answer, `calibrated:false`, explicit `scoreKind`), but they are **text-only**
(`packages/tool-mode-contracts/src/contracts/standard.ts:380-387`). There is no
question about image bytes and no localisation at all.

### 3.3 Perception = deterministic extraction, then selective looks

pi-vision hides format routing behind the existing `read` tool: PDF, docx/odt,
pptx, xlsx/ods and RTF become text with zero-install readers; images are fitted
to the *target* model's registry limits (width, height, bytes, JPEG quality,
tiling); video becomes frames or a `from_s..to_s` window; anything the
environment cannot handle is a **typed miss**, not a fabricated answer
(`packages/pi-vision/README.md:57-62,90-110,202-217`). For long media the agent
writes code in the host's code mode; "only the answers, where they looked or
listened and the price enter the caller's context"
(`packages/pi-vision/README.md:65-73`).

That is the real token-efficiency mechanism: **most bytes never reach a model**.
A page is rendered only when a question needs it; a film is cut only around the
seconds a transcript or a cheap judge narrows to; the frontier model sees a
fitted crop and a typed question.

The honest caveat: the escalation ladder itself (grep -> Jev scan -> halve ->
eyes -> box) lives in **skill prose**, not engine logic
(`EXTERNAL-FINDINGS.md:103-104,116-119`). The model is free to ignore it. Tool
Mode can do better by encoding the ladder in the workflow artifact (§6 A4).

A second interface lesson: pi-vision **does not grow the tool list**. It keeps
`read`, adds optional arguments, and exposes `vision.see`/`vision.judge`/
`vision.transcribe` as code-mode globals taught by one static system-prompt
section (`EXTERNAL-FINDINGS.md:209-214`). Tool Mode's Code Mode already binds
tools into a program; what is missing is a stable, documented perception
primitive surface for those programs to call, so capability grows through
composition rather than through one top-level tool per operation.

### 3.4 Receipt depth: every look is priced and content-addressed

A look is filed as a record with the source SHA-256, the fragment, the fit
(`original`, `shown`, block count and bytes), input/output tokens, the
model/provider, the price (`cost_usd` is `null` when unknown and never 0; 0 only
when another service billed it), the start time, the parent tool call, and a
**memo key** over source hash + selector + question + model + contract version,
so an identical look is reused instead of repaid
(`packages/pi-vision/src/core/evidence.ts:16-55,100-103`). A failed look is
still filed and counted; a memoized answer is marked `kept`; a changed contract
never reuses an old answer (`EXTERNAL-FINDINGS.md:197-202`).

Tool Mode's receipt has provenance (extension version and digest, model
identity, activation generation, location) but **no execution economics and no
input identity** (`src/receipt.ts:32-71`). The result envelope is worse:
`ToolMeta` is closed over nine provenance fields
(`packages/tool-mode-contracts/src/meta.ts:29-70`), so the broker's `LlmUsage`
has nowhere to go. On the declarative path the loss is total: `harness-serving`
returns `outcome.text`, the tool schema is `type:'string'`, and no receipt is
written at all (`LOCAL-SURFACE.md §6, §8b`).

### 3.5 Typed misses and no half answers

pi-vision returns a stable miss code with a remedy: `no_vision_route,
look_failed, video_unseeable, over_budget, needs, unsupported, unreadable,
not_ready, refused` (`EXTERNAL-FINDINGS.md:109-111`). A Box question always
returns a box, so presence must be asked separately; a package part that is not
built throws `NotBuiltError`, "never a half answer"
(`packages/pi-vision/README.md:60-62,100-103`; `packages/jev/README.md:108`).

Tool Mode already refuses well at the model/extension level (`capability.ts`,
`inspect()`, needs-preparation). What it lacks is a shared **media miss
taxonomy**: "unsupported format", "over budget", "decoder not installed" and
"model cannot see" are different outcomes, and no single vocabulary names them.

### 3.6 Decisions are separable from the execution that consumed them

`recordDecision` + `rederiveDecision` store the questions, answers and the gate
rule, so a decision can be audited or re-thresholded with **no model call**
(`EXTERNAL-FINDINGS.md:217-219`). This is the mechanism that makes a workflow's
thresholds reviewable after the fact.

Tool Mode returns a decision and a reason but does not persist the rule that
turned answers into an outcome. A decision receipt that can be re-derived is a
small addition to A1 with outsized audit value.

### 3.7 The economics are receipts, not a benchmark

The repository ships scripted demos with no key, fake eyes, and a provider
conformance suite (`packages/pi-vision/README.md:9-45,170`), and a measured
run with a stated cost, time and spend cap. It does **not** ship a baseline
comparison or an accuracy evaluation (`EXTERNAL-FINDINGS.md:120-126,163-170`).
That is the right level of honesty for a tool: price each look, cap the run,
and let the caller decide.

Tool Mode can go one step further cheaply, because it already has a
deterministic-fake culture. It lacks the corpus and the protocol (§6 A5).

---

### 3.8 The design rules this implies

If the mechanisms above are taken seriously, nine rules follow. They are the
useful answer to "how could we learn from this", independent of whether any
particular feature is copied.

1. **A perception result is an answer, a location and a price.** If a result
   cannot say where it looked and what the look cost, it is not ready to steer a
   frontier agent.
2. **Split the work by kind, not by model.** Deterministic work in code (extract,
   paginate, cut frames, sort), one focused judgment as a typed question,
   open-ended investigation in the agent. AgentRun's own rule is that code does
   exact work, Jev decides meaning, and agents investigate.
3. **Thresholds are artifact data, never prompt text.** A gate a reviewer cannot
   inspect and re-derive is a prompt, not a policy.
4. **Every capability needs a "cannot" path** with a stable code and a remedy;
   a half answer is worse than a typed miss.
5. **Pin identity, and let a change invalidate reuse.** Source digest + contract
   version + implementation + recipe/workflow digest belong in the cache key and
   the receipt.
6. **Fit the payload to the target model before dispatch.** The caller should
   never resize, tile or count bytes; the host should report what it reduced.
7. **Ship a no-key scripted demo and one measured, capped live run.** Report the
   price per look; never report a savings percentage without a baseline.
8. **Prefer interface-preserving extension where the semantics fit.** pi-vision
   adds media behaviour to the existing `read` tool with optional arguments
   instead of renaming it. Tool Mode should extend `describe_image` or
   `media_find_moments` with optional parameters before minting a new tool name.
9. **Grow capability through composition, not tool count.** A stable primitive
   surface plus a skill that teaches it scales further than a new top-level tool
   per operation; pi-vision's tool list is unchanged by design.

---

## 4. Where Tool Mode already matches (do not rebuild)

| Mechanism | Tool Mode today | Evidence |
| --- | --- | --- |
| Isolated non-agent model request, no parent history/tools | HLM-05/06; broker builds one message from the recipe | spec:1382-1385; `tool-mode-recipes/README.md:48-60` |
| One attempt, no silent repair | HLM-07; defaults 1 / 0 | `src/harness-budgets.ts:58-67` |
| Composition with per-call authorization | `tool_mode_run`: granted ∩ visible, reject-not-omit, sandbox subprocess, 120s/600s, 64MiB output | spec:434-478; `LOCAL-SURFACE.md §4` |
| Extension identity, content digest, activation generation | `ToolMeta` + `InvocationReceipt` | `meta.ts:29-70`; `src/receipt.ts:32-71` |
| Declarative packages without executable code | TMX 1.1 `execution.kind: "declarative"` | spec:1419-1478 |
| Capability resolver refusing with a reason | `resolveCapability`; `model_tools describe` | `docs/model-as-tool-architecture.md:70-93` |
| Skills teaching when to use a tool | per-tool skill from catalog + playbook | `docs/model-as-tool-architecture.md:181-199` |
| Local embedding perception | EmbeddingGemma text/code/image/audio; real ONNX; video windows 1 fps, audio 11.2 s | `LOCAL-SURFACE.md §5, §9` |

Tool Mode is **stronger than AgentRun on two axes** that must not be traded
away: per-call authorization for composed calls (CODE-05/07/12) and a resolver
that refuses before loading an unqualified model. AgentRun's code nodes are
trusted host JavaScript, "not a sandbox" (`EXTERNAL-FINDINGS.md:171-174`); Tool
Mode's PTC runtime is a separate subprocess with a binding allow-list. A workflow
artifact must inherit that model, not reimplement it.

---

## 5. The gaps that matter

| # | Capability | AgentRun / pi-vision | Tool Mode today | Gap |
| --- | --- | --- | --- | --- |
| G1 | Per-call economics | tokens, USD (null unknown), model, fit, source SHA-256, memo | usage dropped at `harness-serving`; output is a string; no receipt on the declarative path; no price anywhere | **blocks every savings claim** |
| G2 | Pinned workflow artifact | typed workflow, inspect/dry-run, SHA-256 revision, one tool, escalation | composition exists (`tool_mode_run`, RCP-09 drafts), but no packaged digest-pinned artifact or one-tool identity; saved programs deferred | **reuse is unreviewed and unpinned** |
| G3 | Media ingress | path/page/window arguments resolved by the host; bytes never inlined | embedding/retrieval tools accept a `path` part (no root allow-list); the declarative boundary takes JSON `{mediaType,bytes}`; `image_path` appears nowhere in the host | **no file admission or custody at the model boundary** |
| G4 | Document/video extraction | PDF/office text, pages, frames, fit-to-limits, typed misses | no document contract; no caption/transcript tool (voz is not installed); video is only embeddable, with AVI-DIB/1 fps/32-frame limits | **documents blocked; video only as retrieval windows** |
| G5 | Image→words | hosted eyes + skills | no catalog model captions/OCRs; `describe_image` is frontier-only and refuses OCR claims | **no local caption/OCR tier** |
| G6 | Typed image questions | noul/choice/score/box over images | `decision_*` text-only; `describe_image` returns prose; no region output | **no typed image question at all; a frontier structured-output recipe is the only near route** |
| G7 | Evaluation | scripted fakes, conformance, n=1 cost | fake providers only; no corpus, no baseline | **cannot falsify quality or savings** |
| G8 | Priced routing / cache | model chosen by host; price in receipt; memo by contract version | no tier/price metadata; no result cache; routing implicit | **repeat looks repaid; routing unauditable** |

Two supporting facts that shape the work:

- **The "eyes" tool is frontier-only by construction.** Its default executor is
  explicit config > `config.harnessModel` > the deployment's agent-default model,
  with `destination:'remote'` (`LOCAL-SURFACE.md §8b`); in this profile that
  resolves to `deepseek-official/deepseek-flash`, so every local `describe_image`
  call is a remote frontier call. There is no local captioner to route to, and
  no usage returns, so the choice cannot be measured.
- **The repository's status artifacts are stale against the code in both directions.**
  The workspace manifest says EmbeddingGemma "wires no ONNX session yet" while
  `src/inference.ts:106-167` creates real ORT sessions; `media_find_moments`
  descriptions say video is refused while `src/index.ts:1059-1098` implements
  it; release.json and TRACEABILITY still carry a round-59 `NOT_RUN`
  (`LOCAL-SURFACE.md §8a`). The opposite can also happen: the tool description
  in this session's snapshot still refuses video, while the live host's manifest
  reports updated descriptions. **Adjudicate status by a call on the live host or
  a test, not by prose.** This is a pre-existing defect, not one this
  report fixes, but any perception work will trip over it.

---

## 6. What to add

### A1. ACC: make usage, price, source identity and the decision rule part of the result

**Learned.** One receipt per paid operation: source SHA-256, question, answer,
model, price (null never 0), fit facts, tokens, start time, parent call, memo
key; a failed look is still filed; a memoized answer is labelled
(`packages/pi-vision/src/core/evidence.ts:16-55`). A decision stores its rule so
it can be re-derived without a model call (`EXTERNAL-FINDINGS.md:217-219`).

**Today.** `ToolMeta` is closed over nine provenance fields (`meta.ts:29-70`);
`InvocationReceipt` has no timings, tokens, price or source digest
(`src/receipt.ts:32-71`); `harness-serving` returns `outcome.text` and drops
`LlmUsage`; the declarative tool's schema is `type:'string'`; no receipt is
written on that path (`LOCAL-SURFACE.md §6, §8b`); `tool_mode_run`
reports `elapsedMs` and a call count only (`src/tool-mode-run.ts:287,402`), and
its receipt records `modelIdentity:'none'` even when nested calls ran
(`src/index.ts:2993`). No price is computed anywhere, and the existing
`describeCost` renderer has no production caller.

**Add (proposed ACC-01..04, envelope v1.1):**

- `usage` on results and receipts:
  `{ inputTokens, outputTokens, images, audioSeconds, elapsedMs, attempts,
  cost: MonetaryAmount, priceSource: 'provider' | 'estimate' | 'unknown' }`.
  Reuse RES-10's `MonetaryAmount` (`{known:true,currency,amount}` |
  `{known:false,reason}`) instead of a nullable number; absent stays unknown and
  is never summed as 0. Wire the existing `describeCost` renderer; do not let
  the host synthesize a price without a declared table.
- `sources`: SHA-256 of the bytes the host actually admits to the call (for the
  declarative path, the typed image it already receives), digest only, plus the
  fit facts when an image was reduced. Path-based digests arrive with A2's file
  admission; do not claim them earlier.
- A receipt for **declarative** tools as well as module tools, and aggregation
  in `tool_mode_run.meta` (sum over bindings), charging the root budget that
  CODE-11 already requires.
- A `decision` receipt on the decision contracts: the questions, the answers
  (probabilities included), the gate rule and the outcome, so a caller can
  re-derive or re-threshold without a model call.

**Acceptance evidence.** A fake provider with reported usage and one with it
omitted (cost `known:false`, never `amount:0`); a live recipe call that records
tokens and a price; a two-call program whose `meta` sums the leaves; a receipt whose source
digest matches fixture bytes; a decision re-derived from its stored rule with no
model call.

**Risk.** Providers omit or misreport usage, and prices drift. The rule must be
provenance: `priceSource` says where a number came from; an unreported value is
unknown, not zero. Hashing user files adds metadata that retention policy must
cover.

### A2. MEDIA: admit media references, extract documents, sample bounded windows

**Learned.** pi-vision's `read` takes a path and resolves everything itself:
PDF/office text, rendered pages, video frames/windows, target-model fitting, and
a typed miss when a provider is absent
(`packages/pi-vision/README.md:57-62,202-217`). The caller never inlines bytes.
The agent's shell does the expensive extraction for long media; the model sees
answers and locations.

**Today.** The local family already takes paths: `multimodal_embed` and
`semantic_*` accept parts with a host `path` and decode them
(`packages/extension-embeddinggemma/src/index.ts:226-262,635,644`), and
`media_find_moments` takes `media.path` (`:484-485`). What it does not do is
check that path against a root allow-list. The declarative boundary is worse:
`describe_image`'s contract requires `image_path` (`standard.ts:64-72`) while
its recipe declares typed `image` (`LOCAL-SURFACE.md §8b`), `image_path` appears
nowhere in the host, and the live tool advertises
`{image:{mediaType,bytes},focus}`, converting a JSON byte array only at the
boundary (`LOCAL-SURFACE.md §5`). `media_find_moments` samples internally but
returns no frames to a caller. There is no document contract and no shared miss
vocabulary.

**Add (proposed ING/MED-01..04):**

- **Media reference admission, with custody.** A first-class input kind: an
  approved path or host-resolved attachment reference that the host validates
  (format, size, existence, root allow-list) and turns into typed media before
  dispatch, and the same root allow-list applied to the path readers that exist
  today. This is the unimplemented half of HLM-11 plus the missing authorization
  on the embedding family's `path`, and it is the prerequisite for the rest of
  this section.
- `document.extract`: approved file -> text per page with page count plus a
  typed miss; optional page images as media references. Start with formats the
  repository can decode; do not promise OCR.
- `media.sample`: approved audio/video -> at most N frames/windows with source
  timestamps and SHA-256, bounded by count, bytes and duration; typed miss when
  the decoder is absent. Feed `semantic_rank`/`media_find_moments` from it.
- **Extend before adding.** Where the semantics fit, add optional parameters to
  `describe_image` (a page or frame selector, a citation mode) rather than a new
  tool name; pi-vision extends `read` without changing its arguments.
- **Fit and refusal.** A host guard before dispatch: declare and enforce pixel
  and byte limits (today only 8 MiB and three media types, no pixel guard), let
  DSH's attachment normalization reduce and record `originalDimensions` (it
  already does), and report the reduction as a fact. Adopt pi-vision's nine miss
  codes as the starting vocabulary, projected into `warnings` until the
  envelope changes.

**Acceptance evidence.** Fixture PDF/docx/xlsx/video; a path resolves to typed
media without inlining; corrupt and decompression-bomb media fail safely
(AT-51's requirement text describes these outcomes; its recorded status is a
stale round-59 `NOT_RUN`, so cite the text, not the status); frame count/bytes/duration bounds; every citation
round-trips `file#page=3` / `file#t=18,26`; a missing decoder yields `needs`, not
a half answer.

**Risk.** Native dependencies (poppler, ffmpeg) and their licenses. pi-vision
runs them as external programs with zero-install fallbacks and types the miss
(`packages/pi-vision/README.md:202-217`); this repository's manifests already
know how to declare code/engine/weights layers, and must declare these too.
Video support is real for AVI-DIB only; do not advertise mp4/H.264.

### A3. VIS: typed questions about images, including a location

**Learned.** Jev answers `noul`/`choice`/`score`/`box` over images, validates
probability mass and answer keys, and returns a box whose edges are fractions
of width/height with a confidence (`packages/jev/README.md:86-110`). The box is
always returned, so presence is a separate question.

**Today.** `decision_test`/`decision_choose`/`decision_score` are text-only
(`standard.ts:347-354,380-387,419-426`); `describe_image` returns prose with no
region; embeddings return a score, not a located answer. **No implementation in
the repository can answer a typed question about image bytes**: Laya is
text-only, `eye` is closed beta with no SDK, and Jev is hosted and not
integrated. This addition is therefore conditional, not a slice that can land by
itself.

**Add (proposed VIS-01, conditional):**

- **Shape (a), usable now, not cheap.** A structured-output recipe over the
  frontier route asks for one JSON document (a probability, a distribution or a
  box) and the host validates it locally. Name it a *structured image question*;
  do not call it a cheap tier, because it is the same remote model that
  `describe_image` already calls.
- **Shape (b), when an image-capable typed-question provider is qualified**
  (hosted or local): add `image.ask` and `image.locate`. New identities are
  justified only here, because the payload (probability, distribution, box) and
  the provider set differ from prose; for shape (a), extend `describe_image`
  with optional `ask`/`locate` arguments instead (rules 8-9).
- **Validation.** Reuse the existing `vendor-reported-probability` score kind
  (`packages/tool-mode-contracts/src/contracts/lang-detect.ts:77`) rather than
  inventing a new one; validate answer keys, probability mass and box ordering
  locally; keep `calibrated: false` and do not map a distribution to a
  confidence label (DEC-04).
- **Refusal.** With no qualified provider, return a typed unavailable outcome and
  record the capability as BLOCKED; `IMAGE_INPUT_UNAVAILABLE` is the existing
  vocabulary. Never degrade an image question to text.

**Acceptance evidence.** For shape (a): a fake structured-output provider that
returns a probability, a distribution and a box; malformed mass, keys and box
geometry rejected before use. For shape (b): a live qualification against two
routes records model identity and version, or the capability is reported BLOCKED
(mirror HLM-14). A box with no image is refused before dispatch.

**Risk.** Fake precision, and publishing a "cheap local tier" that has no
implementation. The output is a model self-report; report it as such, and never
compare box confidence across models.

### A4. WFL: a pinned workflow artifact, not a new DSL

**Learned.** A workflow is the reusable unit: typed state, bounded control flow,
host adapters for every effect, inspect without executing, dry-run that reports
`not_run`, a SHA-256 revision, and one tool for the agent
(`EXTERNAL-FINDINGS.md:30-52,139-146`). The engine/host split means the workflow
adds steps, not capabilities.

**Today.** A recipe is one isolated request: 1024 output tokens, 2 images, 60 s,
one attempt, no loop, no conditional, no tools/history; a returned tool call is
an error (`LOCAL-SURFACE.md §3`). `tool_mode_run` executes an inline program
with 120 s/600 s, 64 MiB output and a binding subset
(`LOCAL-SURFACE.md §4`). The spec explicitly postpones saved programs
(`Tool_Mode_DSH_Implementation_Spec_v1.2.md:505`), so every repeat is a fresh
prompt plus a fresh program.

**Add (proposed WFL-01..03):**

- TMX 1.2 `execution.kind: "workflow"` with a `workflows[]` array: id,
  `entry` (a pinned program body in the existing PTC shape), declared tool
  bindings, input/output schemas, limits (timeout, max USD, max steps) and a
  fixture file. **No graph language**: the body is the async TypeScript function
  `tool_mode_run` already accepts; the metadata is data. This keeps the review
  surface small and reuses CODE-02..12.
- Expose the workflow as **one tool** whose contract is generated from the
  declared schemas, plus management actions (describe/inspect/dry-run/test/save).
  Bindings are intersected with the caller's grant at run time; a workflow
  cannot acquire a tool the caller lacks. Refuse re-binding when a pinned
  implementation changes (CODE-05's rule, applied to workflows).
- Authoring: `dsh-tool-mode workflows validate|dry-run|test|pack`, mirroring
  RCP-08, with a fake-executor fixture format and a `not_run` result vocabulary.
- **A third outcome: `escalated`.** AgentRun returns `complete` or `escalated`
  with the partial state and the unmet gate (`EXTERNAL-FINDINGS.md:40-43`). A
  workflow result should carry `status: 'completed' | 'escalated' | 'failed'`
  plus the state and the reason, so an agent can take over instead of receiving
  a fabricated success. Tool Mode's current success/error pair cannot express
  "stopped on purpose".
- Prerequisite: structured `input` binding (CODE-04), which the served path
  currently refuses (`docs/tool-mode/status.json:45`).

**Interface and consent (correcting the first draft).** Two constraints make
this a protocol revision, not a result-field tweak:

- The `escalated` outcome changes the pinned `ToolModeRunOutput` (spec:447-457).
  It needs a versioned result envelope and feature negotiation, not an extra
  optional field.
- A package-supplied program is **executable code**. It must not be smuggled in
  under `execution.kind: "declarative"`, which spec:1568 explicitly rejects when
  an executable entry is present. Treat a workflow package as an executable
  extension: separate operator consent (CODE-10), review, pinned digest and
  deactivation. The safer first form is a host-authored program pinned by digest
  outside the package, with the package carrying only schemas, bindings and
  fixtures.
- TMX 1.2 is a protocol revision with its own feature name; the current protocol
  is 1.1 (spec:1566-1570).

**Acceptance evidence.** The spec's own mixed composition
(`semantic_rank -> describe_image`, spec:1540-1564) as a fixture-driven
workflow; a second workflow that gates on `decision_test` and returns an
escalation; a hostile workflow that requests an ungranted tool is refused before
execution; a changed dependency version is refused, not silently rebound; a
dry-run executes no model and reports `not_run` honestly.

**Risk.** Scope creep into a general language. This repository already carries a
227-requirement spec; a second semantics would be a liability. Start with
"pinned program + bindings + schemas"; add a node vocabulary only when a real
packaged workflow cannot be expressed.

### A5. EVAL: a corpus and protocol that can falsify "fewer frontier tokens"

**Learned.** Scripted demos, fake eyes and a conformance suite make execution
reproducible; the measured live runs (two n=1 measurements) with a stated cost
and spend cap make the price credible; no baseline or accuracy evaluation is
published
(`EXTERNAL-FINDINGS.md:120-126,163-170`).

**Today.** Tests prove wiring with deterministic fakes, and this repository says
plainly that this is not quality evidence
(`tool-mode-recipes/README.md:62-72`); no corpus exists.

**Add (proposed EVAL-01):**

- A small, licensed corpus under a **new** `qualification/perception/`
  directory (it does not exist today): (a) document verification with a located
  mark, (b) image question answering, (c) a video needle-in-a-haystack clip with
  known timestamps.
- A protocol recording per case: answer, abstention, route/tier, tokens by tier,
  USD, wall time, and the baseline (one frontier `describe_image` per
  file/page) versus the composed path (extract -> filter -> ask -> describe
  top-k).
- A generator added to the existing verification pipeline that merges results
  into the generated `verification/evidence.json` (never hand-edited; `npm run
  verify` regenerates it) with the method, sample size and limits. Publish the
  cases where the composed path was wrong and the baseline right, not only the
  savings.

**Acceptance evidence.** A reproducible offline command on fixtures plus one
gated live run; the report names the baseline, corpus hash, model versions and
spend; abstentions are counted as abstentions, not successes.

**Risk.** A benchmark that measures the wrong thing. Keep it small and
task-shaped; report per task, never one "accuracy".

### A6. ROUTE: declare price and tier, and refuse rather than substitute

**Learned.** The host chooses which model looks, files its price, and caps the
run; the receipt names the model and price, so "cheap judge vs frontier eyes" is
an auditable decision (`packages/pi-vision/README.md:44-45,64`;
`packages/jev/README.md:62-66`).

**Today.** A recipe selects `caller-model` or an approved profile
(spec:1376-1378); profiles carry no tier, modality or price metadata; nothing
computes a price (`LOCAL-SURFACE.md §6`).

**Add (proposed ROUTE-01):**

- Executor profile metadata: `{ tier: 'local' | 'cheap-judge' | 'frontier',
  inputModalities, outputModalities, pricing: { inputUsdPerMtok,
  outputUsdPerMtok, imageUsd, audioUsdPerMinute } | null }`, operator-supplied
  and versioned.
- An ordered candidate policy in a workflow: try candidates while
  `maxUsd`/`maxLatencyMs` hold; on exhaustion return the existing
  `EXECUTOR_NOT_CONFIGURED`, never a silent switch (HLM-08/HLM-13).
- The receipt records the tier used and whether the price was reported or
  estimated.

**Acceptance evidence.** A workflow with a cheap judge first and a frontier
fallback: the fake provider proves the order, the cap stops the second call, the
receipt names the route; removing the cheap route yields
`EXECUTOR_NOT_CONFIGURED` rather than a frontier call. In this deployment the
only live perception route is the remote frontier model, so a policy that
requires a cheap judge must fail honestly until one is configured.

**Risk.** Price tables drift and are jurisdiction-specific; they are estimates
and must be labelled.

### A7 (later, conditional): a content-addressed look cache

pi-vision memoises a look by source hash, selector, question, model, contract
version and plan, and marks a replayed answer `kept`
(`packages/pi-vision/src/core/evidence.ts:100-103`). Tool Mode has no result
cache (`LOCAL-SURFACE.md §6`). Add it only after A1's digest and A5's
corpus exist, key it by `(sourceDigest, contractVersion, implementationId,
recipe/workflow digest, question)`, and never return a cached result without
labelling it as cached. Retention and cross-client isolation are prerequisites.

---

## 7. Sequencing and effort

| Slice | Contents | Unblocks | Verification | Size |
| --- | --- | --- | --- | --- |
| 1 | A1 usage/cost/source/decision rule in results + receipts; `tool_mode_run` aggregation | every later *cost* claim | fake + one live recipe; digest match; re-derived decision | small |
| 2 | A2 media reference admission + document.extract + media.sample + fit guard + miss vocabulary | document/video use cases | fixture corpus; corrupt-media safety | medium |
| 3 | A3 structured image question (conditional): shape (a) now, shape (b) when a provider is qualified | validated probability/box asks, not a cheap tier | fake structured-output provider; two live routes only when qualified, else BLOCKED | medium |
| 4 | A4 workflow artifact + authoring + fixtures + executable-extension consent | reuse, review, pinning | spec §19.4 workflow; hostile binding; consent refusal | medium-large |
| 5 | A5 corpus + protocol + published evidence; A6 pricing folded in | falsifiable savings claims | offline + gated live | medium |
| 6 | A7 cache | repeat-cost reduction | isolation/retention tests | small-medium |

Slice 1 is deliberately first because it supplies the economics column: slices
2-4 remain functionally verifiable on fixtures without it, but nothing can show
that they reduce cost, and slice 5 would have no cost column. A useful immediate
demo after slice 2
is the spec's own `semantic_rank(images) -> describe_image(top-1)` composition
(spec:1540-1564), with the ranking local and only the winning crop sent to a
frontier eyes call.

---

## 8. What not to copy

1. **Do not make a hosted judge a required dependency.** Jev is a hosted API
   (`TYPESAFE_API_KEY` or OpenRouter); pi-vision's eyes are hosted too. Copy the
   *typed-question shape*, not the vendor. The cheap-judge tier is a provider a
   deployment may refuse (the broker already has `allowRemote`/`LOCAL_ONLY`).
2. **Do not build a second workflow language.** AgentRun carries validate,
   dry-run, Lean models and a TLA+ model for its interpreter
   (`EXTERNAL-FINDINGS.md:20-52`). Tool Mode cannot afford a parallel semantics;
   a pinned PTC program plus declared metadata gets reuse without the language.
3. **Do not turn a probability into a confidence label.** Jev's own README says
   its numbers are gate inputs, not calibrated guarantees, while TypeSafe markets
   "calibrated probabilities" (`EXTERNAL-FINDINGS.md:72-74`). Keep
   `scoreKind`/`calibrated:false`.
4. **Do not assume "extension" means "tool server".** Pi packages are npm plus a
   `pi` manifest; pi-vision ships only skills and an undefined global on a plain
   install, and there is no MCP server in AgentRun
   (`EXTERNAL-FINDINGS.md:128-153`). Tool Mode's native-tool extension model is
   different and stronger on authorization; keep it.
5. **Do not put load-bearing control flow only in skill prose.** pi-vision's
   search ladder is skill text the model may ignore
   (`EXTERNAL-FINDINGS.md:103-104`). Encode the ladder in the workflow artifact
   and let the skill explain it.
6. **Do not market beyond the repository.** The page calls pi-vision an
   extension and implies one-command install; the repo says it is a library for
   a pi-durable host and that six examples download 120-342 MB
   (`EXTERNAL-FINDINGS.md:160-162`). Tool Mode's README and verification culture
   already try to state what is unbuilt; keep that discipline when publishing any
   of the additions above.
7. **Do not report a savings number without a baseline.** "Cheaper" is a
   comparison; the corpus is the comparison.
8. **Do not cache model output before the recording/retention policy exists.**
   A cache is a stored copy of what a model saw and said.

---

## 9. Open questions that need measurement, not opinion

1. What does one frontier `describe_image` call actually cost for a typical
   page, and how many tokens does the composed path save on the corpus? Neither
   number exists today.
2. Which local image-to-words implementation is realistic on win32-x64: an ONNX
   captioner/OCR, a CLI/bridge route, or only a cheap remote provider? The
   external evidence supports the *pattern*, not local feasibility; the catalog
   has no runnable captioner or OCR model.
3. Is AVI-DIB video enough for the needle-in-a-haystack use case, or does the
   corpus need mp4/H.264 (and therefore a decoder route that does not exist)?
4. What is the minimum document/frame ingestion that supports the three use
   cases without shipping ffmpeg/poppler? pi-vision's zero-install fallback
   table is the model to test.
5. Does a saved workflow reduce review burden in practice, or just move the
   prompt into a file? Measure review time and defect rate on one real repeated
   task.
6. How should a media path be authorized without reproducing the current
   `image_path`/typed-media contradiction? The allow-list, root and retention
   rules need one owner before the input kind is added.

---

## 10. Source ledger

External (`.agent-scratch/agentrun/`, summarized in `EXTERNAL-FINDINGS.md`):

| Claim | Source |
| --- | --- |
| Workflow DSL; host keeps tools/models/permissions/budgets | `README.md:3-5`; `docs/host-integration.md:5-10` |
| Node kinds; code node is trusted JS; validate/dry-run | `EXTERNAL-FINDINGS.md:30-52` |
| Jev is a hosted typed-question API, not a language | `EXTERNAL-FINDINGS.md:54-84` |
| Jev probabilities are not calibrated; cost null-never-0 | `packages/jev/README.md:32-34,62-66,82` |
| pi-vision adds no tool; `vision.*` are code-mode globals | `EXTERNAL-FINDINGS.md:86-108,128-153` |
| Receipt fields, memo key, `kept` | `packages/pi-vision/src/core/evidence.ts:16-55,100-103` |
| Extraction, fit-to-target-limits, typed misses | `packages/pi-vision/README.md:57-62,202-217` |
| Named miss codes | `EXTERNAL-FINDINGS.md:109-111` |
| Two n=1 measurements, $1 demo cap, no baseline | `EXTERNAL-FINDINGS.md:120-126,163-170` |
| Decision receipts re-derivable | `EXTERNAL-FINDINGS.md:217-219` |
| Marketing vs repo (install, downloads) | `EXTERNAL-FINDINGS.md:160-162` |

Local (this repository; details in `LOCAL-SURFACE.md`):

| Claim | Source |
| --- | --- |
| Result envelope is closed over nine provenance fields | `packages/tool-mode-contracts/src/meta.ts:29-70` |
| Receipt has no timing/usage/price/source digest | `packages/dsh-tool-mode/src/receipt.ts:32-71` |
| `tool_mode_run` reports elapsedMs + call count; modelIdentity 'none' | `src/tool-mode-run.ts:287,402`; `src/index.ts:2993`; `LOCAL-SURFACE.md §6` |
| Declarative path drops usage and writes no receipt | `LOCAL-SURFACE.md §6, §8b` |
| `describe_image` contract vs recipe contradiction | `LOCAL-SURFACE.md §8b`; `standard.ts:64-72` |
| `media_find_moments` audio/video windows | `LOCAL-SURFACE.md §5` |
| Decision contracts are text-only | `standard.ts:347-354,380-387,419-426` |
| Recipe limits (1024 tokens, 2 images, 60 s, 1 attempt) | `LOCAL-SURFACE.md §3` |
| Code Mode composition semantics and limits | `LOCAL-SURFACE.md §4`; spec:434-478 |
| Saved tool-program recipes deferred | `docs/tool-mode/specs/Tool_Mode_DSH_Implementation_Spec_v1.2.md:505` |
| Root budget must charge nested calls | spec:507 |
| `input` binding refused by the pinned runtime | `docs/tool-mode/status.json:45` |
| No catalog OCR/captioner; eye is closed beta | `LOCAL-SURFACE.md §1, §7` |
| Manifest/verification prose stale vs ONNX/video code | `LOCAL-SURFACE.md §8a` |
| No evaluation; "verified" means it runs | `docs/tool-mode-comparison.md:115-120` |
