# LOCAL-SURFACE — what the model-as-tool host already does

Audited 2026-10-20. HOST = `D:\DEV\dsh-tool-mode`; DSH = `D:\deepseek-harness`.
Every claim is cited to code or a test. Where manifest/README/verification prose disagrees with
code, §8 names it. No product source was modified.

Scope: one machine at one time. "Installed", "prepared-cold" and "runs here" are facts about
this profile on 2026-10-20, not repository facts; re-read `model_tools` on another host.

## 1. Catalog & models

Catalog: `packages/dsh-tool-mode/catalog/desert-ant-models.json` (19 entries, 693 lines).
Resolution: `packages/dsh-tool-mode/src/capability.ts:82-205` — extension → npm
(onnxruntime / native, win32 browser-only refusal at :155-159) → CLI (:178) → bridge (:187) →
unavailable (:196-204). `verifiedRunnableOnWindows` is a catalog field, not a probe.

| id | input modality | contract / tool | runnable on this Windows host? | why not |
|---|---|---|---|---|
| tongue | text | `text.language_detect` / `lang_detect` | catalog yes (`native-node`, catalog:497-538); **not installed here** | live store has only 3 extensions (§2); `model_tools installed` returns `{installed:0}` |
| voz | audio | `stt.transcribe` / `stt_transcribe` | catalog yes (`onnxruntime-node`, 349 MB, catalog:614-657); **not installed here** | same store evidence |
| eye | image | `image.frame-scoring` / `score_frames` | no | closed beta, no SDK, `windowsSupport:"no-sdk"` (catalog:185-225); capability.ts:51-53 |
| face | image | `image.face-matching` | no | closed beta / no-sdk (catalog:227-264) |
| moderator | image | `image.nsfw-detection` | no | browser-only prebuild → win32 refusal, capability.ts:155-159 (catalog:305-341) |
| clips | video | `video.clip-selection` | no | no npm package, verb only (catalog:75-109); CLI is macOS/Linux |
| schemer | text | `text.structured-extraction` | no | closed beta / no-sdk (catalog:386-420); the repo's `structured_extract` comes from needle instead |
| title | text | `text.title-generation` | no | Apple-only (catalog:458-495; capability.ts:54-56) |
| uhm | audio | filler detection | no | Apple-only (catalog:579-612) |
| align, clear, ear, emo, gist, redact, shapes, toxic, who | text/audio/stroke | none (`contract:null`) | no | browser-only prebuilds (catalog:14-15, 122-123) |

**Vision / OCR / image understanding.** No catalog model does OCR or captioning. `eye` is
frame scoring + labels + duplicate grouping (catalog:185-225) and closed beta, no SDK; `face`/
`moderator` closed beta / browser-only; `clips` is transcript-driven (catalog:95-108), no
pixels. The only vision that runs here is EmbeddingGemma's vision encoder (vectors, not words)
and `describe_image`, which is a frontier harness-model call (§2, §8b).

## 2. Contracts / tools — implemented vs spec-only

Host control tools: `model_tools` (src/index.ts:1872), `tool_mode_list` (:2758),
`tool_mode_describe` (:2793), `tool_mode_run` (:2925). Extension tools reach the registry
via `src/extension-registrar.ts:129-205` into `src/index.ts:3419` (manifest-schema path) and
`src/index.ts:3754-3883` (declarative-recipe path).

