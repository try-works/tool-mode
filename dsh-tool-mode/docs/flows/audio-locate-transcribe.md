# Flow: audio locate → transcribe → compare

**Status:** verified on this host, 2026-10-20, exit code 0.
**Verifier:** `scripts/verify-flows.mjs` (flow 1). Command: `node scripts/verify-flows.mjs`.

This is a **flow**, not a tool: there is no cross-extension composite tool. The agent
composes three independent tools (plus one caller-side step) and decides the order,
the window size, the stride, and the query. **No tool calls another tool.**

```
caller
  │  1. media_find_moments      (EmbeddingGemma)  → ranked source-time windows
  │  2. materialize the window  (CALLER, not a tool: stt_transcribe takes a path, not a range)
  │  3. stt_transcribe          (Desert Ant Voz)  → text of that window
  │  4. semantic_similarity     (EmbeddingGemma)  → cosine(transcript, query)
  ▼
```

## Purpose

Find *where* in an audio item a query is spoken (embedding retrieval over windows),
transcribe only that window, and score how much the transcript still resembles the
query. The result is a located, transcribed, and comparatively scored region — not a
transcript of the whole file, and not a speech recognizer doing the locating.

## Prerequisites

| Requirement | What this run used |
| --- | --- |
| Extensions (installed from source, then prepared, then enabled) | `@try-works/extension-embeddinggemma` 0.1.2, `@try-works/extension-desert-ant-voz` 0.1.5 |
| Assets | EmbeddingGemma content-addressed blobs already in `E:/dsh-asset-cache` (text + vision + audio groups); Voz declares a **zero-asset** lock, so the host prepares and fetches nothing and the vendor package loads its own cache (`C:\Users\erikb\.cache\desert-ant-models`). `prepare` returned `prepared: true, activationReady: true` for both, with no transfer needed |
| Store | a **fresh** scratch store under `D:/DEV/verify-flows/`; installing from source copies the extension's runtime dependencies beside it, so a store is roughly 1 GB — the scratch volume needs ~3 GB free for a two-flow run, and the verifier prunes abandoned `run-*` directories older than an hour |
| Audio | `docs/tool-mode/qualification/.voz-wavs-10200/english.wav` (22050 Hz, mono, 16-bit PCM, 3.374 s, synthesized speech) |
| Path authority | the caller's grant must include the roots of both the audio and the store: a path outside every approved root is refused with `PATH_OUTSIDE_GRANT` |

## Exact call sequence

### 1. Locate — `media_find_moments`

```json
{
  "query": { "id": "q", "parts": [{ "kind": "text", "text": "The quick brown fox jumps over the lazy dog." }] },
  "media": { "kind": "audio", "path": "D:\\DEV\\dsh-tool-mode\\docs\\tool-mode\\qualification\\.voz-wavs-10200\\english.wav" },
  "windowSeconds": 2,
  "strideSeconds": 0.5,
  "top_k": 4,
  "dimensions": 768
}
```

`windowSeconds` is capped at the model's 11.2 s audio window; `sampling` is a
video-only field and supplying it for audio is an error. The final window is clipped
to the source and included exactly once.

Verified result:

```json
{
  "matches": [
    { "startSeconds": 0.44825, "endSeconds": 2.44825, "score": 0.6987753731922857 },
    { "startSeconds": 0, "endSeconds": 2, "score": 0.6977544817032579 }
  ],
  "scoreKind": "cosine_similarity",
  "localization": "window_level",
  "embeddingSpaceId": "embeddinggemma-2/text/daa72c512439-9fd452bfc691",
  "windowsEvaluated": 2,
  "sampledFrameTimestampsSeconds": []
}
```

Two windows were evaluated: the window at `0–2 s`, and a tail at
`0.44825–2.44825 s` (the tail starts at `admittedDuration - windowSeconds`). The
scores are ranking evidence for this space, not probabilities.

