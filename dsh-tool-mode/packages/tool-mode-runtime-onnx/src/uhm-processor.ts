/**
 * Processor `uhm/waveform-v1`: filler-word detection (Phase 3, the first model).
 *
 * The pipeline is `frames.ts` + `wav.ts`; this module is only the processor seam: the
 * labels sidecar, the one-input/one-output graph binding, and the window loop.
 *
 * @module uhm-processor
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { Effect } from 'effect'

import type { JsonObject } from '@try-works/tool-mode-extension-sdk'

import { InferenceFailed, RuntimeUnavailable, describeCause } from './errors.ts'
import {
  UHM_LABELS_FILE,
  parseUhmLabels,
  uhmResultFromWindows,
  type UhmResult,
  type UhmWindowRun,
} from './frames.ts'
import type { ProcessorDefinition } from './processor.ts'
import { UHM_SAMPLE_RATE, UHM_WINDOW_SAMPLES, windowsOf } from './wav.ts'

/** The recipe processor id this module implements. */
export const UHM_WAVEFORM_PROCESSOR = 'uhm/waveform-v1'

const PROVIDER = 'onnx'

/** The graph binding the provider proves at load time. */
export interface UhmBinding {
  readonly inputName: string
  readonly outputName: string
}

/** Read and validate the pinned labels document beside the model artifact. */
async function readLabels(directory: string): Promise<readonly string[]> {
  const labelsPath = path.join(directory, UHM_LABELS_FILE)
  let text: string
  try {
    text = await readFile(labelsPath, 'utf8')
  } catch (cause) {
    throw new RuntimeUnavailable({
      provider: PROVIDER,
      reason: 'the uhm labels file "' + UHM_LABELS_FILE + '" cannot be read from the prepared asset directory: ' + describeCause(cause),
    })
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (cause) {
    throw new RuntimeUnavailable({
      provider: PROVIDER,
      reason: 'the uhm labels file "' + UHM_LABELS_FILE + '" is not valid JSON: ' + describeCause(cause),
    })
  }
  const parsed = parseUhmLabels(raw)
  if (!parsed.ok) {
    throw new RuntimeUnavailable({
      provider: PROVIDER,
      reason: 'the uhm labels file "' + UHM_LABELS_FILE + '" cannot be used: ' + parsed.reason,
    })
  }
  return parsed.labels
}

/** Map the uhm result onto the tool output contract. */
function payloadOf(result: UhmResult): JsonObject {
  const fillers: JsonObject[] = result.fillers.map((span) => ({
    startMs: span.startMs,
    endMs: span.endMs,
    type: span.type,
    confidence: span.confidence,
  }))
  const coverage = {
    complete: result.coverage.complete,
    processedSeconds: result.coverage.processedSeconds,
    totalSeconds: result.coverage.totalSeconds,
  }
  if (result.coverage.reason !== undefined) {
    return { fillers, coverage: { ...coverage, reason: result.coverage.reason } }
  }
  return { fillers, coverage }
}

/**
 * The uhm processor definition.
 *
 * @returns the definition the provider factory dispatches to
 */
export function uhmProcessor(): ProcessorDefinition<readonly string[], UhmBinding> {
  return {
    id: UHM_WAVEFORM_PROCESSOR,
    sampleRate: UHM_SAMPLE_RATE,
    loadSidecar: readLabels,
    bindGraph: (names) => {
      const inputName = names.inputs[0]
      const outputName = names.outputs[0]
      if (names.inputs.length !== 1 || inputName === undefined || outputName === undefined) {
        return {
          ok: false,
          reason:
            'the uhm graph must expose exactly one input and at least one output; it exposes '
            + String(names.inputs.length)
            + ' input(s) ('
            + (names.inputs.join(', ') || 'none')
            + ') and '
            + String(names.outputs.length)
            + ' output(s)',
        }
      }
      return { ok: true, value: { inputName, outputName } }
    },
    invoke: (request) =>
      Effect.gen(function* () {
        const windows = windowsOf(request.audio.samples)
        const runs: UhmWindowRun[] = []
        for (const window of windows) {
          const outputs = yield* request.engine.run({
            [request.binding.inputName]: { data: window.samples, dims: [1, UHM_WINDOW_SAMPLES] },
          })
          const output = outputs[request.binding.outputName]
          if (output === undefined) {
            return yield* Effect.fail(
              new InferenceFailed({
                provider: PROVIDER,
                phase: 'post',
                message: 'the graph produced no output named ' + JSON.stringify(request.binding.outputName),
              }),
            )
          }
          if (!(output.data instanceof Float32Array)) {
            return yield* Effect.fail(
              new InferenceFailed({
                provider: PROVIDER,
                phase: 'post',
                message: 'the graph output ' + JSON.stringify(request.binding.outputName) + ' is not a float32 tensor',
              }),
            )
          }
          runs.push({ window, data: output.data, dims: output.dims })
        }
        return yield* Effect.try({
          try: () => payloadOf(uhmResultFromWindows({ runs, totalSamples: request.audio.samples.length, labels: request.sidecar })),
          catch: (cause) => new InferenceFailed({ provider: PROVIDER, phase: 'post', message: describeCause(cause) }),
        })
      }),
  }
}
