/**
 * Processor `clear/stft-v1`: DeepFilterNet3 speech enhancement (Phase 3, after uhm).
 *
 * The graph takes HOST-COMPUTED features (`spec`, `feat_erb`, `feat_spec`) and returns
 * `spec_enhanced`; the DSP that computes and inverts them is `clear-dsp.ts`, pinned to the
 * primary source. This module is the pipeline: window the spectrum, run the model per
 * 200-frame chunk, overlap-add, master, encode a WAV under the host's result budget.
 *
 * OUTPUT IS BYTES, NOT A PATH. InvocationContextV1 has no writable path (resolvePath
 * grants reads), so the enhanced audio travels back as base64 WAV and the caller writes it.
 *
 * @module clear-processor
 */

import { Effect } from 'effect'

import {
  CLEAR_CHUNK_FRAMES,
  CLEAR_N_DF,
  CLEAR_N_ERB,
  CLEAR_N_FREQ,
  CLEAR_SAMPLE_RATE,
  ClearStft,
  clearChunkInputs,
  clearFeatures,
  encodePcm16Wav,
  maxSamplesForResultBudget,
  normalizeLoudnessInPlace,
  scatterEnhanced,
} from './clear-dsp.ts'
import { InferenceFailed, InvalidInput, describeCause } from './errors.ts'
import type { ProcessorDefinition } from './processor.ts'

/** The recipe processor id this module implements. */
export const CLEAR_STFT_PROCESSOR = 'clear/stft-v1'

const PROVIDER = 'onnx'

/** The three input tensor names the pinned graph exposes (verified on the artifact). */
const REQUIRED_INPUTS = ['spec', 'feat_erb', 'feat_spec'] as const

/** The output tensor name the pinned graph exposes. */
const REQUIRED_OUTPUT = 'spec_enhanced'

/** The graph binding the provider proves at load time. */
export interface ClearBinding {
  readonly spec: string
  readonly featErb: string
  readonly featSpec: string
  readonly output: string
}

/**
 * The clear processor definition.
 *
 * @returns the definition the provider factory dispatches to
 */