**Coverage caveat — measured, not assumed.** The fixture is 22050 Hz and 3.373923 s, but
`media_find_moments` planned its windows over **2.44825 s** only. The decoder converts
time to SOURCE frame indices with the model's 16 kHz rate
(`endSample = min(frames, ceil(3.373923 × 16000)) = 53983` of 74395 source frames) and
then resamples those 53983 frames to 16 kHz, yielding 39172 samples = 2.44825 s. So the
admitted duration is the source duration multiplied by `modelHz / sourceHz`
(16000/22050 = 0.725624). Everything after 2.44825 s of this file is unreachable by the
window plan, and a `range` is scaled the same way (a requested `1–2 s` range decodes as
0.725625 s). A 16 kHz source is unaffected (`16000/16000 = 1`), which is why the 16 kHz
qualification fixtures never showed it.
The verifier prints a `coverage` line — for this run
`{"sourceDurationSeconds":3.373923,"lastWindowEndSeconds":2.44825,"admittedFraction":0.725639,"modelHzOverSourceHz":0.725624,"covered":false}`
— and the extension code itself was not changed (out of this task's scope).

### 2. Materialize the located window (caller step)

`stt_transcribe`'s contract accepts `audio.path`, not a time range, so the caller has
to produce the file it wants transcribed. The verifier cuts the PCM payload of the
located window into a new WAV (no re-encode, no resample):

```
window = WAV slice of english.wav, from 0.44825 s to 2.44825 s
       = 44101 frames at 22050 Hz mono 16-bit ≈ 2.000 s
```

This is **caller machinery**, not a tool call. It is where the composition is
actually stitched together.

### 3. Transcribe — `stt_transcribe`

```json
{
  "audio": { "path": "D:\\DEV\\verify-flows\\...\\flow1-window-0_44825-2_44825.wav", "sampleRateHz": 22050, "channels": 1 },
  "language": "en",
  "timestamps": "none"
}
```

Verified result:

```json
{
  "text": "Brown fox jumps over the lazy dog",
  "coverage": { "complete": true, "transcribedSeconds": 1.76, "totalSeconds": null, "reason": null }
}
```

`language` is validated for shape and then honored by the model's own
auto-detection; this build exposes no per-code supported list, so the code is
advisory. The window starts at 0.448 s, which cuts the leading “The quick” — that is
expected: window-level localization is not sentence segmentation.

### 4. Compare — `semantic_similarity`

```json
{
  "left":  { "id": "transcript", "parts": [{ "kind": "text", "text": "Brown fox jumps over the lazy dog" }] },
  "right": { "id": "query",      "parts": [{ "kind": "text", "text": "The quick brown fox jumps over the lazy dog." }] },
  "dimensions": 768
}
```

Verified result:

```json
{
  "score": 0.8761789517669837,
  "scoreKind": "cosine_similarity",
  "embeddingSpaceId": "embeddinggemma-2/text/daa72c512439-9fd452bfc691",
  "meta": {
    "contract": "@try-works/extension-embeddinggemma/semantic_similarity",
    "contractVersion": "1.0.0",
    "implementationId": "embeddinggemma2-similarity",
    "extension": "@try-works/extension-embeddinggemma",
    "extensionVersion": "0.1.2",
    "activationGeneration": 3,
    "executionLocation": "device",
    "receiptId": "rcpt_000001",
    "warnings": []
  }
}
```

The score is a cosine similarity in the named space, NOT a probability that the two
mean the same thing, and it is comparable only within that space.

## What each receipt proves

A receipt is the host-authored `meta` envelope. This is the important asymmetry:

| Call | `meta.receiptId` in the result | Why |
| --- | --- | --- |
| `media_find_moments` | **absent** (`null`) | Its declared output schema lists `meta` as an optional property, not a required one. The host stamps (and records) the envelope only when the schema requires `meta`. |
| `stt_transcribe` | **absent** (`null`) | Its output schema declares `additionalProperties: false` and no `meta` at all, so even a stamp would be rejected. Its description says “The host attaches the reserved meta field” — behavior and prose disagree. |
| `semantic_similarity` | `rcpt_000001` | Its schema requires `meta`, so the host stamps it and records the invocation receipt. |

So this run proves, per call:

- **`media_find_moments` (`null`):** the call returned a schema-valid result with two
  windows, a ranking, a score kind, an embedding space id, and zero sampled video
  frames. It carries **no host provenance**: no receipt id, no extension identity, no
  activation generation. A caller that needs that provenance cannot get it from the
  result.
- **`stt_transcribe` (`null`):** the call returned `text` and an honest `coverage`
  block (`complete: true`, `transcribedSeconds: 1.76`) but, again, no host provenance
  in the result.
- **`semantic_similarity` (`rcpt_000001`):** the result is bound to the declaring
  extension `@try-works/extension-embeddinggemma` 0.1.2, contract
  `.../semantic_similarity` 1.0.0, implementation `embeddinggemma2-similarity`, host
  activation generation 3, execution location `device`. It proves *which
  implementation produced this number under which activation*; it does not prove the
  number is correct, calibrated, or that the other two calls happened.

That gap (two of the three tool calls have no receipt, even though the receipt
machinery exists) is a property of the declared schemas, not of the flow. The verifier
prints `receiptId: null` and the reason for each such call instead of inventing one.

## Failure modes

| Failure | Where it surfaces | What it means |
| --- | --- | --- |
| No matches | `matches: []` | Query produced no window, or the source shorter than one window. Do not invent a window. |
| Empty window | `endSeconds <= startSeconds` | A caller slicing this window produces a zero-frame file; the verifier refuses before calling STT. |
| Unsupported audio | `media_find_moments` / `stt_transcribe` error | The bounded decoders accept specific WAV shapes; a non-PCM or compressed file is refused, never silently mis-read. |
| Non-16 kHz source | `coverage` line: `admittedFraction < 1` | The window plan covers only `sourceDuration × modelHz/sourceHz` of the file and any `range` is scaled the same way. The uncovered tail cannot be located; reported, not hidden. |
| Unsupported PCM for the caller's slicer | verifier error before STT | The verifier supports 16-bit PCM only. Another caller must implement its own slice (or an encoder) — the tool will not do it. |
| Empty transcript | `text: ""` | Silence or no speech in the fixture (the PowerShell fallback fixture is a 440 Hz tone, not speech). The flow stops: `semantic_similarity` of an empty text is not a result. |
| Wrong language | transcript garbage, not an error | `language` is advisory; the engine auto-detects. A wrong request still transcribes something. |
| Path outside the grant | `PATH_OUTSIDE_GRANT` | The caller's approved roots must contain both the audio and the window file. |
| Assets missing | `prepare` returns `prepared: false` with a reason | Network/preparation failure: the exact URL or reason is reported. No model is loaded. |
| Model load failure | first call of the extension | Provider `load` failed; every later call of that implementation fails the same way until the extension is repaired. |
| Upgrade refusal on install | install line with `skipped: true` | The store already held the extension; treat as a skip, then prepare/enable the installed copy. |

## What is caller policy (and what is not)

- **The ordering.** Nothing sequences these calls; the caller does.
- **The window size, stride, and `top_k`.** Model limits are enforced per call
  (`windowSeconds ≤ 11.2`, window-count caps), but the retrieval plan is the caller's.
- **Which window is transcribed.** The caller picks the top match (or any match).
- **The window materialization.** No tool accepts a range for transcription; the
  caller must cut or render the audio.
- **The query text.** It is an input, not a model output.
- **The final judgement.** `semantic_similarity` returns a number; whether 0.876 is
  “good enough” is a policy decision the caller owns. That judgement belongs to the
  companion flow, `semantic-gate.md`.

**No tool calls another tool.** Each result is returned to the caller, which decides
what to do next.

## Reproduce

```powershell
node scripts/verify-flows.mjs --flow 1
```

Every line is JSON; the last flow line is `{"flow":1,"phase":"flow-complete","ok":true,...}`
and the run exits 0 only when a real transcript and a finite score were produced.

## Remainders

- The fixture is synthesized speech, not a real-speaker corpus; retrieval quality on a
  real corpus is not measured here.
- The absolute cross-modal scores (0.70 for a text query against the speech windows)
  are low compared with the same-modality pairs; only the **ranking** is used.
- The non-16 kHz admission defect above: this flow works, but a caller cannot locate
  anything in the last 27% of a 22050 Hz file. A 16 kHz pipeline would not show it.
- Two of the three tool calls carry no host receipt (see above); only
  `semantic_similarity` does.
- The fixture lives under an untracked `.voz-wavs-*` directory (produced by
  `scripts/synthesize-voz-utterances.ps1`); on a host without it the verifier
  synthesizes a 3 s 16 kHz mono tone and flow 1 then fails honestly on an empty
  transcript.

