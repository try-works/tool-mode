/**
 * The DeepFilterNet3 front end, chunk layout and mastering the clear graph depends on
 * (processor `clear/stft-v1`).
 *
 * THE GRAPH TAKES FEATURES, NOT A WAVEFORM: inputs `spec` (interleaved complex STFT),
 * `feat_erb` and `feat_spec` (DFN3 features computed here), output `spec_enhanced`. So
 * every constant below is part of the model contract, and a plausible-looking substitute
 * (1024-point FFT, Hann window, log-mel filterbank) is silent garbage rather than an error.
 *
 * PRIMARY SOURCE for every value, desert-ant-core commit
 * baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7:
 * - Sources/Clear/DSP.swift L31-46 (geometry, normAlpha, ERB widths), L271-302 (Vorbis
 *   window, wnorm, prepad), L343-476 (framing, mirror, overlap-add, prepad drop);
 * - Sources/Clear/Features.swift L20-125 (ERB dB, running normalization, unit-norm);
 * - Sources/Clear/Enhancer.swift L55-73, L185-259 (200-frame chunks, interleaved layout,
 *   the two-frame feature lookahead);
 * - Sources/Clear/Clear.swift L428-434, L478-494 (48 kHz, mono downmix, mastering);
 * - Sources/AudioDSP/Loudness.swift L24-27, L90-244, L264-285 (K-weighting, blocks,
 *   gating, gain cap);
 * - Sources/AudioDSP/Limiter.swift L28-30, L169-198 (look-ahead and release).
 *
 * The module is PURE: no I/O, no engine. `ClearStft` holds scratch buffers and is used
 * sequentially, like the reference.
 *
 * @module clear-dsp
 */

import { Dft960 } from './fft.ts'

/** The model's sample rate, in and out. */
export const CLEAR_SAMPLE_RATE = 48_000

/** STFT size (libDF / DFN3). */
export const CLEAR_FFT_SIZE = 960

/** STFT hop; half the window, so consecutive frames overlap by 50%. */
export const CLEAR_HOP_SIZE = 480

/** STFT bins (fftSize/2 + 1). */
export const CLEAR_N_FREQ = 481

/** ERB bands for feat_erb. */
export const CLEAR_N_ERB = 32

/** Complex bins kept for feat_spec. */
export const CLEAR_N_DF = 96

/** Feature lookahead: feat_erb/feat_spec frame t come from analysis frame t+2. */
export const CLEAR_LOOKAHEAD = 2

/** Frames per model window. */
export const CLEAR_CHUNK_FRAMES = 200

/** The running-normalization coefficient: round(exp(-hop/sr/tau), 3) with tau = 1 s. */
export const CLEAR_NORM_ALPHA = 0.99

/**
 * ERB band widths, fixed at training time: thirteen 2-bin bands, then 5, 5, 7, 7, 8, 10,
 * 12, 13, 15, 18, 20, 24, 28, 31, 37, 42, 50, 56, 67. Their sum is exactly nFreq.
 */
export const CLEAR_ERB_WIDTHS: readonly number[] = [
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  5, 5, 7, 7, 8, 10, 12, 13, 15, 18, 20,
  24, 28, 31, 37, 42, 50, 56, 67,
]

/** The SDK's default integrated-loudness target (Apple Podcasts). */
export const CLEAR_TARGET_LUFS = -19

/** Cap on upward loudness gain, so a quiet input does not lift the noise floor. */
export const CLEAR_MAX_GAIN_DB = 9

/** True-peak ceiling for the look-ahead limiter. */
export const CLEAR_PEAK_CEILING_DBTP = -1.5

/** WAV header size for 16-bit PCM. */
export const CLEAR_WAV_HEADER_BYTES = 44

/** JSON envelope allowance reserved beside audio_base64 in the result budget. */
export const CLEAR_OUTPUT_ENVELOPE_BYTES = 1024

/** The Vorbis window: sin(pi/2 * sin^2(pi/2 * (n+0.5)/halfN)), halfN = 480. */
const VORBIS_WINDOW = (() => {
  const window = new Float32Array(CLEAR_FFT_SIZE)
  const halfN = CLEAR_FFT_SIZE / 2
  for (let n = 0; n < CLEAR_FFT_SIZE; n += 1) {
    const s = Math.sin((0.5 * Math.PI * (n + 0.5)) / halfN)
    window[n] = Math.sin(0.5 * Math.PI * s * s)
  }
  return window
})()

