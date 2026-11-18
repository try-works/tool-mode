# dsh-tool-mode

> **User documentation:** [docs/guide](docs/guide/index.md) — install, first call,
> MCP, extensions, custom tools, security and troubleshooting.

Expose on-device models to a DSH agent as **tools**, rather than as chat endpoints.

Each model is wrapped by a **contract** — a stable name with explicit input and output
schemas, semantics, limits and unsupported cases — and bound to one or more
**implementations**. The agent sees `lang_detect` and `stt_transcribe`; which model serves
them is a binding decision, not something the schema changes.

## Implementation status — read this first

**The specifications are not fully implemented.** The normative specification has 227
requirements and the verification checklist adds 90 acceptance tests; **309 are done, 0 are
partial, 8 are blocked and 0 were never started.**

> **[`verification/FINAL-REPORT.md`](verification/FINAL-REPORT.md) is the honest summary**
> — generated from the recorded evidence, it states what genuinely stands with the
> verification method for each claim, names the concrete condition behind every blocked
> item, and says explicitly what it does not claim.

That report is generated, not written, precisely because a hand-maintained summary of 317
tracked items drifts from its data — and the drift is always in the flattering direction.

## Packages

All 28 workspace packages, not only the published host packages.

### Host and runtime packages

| Package | Version | Role |
| --- | --- | --- |
| `@try-works/dsh-tool-mode` | 0.5.92 | DSH plugin: catalog, dispatch, discovery, MCP |
| `@try-works/tool-mode-contracts` | 0.1.1 | Model-free contract identities, schemas, validation |
| `@try-works/tool-mode-extension-sdk` | 0.1.5 | Extension authoring API and manifest validation |
| `@try-works/tool-mode-recipes` | 0.1.0 | Recipe format and provider-neutral LLM broker |
| `@try-works/tool-mode-runtime-core` | 0.1.0 | Runtime contracts, errors, readiness, ports |
| `@try-works/tool-mode-runtime-dsh` | 0.1.0 | Effect runtime → SDK ModelProviderV1 bridge |
| `@try-works/tool-mode-runtime-litert` | 0.1.0 | LiteRT.js engine and fetch-interception shim |
| `@try-works/tool-mode-runtime-onnx` | 0.1.0 | ONNX Runtime engine and waveform processors |
| `@try-works/tool-mode-runtime-processors` | 0.1.0 | Deterministic text/window/span/PII processors |
| `@try-works/tool-mode-runtime-recipes` | 0.1.0 | Declarative recipe validation and provider resolution |

### Extension packages

| Package | Version | Kind | Tools | Models |
| --- | --- | --- | --- | --- |
| `@try-works/extension-clear-recipe` | 0.1.1 | declarative | `enhance_speech` | clear |
| `@try-works/extension-declarative-recipes` | 0.1.0 | declarative | — | — |
| `@try-works/extension-desert-ant-tongue` | 0.1.3 | module | `lang_detect` | tongue |
| `@try-works/extension-desert-ant-voz` | 0.1.5 | module | `stt_transcribe` | voz |
| `@try-works/extension-ear-recipe` | 0.1.1 | declarative | `identify_language` | ear |
| `@try-works/extension-embeddinggemma` | 0.1.2 | module | `multimodal_embed`, `semantic_similarity`, `semantic_rank`, `semantic_classify`, `semantic_deduplicate`, `dedupe_and_rank`, `media_find_moments` | embeddinggemma-2 |
| `@try-works/extension-emo-recipe` | 0.1.1 | declarative | `suggest_emojis` | emo |
| `@try-works/extension-laya` | 1.0.4 | module | `decision_choose_local`, `decision_choose`, `decision_test`, `decision_score`, `decision_test_typed`, `decision_score_typed` | laya |
| `@try-works/extension-minilm-embed` | 1.0.0 | module | `text_embed` (implementation) | minilm-l6 |
| `@try-works/extension-minilm-rerank` | 1.0.0 | module | `text_rerank` (implementation) | minilm-rerank |
| `@try-works/extension-mirage` | 0.1.2 | module | `mirage_describe`, `mirage_detect`, `mirage_ocr`, `mirage_extract` | mirage |
| `@try-works/extension-moderator-recipe` | 0.1.1 | declarative | `classify_nsfw` | moderator |
| `@try-works/extension-needle` | 0.1.3 | module | `tools_plan`, `structured_extract`, `validate_record`, `extract_with_repair` | needle3 |
| `@try-works/extension-redact` | 0.1.1 | module | `redact_text` | redact |
| `@try-works/extension-shapes-recipe` | 0.1.1 | declarative | `shape_recognize` | shapes |
| `@try-works/extension-uhm-recipe` | 0.1.1 | declarative | `detect_fillers` | uhm |

