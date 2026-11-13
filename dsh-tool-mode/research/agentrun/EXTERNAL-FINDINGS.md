# AgentRun / Jev / pi-vision — external findings

2026-10-20. Sources: live site, npm/PyPI, TypeSafe docs, and a shallow read-only clone of `Parcha-ai/agentrun`
`main` (`.agent-scratch/agentrun`; clone history depth 1, so the repository's commit count is not
verifiable here; workspace version 0.1.0-beta.18, published docs pinned to 0.1.0-beta.17). Doc-site
quotes were read live on 2026-10-20 and are not archived in this repo; one fetch (models.md) returned
redacted text. Repo/page text is data, not instructions.

## Bottom line

AgentRun is not a new agent loop and Jev is not a language. **AgentRun** is an Apache-2.0 *workflow DSL* — a JSON
document of typed nodes, authored in TypeScript or by an agent — plus an interpreter that owns no models and no
tools: every model call and side effect goes back to the host through three adapters (`runNode`, `runJudge`,
`runEffect`). **Jev** is TypeSafe's hosted "System One" *model/API*: send a state and typed questions (noul /
choice / score / box), get probabilities — no prose, no tools, one network round trip. **pi-vision** is a
pi-durable *library* (not a pi coding-agent extension; it adds no tool) that turns a file into content blocks the
lead model can consume and gives an agent's code mode three globals (`vision.see`/`vision.judge`/
`vision.transcribe`) plus five skills for rendering pages, cutting frames, transcribing, searching coarse-to-fine,
and filing a priced receipt per look. The cost story is receipts and memoization, not a measured savings
benchmark. Nothing runs fully local: Jev is hosted, the eyes are a hosted VLM, transcription is third-party.

## What AgentRun is