| tool | contract | implemented where | registered where | status |
|---|---|---|---|---|
| `describe_image` | `image.describe` | recipe `tool-mode-recipes/src/images.ts:68-95`; contract `tool-mode-contracts/src/contracts/standard.ts:58-95` | declarative `src/index.ts:3754-3883` | wired, frontier-only; self-contradictory input (§8b) |
| `text_title` | `text.title` | recipe `tool-mode-harness-text/recipes/text-title.json`; contract `standard.ts:16-55` | same | wired |
| `multimodal_embed` | own | `extension-embeddinggemma/src/index.ts:927-949` + `inference.ts:106-167` | manifest `tools[]` → `src/index.ts:3419` | wired, real ONNX (§8a) |
| `semantic_similarity/_rank/_classify/_deduplicate` | own | `index.ts:952-1046`; math `vectors.ts` | same | wired |
| `media_find_moments` | own | `index.ts:1048-1150` (audio **and** video) | same | wired; video real (§8a) |
| `text_rerank` | `text.rerank` | `extension-minilm-rerank/src/{index,pure,tokenizer}.ts` | standard-contract path, `extension-registrar.ts:79-83` | implemented; **not installed** in the audited profile (assets ARE prepared under `~/.dsh/model-as-tool/asset-cache`) |
| `text_embed` | `text.embed` | `extension-minilm-embed/src/*` | same | implemented; **not installed** in the audited profile |
| `decision_choose/_test/_score` | own | `extension-laya/src/{index,pure}.ts` | manifest `tools[]` | wired; Laya assets prepared in `E:\dsh-asset-cache\groups\...extension-laya` |
| `tools_plan`, `structured_extract` | `tools.plan`, `text.structured_extract` | `extension-needle/src/{engine,contracts,process-bridge}.ts` | `src/index.ts:3437-3478` | implemented; **not installed** in the audited profile; `tools_plan` reads a frozen host snapshot, not caller input |
| `lang_detect`, `stt_transcribe` | `text.language_detect`, `stt.transcribe` | `extension-desert-ant-tongue/src/index.ts`, `...-voz/src/index.ts` | manifest `tools[]` | implemented, **not installed here** |
| `model_tools`, `tool_mode_list/describe/run` | host tools | `src/index.ts` | direct `ctx.tools.register` | wired |

**Installed set, audited profile.** The live host (pid 26620, `apps/cli/src/bin.ts web`) has exactly
three extensions installed and active: `@try-works/extension-declarative-recipes` (0.1.0),
`@try-works/extension-laya` (1.0.1), `@try-works/extension-embeddinggemma` (0.1.1) —
`C:\Users\erikb\.dsh\profiles\web\extensions\{extensions.lock.json,profiles/default/state.json}`.
Both model extensions report readiness `prepared-cold`, with all their tools `enabled:true`
(state.json). The declarative-recipes package is what supplies BOTH `text_title` and
`describe_image` (`extension-declarative-recipes/tool-mode.extension.json:31-44`).
`model_tools installed` reports `{models:[], installed:0, runnable:0}`: no catalogue model
(tongue/voz) is installed, so no catalogue-backed tool is live.

**Zero-production-caller exports:** `createTextTitleTool` (`tool-mode-recipes/src/titles.ts:480`)
and `createDescribeImageTool` (`images.ts:173`) are re-exported (`tool-mode-recipes/src/index.ts:80-110`)
and exercised only by `tests/builtins.test.ts`. Production goes `prepareDeclarative` →
`HarnessBroker` (`src/harness-serving.ts:97-195`).

## 3. The declarative harness-model recipe primitive

Format `packages/tool-mode-recipes/src/recipe-format.ts`; executor `src/broker.ts`; DSH binding
`src/dsh-adapter.ts`.

**What a recipe is.** TRUSTED, DATA-ONLY: one static instruction string + typed input bindings
(`recipe-format.ts:1-38`). Exactly 9 top-level keys allowed (`:54-64`). Refused BY NAME: `tools`,
`tool_calls`, `messages`, `history`, `conversation`, `attachments`, `memory`, `skills`,
`systemPrompt`, `inheritConversation`, `includeTools` (`:74-90`), plus `__proto__` / `constructor` /
`prototype` (`:96`). Template *code* (`${...}` and `<%...%>`) is refused; only `{{name}}` placeholders
naming a declared input are bound (`:21-25`). Input kinds: `string|integer|number|boolean|image`
(`:143`); 13 permitted per-input keywords (`:124-137`).

