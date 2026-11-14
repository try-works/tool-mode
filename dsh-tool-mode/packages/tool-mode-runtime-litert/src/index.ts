/**
 * `@try-works/tool-mode-runtime-litert` — a socket-free LiteRT.js runtime.
 *
 * Public surface:
 * - `installLitertFetchShim` / `resolveLitertWasmDir` — the proven node boot shim.
 * - `createNodeLitertBoot` — the real boot, or inject a fake `LitertBoot` in tests.
 * - `LitertSession` / `litertLayer` — the Effect service over one compiled model.
 * - `createProviderFromRecipe` — the Phase 2 factory a code-free model recipe names; it owns
 *   the engine and the processors this package implements (shapes/points-v1,
 *   moderator/crops-v1, ear/mel-v1 and emo/text-v1).
 * - `InferenceFailed` / `RuntimeUnavailable` — the typed failures.
 *
 * The redact extension calls `litertLayer({ wasmDir, modelBytes })` to provide
 * `LitertSession`; it never talks to `@litertjs/core` directly.
 */

/*
 * The anti-slop no-shape rule targets structural "shape" placeholders in type names. The
 * exported SHAPES_* constants and ShapesClass name the DOMAIN of the shapes/points-v1
 * processor (2D geometric shapes, and the tool schema's "shape" field), so the rule is
 * disabled for this file only.
 */
/* oxlint-disable anti-slop/no-shape-in-symbol-names */

export { InferenceFailed, RuntimeUnavailable } from '@try-works/tool-mode-runtime-core'
export { describeCause } from './errors.ts'
export {
  createLoadLiteRtGuard,
  createNodeLitertBoot,
  processLoadLiteRtGuard,
  type CompiledLitertModel,
  type LiteRtCompileOptions,
  type LiteRtCompiledModelLike,
  type LiteRtRuntimeModule,
  type LiteRtTensorDetail,
  type LiteRtTensorLike,
  type LitertBoot,
  type LitertFeed,
  type LitertLoadOptions,
  type LitertOutput,
  type LoadLiteRtGuard,
  type NodeLitertBootOptions,
} from './model.ts'
export {
  SHAPES_CLASSES,
  SHAPES_CLASS_COUNT,
  SHAPES_POINT_COUNT,
  SHAPES_POINTS_PROCESSOR,
  shapesPointsProcessor,
  type ShapesClass,
} from './shapes.ts'
export {
  MODERATOR_DEFAULT_POLICY,
  MODERATOR_DEFAULT_QUALITY,
  MODERATOR_DEFAULT_THRESHOLD,
  MODERATOR_HEADS,
  MODERATOR_POLICIES,
  MODERATOR_PROCESSOR,
  MODERATOR_QUALITIES,
  MODERATOR_SCORE_COUNT,
  MODERATOR_SIDE,
  moderatorCropsProcessor,
  type ModeratorHead,
  type ModeratorPolicy,
} from './moderator.ts'
export type { ModeratorQuality } from './pillow.ts'
export {
  EMO_DEFAULT_LIMIT,
  EMO_FMAX,
  EMO_LABEL_COUNT,
  EMO_MAX_LIMIT,
  EMO_MAX_TEXT_CHARACTERS,
  EMO_N_BUCKETS,
  EMO_N_HASHES,
  EMO_N_IMPORTANCE,
  EMO_PROCESSOR,
  EMO_SEM_PAD_INDEX,
  EMO_SMAX,
  emoTextProcessor,
} from './emo.ts'
export {
  EAR_CONFUSABLE_LANGUAGES,
  EAR_LANGUAGE_ALIASES,
  EAR_LANGUAGE_COUNT,
  EAR_MAX_WINDOWS,
  EAR_PROCESSOR,
  EAR_RELIABLE_MARGIN,
  earMelProcessor,
} from './ear.ts'
export {
  EAR_AFFINE_ADD,
  EAR_AFFINE_DIVIDE,
  EAR_BINS,
  EAR_CLAMP_MIN,
  EAR_DEFAULT_WINDOWS,
  EAR_FLOOR_DECADES,
  EAR_FRAMES,
  EAR_HANN,
  EAR_HOP,
  EAR_MELS,
  EAR_N_FFT,
  EAR_SAMPLE_RATE,
  EAR_WINDOW_SAMPLES,
} from './ear-frontend.ts'
export {
  createProviderFromRecipe,
  type ProviderFactoryOptions,
} from './provider-factory.ts'
export {
  LITERT_WASM_PREFIX,
  installLitertFetchShim,
  resolveLitertWasmDir,
  type LitertShim,
} from './shim.ts'
export {
  LitertSession,
  litertLayer,
  type LitertLayerOptions,
  type LitertOutputs,
  type LitertSessionApi,
} from './runtime.ts'
