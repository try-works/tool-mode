# Phase 4 — remaining models (moderator first)

Each port follows the clear precedent: artifact + preprocessing constants pinned to a primary source
(Desert-Ant-Labs/desert-ant-core), provenance recorded in the lock, a code-free recipe package, and a
real gated run. Target order: **moderator** (this round), then emo, gist, ear, and the remaining
catalog entries that can honestly run.

## moderator (pinned)

- HF `desert-ant-labs/moderator`, revision `263b727eedee2c439b4f35b4491ee80802ea8a6e`.
- `moderator.tflite` 9,618,016 B sha256 `925d11966ea9086acbfeaf4d00c1dd30c738c531695f2004b68880d3f121cd89`.
- Graph contract: input tensor `image` `[1,384,384,3]` float32 raw RGB (normalisation is inside the
  model), output tensor `scores` `[5]` in head order nipples, genitals, buttocks, nude, sexAct.
- Preprocessing (primary source: `Sources/Moderator/Preprocess.swift`, `Model.swift`):
  - side 384; Pillow bilinear resampler ported bit-exactly (fixed-point taps, `precisionBits = 22`);
  - `fast`: one center square of the full short side;
  - `balanced`: the whole image letterboxed onto a black square + center squares at 85%, 70%, 55% of
    the short side (4 crops);
  - `accurate`: the 4 tiles plus each tile mirrored horizontally (8 crops);
  - per-head score = max over crops; `score = max(counted heads)` with policy `standard` (all five) or
    `allowTopless` (all but nipples); `isNSFW = score >= threshold` (default 0.5).
- New processor `moderator/crops-v1` in `@try-works/tool-mode-runtime-litert` (the LiteRT factory), so
  the code-free package names `@try-works/tool-mode-runtime-litert` / `createProviderFromRecipe`.

### Tool contract (code-free package `extension-moderator-recipe`)

- tool `classify_nsfw`; input `{ image_path }` closed. v1 decodes **PNG only** (8-bit RGB/RGBA,
  non-interlaced) through `node:zlib`; JPEG is refused by name rather than guessed. Quality/threshold/
  policy default to `balanced` / 0.5 / `standard` and may be supplied.
- output `{ isNSFW, score, threshold, policy, quality, regions: { nipples, genitals, buttocks, nude, sexAct }, crops }`.
- honest limits: the model is an adult-content classifier; no claim about minors or non-adult content;
  scores are decision scores, not calibrated probabilities.

## Gate

- runtime-litert: tsc/build/tests incl. bit-exact Pillow tap tests and geometry tests; gated real run on
  a generated PNG (blank/solid) asserting finite scores and `isNSFW=false`.
- package: manifest/lock/recipe tests; `verify:phase4` E2E registers `classify_nsfw` from JSON alone and
  runs the real model.
- full suite, architecture, manifests, inventories; verifier snapshot 9.
## Phase 4 evidence — moderator (2026-11-14, snapshot 9)

- `npm run verify:runtime` snapshot 9: **11/11 PASS** (runtime-litert 101 tests / 98 pass / 3 gated skips;
  extension-moderator-recipe 31/31). Full suite **3331 tests, 3309 pass, 0 fail, 22 skipped**;
  architecture + manifests green (16 packages).
- `npm run verify:phase4` (`scripts/verify-phase4.ts`), re-run first-hand by the verifier: the code-free
  package registers `classify_nsfw` and the real moderator.tflite scores a generated 512×384 PNG —
  `{isNSFW:true, score:0.569, threshold:0.5, policy:standard, quality:balanced, crops:4}` with all five
  region heads finite. CPU XNNPACK.
- **The E2E asserts wiring and shape only** (finite score, boolean decision, finite heads). A flat mid-grey
  image scores NSFW at 0.569 while black/white score 0.368/0.316 — out-of-distribution behaviour, recorded
  as a limitation in the skill and verification doc. This is not a moderation-accuracy claim; that needs
  labelled real images in both classes and a confusion matrix.
- Preprocessing is primary-sourced: `desert-ant-core` @ `baf4e6e3…`, Sources/Moderator/Preprocess.swift +
  Model.swift + Moderator.swift, with bit-exact Pillow-bilinear tap tests, crop geometry and mirror tests.

## Remaining Phase 4 candidates

