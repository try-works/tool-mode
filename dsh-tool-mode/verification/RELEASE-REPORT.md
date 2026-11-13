# Tool Mode release report

Generated 2026-11-13T07:52:30.182Z from commit `db5801c46700d9c9d3f766ede3ca4be01afbefcf`.

## How to reproduce

From a clean checkout of the commit above: `npm install && npm run verify`.
No credentials or model assets are required for the suites reported here;
requirements needing either are recorded as BLOCKED or NOT_RUN rather than PASS.

## Installed package identities

| Package | Version |
|---|---|
| `@try-works/dsh-tool-mode` | 0.5.44 |
| `@try-works/tool-mode-contracts` | 0.1.1 |
| `@try-works/tool-mode-extension-sdk` | 0.1.5 |
| `@try-works/extension-desert-ant-tongue` | 0.1.3 |
| `@try-works/extension-desert-ant-voz` | 0.1.5 |
| `@try-works/extension-embeddinggemma` | 0.1.2 |
| `@try-works/extension-needle` | 0.1.3 |
| `@try-works/tool-mode-recipes` | 0.1.0 |
| `@try-works/tool-mode-harness-text` | 0.1.0 |

## Requirement status

| Status | Count |
|---|---|
| PASS | 309 |
| FAIL | 0 |
| BLOCKED | 8 |
| NOT_RUN | 0 |
| NOT_APPLICABLE | 0 |

Total: 317 requirements, of which 309 PASS.

## MCP conformance matrix

| Fact | Value |
|---|---|
| Revision implemented | 2026-07-28 |
| Pinned schema commit | 5f5440bb26a62e2cf3440b92da5a667efa03b267 |
| Official SDK supports the revision | YES (v2 line) |
| Basis | Schema-conformant adaptation, verified by an independent probe |
| Probe checks | `npm run verify:mcp` |

## Model and modality support

| Model | Platform | Modality | Status |
|---|---|---|---|
| Tongue | win32 x64 | text to language | **real inference verified**: the built artifact loaded and `lang_detect("kann ich das haben")` returned `de` |
| EmbeddingGemma 2 | win32 x64, CPU | text + image + audio + video | **real inference verified** on this host for all four modalities; measured load 8428 ms, warm inference 101 ms, peak working set 966 MiB |
| Needle | win32 x64, CPU | structured extraction / planning | **real engine verified**: multi-intent planning and extraction ran through the managed process bridge with **0 TCP connections** |
| Voz | win32 x64 | audio to text | **not run**: no installed live Voz provider/model assets; ARCH-04 is BLOCKED |
| Declarative text recipes | host harness | text → bounded JSON | broker/fixture path verified; `--live` requires an operator executor profile (RCP-08) |
| 16 further catalog models | varies | varies | cannot run on this host; recorded in the capability resolver |

## Measurements on this host

| Measurement | Value | Method |
|---|---|---|
| EmbeddingGemma cold load | 8428 ms | real ONNX session creation from the pinned 349 MB text backbone |
| EmbeddingGemma warm inference | 101 ms | real embed of a short text after load |
| EmbeddingGemma peak working set | 966 MiB (1,012,944,896 bytes) | sampled process memory during real load/inference |
| Needle engine network | 0 TCP connections | real managed-worker run, connection table observed |
| Native audio asset | 1,172,750,848 bytes, SHA-256 `6943b910…da1e3a` | pinned asset lock |

## Custom author demonstration

`@try-works/extension-declarative-recipes` is a shipped package with NO code: its
`text_title` and `describe_image` implementations are static recipes interpreted by
the host broker, and it ships native skills. The authoring CLI covers create →
validate → test (fixtures) → pack; `--live` remains an explicit unsupported refusal
until an operator executor profile exists (RCP-08).

## Migration effects

Manifest 1.0 records are normalized to module execution for reading without
rewriting installed bytes; breaking schema deltas refuse the stage and leave the
previous version usable; a license delta or permission expansion marks the stage as
requiring approval; provider selection is preserved across reactivation. These
behaviours are asserted by the migration/update-flow suites.

## Known limitations and unresolved gates

8 requirement(s) are not PASS.
0 requirement(s) have no status written for them, and are reported as NOT_RUN.
No status key names something that is not a requirement.

The first 40 unresolved requirements:

- TOOL-02 is BLOCKED
- LIC-03 is BLOCKED
- MOD-16 is BLOCKED
- MOD-17 is BLOCKED
- DEC-07 is BLOCKED
- TDD-02 is BLOCKED
- TDD-10 is BLOCKED
- AT-90 is BLOCKED

## What this report does NOT claim

Per TDD-10: this document is not evidence that implementation, live inference or
Windows verification has occurred. It records statuses and identities. Where a
requirement needs a platform, model or credential this run did not have, it is
BLOCKED or NOT_RUN — never PASS.
