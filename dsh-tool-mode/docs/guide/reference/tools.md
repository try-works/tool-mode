---
title: Tools
description: The tools an agent can call, and the model or extension behind each one.
---

# Tools

The tools below are declared by installed extension manifests. The **live
schema** is always available from `tool_mode_describe`; this page is the
human-readable index, not a second source of truth for argument shapes.

Catalog models are documented separately in [Models](models.md). A catalog model's
tool name is a route label; it is not a promise that the tool is registered in
your deployment.

## Tool index

| Tool | What it does | Backed by | Availability |
|---|---|---|---|
| `decision_choose` | Standard decision.choose: choose one of 2–16 options for a stated decision and return the chosen option as an INDEX plus a confidence bucket and reas… | Laya decision family (Extension) | Requires @try-works/extension-laya to be installed and enabled |
| `decision_choose_jev` | Choose one of 2–16 options through the remote Jev (TypeSafe System One) typed-question API. | Remote Jev (Opt-in remote route) | Only when jev.enabled is true and a Jev API key is configured |
| `decision_choose_local` | Choose one of the caller's options for a stated prompt, over the pinned Laya checkpoint, using the extension-local result shape (label + per-option p… | Laya decision family (Extension) | Requires @try-works/extension-laya to be installed and enabled |
| `decision_combine` | Combine code-computed facts and model judgment probabilities through explicit first-match rules. | Host (Host tool) | Built into the host |
| `decision_evaluate` | Evaluate labeled decision probabilities with accuracy, confusion rates, Brier score and calibration bins. | Host (Host tool) | Built into the host |
| `decision_judgments_jev` | Batch independent yes/no judgments through the remote Jev API. | Remote Jev (Opt-in remote route) | Only when jev.enabled is true and a Jev API key is configured |
| `decision_route` | Route a judgment probability into accept, reject or the escalate band. | Host (Host tool) | Built into the host |
| `decision_score` | Score a stated prompt onto one of the caller's ordinal levels over the pinned Laya checkpoint. Bounded by 512 state tokens and a 192-token head budge… | Laya decision family (Extension) | Requires @try-works/extension-laya to be installed and enabled |
| `decision_score_typed` | Score a state/question onto 2–32 ordered levels over the SAME pinned Laya checkpoint and head as decision_score, preserving the native ORDINAL distri… | Laya decision family (Extension) | Requires @try-works/extension-laya to be installed and enabled |
| `decision_test` | Answer a stated yes/no question over the pinned Laya checkpoint. Bounded by 512 state tokens and a 192-token head budget; truncated state or collapse… | Laya decision family (Extension) | Requires @try-works/extension-laya to be installed and enabled |
| `decision_test_typed` | Evaluate a yes/no proposition against a state over the SAME pinned Laya checkpoint and head as decision_test, returning the native P(proposition) exp… | Laya decision family (Extension) | Requires @try-works/extension-laya to be installed and enabled |
| `dedupe_and_rank` | Group items by near-duplicate representative clustering and rank the group representatives against a query in ONE embedding pass over EmbeddingGemma … | EmbeddingGemma 2 multimodal embeddings (Extension) | Requires @try-works/extension-embeddinggemma to be installed and enabled |
| `describe_image` | Describe the visible content of an approved image with honest uncertainty. | Harness Vision (Extension) | Requires @try-works/harness-vision to be installed and enabled |
| `extract_with_repair` | Extract structured data from text into a caller-supplied JSON Schema, and repair ONE rejected attempt. The first answer is re-validated exactly as st… | Cactus Needle 3 tool calling and structured extraction (Extension) | Requires @try-works/extension-needle to be installed and enabled |
| `lang_detect` | Identify the language of a short piece of text with a reliability verdict and ranked alternatives. | Desert Ant Tongue language detection (Extension) | Requires @try-works/extension-desert-ant-tongue to be installed and enabled |
| `media_find_moments` | Find the source-time windows of one audio item that best match a query by embedding each window and ranking by cosine similarity. Returns window-leve… | EmbeddingGemma 2 multimodal embeddings (Extension) | Requires @try-works/extension-embeddinggemma to be installed and enabled |
| `mirage_describe` | Describe one image with Mirage: scene, objects, text, relations and a short generated reasoning trace. Sections can be selected. Boxes use the model'… | Cactus Mirage vision (describe, detect, OCR, forms) (Extension) | Requires @try-works/extension-mirage to be installed and enabled |
| `mirage_detect` | Detect the objects Mirage names in one image, with boxes, scores and an optional mask (bitmap RLE or polygons). Object names come from the model's la… | Cactus Mirage vision (describe, detect, OCR, forms) (Extension) | Requires @try-works/extension-mirage to be installed and enabled |
| `mirage_extract` | Fill an ordered, bounded form from one image: enum choices, bounded integers, or short strings, using Mirage's native form decoding. The engine retur… | Cactus Mirage vision (describe, detect, OCR, forms) (Extension) | Requires @try-works/extension-mirage to be installed and enabled |
| `mirage_ocr` | Read the text Mirage finds in one image: each line's string, box and detection score. This is OCR, not a guarantee of exact transcription; the model'… | Cactus Mirage vision (describe, detect, OCR, forms) (Extension) | Requires @try-works/extension-mirage to be installed and enabled |
| `multimodal_embed` | Embed one or more items into a shared embedding space over EmbeddingGemma 2. Returns L2-normalized vectors of 768, 512, 256 or 128 dimensions plus a … | EmbeddingGemma 2 multimodal embeddings (Extension) | Requires @try-works/extension-embeddinggemma to be installed and enabled |
| `semantic_classify` | Classify one item against caller-supplied label descriptions by embedding cosine similarity over EmbeddingGemma 2. Returns the best label with its ra… | EmbeddingGemma 2 multimodal embeddings (Extension) | Requires @try-works/extension-embeddinggemma to be installed and enabled |
| `semantic_deduplicate` | Group near-duplicate items by greedy representative clustering in input order over EmbeddingGemma 2 cosine similarity: each item joins the FIRST grou… | EmbeddingGemma 2 multimodal embeddings (Extension) | Requires @try-works/extension-embeddinggemma to be installed and enabled |
| `semantic_rank` | Rank candidate items against a query by embedding cosine similarity over EmbeddingGemma 2, returning the caller's own IDs in stable descending score … | EmbeddingGemma 2 multimodal embeddings (Extension) | Requires @try-works/extension-embeddinggemma to be installed and enabled |
| `semantic_similarity` | Cosine similarity between two items embedded in one space over EmbeddingGemma 2, supporting text-to-text, text-to-image, text-to-audio and image-to-i… | EmbeddingGemma 2 multimodal embeddings (Extension) | Requires @try-works/extension-embeddinggemma to be installed and enabled |
| `structured_extract` | Extract structured data from text into a caller-supplied JSON Schema, over the pinned Cactus Needle 3 native engine. The schema is compiled to a byte… | Cactus Needle 3 tool calling and structured extraction (Extension) | Requires @try-works/extension-needle to be installed and enabled |
| `stt_transcribe` | On-device speech transcription with honest partial-coverage reporting. | Desert Ant Voz speech transcription (Extension) | Requires @try-works/extension-desert-ant-voz to be installed and enabled |
| `text_embed` | Embed text into the legacy 384-dimensional MiniLM space. | MiniLM text_embed (Standard contract) | Requires the MiniLM text_embed extension and its prepared text backbone |
| `text_rerank` | Score query/document pairs with the MiniLM cross-encoder and rank them. | MiniLM text_rerank (Standard contract) | Requires the MiniLM text_rerank extension and its prepared text backbone |
| `text_title` | Propose a bounded title and one-sentence description for supplied text through an authorized harness model. | Harness Text Tools (Extension) | Requires @try-works/tool-mode-harness-text to be installed and enabled |
| `tools_plan` | Propose the tool calls a request implies, as DATA, over the pinned Cactus Needle 3 native engine. Returns each proposal as a name plus an arguments o… | Cactus Needle 3 tool calling and structured extraction (Extension) | Requires @try-works/extension-needle to be installed and enabled |
| `validate_record` | Validate one record against a caller-supplied JSON Schema, using the SAME sanitiser and validator this extension's extraction path uses, so a record … | Cactus Needle 3 tool calling and structured extraction (Extension) | Requires @try-works/extension-needle to be installed and enabled |

