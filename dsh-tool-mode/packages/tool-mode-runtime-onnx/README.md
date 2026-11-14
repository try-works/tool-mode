# @try-works/tool-mode-runtime-onnx

The ONNX Runtime engine for the Tool Mode local model runtime (Phase 3): one onnxruntime-node
session, shared by every processor this build implements.

## Engine

`onnxLayer({ modelBytes, accelerators, ... })` provides the `OnnxSession` Effect service. It
acquires one `onnxruntime-node` session in the layer scope (so a provider cannot leak a native
handle) and releases it when the scope closes. Execution providers are negotiated from the
recipe's declared lanes against what the installed engine reports as bundled — the first
declared lane that works wins, and there is no silent CPU fallback for a lane the recipe did
not declare. This host reports cpu, dml and webgpu as bundled (onnxruntime-node 1.30.0,
win32-x64).

## Provider factory

`createProviderFromRecipe(recipe, assets, options?)` is the factory a code-free
`model-runtime` recipe names. It owns the engine and the processor; the recipe supplies the
artifact, limits and tool schemas. The factory shares one lifecycle across processors (resolve
artifact, build session, validate graph tensor names, relay abort/timeout, dispose) and
dispatches on `processor.id`.

### `uhm/waveform-v1` — filler words

WAV decode (PCM 16-bit and float32, mono or stereo down-mix), linear resample to 16 kHz,
480000-sample windows with a 1 s overlap and a zero-padded final window, one run per window,
argmax per 20 ms frame, filler = class != 0 and probability >= 0.5, spans merged across window
overlap (one-frame gaps tolerated) and clipped to the audio length. Output:
`{ fillers: [{ startMs, endMs, type, confidence }], coverage: { complete, processedSeconds, totalSeconds, reason? } }`.
Reads `labels.json` beside the model.

### `clear/stft-v1` — speech enhancement

The pinned `clear-studio.onnx` graph takes HOST-COMPUTED features (`spec`, `feat_erb`,
`feat_spec`) and returns `spec_enhanced`; it is DeepFilterNet3. Every parameter is ported from
the primary source, **desert-ant-core commit `baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7`**:

- `Sources/Clear/DSP.swift` L31-46 (n_fft 960, hop 480, 481 bins, nErb 32, nDf 96,
  convLookahead 2, 48 kHz, normAlpha 0.99, ERB widths summing to 481), L271-302 (Vorbis window,
  forward gain 1/960, 480-sample prepad), L343-476 (framing, Hermitian mirror, unscaled inverse
  DFT, windowed COLA overlap-add);
- `Sources/Clear/Features.swift` L20-125 (ERB dB with the -60..-90 dB running-mean state ramp
  divided by 40; unit-norm of the first 96 complex bins with the 1e-3..1e-4 ramp);
- `Sources/Clear/Enhancer.swift` L55-73, L185-259 (200-frame windows, interleaved
  `[1,1,200,481,2]` / `[1,1,200,32]` / `[1,1,200,96,2]`, features read two frames ahead);
- `Sources/Clear/Clear.swift` L428-434, L478-494 (48 kHz, mono downmix, mastering);
- `Sources/AudioDSP/Loudness.swift` L24-27, L90-244, L264-285 (BS.1770-4 K-weighting, 400 ms
  blocks at 100 ms, -70/-10 gating, target -19 LUFS, +9 dB upward cap);
- `Sources/AudioDSP/Limiter.swift` L28-30, L169-198 (5 ms look-ahead, 50 ms release,
  -1.5 dBTP ceiling).

The descriptor is `{ audio_path }` only: there is no writable path in `InvocationContextV1`,
so the enhanced audio comes back as a base64 WAV. Output:
`{ audio_base64, sampleRate: 48000, durationSeconds, coverage: { complete, processedSeconds, totalSeconds, reason? } }`
— 16-bit PCM, mono, 48 kHz. The duration is capped by the HOST's `context.limits.maxResultBytes`
(`maxSamplesForResultBudget`); with the default 8 MiB budget that is 3,145,322 samples
(65.5275 s), and `coverage.complete` is false with a reason when the cap bites.

## Tests

`npm test` runs the unit suite: fake-session lifecycle, WAV/DSP parameter tests against the
primary source constants, the clear pipeline over an echo engine, and the response-budget
arithmetic. The real-inference gates are skipped unless `TOOL_MODE_REAL_ASSETS=1` and the
pinned assets exist under `.assets/uhm` and `.assets/clear`.