| limit | value | source |
|---|---|---|
| max output tokens per leaf | 1024; a recipe may lower, never raise | `recipe-format.ts:48`, `broker.ts:250-262` |
| max image inputs per leaf | 2 | `recipe-format.ts:51` |
| wall-clock deadline | 60 s (caller passes `deadlineMs`) | `src/harness-budgets.ts:61`, `broker.ts:383-392` |
| provider attempts / auto repairs | 1 / 0 | `src/harness-budgets.ts:58-67` |
| inherited context | none: no history, system prompt, tools, memory, skills | `broker.ts:9-13`, `dsh-adapter.ts:262-269` |
| model-emitted tool call | never executed → `UNEXPECTED_MODEL_TOOL_CALL` | `broker.ts:169-170`, `dsh-adapter.ts:315-318` |
| remote destination | permitted per host policy; `LOCAL_ONLY_HOST_POLICY` forbids it | `broker.ts:220-237` |

**Multi-step pipeline today?** No. One recipe = one request = one completion; no loop, no
conditional, no second call; a returned tool call is an error. Composition exists only *outside*
the recipe, via Code Mode (spec §10): CODE-01/02/03 require every leaf to work through DSH
native + PTC, ship `tool_mode_run` for external clients, and bind the intersection of requested
and authorized names, rejecting rather than omitting
(`docs/tool-mode/specs/Tool_Mode_DSH_Implementation_Spec_v1.2.md:432-462`). CODE-07 states
harness-backed tools "remain ordinary leaf tools, **not nested agent loops**" and refuses
recursive `tool_mode_run` bindings (`:470`). CODE-10 makes hosted code separate consent (`:478`);
CODE-11 charges every nested model call to the root budget (`:507`). The spec's required demo is
`stt_transcribe → decision_choose → text_title` and demands the host "report the title's actual
location and billable model call" (`:482-505`) — that reporting does not exist (§6).

## 4. Code Mode (DSH `run_code` / PTC)

| question | answer | source |
|---|---|---|
| what it is | DSH tools plugin `mode:'ptc'` contributes **only** `run_code` plus a generated SDK prompt naming the other tools | `packages/core/tools/src/index.ts:678-688`; `packages/core/tools/tests/ptc.spec.ts:218` |
| program model | body of an **async TypeScript function** (Python flavour exists); `input` bound structurally, never interpolated | `src/index.ts:2931-2940`; spec `:440-446` |
| sandbox | separate Node subprocess from `@deepseek-ai/dsh-ptc-runtime-node` over `fs`/`subprocess`/`sandbox` policy, with a duplicate-mount guard | `src/ptc-runtime.ts:1-102`; `packages/ptc-runtime/ptc-runtime-node/src/{launch,process,persistent-process}.ts` |
| limits | 120 s default / 600 s ceiling; 64 MiB output; 512 MiB old-gen heap; 128 pending binding calls; per-call or persistent REPL | `packages/ptc-runtime/ptc-runtime-node/src/config.ts:31-44` |
| bindable tools | granted ∩ registered-visible, **reject-not-omit**, null-prototype map, `run_code` never bindable | `src/ptc-authority.ts:102-110`; `src/ptc-runtime.ts:142-160`; `src/index.ts:2898-2913` |
| authorization | grant read per run: external client's grant inside an external call, host grant otherwise | `src/index.ts:2862-2898` |
| loops / model calls | loops, conditionals, dependent calls supported; **N separate leaf model calls** allowed, each a full recipe invocation; no agent loop, no tool-use turn, no state reuse | spec `:470`, `:507`; `broker.ts` has no conversation field |

So Code Mode **is** composition of tool-mode tools, and it **can** drive model calls in a loop —
as N independent, budget-charged, isolated leaf calls. It cannot iterate a conversation.

## 5. Media path

| hop | shape | source |
|---|---|---|
| recipe input | typed media `{ mediaType, bytes: Uint8Array }` — never a path or URL | `recipe-format.ts:278-293` |
| tool boundary (DSH args are JSON) | `{ mediaType, bytes: number[] }` → `Uint8Array`, converted **only** here | `src/index.ts:3858-3876` |
| broker → DSH | one user message: text part + one `{type:'image', attachment}` per image | `dsh-adapter.ts:269-280` |
| attachment minting | `ctx.attachments.saveImage({data, mediaType})`; absent ⇒ provider reports images `unknown` ⇒ `EXECUTOR_CAPABILITY_UNKNOWN` (never a silent drop) | `src/harness-llm.ts:251-262`; DSH `packages/attachment/attachment/src/index.ts:98-103` |
| fitting / dimension guard in HOST | none: only media types png/jpeg/webp, `maxBytes 8388608`, `imageInputs.max 1` | `tool-mode-recipes/src/images.ts:79-93` |
| fitting in DSH | yes: attachment store normalizes and records `originalDimensions` when it reduces; projection resizes to a max-pixel budget | `packages/attachment/attachment/src/index.ts:152-156`; `src/request-projection.ts:19-42` |