`emo` (text → 812 emojis; custom Unigram tokenizer binary + FNV n-gram features), `gist` (text → 36 topics;
Unigram tokenizer + 8448-dim features), `ear` (audio → language ID; mel front end + window selection).
`tongue` (pure JS) and `voz` (ONNX) already run outside the runtime layer; `title`, `eye`, `face`, `schemer`,
`toxic`, `who` remain Apple-only or closed beta.
- Preprocessing was proven bit-exact outside the repo: a temporary Pillow 13.0.0 reference compared the
  PNG decode (589,824 bytes, 0 mismatches) and all 13 crops (fast 1, balanced 4, accurate 8 with mirrors;
  0 mismatches), with the exact windows recorded. A permanent golden test now pins decoded pixels and all
  13 tiles to Pillow sha256 values, so decoder/tap/geometry/channel-order drift fails.
- The flat mid-grey NSFW score is therefore model OOD behaviour, not preprocessing: black 0.368, white 0.316,
  blue 0.273, sky/ground 0.167–0.172 (SFW) versus grey 0.569 (identical at 1/4/8 crops because every crop is
  flat). The real test asserts shape, score=max(heads), threshold rule and determinism on grey (OOD, no class
  assertion) and asserts isNSFW=false on a synthetic sky/ground image.
- Deliberate default deviation: the upstream SDK's `Options` defaults to `accurate`; this tool defaults to
  `balanced` (4 crops) for latency. Callers can pass `accurate`; the schema and skill state the default.
- Final full suite: **3335 tests, 3312 pass, 1 fail, 22 skipped**; the single failure is the known
  `mcp-rate-limit.test.ts` timing flake (60 s window; 200 vs 429 under parallel load). Re-run alone:
  **14/14 pass, exit 0** — not a regression. `verify:runtime` gate 11/11, architecture and manifests green.
## ear (pinned) — spoken language identification

- HF `desert-ant-labs/ear`, revision `1e2148c0cc46130174ecf564c406e44931fca386`.
- `ear.tflite` 10,671,552 B sha256 `a19b43892abe53afba50122a861b10fd76f312a5027a5c659b0738081135feeb`;
  `ear_meta.json` 2,190 B, `languages.json` 628 B, `mel_filters.f32` 64,328 B (digests computed from
  the fetched bytes and recorded in the lock).
- Meta: 16 kHz mono, 30 s windows, recommended 3; STFT n_fft 400, hop 160, 80 mels, 3000 frames,
  Hann periodic, center=true, log10, clamp 1e-10, floor 8 decades below the peak, affine (x+4)/4;
  filterbank header `uint32 mels, uint32 bins, then mels*bins float32 LE, mel-major`;
  tflite input `mel` [1,80,3000], output `output_0` 103 logits; order = languages.json.
- Pipeline (primary source `Sources/Ear/Frontend.swift`, `Model.swift`, `Ear.swift`, `Languages.swift`):
  resample to 16 kHz; choose `recommended_windows` (3) 30 s windows by syllable-modulation score
  (RMS envelope at hop 160, one-pole 8 Hz minus 2 Hz band-pass, running sums); per window compute
  log-mel features and run the model; softmax and average probabilities across windows; fold aliases
  (tl→fil, nb→no, yue→zh), sum folded mass, top-5 candidates.
- Output: `{ language, confidence, isReliable, candidates: [{language, probability}], windows }`.
  `isReliable = top−runnerUp >= 0.25 && top not in {no,sv,da}` (`Ear.swift` reliableMargin).
- Processor `ear/mel-v1` in `@try-works/tool-mode-runtime-litert`; package `extension-ear-recipe`,
  tool `identify_language`, input `{audio_path, windows?}`.
## Phase 4 evidence — ear (2026-11-14)

- `extension-ear-recipe` (code-free): 30/30 tests; four assets pinned (ear.tflite 10,671,552 B,
  ear_meta.json 2,190 B, languages.json 628 B, mel_filters.f32 64,328 B) at revision
  `1e2148c0…`; contractSource desert-ant-core `baf4e6e3…` with Frontend/Model/Ear/Languages + AudioDSP
  STFT/Windowing + AudioIO resample line ranges.
- `ear/mel-v1` in runtime-litert: STFT 400/160 Hann center, 80-mel filterbank, log10/floor/affine,
  30 s window selection by syllable modulation, `mel` [1,80,3000] -> `output_0` 103 logits, softmax
  averaged over windows, aliases (yue→zh), isReliable margin 0.25 and not in {no,sv,da}. litert suite
  **141 tests (137 pass, 4 gated skips)**.
