# Phase 3 — ONNX provider + uhm (and clear)

Goal: the same code-free `model-runtime` contract serves ONNX artifacts through
`@try-works/tool-mode-runtime-onnx`, starting with uhm (filler-word detection) and then clear
(speech enhancement).

## uhm facts (pinned)

- HF `desert-ant-labs/uhm`, revision `a81452eeaa82ba83bdd3682906fe01120b12351a`.
- `uhm.onnx` 94,042,570 B sha256 `fbd19765def76893841e0c70e498bf632d6c68175ceae5a2da8fe3bf7d9d0314` (fp32 reference).
- `labels.json` 237 B (6 classes: 0 not_filler, 1 uh, 2 um, 3 hmm, 4 and, 5 other).
- Input `(1,480000)` float32 = 16 kHz mono, up to 30 s. Output `(1,1499,6)`, one frame every 20 ms.
- Descriptor: `{ "audio_path": string }`; the provider resolves it with `context.resolvePath` and reads the file.

## Processor `uhm/waveform-v1`

1. Read + decode WAV (PCM 16-bit and float32, mono or stereo down-mix), resample to 16 kHz (linear).
2. Window into 480000-sample (30 s) chunks with a 1 s overlap; pad the final chunk with zeros.
3. Run the ONNX session per chunk; per frame take argmax and probability.
4. Filler frame = class != 0 and probability >= 0.5. Merge consecutive filler frames of the same
   class (tolerating one-frame gaps) into spans; subtype = the class name, confidence = mean.
5. Return `{ fillers: [{ startMs, endMs, type, confidence }], coverage: { complete, processedSeconds,
   totalSeconds, reason? } }`, spans merged across chunk overlap and clipped to the audio length.

## Packages

- `tool-mode-runtime-onnx`: Effect service `OnnxSession` (`Layer.effect` + `acquireRelease`, CPU
  default, optional dml/webgpu negotiation), `createProviderFromRecipe(recipe, assets, options?)`
  implementing `uhm/waveform-v1`; type-only imports of runtime-recipes/sdk. No host import.
- `extension-uhm-recipe`: **code-free** declarative package: manifest (execution.kind declarative, no
  entry), `models.lock.json` (uhm.onnx + labels.json pinned), `recipes/detect-fillers.json`
  (`kind: model-runtime`, provider `@try-works/tool-mode-runtime-onnx` / `createProviderFromRecipe`,
  processor `uhm/waveform-v1`, tool `detect_fillers`), schemas, skill.

## Clear (after uhm) — pinned facts

- HF `desert-ant-labs/clear`, revision `b98f790c8a16d572f47bfdebd39964a0cbc987dc`.
- `clear-studio.onnx` 24,801,006 B sha256 `4176990296374e972f0c347ddcc7988d216829cafc58e4d54a98dccd715107d9`.
- **The graph takes host-computed features, not waveform:** inputs `spec`, `feat_erb`, `feat_spec`;
  output `spec_enhanced`. The HF card does not document the STFT/window/hop/ERB parameters.
- Therefore the processor `clear/stft-v1` must derive those parameters from the public
  `Desert-Ant-Labs/desert-ant-core` Swift source and record the file+lines; guessing them would
  produce plausible audio from the wrong features. If the source is ambiguous, stop and report.
- Output must be JSON (no writable path in `InvocationContextV1`): enhanced WAV as base64 with
  sample rate/duration/coverage, capped so `limits.maxResultBytes` holds.

## Gate

- runtime-onnx: tsc + fake-session tests + gated real uhm run on a synthesized WAV (assert 1499x6 →
  spans/coverage; semantic filler quality is NOT claimed by a synthetic clip).
- extension-uhm-recipe: manifest/lock/recipe tests; host lane registers `detect_fillers` from JSON alone.
- `npm run verify:phase3` end-to-end (recipe → host lane → real ONNX) with the pinned asset present.
- full `npm test`, `verify:architecture`, `verify:manifests`, inventory regeneration.
## Phase 3 evidence — uhm half (2026-11-14)

- `npm run verify:runtime` snapshot 7: **9/9 PASS** (runtime-onnx and extension-uhm-recipe added; both recipe
  packages are tests-only and report N/A for build/typecheck).
- `npm run verify:phase3` (`scripts/verify-phase3.ts`), re-run first-hand by the verifier against the pinned
  assets: code-free `extension-uhm-recipe` registers `detect_fillers` and the real ONNX model runs a 3 s
  synthesized WAV — spans 1000–1600 ms and 2200–3000 ms (`hmm`, 0.642 / 0.629), coverage complete 3/3, exit 0.
- `tool-mode-runtime-onnx`: 85 tests (83 pass, 2 gated real-asset skips); real geometry `[1,1499,6]` on the
  pinned artifact; EP negotiation CPU. The real gate caught a genuine bug (ONNX Tensor data/dims are
  prototype getters), which the fakes could not.
- Full suite: **3180 tests, 3160 pass, 0 fail, 20 skipped**; `verify:architecture` and `verify:manifests` green;
  docs/models-index/client catalog/FINAL-REPORT regenerated.
- **Honest caveat:** the E2E is one 3 s clip with two detections at ~0.63–0.64 and no negative control. It
  proves wiring and honest coverage, not filler-detection accuracy. A second clip and a filler-free clip are
  required before any accuracy claim.

## Remaining for Phase 3

Clear (`clear-studio.onnx`, processor `clear/stft-v1`) is not built yet; it needs host STFT/overlap-add DSP and
its own code-free package. That is the next step, followed by Phase 4's remaining models.
## Phase 3 completion evidence (2026-11-14, snapshot 8)

- `npm run verify:runtime` snapshot 8: **10/10 PASS** (runtime-onnx, uhm and clear packages included;
  the three code-free recipe packages report N/A for build/typecheck).
- Both E2Es re-run first-hand by the verifier, exit 0: `detect_fillers` (spans 1000–1600 / 2200–3000,
  coverage 3/3, byte-identical to snapshot 7 → deterministic) and `enhance_speech` (96,044-byte WAV,
  duration 1, coverage 1/1).
- Counts corrected by the verifier: `tool-mode-runtime-onnx` is 134 tests (131 pass, 3 gated skips);
  `extension-clear-recipe` is 30/30. The clear E2E does not print `sampleRate`; 48 kHz is contract-derived
  (lock processor constants), not observed output.
- Full suite: **3259 tests, 3238 pass, 0 fail, 21 skipped**; architecture, manifests and README coverage green.
- Clear provenance: `desert-ant-core` @ `baf4e6e3…` (source-available) — the six file/line ranges are pinned
  in the lock and asserted by the lock test, because the TypeScript DSP is a derivative of that source.
  This is the pattern for Phase 4 ports.

## Phase 4 — remaining models (recon)

- `emo`: text → 812-emoji distribution; `emo.tflite` 10.2 MB + `emo_tokenizer.bin` (Unigram) + `emo_meta.json`.
- `moderator`: image → NSFW score + region confidences; `moderator.tflite` 9.2 MB (int8).
- `gist`: text → 36 topics; `gist.tflite` 13 MB + `gist_tokenizer.bin` (Unigram) + taxonomy/config.
- `ear`: audio → language ID + reliability; `ear.tflite` + `mel_filters.f32` + `languages.json`.
- `tongue` (pure JS) and `voz` (ONNX) already run outside the runtime layer; `title`, `eye`, `face`,
  `schemer`, `toxic`, `who` are Apple-only or closed beta and stay unavailable.
- Each port must pin artifact + tokenizer/front-end parameters to a primary source and record provenance
  (the clear precedent), then ship a code-free recipe package with a real gated run.