**media_find_moments** — `extension-embeddinggemma/src/index.ts:1048-1150`. Validation accepts
`media.kind ∈ {audio, video}` and rejects `sampling` on audio (`:477-505`). AUDIO: bounded WAV
decode → mel → audio encoder → window cosine, final window clipped and included once
(`:1100-1150`). VIDEO: **real** — AVI parse, per-window 1 fps sampling, video grid, vision
encoder, fused `video_features` (`:1059-1098`). Audio window limit **11.2 s**
(`media.ts:73-74`, enforced `index.ts:497-499`); video 32 samples at 1 fps (`media.ts:81-93`).
Refused by name: non-RIFF/AVI (`media.ts:168`), compressed (`:224`), non-BGR24 (`:244`), frame cap
(`:234`), dimension cap (`:230`). **No OCR and no frame captioning**: frame sampling only feeds
embeddings. DSH's `read_image` (`packages/fs/tool-fs/src/read-image.ts:211`) is the model-facing
image path, gated on the calling route declaring `image` input (`:120+`) — a frontier-model read,
unrelated to the local encoders.

## 6. Cost / usage / latency

| where | what it records | source |
|---|---|---|
| `LlmUsage` | `{known:true,in,out}` or `{known:false,reason}` — an unreported call is **never 0** | `tool-mode-recipes/src/broker.ts:105-113` |
| provider → broker | `usage` carried on `LlmCompletion` and on `BrokerOutcome.completed` | `broker.ts:118`, `:330-343`; `dsh-adapter.ts:301-303` |
| broker → tool result | **DROPPED**: `invoke` returns `outcome.text` only; usage, provider identity and recipe identity are discarded | `src/harness-serving.ts:167-190` |
| declarative tool result | declared `type:'string'`, executed as a string — no envelope, no `meta` | `src/index.ts:3849-3851`, `:3881` |
| journal | recipe id/version, provider id + **generation**, destination, `maxOutputTokens`, image count, exact prompt — **no usage, no latency** | `broker.ts:264-296`; sinks `src/index.ts:3157`, `:3783` (debug log) |
| receipts | identity only (contract, implementation, extension, `modelIdentity`, generation, location); **no tokens, no duration** | `src/receipt.ts:32-71` |
| external MCP accounting | the ONLY timings + sizes + failure class; wired for external calls, surfaced as `model_tools receipts.external` | `src/invocation-accounting.ts:48-118`; wired `src/index.ts:1515-1516`; surfaced `:2489-2500` |
| monetary cost | a 3-state type exists and prints unknown as unknown; **nothing computes a price** | `src/harness-budgets.ts:20-30`, `:139-150` |
| `tool_mode_run` receipt | records success with `modelIdentity:'none'` regardless of nested model calls | `src/index.ts:2982-2994` |

**"Unreported usage is unknown, never zero"** is enforced at the TYPE level only
(`broker.ts:105-113`, rationale restated at `src/harness-budgets.ts:20-30`). Nothing downstream
carries that unknown either, so a caller cannot distinguish "unknown" from "not reported".