### Harness recipe packages

| Package | Version | Tools | Role |
| --- | --- | --- | --- |
| `@try-works/harness-vision` | 0.1.0 | `describe_image` | Harness Vision |
| `@try-works/tool-mode-harness-text` | 0.1.0 | `text_title` | Harness Text Tools |

## Quick start

```bash
npm install @try-works/dsh-tool-mode
```

Enable the plugin in your DSH configuration, then:

```
tool_mode_list         # list every catalogued model and why an unavailable one cannot run
tool_mode_describe { "tools": ["lang_detect"] }
```

## Remote Jev (optional)

Jev is a **remote** TypeSafe System One API, not a local checkpoint. Enable the optional
typed-question tool and supply the key one of three ways:

```yaml
- id: model-tools
  config:
    jev:
      enabled: true
      model: jev-1.14
      # apiKey: ...                 # direct (operator config)
      # credentialRef: jev/api-key  # DSH credentials service (default ref)
      # apiKeyEnv: TYPESAFE_API_KEY # environment fallback
```

The registered tool is `decision_choose_jev` on the standard `decision.choose` result.
The request is Jev's native `systemOne` choice shape; the response conversion is versioned
and refuses unknown ids, missing/extra options, unnormalized probabilities and non-finite
confidence. No silent remote failover and no local-Jev-weights claim.

## The one architectural rule

**The host contains no model-specific code, and there is no private built-in adapter
path.** Every model lives in an independently versioned extension package that depends
only on the published extension SDK.

This is enforced rather than intended: `npm run verify:architecture` fails the build on a
model name, a model branch or a model import in host source, and on any extension that
imports the host or DSH directly. The published artifact is checked the same way — the
installed `lib/` is read to confirm the model-specific adapters are absent from it.

The rule exists because the alternative is a plugin that knows about whichever model was
written first, and that quietly stops working for every model added afterwards.

## Verifying it yourself

```bash
npm run verify           # typecheck, build, tests, architecture, MCP conformance, inventory
npm run release:gate     # exits nonzero while any mandatory gate is not done
```

**`release:gate` is deliberately red**, and it is kept separate from `verify` on purpose.
Collapsing them would make one of them lie: the suite passing means *the code that exists*
is correct, and the release gate failing means *the specifications* are not finished. Both
are true at once, and a single command would have to misreport one of them.

Other checks:

| Command | What it proves |
| --- | --- |
| `npm test` | The full test suite across the monorepo |
| `npm run verify:architecture` | The host holds no model-specific code |
| `npm run verify:built` | **A real inference through the built artifact** — `lang_detect` on German text must return `de` |
| `npm run verify:mcp` | 39 checks validating SAVED FIXTURES against the pinned `2026-07-28` schema — not live server conformance |
| `npm run verify:verification` | The evidence never reports a pass for a partial requirement |
| `npm run traceability` | Regenerates the requirement-by-requirement traceability table |

## Catalog models

All 18 catalog entries. “Verified” means a real inference was verified on Windows x64; the other rows name the concrete block.