/**
 * The analysis/synthesis window.
 *
 * @returns a copy, so a caller cannot change the transform for everyone
 */
export function vorbisWindow(): Float32Array {
  return Float32Array.from(VORBIS_WINDOW)
}

/** One windowed frame's spectrum. */
export interface ClearSpectrum {
  /** Frame-major real parts, `nFrames * 481`. */
  readonly real: Float32Array
  /** Frame-major imaginary parts, `nFrames * 481`. */
  readonly imag: Float32Array
  readonly nFrames: number
}

/**
 * The clear STFT: Vorbis window, n_fft 960, hop 480, 480-sample analysis prepad, forward
 * gain 1/960, unscaled inverse DFT and windowed COLA overlap-add.
 *
 * Holds one DFT and scratch buffers; use it sequentially.
 */
export class ClearStft {
  /** The transform size. */
  readonly fftSize = CLEAR_FFT_SIZE
  /** The hop size. */
  readonly hopSize = CLEAR_HOP_SIZE
  /** The number of bins kept. */
  readonly nFreq = CLEAR_N_FREQ
  private readonly dft = new Dft960()
  /** wnorm = 2*hop/fftSize^2 = 1/960: compensates the unscaled inverse DFT. */
  private readonly wnorm = (2 * CLEAR_HOP_SIZE) / (CLEAR_FFT_SIZE * CLEAR_FFT_SIZE)
  private readonly frame = new Float32Array(CLEAR_FFT_SIZE)
  private readonly fullReal = new Float32Array(CLEAR_FFT_SIZE)
  private readonly fullImag = new Float32Array(CLEAR_FFT_SIZE)
  private readonly timeReal = new Float32Array(CLEAR_FFT_SIZE)
  private readonly timeImag = new Float32Array(CLEAR_FFT_SIZE)

  /**
   * Analyse a mono 48 kHz waveform.
   *
   * @param audio - the samples
   * @returns the frame-major spectrum
   */
  forward(audio: Float32Array): ClearSpectrum {
    const prePad = this.fftSize - this.hopSize
    // The reference pads the tail so the last frames are complete: see ClearEnhancer
    // prepareInput, Sources/Clear/Enhancer.swift L390-403.
    const windowed = Math.max(this.fftSize, Math.ceil(audio.length / this.hopSize) * this.hopSize + this.fftSize)
    const paddedLength = prePad + Math.max(windowed, audio.length)
    const padded = new Float32Array(paddedLength)
    for (let i = 0; i < audio.length; i += 1) {
      const value = audio[i] ?? 0
      padded[prePad + i] = Number.isFinite(value) ? value : 0
    }
    const nFrames = Math.floor((paddedLength - this.fftSize) / this.hopSize) + 1
    const real = new Float32Array(nFrames * this.nFreq)
    const imag = new Float32Array(nFrames * this.nFreq)
    for (let t = 0; t < nFrames; t += 1) {
      const offset = t * this.hopSize
      for (let n = 0; n < this.fftSize; n += 1) {
        this.frame[n] = (padded[offset + n] ?? 0) * (VORBIS_WINDOW[n] ?? 0)
      }
      this.dft.forward(this.frame, 0, this.fullReal, this.fullImag, 0)
      const base = t * this.nFreq
      for (let k = 0; k < this.nFreq; k += 1) {
        real[base + k] = (this.fullReal[k] ?? 0) * this.wnorm
        imag[base + k] = (this.fullImag[k] ?? 0) * this.wnorm
      }
    }
    return { real, imag, nFrames }
  }