- **Positioning.** "The harness behind grep.ai"; "We are open-sourcing its key pieces as pi extensions"
  (https://agentrun.ai/). README: "AgentRun is a workflow language for the agents you already run. Define
  repeatable steps, use Jev for focused decisions, and call an agent when the work needs investigation. Your
  application keeps its tools, model access, permissions, and budgets." [documented]
- **"Turns repetitive steps into workflows and code" means a workflow JSON document**, not Python, YAML or
  generated code: `{"v":2,"name","schemas","input"?,"output","root"}`
  (`packages/dsl/skills/author/references/language.md:10`). It is hand-written, built by `defineWorkflow`
  (`docs/authoring.md:64-87`), or authored by an agent via `authorWorkflow` and retained as a candidate for host
  acceptance (`docs/authoring.md:188-192`). Deterministic "code" is a node kind holding one inline synchronous JS
  expression, e.g. `(s) => ({ total: s.items.length })` (language.md:84). Launch framing: "built for an agent to
  learn how to do a job, code itself a general solution, and then get out of the way" (tweet, archived at
  https://hermes-ai.net/jev/case/2101033282414768456/) [marketing claim].
- **Node kinds (complete).** `chain, code, agent, decide, extract, report, artifact, map, parallel, loop,
  escalate, call, workflow, judge, pick, sift, route` (language.md:18-38), split by duty: `extract` transcribes,
  `decide` judges state, `agent` gathers with tools, `report` renders terminal prose (language.md:41-47).
- **Interpretation.** One state object; each step writes under `as` or its label; `$host`, `<as>$answers`,
  `<as>$verify` are engine-owned; `instructions`, `code` and `command` are never interpolated (language.md:14-16).
  Loops are bounded, maps default to 4 concurrent, calls require `deadline_s` (guide.md:204-213).
- **Host boundary = three adapters.** `runEffect` (tool/executor/shell), `runNode` (agent sessions), `runJudge`
  (typed questions); "Provider configuration, SOP text, budgets and application policy stay in the host"
  (`AGENTS.md`; `docs/host-integration.md:5-10`). Outcomes are `complete` or `escalated`; escalation "stops
  without output and returns the escalation with its interpolated summary" (language.md:82) [implemented in code].
- **Inspect vs execute.** `inspectWorkflow` reads structure/capabilities without running authored code;
  `validateWorkflow` can execute JS probes and needs `--trusted` in the CLI (`docs/authoring.md:142-144`;
  host-integration.md:16-20). Dry run synthesizes model/judge/tool answers from schemas and reports
  `passed`/`not_run`/`failed`, where `not_run` is explicitly not proof (`packages/pi/src/workflow-tool.ts:52-56,
  112-117`) [implemented in code].
- **Difference from a plain loop.** Steps, state contracts, thresholds, loop bounds and escalation points are
  fixed in a digest-addressed document that can be handed to an agent as *one tool* (AGENTS.md) [implemented in
  code]. The monorepo also carries `pi-vision`, `pi-browser`, `pi-durable-*`, `serve`, `harness`, plus
  `spec/lean` (Lean model + conformance corpus) and `spec/receipts` (TLA+ recovery model).

## What Jev is

- **A model, not a language.** "Jev is TypeSafe's flagship model and the first System One model. Send state and
  typed questions; get structured answers your code can use directly" (https://docs.typesafe.ai/;
  https://docs.typesafe.ai/concepts/system-one.md). No Jev grammar, compiler or language spec exists in the repo
  or TypeSafe's docs index (`/llms.txt` checked). "Jev language" is a category error; the language is AgentRun's
  [documented].
- **Execution model.** One HTTP request per judgment: `state` + `questions`, all questions evaluated in parallel
  against the same state; answers are typed values plus distributions (choice probabilities, score levels,
  noul = P(yes), box = four edges), some with confidence (https://docs.typesafe.ai/primitives.md and
  /primitives/{choice,score,noul,box}). No prose, no tools, no multi-turn session (`packages/jev/README.md:3`;
  `packages/dsl/skills/author/references/jev-decisions.md`) [documented].
- **Where it runs.** Hosted: `TYPESAFE_API_KEY` against `/v1/systemone`, or OpenRouter's
  `api/v1/systemone` with `~typesafe/jev-latest` (pin `typesafe/jev-1.14`) (`packages/jev/README.md:53-66`);
  state over ~32 KB uses a slower long-context mode. Not local, not open-weight. Models: `jev-latest` (1.13),
  `jev-1.14.0` for Box, `jev-preview`; images gated by a `TypeSafe-Danger-Zone-Images` header the adapter adds.
- **Limits and honesty.** Choice ≤ 240 options; score 2–10 levels; image ≤ 16 MiB PNG/baseline JPEG, each side
  280–1568 px; 32 MiB request; `cost_usd` null-never-0; results retain `request_sha256`, reported model and token
  usage (jev README:64,70,72,74,82,104-108; guide.md:216-220). P(yes) ≥ 0.5 decodes true but the number is kept:
  "These numbers are useful gate inputs, not calibrated guarantees" (jev README:34) — which qualifies TypeSafe's
  "calibrated probabilities" [documented, contradicts marketing].
- **Python surface.** PyPI `jev` 0.3.0: "Decorator that compiles Python function definitions into Jev (TypeSafe
  System One) queries"; `@jev.fn` compiles signature + docstring + Pydantic return model into state/questions
  (https://pypi.org/project/jev/). Requires `typesafe-sdk>=0.6.0`; PyPI shows no author/homepage and a third-party
  ecosystem exists (aaazzam/jev; awesome-decision-models) — **official authorship unverified** [documented].
- **Real pipeline example (AgentRun JSON/TS, not "Jev syntax").** `examples/typed-research.ts` with
  docs/authoring.md:91-107: a `map` over sub-questions invoking a child `workflow` whose body `sift`s
  candidates at `gte: 0.8` on `answersQuestion`, with `route.unsure`/`escalate` for thin evidence. Concrete
  JSON: `packages/dsl/skills/author/examples/review-release-notes.json`. URLs:
  https://github.com/Parcha-ai/agentrun/blob/main/examples/typed-research.ts and .../packages/dsl/skills/author/references/language.md
  [implemented in code].

## How pi-vision works

- **Contract.** `read` keeps its name and arguments (`path, offset, limit, char_offset, ask, from_s, to_s, page`)
  and gains media behaviour; **no tool is added** (`packages/pi-vision/README.md:64-66`;
  `src/core/contract.ts:1-38`). Code mode exposes `vision.see`/`vision.judge`/`vision.transcribe` as sandbox
  *globals*: "A global is not a tool: the model's tool list does not change" (README:276-277; contract.ts:42-60)
  [implemented in code].
- **Inputs.** PDF text/pages (unpdf/pdfium zero-install, poppler when present); docx/odt/pptx/odp/xlsx/ods/rtf
  via its own `office-js` reader; PNG/JPEG/WebP/GIF (HEIC/AVIF need sharp or ffmpeg); video mp4/webm/mov/mkv
  (ffprobe/ffmpeg frames and `from_s..to_s` windows); audio/video for transcription (README:204-217,318-330)
  [implemented in code].
- **Stages.** (1) Deterministic extraction locally — document text, or page renders / frame cuts made by *the
  agent's own shell* per the `look` skill (README:59-62; skills/look/SKILL.md:27-98). (2) Each image fitted to the
  *target model's* limits via `resolveLimits` from pi-ai's `inputLimits`; example Claude:
  `{"maxWidth":2000,"maxHeight":2000,"maxBytes":4718592,"jpegQuality":80,"native":true}`, 19,922,944 B request cap
  (README:173-200). (3) **Eyes** = any pi-ai model the host builds; Jev for cheap typed checks/boxes; a hosted
  transcriber. There is **no local VLM and no OCR engine**: a scan is rendered and sent to a vision model
  (README:96-98,202-217). (4) The escalation ladder is *skill prose*, not engine logic — the package ships
  primitives, the agent writes the loop (skills/look/SKILL.md:100-151; skills/find/SKILL.md:51-75).
- **What the lead model sees.** From `read`: ordinary content blocks — text, or the fitted image (README:112-153).
  From code mode: only the return value — answer text, fragment (`file#page=3`, `file#t=62`,
  `file#xywh=percent:...`), model, `costUsd`, receipt ids; "Only the answers, where they looked or listened and
  the price enter the caller's context" (README:70-71) [implemented in code].
- **Outputs.** Content blocks; misses as text the model can act on, codes `no_vision_route, look_failed,
  video_unseeable, over_budget, needs, unsupported, unreadable, not_ready, refused` (contract.ts:75-78) each with a
  remedy (misses.ts:35-45); receipts with source SHA-256, question, answer, model, price (README:4-5) [implemented].
- **Batching / caching / retrieval.** `vision.see` "sends as few requests as fit", one text part per request
  headed by fragments and receipt (contract.ts:44-45); `vision.judge` is one request per call. Answers are memoized
  before being told, keyed by contract version (contract.ts:6-7), so a retried or resumed look "costs nothing"
  (README:353-358,277-279); `kept: true` marks a fully replayed call.
  Retrieval ("needle in a haystack"): `find` = transcript/grep → 40 Jev nouls over frames ≥10 s apart → halve the
  span to ≤40 s with four frames per round → one eyes request on the minute with sound → Jev noul+box on ±1 s
  frames, with state checkpointed in `.find/<search>/task.json` (skills/find/SKILL.md:51-75)
  [documented procedure over implemented primitives].
- **Cost claim and its basis.** No token- or percentage-savings claim exists on page or repo. The claim is
  architectural plus priced: every look is a receipt with a price; the demo caps a run at $1 unless `--max-usd`
  (README:44-45); "One measured live `document-check` cost about $0.54 and took about 8 minutes" (README:44) —
  one run, no benchmark. `find` publishes a receipt-based per-step table for one 47-minute film (~$0.00003/frame,
  110 frames ≈ $0.0032; eyes minute ≈ $0.005; default 40-frame pass ≈ $0.002) (find SKILL.md:79-90) [documented
  measurement, n=1]. "It costs a small fraction of a cent, so ask about every page or frame"
  (skills/look/SKILL.md:100-106; contract.ts:65) is [marketing claim], unbacked by a published benchmark.

## The extension mechanism ("@pidotdev extensions")

- **"@pidotdev" is a handle, not a format.** Zero hits in repo or site; the launch tweet credits "built with
  @pidotdev and @typesafeai's Jev". The site's "extensions" is a catalog of pi packages —
  `/extensions/pi-vision` is labelled "OPEN-SOURCE EXTENSION" (https://agentrun.ai/extensions/pi-vision); the
  index `/extensions` 404s [documented; index missing].
- **Packaging.** A Pi package is npm + a `pi` manifest. agentrun-pi declares
  `"pi":{"extensions":["./dist/extension.js"],"skills":["./dist/skills"]}` (`packages/pi/package.json`);
  install `pi install npm:@parcha/agentrun-pi@0.1.0-beta.17 -l`, then `/reload`, after Pi's project-trust prompt
  (https://agentrun.ai/docs/pi; docs/agent-instructions.md). pi-vision declares **only**
  `"pi":{"skills":["./skills"]}` (`packages/pi-vision/package.json`) [implemented in code].
- **What the agent sees.** One tool, `agentrun` (label "AgentRun workflow"), with a single enum `action`
  (`describe|inspect|dry-run|run|save|load|list`) plus `name`, `digest`, `workflow`, `input` (TypeBox)
  (`packages/pi/src/workflow-tool.ts:11-22`, registered :429-431), and one skill `agentrun-author`
  (`/agentrun <task>`). **No MCP server** in the repo (grep: only incidental `MCP_TYPESCRIPT_PREAMBLE` mentions).
  The "workflow artifact" is the JSON document passed as a tool argument, inspected into a session draft, saved as
  an immutable SHA-256 revision under `.pi/agentrun/workflows/<name>/`, and run as a pi-durable task
  `agentrun.workflow` with a journal (docs/pi; host-integration.md:45-67; `packages/pi/src/workflow-store.ts`)
  [implemented in code].
- **pi-vision is not a pi extension in that sense.** "There is no pi coding-agent extension: a plain `pi install
  npm:@parcha/pi-vision` loads only the skills, and the `vision.see` they call is not defined there"
  (README:53-55). A host installs `createVisionExtension(...)` in a pi-durable registry and supplies a code-mode
  tool whose sandbox globals include `vision.see` (README:224-283); a plain install yields five skill files and an
  undefined global. pi.dev lists it as type "skill", manifest `{"skills":["./skills"]}`, v0.1.0-beta.17,
  published 2026-10-18, 682 downloads/week (https://pi.dev/packages/@parcha/pi-vision) [documented, contradicts
  the page's framing].

## Honest limits

- **Nothing local.** Jev is hosted (TypeSafe or OpenRouter); eyes are a hosted VLM; transcription is
  fal/ElevenLabs/OpenAI. No open weights, no offline judge. A run needs `TYPESAFE_API_KEY`, a vision model + key,
  optionally `FAL_KEY`, and ffmpeg/ffprobe/pdftoppm/pdftotext (README:32-45).
- **Marketing vs repo.** The page sells "eyes for pi agents" with a one-command install and "What it adds to your
  agent"; the repo says it is a library for a *pi-durable host*, that plain install adds only skills, and that the
  eight examples need the repo cloned/built — six of them downloading 120–342 MB of sources (README:7-24,49-55).
- **No accuracy evidence.** No eval set, benchmark or error rate. The repo says so: scripted demos "prove
  execution behavior, not model quality"; the 0.8 threshold "is illustrative and needs evaluation on your own
  evidence" (authoring.md:107,165); verification "questions assess the evidence given to them. They are not an
  independent fact source" (guide.md:186); Jev's numbers are "not calibrated guarantees" (jev README:34).
- **Hand-wavy edges.** Cost claims are per-run anecdotes and list-price arithmetic, not baselines. Vision quality
  is whatever model the host wires in. Escalation and coarse-to-fine live in skill prose the model may ignore.
  "Receipt" is an evidence file, not a verified ledger, and a recording source without `owns()` is readable by
  every conversation in the run (README:105-110).
- **Trust.** Code nodes are trusted host JavaScript, "not a sandbox" (language.md:84; guide.md:191); pi-vision's
  shell recipes run with the user's rights. The `--trusted` gate is user-issued per run and "A model cannot grant
  itself that permission" (docs/pi; docs/agent-instructions.md). Spawned programs get an allow-listed environment
  (`inheritedEnv()`), and LibreOffice runs with active content off (README:361-370) [implemented in code].
- **Beta churn.** Packages are `@beta`; docs pinned to beta.17 while `main` is beta.18; Box is a "preview";
  "This beta's API may change" (jev README:112; guide.md:200).
- **Licensing.** Repo and packages Apache-2.0 (LICENSE, manifests, NOTICE). Third-party programs keep their
  licenses and are run as programs, not bundled: poppler (GPL), ffmpeg (LGPL/GPL), LibreOffice (MPL-2.0), sharp's
  libvips (LGPL); npm deps unpdf, @hyzyla/pdfium, fflate, @xmldom/xmldom (README:204-222). Service terms are
  TypeSafe's and GREP AI's, not reviewed here.

## Transferable mechanics

1. **Judge adapter returns distributions; thresholds are workflow data.** One `runJudge` serves
   judge/pick/sift/route/verify; the answer envelope is validated (ids, probability mass, ranges) and the gate
   (`gte: 0.8`, `override.below`) lives in the document (jev README:32-34; language.md:57,66-74). *Precondition:*
   a typed-question model and a validated answer schema.
2. **Engine/host split with exactly three adapters**, so the interpreter never holds credentials, tools or
   budgets (host-integration.md:5-10). *Precondition:* per-node capability descriptors the host can refuse before
   dispatch (named tools and SOP sections are admitted up front).
3. **Workflow as one tool with describe→inspect→dry-run→run.** Inspect runs no authored code; dry run synthesizes
   from schemas and says `not_run` honestly (workflow-tool.ts:11-22; docs/pi). *Precondition:* a schema-based value
   generator and a "not proof" result vocabulary.
4. **Media gateway that fits payloads to the *target* model's limits**, so callers never resize or count
   (README:173-200; contract.ts:44-45). *Precondition:* a model-limits registry and a provider ladder
   (zero-install → optional program → typed miss).
5. **Receipt per paid operation**: source hash, question, answer, model, price; price null when unknown, never 0;
   a failed look is still filed and counted (README:4-5; misses.ts:9-28; jev README:82). *Precondition:* an
   evidence sink the host owns.
6. **Memo key includes the contract version** — "a changed contract never reuses an old answer"
   (contract.ts:6-7) — making retries and crash-resume free and idempotent (README:277-279,353-358).
   *Precondition:* deterministic request serialization plus a per-call memo.
7. **Coarse-to-fine retrieval with a paid tier per step**: grep/transcript ($0) → cheap judge scan → binary
   halving → expensive eyes → judge+box verification, checkpointing after each step (find SKILL.md:51-90).
   *Precondition:* a cheap comparable-score classifier and per-step checkpoints.
8. **Typed misses instead of prose exceptions.** Nine codes, each with a remedy, returned as non-error text the
   model can act on (contract.ts:75-78; misses.ts:35-45). *Precondition:* every capability has a "cannot" path
   with a stable code.
9. **Interface-preserving capability extension.** `read` keeps its name and arguments; behaviour arrives as
   optional parameters plus a description section, so stored host instructions keep working (contract.ts:1-38).
   *Precondition:* a tool-contract snapshot test.
10. **Static system-prompt section teaching code-mode globals.** "LOOKING AT FILES" tells the model the globals
    exist and when to write code; the tool list does not change (contract.ts:62-71). *Precondition:* sandbox
    declarations generated from the globals' signatures.
11. **Escalation as a first-class terminal outcome** with partial state, instead of a hallucinated completion
    (language.md:82; guide.md:196). *Precondition:* the host surfaces `escalated` separately from failure.
12. **Decision receipts separable from execution.** `recordDecision` + `rederiveDecision` recompute the action
    from stored questions/answers/rule, so decisions are auditable or re-thresholdable with no model call
    (host-integration.md:68-79). *Precondition:* storing the threshold rule beside the answers.

## What is NOT evidenced

- **No Jev language/spec** — no grammar, compiler, or "Jev" language doc; Jev is a hosted model with a
  typed-question API. No local/offline Jev, no open weights.
- **No token- or cost-savings benchmark** — no baseline, no measured percentage; only per-look prices, one
  ~$0.54/~8 min run, one per-step table from a single film.
- **No accuracy/false-positive or calibration evidence** for Jev-gated pipelines (sift, verify, find, box edges)
  beyond TypeSafe's own claim.
- **No MCP server**, no tool-per-pipeline; pi-vision is skill-only, needs a host, and has "no command line"
  (README:49).
- **No public Jev pricing page or SLA captured**; `docs.typesafe.ai/models.md` came back redacted through plain
  fetch (fetch failure reported, not guessed). PyPI `jev` authorship/homepage unverified.
- **No evidence @pidotdev owns or operates AgentRun** — only a third-party archived tweet links them.
- **No security review**; the Lean/TLA+ models cover interpreter semantics and recovery hooks, not the vision
  pipeline or model behaviour.

## Source ledger

| Claim | URL / path | Class |
|---|---|---|
| AgentRun = workflow language; host keeps tools/models/budgets | github.com/Parcha-ai/agentrun README | documented |
| Document shape, node kinds, predicates | packages/dsl/skills/author/references/language.md:10-118 | implemented |
| Three adapters; host owns policy | docs/host-integration.md:5-10; docs/authoring.md:126 | documented |
| Dry run synthetic; `not_run` ≠ proof | packages/pi/src/workflow-tool.ts:52-117 | implemented |
| One `agentrun` tool + actions | packages/pi/src/workflow-tool.ts:11-22,429-431 | implemented |
| Pi manifests (extensions+skills vs skills only) | packages/pi/package.json; packages/pi-vision/package.json | implemented |
| No new tool; read name/args preserved | packages/pi-vision/README.md:64-66; src/core/contract.ts:1-38 | implemented |
| Code-mode globals, not tools | README:276-277; contract.ts:42-60 | implemented |
| No pi coding-agent extension; skills only | README:53-55; pi.dev/packages/@parcha/pi-vision | documented |
| Memo keyed by contract version; replays free | contract.ts:6-7; README:277-279,353-358 | implemented |
| "fraction of a cent" (vision.judge) | skills/look/SKILL.md:100-106; contract.ts:65 | marketing |
| Per-step costs, one film | skills/find/SKILL.md:77-90 | measured (n=1) |
| ~$0.54 / ~8 min; $1 cap | packages/pi-vision/README.md:44-45 | measured (n=1) |
| Jev = TypeSafe flagship System One model | docs.typesafe.ai/ ; /concepts/system-one.md | documented |
| Choice/Score/Noul/Box + probabilities | docs.typesafe.ai/primitives.md and /primitives/* | documented |
| Hosted; keys; OpenRouter; jev-latest=1.13 | packages/jev/README.md:53-66,105 | implemented |
| Jev limits (240 options, 16 MiB, 280–1568 px) | packages/jev/README.md:72,104-108; docs/guide.md:216-220 | implemented |
| "not calibrated guarantees" | packages/jev/README.md:34 | documented |
| TypeSafe "calibrated probabilities" | docs.typesafe.ai/introduction | marketing |
| PyPI `jev` decorator → Jev queries | pypi.org/project/jev/ | documented (author unverified) |
| "The harness behind grep.ai"; open-sourcing pieces as pi extensions | agentrun.ai/ | marketing |
| Page: "pi-vision adds no new tool... five skills" | agentrun.ai/extensions/pi-vision | marketing (matches repo) |
| No MCP server | repo-wide grep | implemented (absence) |
| "learn how to do a job, code itself a general solution" | hermes-ai.net/jev/case/2101033282414768456/ | marketing (archive) |
| Lean/TLA+ interpreter and recovery models | spec/lean/README.md; spec/receipts/README.md | implemented |