| Model | id | Capability | Tool | Input | Contract | Windows |
| --- | --- | --- | --- | --- | --- | --- |
| Align | align | audio.word-alignment | `align_transcript` | audio | — | no win32 build |
| Clear | clear | audio.speech-enhancement | `enhance_speech` | audio | — | verified |
| Clips | clips | video.clip-selection | `select_clips` | video | — | no win32 build |
| Ear | ear | audio.spoken-language-identification | `identify_language` | audio | — | verified |
| Emo | emo | text.emoji-suggestion | `suggest_emojis` | text | — | verified |
| Eye | eye | image.frame-scoring | `score_frames` | image | — | closed beta |
| Face | face | image.face-matching | `match_faces` | image | — | closed beta |
| Gist | gist | text.topic-tagging | `tag_topics` | text | — | no win32 build |
| Moderator | moderator | image.nsfw-detection | `classify_nsfw` | image | — | verified |
| Redact | redact | text.pii-redaction | `redact_text` | text | — | verified |
| Schemer | schemer | text.structured-extraction | `extract_fields` | text | — | closed beta |
| Shapes | shapes | stroke.shape-recognition | `shape_recognize` | stroke | — | verified |
| Title | title | text.title-generation | `suggest_title` | text | — | Apple only |
| Tongue | tongue | text.language-identification | `lang_detect` | text | text.language_detect | verified |
| Toxic | toxic | text.toxicity-detection | `moderate_text` | text | — | closed beta |
| Uhm | uhm | audio.filler-detection | `detect_fillers` | audio | — | verified |
| Voz | voz | audio.speech-recognition | `transcribe_audio` | audio | stt.transcribe | verified |
| Who | who | audio.speaker-labeling | `detect_speakers` | audio | — | closed beta |

### Runtime-layer tools

`redact_text` and `shape_recognize` are the two first-party tools the runtime layer adds beyond the
catalog's extension-backed entries. Redaction reports coverage honestly when the window cap truncates a
document; stroke recognition is a declarative, code-free package (manifest + recipe, no extension entry).

Model and tool registration changes apply on the next host load; install, prepare, enable and disable do not mutate the pinned list mid-session.

## What is unfinished, and what is actually blocked

Most of what is unstarted is **implementation with a known route**, not a missing artifact:
the extension-host worker bridge (`EXT-20`), DSH PTC composition (`CODE-01..03`), the
provider-neutral LLM broker and recipe interpreter (`HLM`, `RCP`), and multimodal
EmbeddingGemma 2 inference (`MOD-01..`). DSH publishes its PTC runtime sources, `MODEL-04`
permits a managed native Windows executable, and the Laya TypeScript source and checkpoint
are obtainable even though the npm name is not.

**Genuinely external, stated narrowly:**

- **npm `laya-ts` returns 404** — the npm *route* is unavailable. This does not establish
  that the TypeScript implementation or the checkpoint is unavailable, and the
  maintainer-side source build `DEC-02` describes has not been attempted.
- **The Laya multilingual checkpoint ships uncalibrated** — packaging it does not make it a
  reliable default. That is a qualification result to report, not a blocker to work around.
- **Target-platform qualification** — Windows clean-install and multi-client
  interoperability have not been run on an authorized machine.

## MCP compatibility

This targets MCP revision **`2026-07-28`**. The published `@modelcontextprotocol/sdk` does
*not* support that revision — it caps at `2025-11-25` — so the wire layer is a
schema-conformant adaptation checked against the pinned upstream schema rather than an SDK
wrapper. The pinned schema, its commit and its SHA-256 hashes are recorded in
`docs/tool-mode/specs/`.

**Scope of that check, stated precisely:** the 39 probe checks validate **saved
request/response fixtures** against the pinned schema. The probe reads frozen files from
disk and never starts the server — its own documentation says so. It is a useful
schema-fixture test and it is **not** live server conformance. Live conformance against a
running server is not yet demonstrated.

## Licensing

The Desert Ant Labs models are covered by the **Desert Ant Labs Source-Available License
1.0** — source-available, *not* open source. Redistribution is not permitted; attribution
is required; a commercial licence applies above the per-platform, per-model
active-device threshold.

Both shipped extensions declare all five licence layers, and a package that declares
nothing is treated as telemetry-bearing rather than network-free — silence about telemetry
is not an absence of telemetry.

## Repository layout

```
packages/dsh-tool-mode/       the plugin: catalogue, contracts, dispatch, MCP surface
packages/tool-mode-contracts/     model-free contract definitions
packages/tool-mode-extension-sdk/ the public extension API
packages/extension-*/             independently versioned model packages
docs/tool-mode/specs/             the specification, and the pinned MCP schema
verification/                     generated evidence, and FINAL-REPORT.md
```

## Agent-authored workflows and tools

