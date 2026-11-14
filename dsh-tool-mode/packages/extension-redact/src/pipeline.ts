/**
 * The redact pipeline: tokenize, window, infer, decode, union the deterministic layer,
 * resolve overlaps, and report coverage.
 *
 * It is an Effect over injected ports (tokenizer + LitertSession), so the whole pipeline is
 * unit-testable with a fake tokenizer and a fake session, while the real test drives the
 * same function through the SDK provider.
 *
 * @module @try-works/extension-redact/pipeline
 */

import { Effect } from 'effect'

import {
  InferenceFailed,
  InvalidInput,
  type RuntimeResult,
} from '@try-works/tool-mode-runtime-core'
import type { LitertFeed, LitertSessionApi } from '@try-works/tool-mode-runtime-litert'
import {
  REDACT_MAX_LENGTH,
  REDACT_MAX_WINDOWS,
  REDACT_MIN_SCORE,
  REDACT_STRIDE,
  decodeBioes,
  deterministicPii,
  mergeSpans,
  windows,
  type Span as ProcessorSpan,
} from '@try-works/tool-mode-runtime-processors'

import {
  coverageOf,
  filterModelSpans,
  padWindow,
  spansFromMerged,
  windowTokenOffsets,
  type SpanLike,
} from './pure.ts'
import type { RedactTokenizer } from './tokenizer.ts'

/** The provider id reported in engine failures. */
const PROVIDER = 'litert'

/** The model's fixed input names; the compiled graph is the authority, checked at run time. */
const INPUT_IDS = 'input_ids'
const ATTENTION_MASK = 'attention_mask'

/** Processing policy for one deployment. */
export interface RedactPolicy {
  /** Probability floor a token must clear before it can contribute to a span. */
  readonly minScore: number
  /** Maximum windows the local pipeline processes per request. */
  readonly maxWindows: number
  /** Model input length in tokens, special pair included. */
  readonly maxLength: number
  /** Content tokens advanced between window starts. */
  readonly stride: number
  /** Model labels withheld by policy (ORG disabled, IMEI deterministic-only). */
  readonly disabledModelLabels: ReadonlySet<string>
}

/** The pinned policy from docs/runtime/PLAN.md and the model's own meta file. */
export const DEFAULT_REDACT_POLICY: RedactPolicy = {
  minScore: REDACT_MIN_SCORE,
  maxWindows: REDACT_MAX_WINDOWS,
  maxLength: REDACT_MAX_LENGTH,
  stride: REDACT_STRIDE,
  disabledModelLabels: new Set(['ORG', 'IMEI']),
}

/** What the pipeline needs. */
export interface PipelineDeps {
  readonly tokenizer: RedactTokenizer
  readonly session: LitertSessionApi
  /** The model's id2label table, O first, in the head's index order. */
  readonly labels: readonly string[]
  /** The <pad> token id used to fill a short window. */
  readonly padId: number
  readonly policy: RedactPolicy
}

/** A short, always-defined description of a thrown or failed value. */
function describeFailure(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null) {
    const record = cause as { reason?: unknown; message?: unknown; _tag?: unknown }
    if (typeof record.reason === 'string' && record.reason.length > 0) return record.reason
    if (typeof record.message === 'string' && record.message.length > 0) return record.message
    if (typeof record._tag === 'string' && record._tag.length > 0) return record._tag
  }
  if (cause instanceof Error) return cause.message.length > 0 ? cause.message : cause.name
  if (typeof cause === 'string') return cause
  return String(cause)
}

/** One engine failure, carrying the phase that broke. */
function failed(phase: 'load' | 'run' | 'post', message: string, cause?: unknown): InferenceFailed {
  const detail = cause === undefined ? message : message + ': ' + describeFailure(cause)
  return new InferenceFailed({ provider: PROVIDER, phase, message: detail })
}

/** Build the named feeds the compiled model declares, refusing an unexpected input set. */
export function feedsForNames(
  inputNames: readonly string[],
  padded: { readonly ids: Int32Array; readonly mask: Int32Array },
  maxLength: number,
): Record<string, LitertFeed> {
  const names = new Set(inputNames)
  if (inputNames.length !== 2 || !names.has(INPUT_IDS) || !names.has(ATTENTION_MASK)) {
    throw new Error(
      'the redact model declares inputs [' + inputNames.join(', ') + ']; exactly '
      + INPUT_IDS + ' and ' + ATTENTION_MASK + ' are expected',
    )
  }
  const dims: readonly number[] = [1, maxLength]
  return {
    [INPUT_IDS]: { data: padded.ids, dims },
    [ATTENTION_MASK]: { data: padded.mask, dims },
  }
}

/** Pick the single logits output and check it matches the declared geometry. */
export function logitsFor(
  outputs: Readonly<Record<string, Float32Array>>,
  tokens: number,
  labels: number,
): Float32Array {
  const named = outputs.logits
  const values = Object.values(outputs)
  const logits = named ?? (values.length === 1 ? values[0] : undefined)
  if (logits === undefined) {
    throw new Error(
      'the model produced ' + String(values.length) + ' outputs [' + Object.keys(outputs).join(', ')
      + ']; one logits output is expected',
    )
  }
  const expected = tokens * labels
  if (logits.length !== expected) {
    throw new Error(
      'the logits output has ' + String(logits.length) + ' values but ' + String(tokens) + ' tokens x '
      + String(labels) + ' labels is ' + String(expected),
    )
  }
  return logits
}

