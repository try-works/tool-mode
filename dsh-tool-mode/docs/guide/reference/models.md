---
title: Models
description: The Desert Ant catalog, what each model does, and where it runs.
---

# Models

Tool Mode ships with the **18-model Desert Ant catalog**. Availability is decided
in the running process, not guessed by the agent: a model with no usable route is
reported as unavailable together with the concrete reason.

## Status at a glance

| Model | Task | Windows x64 | Apple only | Closed beta | Size | License |
|---|---|---|---|---|---|---|
| [Align](https://desertant.com/models/align/) | audio.word-alignment | Browser only | No | No | 0.7 MB | Source-available |
| [Clear](https://desertant.com/models/clear/) | audio.speech-enhancement | Yes | No | No | — | Source-available |
| [Clips](https://desertant.com/models/clips/) | video.clip-selection | Browser only | No | No | — | Source-available |
| [Ear](https://desertant.com/models/ear/) | audio.spoken-language-identification | Yes | No | No | — | Source-available |
| [Emo](https://desertant.com/models/emo/) | text.emoji-suggestion | Yes | No | No | 10.2 MB | Source-available |
| [Eye](https://desertant.com/models/eye/) | image.frame-scoring | Closed beta | No | Yes | — | Source-available |
| [Face](https://desertant.com/models/face/) | image.face-matching | Closed beta | No | Yes | — | Source-available |
| [Gist](https://desertant.com/models/gist/) | text.topic-tagging | Browser only | No | No | — | Source-available |
| [Moderator](https://desertant.com/models/moderator/) | image.nsfw-detection | Yes | No | No | 9.2 MB | Source-available |
| [Redact](https://desertant.com/models/redact/) | text.pii-redaction | Yes | No | No | — | Source-available |
| [Schemer](https://desertant.com/models/schemer/) | text.structured-extraction | Closed beta | No | Yes | — | Source-available |
| [Shapes](https://desertant.com/models/shapes/) | stroke.shape-recognition | Yes | No | No | — | Source-available |
| [Title](https://desertant.com/models/title/) | text.title-generation | Apple only | Yes | No | — | Source-available |
| [Tongue](https://desertant.com/models/tongue/) | text.language-identification | Yes | No | No | 2 MB | Source-available |
| [Toxic](https://desertant.com/models/toxic/) | text.toxicity-detection | Closed beta | No | Yes | — | Source-available |
| [Uhm](https://desertant.com/models/uhm/) | audio.filler-detection | Yes | No | No | — | Source-available |
| [Voz](https://desertant.com/models/voz/) | audio.speech-recognition | Yes | No | No | 349 MB | Source-available |
| [Who](https://desertant.com/models/who/) | audio.speaker-labeling | Closed beta | No | Yes | — | Source-available |

**Reading the status column**

- **Yes** — the provider was verified runnable on Windows x64.
- **Browser only** — the vendor ships a browser build, but no Node native build.
- **No native build** — there is no prebuilt binary for this platform.
- **Apple only** — the model runs through Apple frameworks and needs a Mac (or
  the user-hosted bridge).
- **Closed beta** — the vendor has not published a runtime SDK.

The table describes the **catalog models**. Extension packages add their own
models and tools; see [Extensions](../guides/install-extensions.md).

### Extension models

These models are added by first-party extension packages. They are available only
when the package is installed, its assets are ready, and it is enabled.

| Model | Package | Tools |
|---|---|---|
| Clear speech enhancement (declarative) | `@try-works/extension-clear-recipe` | `enhance_speech` |
| Declarative harness recipes | `@try-works/extension-declarative-recipes` | — |
| Desert Ant Tongue language detection | `@try-works/extension-desert-ant-tongue` | `lang_detect` |
| Desert Ant Voz speech transcription | `@try-works/extension-desert-ant-voz` | `stt_transcribe` |
| Ear spoken language identification (declarative) | `@try-works/extension-ear-recipe` | `identify_language` |
| EmbeddingGemma 2 multimodal embeddings | `@try-works/extension-embeddinggemma` | `multimodal_embed`, `semantic_similarity`, `semantic_rank`, `semantic_classify`, `semantic_deduplicate`, `dedupe_and_rank`, `media_find_moments` |
| Emo emoji suggestions (declarative) | `@try-works/extension-emo-recipe` | `suggest_emojis` |
| Laya decision family | `@try-works/extension-laya` | `decision_choose_local`, `decision_choose`, `decision_test`, `decision_score`, `decision_test_typed`, `decision_score_typed` |
| MiniLM text_embed | `@try-works/extension-minilm-embed` | — |
| MiniLM text_rerank | `@try-works/extension-minilm-rerank` | — |
| Cactus Mirage vision (describe, detect, OCR, forms) | `@try-works/extension-mirage` | `mirage_describe`, `mirage_detect`, `mirage_ocr`, `mirage_extract` |
| Moderator NSFW detection (declarative) | `@try-works/extension-moderator-recipe` | `classify_nsfw` |
| Cactus Needle 3 tool calling and structured extraction | `@try-works/extension-needle` | `tools_plan`, `structured_extract`, `validate_record`, `extract_with_repair` |
| Redact PII redaction | `@try-works/extension-redact` | `redact_text` |
| Shapes stroke recognition (declarative) | `@try-works/extension-shapes-recipe` | `shape_recognize` |
| Uhm filler detection (declarative) | `@try-works/extension-uhm-recipe` | `detect_fillers` |
| Harness Vision | `@try-works/harness-vision` | `describe_image` |
| Harness Text Tools | `@try-works/tool-mode-harness-text` | `text_title` |

## Catalog details

### Align

Word-timestamp refinement for any transcript, on device, from 0.7MB.

- **Capability:** `audio.word-alignment`
- **Input:** audio
- **Output:** { words: [{ text, start, end }] } aligned against the audio
- **npm package:** `@desert-ant-labs/align/native`
- **CLI verb:** `desertant align`
- **Model size:** 0.7 MB
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/align/

### Clear

On-device speech enhancement: denoise, dereverb and loudness-normalize to 48 kHz.

- **Capability:** `audio.speech-enhancement`
- **Input:** audio
- **Output:** A cleaned audio file path plus processing metadata
- **npm package:** `@desert-ant-labs/clear/native`
- **CLI verb:** `desertant clear`
- **Model size:** not stated
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/clear/

### Clips

Clip selection that turns a long recording into ranked shorts and highlights from a transcript.

- **Capability:** `video.clip-selection`
- **Input:** video
- **Output:** { clips: [{ index, start, end, title, file }] } ranked by interest
- **npm package:** —
- **CLI verb:** `desertant clips`
- **Model size:** not stated
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/clips/

### Ear

On-device spoken language identification across 102 languages from a short audio stretch.

- **Capability:** `audio.spoken-language-identification`
- **Input:** audio
- **Output:** { language, confidence, candidates: [{ language, probability }] }
- **npm package:** `@desert-ant-labs/ear/native`
- **CLI verb:** `desertant ear`
- **Model size:** not stated
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/ear/

### Emo

Type a task or message and get the emoji that fit, in 22 languages, on the device.

- **Capability:** `text.emoji-suggestion`
- **Input:** text
- **Output:** [{ emoji, confidence }] ranked suggestions
- **npm package:** `@desert-ant-labs/emo/native`
- **CLI verb:** `desertant emo`
- **Model size:** 10.2 MB
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/emo/

### Eye

On-device frame scoring that tells you which shot to keep, what is in it, and which shots repeat.

- **Capability:** `image.frame-scoring`
- **Input:** image
- **Output:** [{ frame, score, labels, duplicate_of }]
- **npm package:** —
- **CLI verb:** —
- **Model size:** not stated
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/eye/

### Face

On-device face matching that finds the same person across a photo library or through a video.

- **Capability:** `image.face-matching`
- **Input:** image
- **Output:** [{ path, faces: [{ box, match_id }] }]
- **npm package:** —
- **CLI verb:** —
- **Model size:** not stated
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/face/

### Gist

On-device topic tagging across a 36-topic taxonomy, in 101 languages, with no server call.

- **Capability:** `text.topic-tagging`
- **Input:** text
- **Output:** { topics: [{ topic, score }] }
- **npm package:** `@desert-ant-labs/gist/native`
- **CLI verb:** `desertant gist`
- **Model size:** not stated
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/gist/

### Moderator

On-device NSFW detection that flags nudity before upload, trained only on licensed and synthetic data.

- **Capability:** `image.nsfw-detection`
- **Input:** image
- **Output:** { nsfw, score, labels: [...] }
- **npm package:** `@desert-ant-labs/moderator/native`
- **CLI verb:** `desertant moderator`
- **Model size:** 9.2 MB
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/moderator/

### Redact

On-device redaction that strips personal data as you type, in 27 languages, with restore support.

- **Capability:** `text.pii-redaction`
- **Input:** text
- **Output:** { redactedText, items: [{ label, original, placeholder, confidence }] }
- **npm package:** `@desert-ant-labs/redact/native`
- **CLI verb:** `desertant redact`
- **Model size:** not stated
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/redact/

### Schemer

Extract typed fields from any text against your own schema, on device, with empty fields left empty.

- **Capability:** `text.structured-extraction`
- **Input:** text
- **Output:** An object matching the caller-supplied schema
- **npm package:** —
- **CLI verb:** —
- **Model size:** not stated
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/schemer/

### Shapes

On-device shape recognition that turns one hand-drawn stroke into a rectangle, ellipse, triangle, star or line in under 10ms.

- **Capability:** `stroke.shape-recognition`
- **Input:** stroke
- **Output:** { shape, confidence, candidates: [...] }
- **npm package:** `@desert-ant-labs/shapes/native`
- **CLI verb:** `desertant shapes`
- **Model size:** not stated
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/shapes/

### Title

On-device titles and descriptions: a short factual title and a one- or two-sentence description for any passage.

- **Capability:** `text.title-generation`
- **Input:** text
- **Output:** { title, description, isEmpty }
- **npm package:** —
- **CLI verb:** `desertant title`
- **Model size:** not stated
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/title/

### Tongue

On-device language identification for short text across 84 languages, from just a few words.

- **Capability:** `text.language-identification`
- **Input:** text
- **Output:** { language, reliability, candidates: [{ language, probability }], isTooCloseToCall }
- **npm package:** `@desert-ant-labs/tongue`
- **CLI verb:** `desertant tongue`
- **Model size:** 2 MB
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/tongue/

### Toxic

On-device moderation that flags hateful, abusive and threatening text in 23 European languages.

- **Capability:** `text.toxicity-detection`
- **Input:** text
- **Output:** { toxic, score, labels: [...] }
- **npm package:** —
- **CLI verb:** —
- **Model size:** not stated
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/toxic/

### Uhm

On-device filler detection that marks every um, uh and hmm to within 20ms, an hour of audio in 12s.

- **Capability:** `audio.filler-detection`
- **Input:** audio
- **Output:** [{ start, end, word }] filler spans to cut
- **npm package:** —
- **CLI verb:** `desertant uhm`
- **Model size:** not stated
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/uhm/

### Voz

Transcribe 10 minutes of audio in 2s on an iPhone, 14x faster than Whisper, with word timestamps.

- **Capability:** `audio.speech-recognition`
- **Input:** audio
- **Output:** { text, words: [{ text, start, end }], realtimeFactor }
- **npm package:** `@desert-ant-labs/voz`
- **CLI verb:** `desertant voz`
- **Model size:** 349 MB
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/voz/

### Who

On-device speaker labeling that turns a recording into per-person turns with face boxes and timestamps.

- **Capability:** `audio.speaker-labeling`
- **Input:** audio
- **Output:** [{ speaker, start, end, face_box }] turns
- **npm package:** —
- **CLI verb:** —
- **Model size:** not stated
- **License:** Source-available
- **Vendor page:** https://desertant.com/models/who/


## Why a model can be unavailable

An unavailable model stays visible in the catalog so the reason is discoverable.
The common causes are:

1. **No native build for this platform.** Several LiteRT/TFLite packages publish
   Linux or Apple binaries but no `win32-x64` build.
2. **Apple-only frameworks.** Title and Uhm need Core ML/MLX on Apple silicon.
3. **Closed beta.** The weights or SDK are not published yet.
4. **A missing extension.** Extension-backed models need the extension installed,
   prepared, and enabled.
5. **A missing runtime.** Some packages need `onnxruntime-node` or another
   platform runtime before they can execute.

Use `tool_mode_list` for the live answer in your process. Do not infer
availability from this page: your operating system, CPU, installed packages and
enabled extensions decide it.

## Routes

A model does not need to run on the same machine as the agent. The supported
routes are:

- **In-process npm package** — the default when the platform has a build.
- **Desert Ant CLI** — macOS and Linux; covers every shipping model.
- **User-hosted bridge** — an HTTP bridge on a machine that can run a model. The
  plugin does not host the model for you.
- **Extension** — a Tool Mode extension package that declares its tools and
  assets.

See [How Tool Mode works](../concepts/how-tool-mode-works.md) and
[Configuration](../reference/configuration.md#routes).