`tool_mode_workflows` saves, versions and re-runs a Code Mode program by name
(`save`, `clone`, `list`, `get`, `delete`, `run`). A saved workflow is also registered as a
callable `workflow_<name>` tool, with the `inputSchema` supplied at save time, so another
workflow can compose it through its normal `tools` binding. A recursion guard refuses a
workflow that calls itself directly or indirectly. `clone` copies a workflow to a new name
with optional `program`, `tools` or `inputSchema` overrides, leaving the source untouched;
the clone is immediately editable with `save`.

`tool_mode_tools` defines persistent tools in
the reserved `agent_*` namespace: it validates an input JSON Schema, persists the program
and registers the tool immediately; deleting withdraws it, and stored tools are
re-registered on the next host load. `clone` copies an `agent_*` tool to a new name with
optional overrides; the source is unchanged and the clone is a normal editable tool.

### Scoping authored artifacts

Scoping is **enabled by default**; new artifacts are `session`-scoped and existing global
rows remain resolvable. Set `artifactScopes.enabled: false` for the pre-scoping global
namespace. Each artifact lives at one of three scopes: `session` (root session; subagents
inherit), `workspace` (git root, else cwd), or `global`. Resolution is
`session > workspace > global`; `list` reports the winning `scope` plus the lower row it
hides as `shadowing`, and `tool_mode_describe` reports both (accepting either the
artifact name or `workflow_<name>`). Code Mode nested calls inherit the caller's session.
A caller with no session identity is downgraded to global, and every authoring write
response carries `requestedScope` and `scopeReason: "no-session-id"` when the effective
scope differs from the one asked for. An explicit `scope: session` without a session is
refused. Scope is data, never part of the artifact name: `workflow_x` and `agent_x`
stay callable after promotion.

`scope` is accepted on `save`/`define`/`clone` (and `from-run`); `promote` and `demote`
move an artifact. Promotion copies under the same name with `version` 1 and a
`promotedFrom` record, requires evidence (`uses >= artifactScopes.promoteMinUses`,
`failures == 0`) unless `force: true` promotes to workspace, and **never** auto-promotes.
A promotion to `global` also requires the operator to export
`DSH_ARTIFACT_GLOBAL_APPROVAL=1` in the host environment; a model-supplied boolean cannot
substitute for that. At root-session end session artifacts are removed and an `expire`
receipt is recorded; `authoring.pending` exposes their use counts beforehand. A crash can
lose session artifacts without an expire receipt, by design.

`tool_mode_list { scope: "session" | "workspace" | "global" | "all" }` filters authored rows.
Authoring rows carry `scope`, `uses` and `sessions`; invocation receipts for authored
artifacts carry `artifactScope`, `artifactName` and `artifactDigest`, which is what promotion
evidence reads. Existing v1 artifacts migrate to `global` on first read with no data move.
Authored code runs only through the same confined program runner as `tool_mode_run`:
`tools` is a binding subset, never a grant, and execution is refused until the operator
opens hosted code execution (CODE-09 confinement evidence + CODE-10 `hostedCode: true`).
Saving and defining are allowed while the gate is closed; running is not. State lives in
one JSON document under the plugin state directory (`agentAuthoringFile` overrides it);
`allowAgentAuthoring: false` disables the whole surface.

The program binding surface is fixed when a run starts. A tool defined with
`tool_mode_tools` is registered immediately and appears in discovery, but a program cannot
bind a name it defines in that same run: define the tool first, then compose it in a later
program (or call it directly). Inside a program both `tools.<name>` and the bare
`<name>` form are available; stored workflows written with the bare form keep working.

Discovery now publishes an `authoring` block: the stored tools/workflows, the most recent
authoring events (from `authoring-receipts.json`, value-free), a per-session adoption summary
(`offered`, `called`, `authored`, `reused`; `stepsSaved` is null because no counterfactual
exists), and a read-only
`repeatedShapes` report. A shape is a sequence of contracts plus each step's argument
keys and the argument paths a previous result reached; it never contains argument values
or program source, and it is only a suggestion — defining a workflow remains the caller's
decision.

The `model_tools action="receipts"` result also exposes an `authoring` array of the
value-free `define` / `save` / `clone` / `promote` / `demote` / `delete` / `run` / `expire`
events, with `scope`, `targetScope`, `promotedFrom`, `evidence`, `uses` and `sessions` where
they apply, so an authored change is auditable alongside invocation and lifecycle provenance.