/** Read the model-label policy out of redact_meta.json; unknown arrays are ignored. */
export function policyFromMeta(value: unknown): RedactPolicy {
  const disabled = new Set<string>(DEFAULT_REDACT_POLICY.disabledModelLabels)
  if (typeof value === 'object' && value !== null) {
    const meta = value as { default_disabled_labels?: unknown; deterministic_labels?: unknown }
    addLabels(meta.default_disabled_labels, disabled)
    addLabels(meta.deterministic_labels, disabled)
  }
  return {
    minScore: DEFAULT_REDACT_POLICY.minScore,
    maxWindows: DEFAULT_REDACT_POLICY.maxWindows,
    maxLength: DEFAULT_REDACT_POLICY.maxLength,
    stride: DEFAULT_REDACT_POLICY.stride,
    disabledModelLabels: disabled,
  }
}

/** Add every non-empty string in an unknown array to a label set. */
function addLabels(value: unknown, target: Set<string>): void {
  if (!Array.isArray(value)) return
  for (const label of value) {
    if (typeof label === 'string' && label.length > 0) target.add(label)
  }
}

/**
 * Run the full redaction pipeline over one text.
 *
 * @param deps - tokenizer, model session, label table and policy.
 * @param text - the caller's text; offsets are UTF-16 indices into it.
 * @returns the detected spans and an honest coverage report.
 */
export function runRedactPipeline(
  deps: PipelineDeps,
  text: string,
): Effect.Effect<RuntimeResult, InvalidInput | InferenceFailed> {
  return Effect.gen(function* () {
    if (typeof text !== 'string' || text.length === 0) {
      return yield* Effect.fail(new InvalidInput({ field: 'text', message: 'text must be a non-empty string' }))
    }

    const tokens = yield* Effect.tryPromise({
      try: () => deps.tokenizer.encode(text),
      catch: (cause) => failed('run', 'the redact tokenizer failed', cause),
    })
    if (tokens.ids.length !== tokens.mask.length || tokens.ids.length !== tokens.offsets.length) {
      return yield* Effect.fail(
        failed(
          'post',
          'the tokenizer returned inconsistent ids, mask and offsets ('
          + String(tokens.ids.length) + '/' + String(tokens.mask.length) + '/'
          + String(tokens.offsets.length) + ')',
        ),
      )
    }

    const allWindows = yield* Effect.try({
      try: () =>
        windows(tokens.ids, tokens.mask, { maxLength: deps.policy.maxLength, stride: deps.policy.stride }),
      catch: (cause) => failed('post', 'the token windows could not be built', cause),
    })
    const selected = allWindows.slice(0, deps.policy.maxWindows)

    const decoded: ProcessorSpan[] = []
    for (const [index, window] of selected.entries()) {
      const padded = yield* Effect.try({
        try: () => padWindow(window.ids, window.mask, deps.padId, deps.policy.maxLength),
        catch: (cause) => failed('post', 'window ' + String(index) + ' could not be padded', cause),
      })
      const feeds = yield* Effect.try({
        try: () => feedsForNames(deps.session.inputNames, padded, deps.policy.maxLength),
        catch: (cause) => failed('run', 'window ' + String(index) + ' feeds could not be built', cause),
      })
      const outputs = yield* deps.session
        .run(feeds)
        .pipe(Effect.mapError((cause) => failed('run', 'window ' + String(index) + ' inference failed', cause)))
      const logits = yield* Effect.try({
        try: () => logitsFor(outputs, deps.policy.maxLength, deps.labels.length),
        catch: (cause) => failed('post', 'window ' + String(index) + ' output is unusable', cause),
      })
      const offsets = yield* Effect.try({
        try: () =>
          windowTokenOffsets(
            tokens.offsets,
            window.startToken,
            window.ids.length - 2,
            deps.policy.maxLength,
          ),
        catch: (cause) => failed('post', 'window ' + String(index) + ' offsets could not be aligned', cause),
      })
      const windowSpans = yield* Effect.try({
        try: () =>
          decodeBioes(
            logits,
            { tokens: deps.policy.maxLength, labels: deps.labels.length },
            deps.labels,
            offsets,
            deps.policy.minScore,
          ),
        catch: (cause) => failed('post', 'window ' + String(index) + ' BIOES decode failed', cause),
      })
      decoded.push(...filterModelSpans(windowSpans, deps.policy.disabledModelLabels))
    }

    const deterministic = yield* Effect.try({
      try: () => deterministicPii(text),
      catch: (cause) => failed('post', 'deterministic PII detection failed', cause),
    })
    const deterministicSpans: SpanLike[] = deterministic.map((span) => ({
      start: span.start,
      end: span.end,
      label: span.label,
      score: span.score,
    }))
    const merged = mergeSpans([...decoded, ...deterministicSpans])

    return {
      spans: spansFromMerged(merged, text),
      coverage: coverageOf(
        tokens.ids.length,
        allWindows.length,
        selected.length,
        deps.policy.maxWindows,
        deps.policy.maxLength,
        deps.policy.stride,
      ),
    }
  })
}