  /**
   * Synthesize a waveform from a spectrum.
   *
   * @param real - frame-major real parts
   * @param imag - frame-major imaginary parts
   * @param nFrames - how many frames to synthesize
   * @returns the waveform with the analysis prepad dropped (at least the input length)
   */
  inverse(real: Float32Array, imag: Float32Array, nFrames: number): Float32Array {
    const prePad = this.fftSize - this.hopSize
    const rawLength = (nFrames - 1) * this.hopSize + this.fftSize
    const out = new Float32Array(rawLength)
    for (let t = 0; t < nFrames; t += 1) {
      const base = t * this.nFreq
      for (let k = 0; k < this.nFreq; k += 1) {
        this.fullReal[k] = real[base + k] ?? 0
        this.fullImag[k] = imag[base + k] ?? 0
      }
      // Hermitian mirror: X[960-k] = conj(X[k]) for k in 1..479. Bin 480 (Nyquist) and bin
      // 0 are self-conjugate and already in place.
      for (let k = 1; k < this.nFreq - 1; k += 1) {
        this.fullReal[this.fftSize - k] = real[base + k] ?? 0
        this.fullImag[this.fftSize - k] = -(imag[base + k] ?? 0)
      }
      this.dft.inverseUnscaled(this.fullReal, this.fullImag, 0, this.timeReal, this.timeImag, 0)
      const offset = t * this.hopSize
      for (let n = 0; n < this.fftSize; n += 1) {
        out[offset + n] = (out[offset + n] ?? 0) + (this.timeReal[n] ?? 0) * (VORBIS_WINDOW[n] ?? 0)
      }
    }
    return out.subarray(prePad)
  }
}

/** The DFN3 features the graph consumes. */
export interface ClearFeatures {
  /** Frame-major ERB bands, `nFrames * 32`. */
  readonly featErb: Float32Array
  /** Frame-major real parts of the unit-normalized first 96 bins. */
  readonly featSpecReal: Float32Array
  /** Frame-major imaginary parts of the unit-normalized first 96 bins. */
  readonly featSpecImag: Float32Array
}

/**
 * Compute feat_erb and feat_spec exactly as the reference does.
 *
 * @param real - frame-major real spectrum
 * @param imag - frame-major imaginary spectrum
 * @param nFrames - the number of frames
 * @returns the two feature tensors
 */
export function clearFeatures(real: Float32Array, imag: Float32Array, nFrames: number): ClearFeatures {
  const alpha = CLEAR_NORM_ALPHA
  const oneMinus = 1 - alpha

  const erbState = new Float64Array(CLEAR_N_ERB)
  const erbStep = (-90 - -60) / (CLEAR_N_ERB - 1)
  for (let band = 0; band < CLEAR_N_ERB; band += 1) erbState[band] = -60 + band * erbStep

  const featErb = new Float32Array(nFrames * CLEAR_N_ERB)
  for (let t = 0; t < nFrames; t += 1) {
    const rowIn = t * CLEAR_N_FREQ
    const rowOut = t * CLEAR_N_ERB
    let offset = 0
    for (let band = 0; band < CLEAR_N_ERB; band += 1) {
      const width = CLEAR_ERB_WIDTHS[band] ?? 1
      let power = 0
      for (let k = 0; k < width; k += 1) {
        const at = rowIn + offset + k
        const r = real[at] ?? 0
        const m = imag[at] ?? 0
        power += r * r + m * m
      }
      offset += width
      const db = 10 * Math.log10(power / width + 1e-10)
      const state = db * oneMinus + (erbState[band] ?? 0) * alpha
      erbState[band] = state
      featErb[rowOut + band] = (db - state) / 40
    }
  }

  const running = new Float64Array(CLEAR_N_DF)
  const runStep = (0.0001 - 0.001) / (CLEAR_N_DF - 1)
  for (let f = 0; f < CLEAR_N_DF; f += 1) running[f] = 0.001 + f * runStep

  const featSpecReal = new Float32Array(nFrames * CLEAR_N_DF)
  const featSpecImag = new Float32Array(nFrames * CLEAR_N_DF)
  for (let t = 0; t < nFrames; t += 1) {
    const rowIn = t * CLEAR_N_FREQ
    const rowOut = t * CLEAR_N_DF
    for (let f = 0; f < CLEAR_N_DF; f += 1) {
      const r = real[rowIn + f] ?? 0
      const m = imag[rowIn + f] ?? 0
      const magnitude = Math.hypot(r, m)
      const next = magnitude * oneMinus + (running[f] ?? 0) * alpha
      running[f] = next
      const inverse = 1 / Math.sqrt(next)
      featSpecReal[rowOut + f] = r * inverse
      featSpecImag[rowOut + f] = m * inverse
    }
  }

  return { featErb, featSpecReal, featSpecImag }
}