Successful `tool_mode_run` programs are captured by default in `run-captures.json`, with a
shape-only input schema and never the input values; set `captureRunPrograms: false` to opt
out. The notice is published as `authoring.runCapture` in discovery. With a capture present,
`tool_mode_tools` action `from-run` creates an editable `agent_*` scaffold from that run.
`name` and `inputSchema` are optional: the host suggests `agent_from_<run>` and returns the
observed schema with `typed: false` and `schemaInferred: true`. That schema is honest about
being observed - optionality, enums and defaults are not invented; supply an explicit
`inputSchema` when those matter.

## Code Mode gate

**Release checklist:** before publishing, run
`npm run release:evidence` in `packages/dsh-tool-mode` (it records
`verification/ptc-confinement-evidence.json` against the current package version and
validates it). `prepublishOnly` runs the build and `check:confinement`, so
`npm publish` FAILS when the shipped artifact is missing, stale, failed or recorded for
another version; `verify:static` and `verify:release` run the same check. A version bump
therefore cannot ship stale confinement evidence.

`tool_mode_run` requires a passing confinement-evidence artifact **and** `hostedCode: true`.
The artifact is validated for the running package version; the plugin falls back to the
artifact shipped in the package (`verification/ptc-confinement-evidence.json`), so a
version upgrade no longer silently closes Code Mode. Re-record after changing
confinement-sensitive code with
`node packages/dsh-tool-mode/scripts/record-confinement-evidence.mjs`; `npm run
check:confinement` fails when the shipped artifact is stale.

### Windows: the sandbox temp root

DSH's `windows-acl` sandbox creates a private temp directory with `os.tmpdir()` and
writes a DACL on it. If the inherited `TEMP`/`TMP` is on a volume that refuses
`SetNamedSecurityInfoW` (Win32 5), Code Mode fails with
`AclSandbox init failed`. On Windows the plugin therefore points `TEMP`/`TMP` at
`~/.dsh/tool-mode-sandbox/tmp` for its lifetime (creating it owner-only) and restores the
previous values when the host unloads. Resolution:

| `sandboxTempRoot` | Behavior |
| --- | --- |
| unset | Windows: `~/.dsh/tool-mode-sandbox/tmp`; other platforms: leave the platform temp alone |
| absolute path | point `TEMP`/`TMP` at that path |
| `""` (explicit empty) | disable the override; use the platform temp |

The override is process-wide for the plugin's lifetime; Code Mode's sandbox reads
`os.tmpdir()` when it starts a program, so it takes effect without extra configuration.

### Value-flow evidence: which output reached which argument (not full provenance)

A composed run reports `meta.calls` (the bounded trace: `callId`, tool name, timing,
argument/result previews) and `meta.dataFlow` (observed edges). Each edge names the
producing `callId`, the consuming `callId`, the argument path (`query`,
`documents[0].text`, or `$` for the whole argument object) and the evidence:

- `same-reference` — the argument contains the same object identity a previous call
  returned. This can only be observed inside one process; values normally cross the PTC
  sandbox boundary by serialization, so live edges are almost always `same-value`.
- `same-value` — the argument contains a value whose canonical JSON is exactly equal to a
  previous call's result (including a field of it). Ambiguous matches (two earlier calls
  with the same value) produce no edge rather than a guess. A whole object is one edge,
  not one per field.

This is **equality evidence, not taint tracking**: a transformed value
(`text.toUpperCase()`, arithmetic, re-encoding) or a value chosen by control flow has no
edge. To keep that from looking like a simple graph, every run carries
`meta.dataFlowCoverage`: `method: "value-equality"`, `complete: false`, the number of
consumers, how many matched, and the `unresolved` call ids. Receipts expose the same
`dataFlowCoverage` on the composition receipt; nested receipts carry `callId` so they join
the edges. Full provenance would require instrumenting the program runtime, not widening
this equality check.

In `model_tools action: "receipts"`, the composition receipt carries `dataFlow` and
`dataFlowCoverage` plus the existing `runId`/`parentReceiptId` links. The evidence is
bounded by trace depth/size, never a copy of the program's data.

## Path roots and portability