## Host and discovery tools

These are provided by Tool Mode itself rather than by a model extension.

| Tool | What it does | Available over MCP? |
|---|---|---|
| `tool_mode_list` | Lists the tools the caller may use, their readiness and the catalog revision. | Depends on the caller's export grant; check `tools/list`. |
| `tool_mode_describe` | Returns a tool's schemas, model facts, semantics, limits and unsupported cases. | Depends on the caller's export grant. |
| `model_tools` | Read-only management view: installed models, enable/disable state and why a model cannot run. | No. Management stays host-local. |
| `tool_mode_run` | Runs a bounded program that chains tools (Code Mode). | Only when the operator grants hosted code and confinement evidence is valid. |

## Decision and utility tools

The decision family and the harness utilities are registered by the host and
extension packages. Their descriptions and schemas are available through
`tool_mode_describe`. They are not model catalog entries.

## Extensions

| Extension | Package | Version | Tools | Activation |
|---|---|---|---|---|
| [Declarative harness recipes](../guides/install-extensions.md) | `@try-works/extension-declarative-recipes` | 0.1.0 | 0 | operator |
| [Desert Ant Tongue language detection](../guides/install-extensions.md) | `@try-works/extension-desert-ant-tongue` | 0.1.3 | 1 | operator |
| [Desert Ant Voz speech transcription](../guides/install-extensions.md) | `@try-works/extension-desert-ant-voz` | 0.1.5 | 1 | operator |
| [EmbeddingGemma 2 multimodal embeddings](../guides/install-extensions.md) | `@try-works/extension-embeddinggemma` | 0.1.2 | 7 | operator |
| [Laya decision family](../guides/install-extensions.md) | `@try-works/extension-laya` | 1.0.4 | 6 | operator |
| [MiniLM text_embed](../guides/install-extensions.md) | `@try-works/extension-minilm-embed` | 1.0.0 | 0 | operator |
| [MiniLM text_rerank](../guides/install-extensions.md) | `@try-works/extension-minilm-rerank` | 1.0.0 | 0 | operator |
| [Cactus Mirage vision (describe, detect, OCR, forms)](../guides/install-extensions.md) | `@try-works/extension-mirage` | 0.1.2 | 4 | operator |
| [Cactus Needle 3 tool calling and structured extraction](../guides/install-extensions.md) | `@try-works/extension-needle` | 0.1.3 | 4 | operator |
| [Harness Vision](../guides/install-extensions.md) | `@try-works/harness-vision` | 0.1.0 | 1 | operator |
| [Harness Text Tools](../guides/install-extensions.md) | `@try-works/tool-mode-harness-text` | 0.1.0 | 1 | operator |

## Reading a tool result

Most tools return a JSON object with the task result. A tool error is a normal
tool result with `isError: true` and a text explanation; it is not a crash. If a
tool is unavailable, `tool_mode_list` reports the reason instead of registering a
tool that would fail at call time.

For exact fields, call:

```text
tool_mode_describe { "tools": ["lang_detect"] }
```

To discover the live set:

```text
tool_mode_list
```