- `npm run verify:phase4:ear`: the code-free package registers `identify_language` and the real model
  returns `language:"en", confidence:0.309, isReliable:false, candidates:[en,ca,ms,sv,eu], windows:1`
  on a 3 s synthetic tone. **Wiring/shape only — not an accuracy result**; `isReliable:false` is the
  correct behaviour for an uninformative tone.
- Adjudicated label arithmetic: the artifact has **103** labels/logits; 102 canonical codes after the
  `yue→zh` fold (the README's '102 languages'); `tl`/`nb` do not exist in this label set, so those alias
  entries are recorded as no-ops.
- **Latency correction (task-24 reopened rev 6):** the real default 3-window ear call is 98.97 s on this
  Windows/WASM/XNNPACK host (~33 s per 30 s window), so the recipe timeout was raised 120000 → 300000 ms
  (a default call must not sit within 20% of the host timeout). Only the recipe limit, its pinned test and a
  SKILL latency line changed; package tests remain 30/30.
- Post-ear full suite: **3405 tests, 3382 pass, 0 fail, 23 skipped**; architecture + manifests green (17 packages).
## emo (pinned) — emoji suggestions (812 labels)

- HF `desert-ant-labs/emo`, revision `7c2e137cb0300ecf8e31b7deab4c4e9734d06b74`.
- `emo.tflite` 10,222,736 B sha256 `2c382e8da94bab64172c0694b0350abb96829bf89eb623008ed0085128621de2`;
  `emo_tokenizer.bin` 733,197 B sha256 `f54462a7a2344f15c9430ed4e399c49444f890dd6094c745a0c5391690bf019d`;
  `emo_meta.json` 6,280 B sha256 `a3143258ac4099de65367cd4598073f1f5ce94f0eb505a30331762619967d3f6`.
- Meta constants: labels 812; n_hashes 3; n_buckets 44,000; n_importance 16,000; sem_pad_index 48,000;
  fmax 512; smax 64; sem_dim 128.
- Two front ends, both host-side (primary source `Sources/Emo/Tokenizer.swift`, `Model.swift`, `EmoMeta.swift`):
  1. **SemTokenizer** (`Tokenizer.swift` — EMTK binary): magic `EMTK`, offset 6, u32 unkID, u32 k,
     k float32 scores, k uint16 piece lengths, then UTF-8 pieces back to back; Viterbi over scalars
     (maxLen ≤ 24) on NFKC-lowercased text prefixed with `▁`, spaces→`▁`, unknown fallback with the unk
     score; output ≤ smax ids padded with sem_pad_index and an f32 mask (empty text keeps one unmasked pad).
  2. **NGram hashing** (`Tokenizer.swift` `NGram.encode`): FNV-64 feature hashing with the five bucket
     seeds, importance seed `0xFF51AFD7ED558CCD`, per-script feature extraction (word + char n-grams for
     Latin, cluster/Indic, CJK/Jamo, SEA), fmax=512 features, 3 hashes each; buckets int32 [1,512,3],
     signs f32, importance int32 [1,512], count f32 [1,1] = max(nf,1).
- Model tensors (`Model.swift`): `ngram_buckets`, `ngram_signs`, `ngram_importance`, `ngram_count`,
  `sem_ids`, `sem_mask` → `probabilities` (812).
- Processor `emo/text-v1` in `@try-works/tool-mode-runtime-litert`; package `extension-emo-recipe`,
  tool `suggest_emojis`, input `{text, limit?}` (limit default 5, max 20), output
  `{suggestions: [{emoji, confidence}], labels: number}`.
- Real gate: `pay my bills` should surface money/paperwork emoji in the top suggestions (semantic sanity
  observed and recorded, not asserted as accuracy); determinism asserted.
- Honest risk: exact Swift↔JS equivalence of NFKC and the per-script n-gram rules is NOT independently
  proven (no ground-truth tokenizer vectors); tests pin parser invariants and our own vectors, and the
  skill must say emoji relevance is a suggestion, not a promise.
## Phase 4 evidence — emo (2026-11-14)

- `extension-emo-recipe` (code-free): 31/31 tests; three assets pinned first-hand (emo.tflite 10,222,736 B,
  emo_tokenizer.bin 733,197 B, emo_meta.json 6,280 B) at revision `7c2e137c…`; contractSource
  desert-ant-core `baf4e6e3…` with Tokenizer/Model/EmoMeta/Emo line ranges.
- `emo/text-v1` in runtime-litert: EMTK tokenizer parser, Viterbi encoder (NFKC, ▁ prefix), FNV-64 n-gram
  featurizer with per-script rules, six tensors (ngram buckets/signs/importance/count, sem ids/mask),
  softmax over 812 labels from emo_meta.json. litert suite **167 tests (162 pass, 5 gated skips)**.
- `npm run verify:phase4:emo`: the code-free package registers `suggest_emojis` and the real model returns
  for 'pay my bills' — 💰 0.654, 📄 0.105, 💳 0.044, 💶 0.034, 🏠 0.020 (labels 812). The E2E asserts
  shape/finite/label-count only, NOT accuracy; the money-related top suggestion is a **semantic sanity
  signal**, consistent with the vendor's own example, not an accuracy metric.
- Honest limits: Swift↔JS NFKC and per-script featurizer equivalence is not independently proven (no
  ground-truth tokenizer vectors); the skill says suggestions are not promises, confidence is uncalibrated,
  and v1 applies no skin-tone variant.
- Emo final gate: **3462 tests, 3438 pass, 0 fail, 24 skipped**; architecture and manifests green
  (18 packages). `verify-runtime` **13/13 PASS** including extension-emo-recipe.
- Emo latency measured: ~0.5 s model time, 1.16 s full invoke after tensor packing, ~5 s per-process WASM
  warm-up — so `timeoutMs: 120000` is ample (no ear-style change needed); second run byte-identical.
## gist — NOT ported: no published preprocessing contract (evidence, not a guess)

Gist is the last Phase 4 candidate and it cannot be implemented under this project's provenance rule
with the sources available today:

- `desert-ant-core` main has **no `Sources/Gist`** (tree checked 2026-11-14; every other model ported here
  had its preprocessing in that repository).
- The HF card documents only I/O and the broad architecture: text in, `features [1,8448]` → 36 topics;
  "static embedding + hashed n-grams, no transformer"; `gist_embedding.i8` (66,905,344 B) + a `.json`
  sidecar is the semantic feature extractor. It does **not** define token pooling, the n-gram hashing
  parameters, quantisation scales, or the 8448 layout.
- The demo space delegates to the SDK (`Gist.load()` → `classify()`), so it carries no reference code.
- The npm package (`@desert-ant-labs/gist` 4.3.0) ships WASM (`dist/GistWeb.wasm`) plus native libraries
  and thin JS glue; the preprocessing is compiled, not readable source.

Porting from WASM disassembly or inventing the 8448 feature layout would violate the same rule that made
clear, moderator, ear and emo trustworthy: **the contract comes from a primary source, or it is not
implemented**. Consequence: Phases 0–3 and the four Phase-4 models with primary sources are done; gist is
an explicit, evidenced exclusion rather than a silent gap. It can be added the day the vendor publishes
`Sources/Gist` (or a documented feature contract).
## Repo-level verification (2026-11-14, complete)

- `verify:static` **0** — typecheck (19 packages), build, `verify:built` (real `lang_detect` inference),
  architecture, verification, traceability (227 requirements / 90 acceptance tests up to date).
- `verify:docs` was **1** on stale generated references (`models.md`, `tools.md`) after the new packages;
  `node scripts/gen-user-docs.mjs` regenerated them and `verify:docs` is now **0** (22 pages, README coverage).
- `verify:mcp` **0**, `verify:manifests` **0** (18 packages), `verify:packed` **0** — the packed host and
  extension tarballs install into a clean project and `lang_detect` infers `de` with no workspace junction.
- That covers every component of `npm run verify`; the only known intermittent failure remains the
  `mcp-rate-limit` timing test, which passes standalone.
- Re-checked 2026-11-14 (third consecutive round): `desert-ant-core` main still has **no `Sources/Gist`**; the
  card still documents only I/O and the two-stream architecture (no pooling, hashing parameters,
  quantisation scales or 8448 layout). The sidecar `gist_embedding.json` is only
  `{vocab_size: 261349, dim: 256, scale: 1.0, normalize: true}` — 8448 = 33 × 256 hints at a 33-slot layout
  but does not define how slots, hashed n-grams and pooling combine. That is not a contract; implementing it
  would be a guess, so gist is recorded as blocked on the missing published preprocessing contract.
