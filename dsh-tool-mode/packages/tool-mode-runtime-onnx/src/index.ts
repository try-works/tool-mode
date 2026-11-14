/**
 * `@try-works/tool-mode-runtime-onnx` — the ONNX Runtime engine for the local model
 * runtime (Phase 3).
 *
 * Public surface:
 * - `OnnxSession` / `onnxLayer` / `createNodeOnnxLoader` — the Effect service over one
 *   onnxruntime-node session, with execution-provider negotiation.
 * - `createProviderFromRecipe` — the factory a code-free model recipe names. This build
 *   implements two processors:
 *   - `uhm/waveform-v1`: filler-word detection (WAV in, filler spans out);
 *   - `clear/stft-v1`: DeepFilterNet3 enhancement (WAV in, enhanced base64 WAV out, bound
 *     by the host result budget).
 * - the uhm and clear building blocks the processors are made of, exported so a later
 *   processor can reuse them (the clear DSP is a published contract, not an internal).
 * - `InferenceFailed` / `InvalidInput` / `RuntimeUnavailable` — the typed failures.
 *
 * @module @try-works/tool-mode-runtime-onnx
 */

export { InferenceFailed, InvalidInput, RuntimeUnavailable, describeCause } from './errors.ts'
export { CLEAR_STFT_PROCESSOR, type ClearBinding } from './clear-processor.ts'
export {
  CLEAR_CHUNK_FRAMES,
  CLEAR_ERB_WIDTHS,
  CLEAR_FFT_SIZE,
  CLEAR_HOP_SIZE,
  CLEAR_LOOKAHEAD,
  CLEAR_MAX_GAIN_DB,
  CLEAR_N_DF,
  CLEAR_N_ERB,
  CLEAR_N_FREQ,
  CLEAR_NORM_ALPHA,
  CLEAR_OUTPUT_ENVELOPE_BYTES,
  CLEAR_PEAK_CEILING_DBTP,
  CLEAR_SAMPLE_RATE,
  CLEAR_TARGET_LUFS,
  CLEAR_WAV_HEADER_BYTES,
  ClearStft,
  clearChunkInputs,
  clearFeatures,
  encodePcm16Wav,
  integratedLufs,
  limitInPlace,
  maxSamplesForResultBudget,
  normalizeLoudnessInPlace,
  scatterEnhanced,
  vorbisWindow,
  type ClearChunkInputRequest,
  type ClearChunkInputs,
  type ClearFeatures,
  type ClearLoudnessOptions,
  type ClearScatterRequest,
  type ClearSpectrum,
} from './clear-dsp.ts'
export {
  UHM_CLASS_COUNT,
  UHM_FILLER_THRESHOLD,
  UHM_FILLER_TYPES,
  UHM_LABELS_FILE,
  parseUhmLabels,
  uhmResultFromWindows,
  type UhmCoverage,
  type UhmFillerType,
  type UhmLabelsParseResult,
  type UhmResult,
  type UhmResultInput,
  type UhmSpan,
  type UhmWindowRun,
} from './frames.ts'
export { createProviderFromRecipe, type ProviderFactoryOptions } from './provider-factory.ts'
export {
  OnnxSession,
  createNodeOnnxLoader,
  onnxLayer,
  selectExecutionProvider,
  type OnnxBackend,
  type OnnxExecutionProvider,
  type OnnxFeed,
  type OnnxLayerOptions,
  type OnnxLoadOptions,
  type OnnxLoadedSession,
  type OnnxOutputData,
  type OnnxSessionApi,
  type OnnxSessionLoader,
  type OnnxTensor,
  type ProviderSelection,
} from './runtime.ts'
export { UHM_WAVEFORM_PROCESSOR, type UhmBinding } from './uhm-processor.ts'
export {
  UHM_FRAME_MS,
  UHM_FRAME_SAMPLES,
  UHM_HOP_SAMPLES,
  UHM_OVERLAP_SAMPLES,
  UHM_SAMPLE_RATE,
  UHM_WINDOW_SAMPLES,
  decodeWav,
  resampleLinear,
  windowsOf,
  type AudioWindow,
  type WavAudio,
  type WavDecodeResult,
  type WindowGeometry,
} from './wav.ts'