**Caching / memoization.** None for results: no memo/cacheKey in `tool-mode-recipes/src` or
`packages/dsh-tool-mode/src`. What exists is (i) in-process model-session reuse
(`extension-embeddinggemma/src/index.ts:807-855`), (ii) host-prepared asset bytes under
`C:\Users\erikb\.dsh\model-as-tool\asset-cache\groups\` (embeddinggemma-2, minilm-l6,
minilm-rerank, needle3) and `E:\dsh-asset-cache\groups\` (embeddinggemma-2, laya) — i.e. four
model deployments are prepared on this machine, (iii) DSH content-addressed attachment dedupe
(`packages/attachment/attachment/src/types.ts:36`). No embedding, moment or description result
is ever served from a cache.

## 7. Gaps vs a Pi-vision-shaped capability (cheap local perception + frontier orchestration)

| needed capability | exists? | where | missing piece |
|---|---|---|---|
| local image→vector perception | **yes** | `extension-embeddinggemma/src/inference.ts:270`; artifacts in cache | — |
| local image→**words** (caption / OCR / UI parse) | **no** | only `describe_image` = frontier call (`tool-mode-recipes/src/images.ts`) | any local captioner/VLM; no catalog model provides it |
| local frame scoring / shot picking | no | `eye` closed beta, no SDK (catalog:185-225) | an SDK or ONNX port |
| video→temporal embedding | **yes** | `index.ts:1059-1098`; `media.ts:141-268` | AVI-DIB only; no mp4/H.264, no stream frames |
| OCR / text-in-image binding | **no** | describe_image prompt explicitly refuses OCR claims (`images.ts:52-54`) | an OCR path; nothing calls one |
| "describe locally, escalate only if unsure" | **no** | recipes cannot compute; output is `{description}` only | a router (local score → threshold → frontier); no control flow inside a recipe |
| multi-step perception pipeline | partial | Code Mode can chain leaf calls (spec `:470`) | no declarative pipeline; each step hand-written by a model |
| per-call usage/cost surfaced to the caller | **no** | dropped at `src/harness-serving.ts:167-190` | return `usage` and provider identity in the tool result |
| image transport without inlining bytes | **no** (host path) | `src/index.ts:3858-3876` requires JSON bytes | path/attachment-ref input: nothing resolves a path into typed media |
| host-side image fitting guard | partial | host: 8 MiB + 3 media types only; DSH: attachment normalization | a pixel guard before the broker |
| result cache for repeated perception | **no** | §6 | a cache keyed on (space, media digest, dimensions) |
| machine-readable capability descriptor | yes | `tool_mode_describe`, `model_tools list` | — |
| root-budget accounting across a pipeline | partial | per leaf: `harness-budgets.ts`, `broker.ts:250-262` | CODE-11 root budget across nested calls |

## 8. Where manifest / README / verification prose contradicts code

**(a) EmbeddingGemma "wires no ONNX session" is FALSE in the current workspace.**
The manifest description (`packages/extension-embeddinggemma/tool-mode.extension.json:6`) and the
module header (`src/index.ts:10-20`, "It creates NO ONNX session… the inference path is the next
slice") are stale. The code creates real ORT sessions: `createTextEmbedder` over
`onnx/model.onnx` with `onnxruntime-node` + `AutoTokenizer` (`src/inference.ts:106-167`), plus
`createVisionEncoder` (`:270`), `createAudioEncoder` (`:315`), `createVideoEncoder` (`:487`);
`load()` wires them from host-verified asset groups (`src/index.ts:891-925`) and `inspect()`
reports `needs-preparation` **only** when a runtime package fails to resolve (`:872-880`).
Proof: `tests/embedding-real.test.ts:83-121` loads ONLY the text-backbone group and asserts
768-dim unit-norm output plus every reduced width; it skips **with a reason** when artifacts are
absent (`:41-47`). The pinned artifacts are present on this host
(`C:\Users\erikb\.cache\embeddinggemma-2\onnx-community\daa72c5…\onnx\{model,vision_encoder,audio_encoder}.onnx`),
so that suite runs rather than skips here.
**Video too:** `media_find_moments` has a real video branch (`index.ts:1059-1098`), while its own
tool description still says "VIDEO media is refused by name in this build"
(`contracts.ts:119-120`, mirrored into the manifest `:94`). Video is refused only for unsupported
containers/frame formats (`media.ts:168,224,244`).
**Verification artifacts are stale, not authoritative:** `verification/results/release.json:3533-3538`
(AT-50 `NOT_RUN`, "media_find_moments is not implemented") and
`docs/tool-mode/TRACEABILITY.md:430` repeat round-59 adjudications that predate the media slice;
`release.json:3522` / `TRACEABILITY.md:429` likewise say "the tool is not registered". Code and
tests beat them. Precision on WHAT is stale: the manifest's per-tool `description` strings
(manifest:49,58,67,76,85,94) were updated with the media work, while the package-level
`description` (manifest:6) and the module header (src/index.ts:10-20) were not — and
`contracts.ts:119-120` repeats the old video claim as the tool text it feeds the manifest from.

**(b) `describe_image`'s input is self-contradictory, and its usage never reaches the caller.**
The contract `image.describe` requires `image_path`
(`tool-mode-contracts/src/contracts/standard.ts:64-72`; same in
`packages/harness-vision/schemas/describe-image.input.json:7-10`), but the shipped recipe declares
a typed `image` binding (`tool-mode-recipes/src/images.ts:75-82`). The host's declarative
registration advertises the **recipe's** inputs (`src/index.ts:3800-3844`), so in the live host
`describe_image` takes `{ image: {mediaType, bytes:[…]}, focus? }` and no `image_path` at all —
and recipe bindings are CLOSED, so `image_path` yields `RECIPE_BINDING_ERROR`
(`recipe-format.ts:1352-1361`). Nothing in the host resolves a path into typed media
(`image_path` appears nowhere in `packages/dsh-tool-mode/src`). Live confirmation: the
`describe_image` offered to this auditing session advertises exactly `image` (JSON typed media)
and `focus`, not `image_path`: the recipe-derived surface is what callers reach, so the
contract and the recipe disagree. Default model: explicit config > `config.harnessModel` > the
deployment's AUTO-discovered agent-default model (`src/index.ts:1042-1080`,
`src/harness-llm.ts:55-91`) with `destination:'remote'` (`dsh-adapter.ts:178-179`) — i.e. the
user's frontier model, not a local one. Concretely, the audited profile's `model-tools` row sets
neither `harnessModel` nor `harnessProvider` (`C:\Users\erikb\.dsh\profiles\web\cordis.patch.yml`,
`id: model-tools`), so the AUTO path serves `describe_image`/`text_title`, and
`agent-default-model` is `deepseek-official / deepseek-flash` (same file): every `describe_image`
call in this deployment is a remote frontier call. Usage: `outcome.text` only (`harness-serving.ts:169`),
tool output schema `type:'string'` (`index.ts:3849-3851`); no receipt is written for declarative
tools (no `stampResultMeta` on that path — compare `index.ts:3289-3324`).

## 9. What this host can already do without a frontier model

- Transcribe audio locally with word timestamps (`stt_transcribe` / voz ONNX) — when the voz extension is installed.
- Detect the language of short text locally (`lang_detect` / tongue, 84 languages).
- Embed text, code, **image** and **audio** into one 768/512/256/128 space with real ONNX
  (EmbeddingGemma), with per-group loading (a text-only call loads no media weights).
- Compare / rank / classify / dedupe by cosine, with explicit score kinds, abstention and ID preservation.
- Find the best-matching **audio window** (≤11.2 s) and **video window** (1 fps, ≤32 frames) in a
  file, returning source timestamps — no transcription involved.
- Deterministic decisions with abstention (Laya `decision_choose/_test/_score`) — installed here,
  assets prepared (`readiness: prepared-cold`).
- Cross-encode rerank (`text_rerank`), structured extraction and tool planning (needle) — all
  implemented and their assets prepared under `~/.dsh/model-as-tool/asset-cache`, but **not
  installed** in the audited profile.
- Compose all of the above in a sandboxed TS program (`run_code` / `tool_mode_run`) with
  authorization, deadlines, output caps and receipts.
- Report capability honestly: `model_tools list/describe` gives runnable / route / reason per model.

## 10. What genuinely requires a frontier model today

- Turning pixels into **words**: captioning, OCR, UI/document parsing, "what is wrong with this screenshot".
- Judgement and synthesis over perception output (planning a fix, deciding what matters).
- Anything needing **conversation, tools or memory inside a model call** — recipes forbid all three.
- Multi-step reasoning: a recipe is one isolated request; Code Mode composes *tools*, not reasoning.
- Confidence-calibrated "local first, escalate if unsure": no local model emits a calibrated
  confidence and no router exists.
