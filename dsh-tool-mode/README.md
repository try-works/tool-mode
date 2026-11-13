# dsh-tool-mode

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

| Package | Version | What it is |
| --- | --- | --- |
| [`@try-works/dsh-tool-mode`](https://www.npmjs.com/package/@try-works/dsh-tool-mode) | 0.5.44 | The DSH plugin: catalogue, contracts, dispatch and the MCP surface |
| [`@try-works/tool-mode-contracts`](https://www.npmjs.com/package/@try-works/tool-mode-contracts) | 0.1.0 | Model-free contract definitions |
| [`@try-works/tool-mode-extension-sdk`](https://www.npmjs.com/package/@try-works/tool-mode-extension-sdk) | 0.1.4 | The public API an extension is built against |
| [`@try-works/extension-desert-ant-tongue`](https://www.npmjs.com/package/@try-works/extension-desert-ant-tongue) | 0.1.3 | Language detection, pure JavaScript, runs on Windows x64 |
| [`@try-works/extension-desert-ant-voz`](https://www.npmjs.com/package/@try-works/extension-desert-ant-voz) | 0.1.5 | Speech-to-text through ONNX Runtime, runs on Windows x64 |

## Quick start

```bash
npm install @try-works/dsh-tool-mode
```

Enable the plugin in your DSH configuration, then:

```
model_tools            # list every catalogued model and why an unavailable one cannot run
model_tools { "action": "describe", "model": "tongue" }
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
| `npm test` | 1452 tests across nine packages |
| `npm run verify:architecture` | The host holds no model-specific code |
| `npm run verify:built` | **A real inference through the built artifact** — `lang_detect` on German text must return `de` |
| `npm run verify:mcp` | 39 checks validating SAVED FIXTURES against the pinned `2026-07-28` schema — not live server conformance |
| `npm run verify:verification` | The evidence never reports a pass for a partial requirement |
| `npm run traceability` | Regenerates the requirement-by-requirement traceability table |

## What runs on this host

Two of the eighteen catalogued models run here, and the other sixteen do not:

- **Tongue** — pure JavaScript, weights bundled (2 MB), no runtime or accelerator needed.
- **Voz** — `onnxruntime-node` on CPU.

The other sixteen are unavailable for concrete reasons: most LiteRT/TFLite models have no
`win32-x64` native build, `title` is Apple-only (Core ML / MLX, no JS SDK), and six are
closed beta with no shipping SDK.

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