/** What {@link clearChunkInputs} needs. */
export interface ClearChunkInputRequest {
  readonly specReal: Float32Array
  readonly specImag: Float32Array
  readonly featErb: Float32Array
  readonly featSpecReal: Float32Array
  readonly featSpecImag: Float32Array
  readonly nFrames: number
  readonly start: number
  readonly chunkFrames?: number
  readonly lookahead?: number
}

/** One model window's three input tensors. */
export interface ClearChunkInputs {
  /** Interleaved complex spectrum, `T * 481 * 2`. */
  readonly spec: Float32Array
  /** ERB features, `T * 32`. */
  readonly featErb: Float32Array
  /** Interleaved complex DF features, `T * 96 * 2`. */
  readonly featSpec: Float32Array
  /** The fixed window length the graph declares. */
  readonly chunkFrames: number
  /** How many frames of this window are real audio. */
  readonly validFrames: number
}

/**
 * Pack one 200-frame model window.
 *
 * The spectrum is read at the window's own frames; the FEATURES are read two frames ahead
 * and zero-filled past the tail (Sources/Clear/Enhancer.swift L198-237).
 *
 * @param request - the whole-signal arrays and where the window starts
 * @returns the three input tensors
 */
export function clearChunkInputs(request: ClearChunkInputRequest): ClearChunkInputs {
  const chunkFrames = request.chunkFrames ?? CLEAR_CHUNK_FRAMES
  const lookahead = request.lookahead ?? CLEAR_LOOKAHEAD
  const { nFrames, start } = request
  const spec = new Float32Array(chunkFrames * CLEAR_N_FREQ * 2)
  const featErb = new Float32Array(chunkFrames * CLEAR_N_ERB)
  const featSpec = new Float32Array(chunkFrames * CLEAR_N_DF * 2)

  const featureStart = Math.max(0, -start - lookahead)
  const featureEnd = Math.min(chunkFrames, nFrames - start - lookahead)
  for (let t = featureStart; t < featureEnd; t += 1) {
    const source = start + t + lookahead
    for (let f = 0; f < CLEAR_N_ERB; f += 1) {
      featErb[t * CLEAR_N_ERB + f] = request.featErb[source * CLEAR_N_ERB + f] ?? 0
    }
    for (let f = 0; f < CLEAR_N_DF; f += 1) {
      const at = (t * CLEAR_N_DF + f) * 2
      const sourceAt = source * CLEAR_N_DF + f
      featSpec[at] = request.featSpecReal[sourceAt] ?? 0
      featSpec[at + 1] = request.featSpecImag[sourceAt] ?? 0
    }
  }

  const spectrumEnd = Math.min(chunkFrames, nFrames - start)
  for (let t = 0; t < spectrumEnd; t += 1) {
    const source = start + t
    for (let k = 0; k < CLEAR_N_FREQ; k += 1) {
      const at = (t * CLEAR_N_FREQ + k) * 2
      const sourceAt = source * CLEAR_N_FREQ + k
      spec[at] = request.specReal[sourceAt] ?? 0
      spec[at + 1] = request.specImag[sourceAt] ?? 0
    }
  }

  return { spec, featErb, featSpec, chunkFrames, validFrames: Math.max(0, spectrumEnd) }
}

/** What {@link scatterEnhanced} needs. */
export interface ClearScatterRequest {
  /** The model output, interleaved complex, `chunkFrames * 481 * 2`. */
  readonly enhanced: Float32Array
  readonly chunkFrames: number
  readonly start: number
  readonly validFrames: number
  readonly outReal: Float32Array
  readonly outImag: Float32Array
}

/**
 * Copy a chunk's enhanced spectrum into the whole-signal planes.
 *
 * @param request - the output tensor, the window start and the destination planes
 */