Path-bearing model tools (`identify_language`, `stt_transcribe`, `classify_nsfw`,
`multimodal_embed` image/audio parts) admit only paths under an approved root. Roots
are configured as **relative to the DSH home**:

```yaml
approvedRoots:
  - files
```

That means `<DSH_HOME>/files` (with `DSH_HOME` defaulting to `~/.dsh`) on every
machine. Absolute roots are still accepted for a deliberate volume, but they do not
port across machines; a relative root that escapes the DSH home is dropped rather
than widening the grant.
## Model cards and custom tools

`model_tools action="describe"` returns a **capability card** for a model, not just a name:

- the input modality and the catalog's output shape;
- every callable operation (`operations[]`), each with its own tool name, contract,
  parameters and JSON input schema; a model with no explicit operations has one primary
  operation;
- every accepted parameter with its JSON type;
- what the tool returns, a `whenToUse` trigger, `limits`, and an `example`; when the catalog
  omits the latter three, the card derives them from the skill trigger, the measured
  on-device size/modality, and the generated argument schema rather than leaving them blank;
- runtime facts (platform support, verified-on-Windows, size, required runtime);
- the contract it implements and the tool a caller actually invokes.

The card is served even when the model is not installed, so an agent can plan a composition before
preparing it. `tool_mode_describe` serves the same card through the discovery surface for a
model-backed tool.

Every standard-contract result also carries `meta.modelIdentity` — the weights identity, not
only the implementation code path — so two transcribers or two rankers can be compared without
guessing which model produced a result.

Custom tools compose these primitives. A tool that OCRs a page and then extracts typed fields is
one `tool_mode_tools` definition whose program calls two model tools:

```js
const text = await tools.mirage_ocr({ image_path: input.image_path });
return await tools.extract_fields({ text: text.text, schema: input.schema });
```

Read the cards first and pass the exact tool names; do not invent operations a model does not
declare. For a model with several operations (for example Mirage), each operation is a separate
callable tool.

The `structured_extract` and `extract_with_repair` tools are a measured exception: their
working envelope is about **100 characters** of source text. A longer input is refused with a
typed `input-too-long` error before the engine starts; it no longer returns a silent
`extraction: null` that looks like an empty document.

## Where extensions and models live

Storage is under the DSH home (`DSH_HOME`, or `~/.dsh`). Relative config paths resolve
there; an absolute path is kept only when an operator deliberately chooses another
volume.

| Data | Default | Config |
| --- | --- | --- |
| State and receipts | `<DSH_HOME>/model-as-tool/state.json` | `stateFile` |
| Credentials | `<DSH_HOME>/model-as-tool/credentials.json` | `credentialsFile` |
| Extension packages | `<DSH_HOME>/profiles/<profile>/extensions` | `extensionStore` (relative resolves under DSH_HOME) |
| Prepared model assets | `<DSH_HOME>/model-as-tool/asset-cache` | `assetCacheRoot` (relative resolves under DSH_HOME) |
| Files path-taking tools may read | `<DSH_HOME>/files` | `approvedRoots: [files]` |

The current profile uses `extensionStore: profiles/web/extensions` and
`assetCacheRoot: model-as-tool/assets`, both relative. A previous absolute asset cache
such as `E:\dsh-asset-cache` is no longer used; remove it to reclaim the space. Model
assets are re-downloaded to the DSH-home cache when an extension is prepared.

## Decision decomposition

The pattern is domain-neutral: triage, approvals, routing, moderation, release gates,
extraction acceptance, prioritisation or any other branch. Laya and Jev answer
**atomic judgments**; code makes the decision. Use the shipped
`decision-decomposition` skill, `decision_test_typed` / `decision_choose` for one judgment,
and `decision_combine` to evaluate explicit facts + probability rules with a full trace.
When Jev is configured, `decision_judgments_jev` batches independent questions in one
native request. This avoids one giant choice question whose only explanation is a single
probability. `decision_route` and `decision_evaluate` add confidence-band escalation and
calibration metrics (accuracy, FPR/FNR, Brier, ECE, threshold sweep, hybrid cost). See
[TypeSafe's judgment article](https://typesafe.ai/blog/dont-call-it-a-decision-model) and
[Hightouch's calibration study](https://hightouch.com/blog/llm-judges-identity-resolution)
(the study is provenance for the calibration lesson, not the scope).