export function clearProcessor(): ProcessorDefinition<void, ClearBinding> {
  return {
    id: CLEAR_STFT_PROCESSOR,
    sampleRate: CLEAR_SAMPLE_RATE,
    loadSidecar: async () => undefined,
    bindGraph: (names) => {
      const missing = REQUIRED_INPUTS.filter((name) => !names.inputs.includes(name))
      if (missing.length > 0) {
        return {
          ok: false,
          reason:
            'the clear graph is missing the input tensor(s) '
            + missing.join(', ')
            + '; it exposes '
            + (names.inputs.join(', ') || 'none'),
        }
      }
      if (!names.outputs.includes(REQUIRED_OUTPUT)) {
        return {
          ok: false,
          reason:
            'the clear graph has no ' + REQUIRED_OUTPUT + ' output; it exposes ' + (names.outputs.join(', ') || 'none'),
        }
      }
      return { ok: true, value: { spec: 'spec', featErb: 'feat_erb', featSpec: 'feat_spec', output: REQUIRED_OUTPUT } }
    },
    invoke: (request) =>
      Effect.gen(function* () {
        const audio = request.audio.samples
        if (audio.length === 0) {
          return yield* Effect.fail(
            new InvalidInput({ field: 'audio_path', message: 'the audio has no samples to enhance' }),
          )
        }
        // Bound the work by the HOST's result budget, not by an invented fixed duration:
        // base64 is 4/3 of the WAV, and the response must serialize within maxResultBytes.
        const maxSamples = maxSamplesForResultBudget(request.context.limits.maxResultBytes)
        if (maxSamples < 1) {
          return yield* Effect.fail(
            new InvalidInput({
              field: 'input',
              message:
                'the host result budget of '
                + String(request.context.limits.maxResultBytes)
                + ' bytes cannot hold an enhanced WAV',
            }),
          )
        }
        const processedSamples = Math.min(audio.length, maxSamples)

        const stft = new ClearStft()
        const spectrum = stft.forward(audio.subarray(0, processedSamples))
        const features = clearFeatures(spectrum.real, spectrum.imag, spectrum.nFrames)
        const outReal = new Float32Array(spectrum.real.length)
        const outImag = new Float32Array(spectrum.imag.length)
        const chunkCount = Math.ceil(spectrum.nFrames / CLEAR_CHUNK_FRAMES)
        for (let chunk = 0; chunk < chunkCount; chunk += 1) {
          const start = chunk * CLEAR_CHUNK_FRAMES
          const inputs = clearChunkInputs({
            specReal: spectrum.real,
            specImag: spectrum.imag,
            featErb: features.featErb,
            featSpecReal: features.featSpecReal,
            featSpecImag: features.featSpecImag,
            nFrames: spectrum.nFrames,
            start,
          })
          const outputs = yield* request.engine.run({
            [request.binding.spec]: {
              data: inputs.spec,
              dims: [1, 1, CLEAR_CHUNK_FRAMES, CLEAR_N_FREQ, 2],
            },
            [request.binding.featErb]: {
              data: inputs.featErb,
              dims: [1, 1, CLEAR_CHUNK_FRAMES, CLEAR_N_ERB],
            },
            [request.binding.featSpec]: {
              data: inputs.featSpec,
              dims: [1, 1, CLEAR_CHUNK_FRAMES, CLEAR_N_DF, 2],
            },
          })
          const output = outputs[request.binding.output]
          if (output === undefined) {
            return yield* Effect.fail(
              new InferenceFailed({
                provider: PROVIDER,
                phase: 'post',
                message: 'the graph produced no output named ' + JSON.stringify(request.binding.output),
              }),
            )
          }
          if (!(output.data instanceof Float32Array)) {
            return yield* Effect.fail(
              new InferenceFailed({
                provider: PROVIDER,
                phase: 'post',
                message: 'the graph output ' + JSON.stringify(request.binding.output) + ' is not a float32 tensor',
              }),
            )
          }
          if (output.data.length < CLEAR_CHUNK_FRAMES * CLEAR_N_FREQ * 2) {
            return yield* Effect.fail(
              new InferenceFailed({
                provider: PROVIDER,
                phase: 'post',
                message:
                  'the graph output ' + JSON.stringify(request.binding.output) + ' has '
                  + String(output.data.length) + ' values; a full window needs ' + String(CLEAR_CHUNK_FRAMES * CLEAR_N_FREQ * 2),
              }),
            )
          }
          scatterEnhanced({
            enhanced: output.data,
            chunkFrames: CLEAR_CHUNK_FRAMES,
            start,
            validFrames: inputs.validFrames,
            outReal,
            outImag,
          })
        }

        const enhanced = stft.inverse(outReal, outImag, spectrum.nFrames)
        const delivered = enhanced.subarray(0, processedSamples)
        // The loudness stage needs a measurable programme; a short or silent signal is left
        // as the model returned it (the reference behaves the same).
        yield* Effect.try({
          try: () => {
            normalizeLoudnessInPlace(delivered)
          },
          catch: (cause) => new InferenceFailed({ provider: PROVIDER, phase: 'post', message: describeCause(cause) }),
        })
        const wav = encodePcm16Wav(delivered, CLEAR_SAMPLE_RATE)
        const durationSeconds = processedSamples / CLEAR_SAMPLE_RATE
        const coverageBase = {
          complete: processedSamples === audio.length,
          processedSeconds: durationSeconds,
          totalSeconds: request.audio.sourceDurationSeconds,
        }
        const audioBase64 = Buffer.from(wav).toString('base64')
        if (processedSamples === audio.length) {
          return { audio_base64: audioBase64, sampleRate: CLEAR_SAMPLE_RATE, durationSeconds, coverage: coverageBase }
        }
        return {
          audio_base64: audioBase64,
          sampleRate: CLEAR_SAMPLE_RATE,
          durationSeconds,
          coverage: {
            ...coverageBase,
            reason:
              'the '
              + String(request.context.limits.maxResultBytes)
              + '-byte result budget caps the enhanced audio at '
              + String(processedSamples)
              + ' of '
              + String(audio.length)
              + ' samples',
          },
        }
      }),
  }
}