export function scatterEnhanced(request: ClearScatterRequest): void {
  const { enhanced, start, validFrames } = request
  for (let t = 0; t < validFrames; t += 1) {
    const destination = start + t
    for (let k = 0; k < CLEAR_N_FREQ; k += 1) {
      const at = (t * CLEAR_N_FREQ + k) * 2
      const target = destination * CLEAR_N_FREQ + k
      request.outReal[target] = enhanced[at] ?? 0
      request.outImag[target] = enhanced[at + 1] ?? 0
    }
  }
}

/** BS.1770-4 K-weighting stage 1 (high shelf) at 48 kHz. */
const K_WEIGHT_STAGE1_B = [1.53512485958697, -2.69169618940638, 1.19839281085285] as const
const K_WEIGHT_STAGE1_A = [-1.69065929318241, 0.73248077421585] as const
/** BS.1770-4 K-weighting stage 2 (high pass) at 48 kHz. */
const K_WEIGHT_STAGE2_B = [1.0, -2.0, 1.0] as const
const K_WEIGHT_STAGE2_A = [-1.99004745483398, 0.99007225036621] as const

/** One direct-form-I biquad over a Float32 signal, in place. */
function biquadInPlace(samples: Float32Array, b: readonly number[], a: readonly number[]): void {
  const b0 = b[0] ?? 0
  const b1 = b[1] ?? 0
  const b2 = b[2] ?? 0
  const a0 = a[0] ?? 0
  const a1 = a[1] ?? 0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < samples.length; i += 1) {
    const xn = samples[i] ?? 0
    const yn = b0 * xn + b1 * x1 + b2 * x2 - a0 * y1 - a1 * y2
    x2 = x1
    x1 = xn
    y2 = y1
    y1 = yn
    samples[i] = yn
  }
}

/**
 * ITU-R BS.1770-4 integrated loudness of mono samples at 48 kHz.
 *
 * 400 ms blocks at a 100 ms step; gated at -70 LUFS, then at (gated mean - 10 LU).
 *
 * @param samples - the signal
 * @param sampleRate - must be 48 kHz, the rate the K-weighting coefficients were derived for
 * @returns LUFS, or null for silence or audio shorter than one block
 */
export function integratedLufs(samples: Float32Array, sampleRate: number = CLEAR_SAMPLE_RATE): number | null {
  if (sampleRate !== CLEAR_SAMPLE_RATE || samples.length === 0) return null
  const weighted = Float32Array.from(samples)
  biquadInPlace(weighted, K_WEIGHT_STAGE1_B, K_WEIGHT_STAGE1_A)
  biquadInPlace(weighted, K_WEIGHT_STAGE2_B, K_WEIGHT_STAGE2_A)
  const block = Math.round(0.4 * sampleRate)
  const step = Math.round(0.1 * sampleRate)
  if (weighted.length < block) return null

  const blockLoud: number[] = []
  const meanSquares: number[] = []
  for (let start = 0; start + block <= weighted.length; start += step) {
    let sum = 0
    for (let i = start; i < start + block; i += 1) {
      const value = weighted[i] ?? 0
      sum += value * value
    }
    const meanSquare = sum / block
    meanSquares.push(meanSquare)
    blockLoud.push(-0.691 + 10 * Math.log10(meanSquare + 1e-12))
  }

  const gated = (threshold: number): number | null => {
    let accumulator = 0
    let count = 0
    for (let i = 0; i < blockLoud.length; i += 1) {
      if ((blockLoud[i] ?? -Infinity) > threshold) {
        accumulator += meanSquares[i] ?? 0
        count += 1
      }
    }
    return count > 0 ? -0.691 + 10 * Math.log10(accumulator / count + 1e-12) : null
  }

  const firstPass = gated(-70)
  if (firstPass === null) return null
  return gated(firstPass - 10) ?? firstPass
}

/** Where mastering should land; every field defaults to the SDK's Apple Podcasts preset. */
export interface ClearLoudnessOptions {
  readonly targetLufs?: number
  readonly maxGainDb?: number
  readonly peakCeilingDbtp?: number
}

/**
 * Normalize loudness in place: measure, apply min(maxGain, target - measured), then limit.
 *
 * @param samples - the signal, at 48 kHz
 * @param options - target, gain cap and peak ceiling
 * @returns the measured input LUFS, or null when the signal was left untouched (silence)
 */
export function normalizeLoudnessInPlace(samples: Float32Array, options: ClearLoudnessOptions = {}): number | null {
  const target = options.targetLufs ?? CLEAR_TARGET_LUFS
  const maxGain = options.maxGainDb ?? CLEAR_MAX_GAIN_DB
  const ceiling = options.peakCeilingDbtp ?? CLEAR_PEAK_CEILING_DBTP
  const measured = integratedLufs(samples)
  if (measured === null) return null
  // Only upward gain is capped: attenuating a loud input is always safe.
  const gainDb = Math.min(maxGain, target - measured)
  const gain = Math.pow(10, gainDb / 20)
  for (let i = 0; i < samples.length; i += 1) samples[i] = (samples[i] ?? 0) * gain
  limitInPlace(samples, ceiling, CLEAR_SAMPLE_RATE)
  return measured
}

/**
 * A look-ahead peak limiter, in place.
 *
 * Instantaneous attack: the envelope is already down when a peak arrives, because the
 * window maximum looks 5 ms ahead. Exponential release. This is the reference's single-pass
 * form of Limiter.Streaming.process + flush (same envelope over the whole signal).
 *
 * @param samples - the signal
 * @param ceilingDbtp - the sample-peak ceiling
 * @param sampleRate - the sample rate the window and release are derived for
 */
export function limitInPlace(samples: Float32Array, ceilingDbtp: number, sampleRate: number): void {
  const n = samples.length
  if (n === 0) return
  const ceiling = Math.pow(10, ceilingDbtp / 20)
  const lookahead = Math.max(0, Math.round(0.005 * sampleRate))
  const release = Math.exp(-1 / (sampleRate * 0.05))
  const magnitude = new Float32Array(n)
  for (let i = 0; i < n; i += 1) magnitude[i] = Math.abs(samples[i] ?? 0)

  // Monotonic-decreasing deque of candidate peak indices; head advances, tail pops.
  const deque: number[] = []
  let head = 0
  const push = (index: number): void => {
    const value = magnitude[index] ?? 0
    while (deque.length > head && (magnitude[deque[deque.length - 1] ?? 0] ?? 0) <= value) deque.pop()
    deque.push(index)
  }
  for (let j = 0; j < Math.min(lookahead, n); j += 1) push(j)

  let envelope = 1
  for (let i = 0; i < n; i += 1) {
    const ahead = i + lookahead
    if (ahead < n) push(ahead)
    while (deque.length > head && (deque[head] ?? 0) < i) head += 1
    const upcoming = deque.length > head ? magnitude[deque[head] ?? 0] ?? 0 : 0
    if (upcoming > ceiling) {
      const required = ceiling / upcoming
      if (required < envelope) envelope = required
    }
    samples[i] = (samples[i] ?? 0) * envelope
    envelope = 1 - (1 - envelope) * release
  }
}

/**
 * Encode mono float samples as a 16-bit PCM RIFF/WAVE document.
 *
 * @param samples - the samples
 * @param sampleRate - the sample rate to declare
 * @returns the WAV bytes
 */
export function encodePcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2
  const bytes = new Uint8Array(CLEAR_WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(bytes.buffer)
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i)
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(CLEAR_WAV_HEADER_BYTES + i * 2, Math.round(clamped * 32_767), true)
  }
  return bytes
}

/**
 * The most 48 kHz mono PCM16 samples whose base64 WAV fits the host's result budget.
 *
 * base64 is 4/3 of the raw WAV, which is 44 header bytes plus 2 bytes per sample. The
 * 1024-byte envelope allowance is for the rest of the JSON result.
 *
 * @param maxResultBytes - context.limits.maxResultBytes
 * @returns the sample cap, or 0 when even a header cannot fit
 */
export function maxSamplesForResultBudget(maxResultBytes: number): number {
  if (!Number.isFinite(maxResultBytes)) return 0
  const usable = maxResultBytes - CLEAR_OUTPUT_ENVELOPE_BYTES
  if (usable <= CLEAR_WAV_HEADER_BYTES) return 0
  const wavBytes = Math.floor((usable * 3) / 4)
  if (wavBytes <= CLEAR_WAV_HEADER_BYTES) return 0
  return Math.floor((wavBytes - CLEAR_WAV_HEADER_BYTES) / 2)
}
