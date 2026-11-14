/**
 * The ear log-mel front end and window selection, ported from the primary source.
 *
 * PROVENANCE (Desert-Ant-Labs/desert-ant-core @ baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7):
 * - Sources/Ear/Frontend.swift:25-40 geometry (and windowSamples = frames * hop)
 * - Sources/Ear/Frontend.swift:48-63 Hann periodic + center STFT + filterbank size checks
 * - Sources/Ear/Frontend.swift:65-106 features: truncate/pad to one window, STFT, mel energies,
 *   log10(clamp), floor relative to the peak, affine
 * - Sources/Ear/Frontend.swift:137-221 windowOffsets + modulationScores
 * - Sources/Ear/Frontend.swift:223-242 mel filterbank parse (uint32 LE mels/bins then f32 LE)
 * - Sources/AudioDSP/STFT.swift:68-106 (bins = nFFT/2 + 1), :109-158 (REFLECT pad, frames)
 * - Sources/AudioDSP/Windowing.swift:21-27 Hann periodic, :30-41 reflect padding
 * - .assets/ear/ear_meta.json: 16 kHz, n_fft 400, hop 160, mels 80, frames 3000, Hann periodic,
 *   log10, clamp 1e-10, floor 8 decades, affine (x + 4) / 4.
 *
 * nFFT is not a power of two, so the source's portable path is an exact real-DFT matmul
 * (STFT.swift:142-158). This module does the same transform, in double precision, then stores
 * the features as float32 -- the tensor the model consumes.
 */

/** The model's sample rate. */
export const EAR_SAMPLE_RATE = 16_000
/** Analysis window length. */
export const EAR_N_FFT = 400
/** Hop between analysis frames. */
export const EAR_HOP = 160
/** Mel bands. */
export const EAR_MELS = 80
/** Frames the model consumes. */
export const EAR_FRAMES = 3000
/** Spectrum bins: nFFT / 2 + 1. */
export const EAR_BINS = EAR_N_FFT / 2 + 1
/** Samples in one 30 s analysis window. */
export const EAR_WINDOW_SAMPLES = EAR_FRAMES * EAR_HOP
/** Floor applied to mel energies before the logarithm. */
export const EAR_CLAMP_MIN = 1e-10
/** How far below the loudest bin the features are floored, in decades. */
export const EAR_FLOOR_DECADES = 8
/** Affine add. */
export const EAR_AFFINE_ADD = 4
/** Affine divide. */
export const EAR_AFFINE_DIVIDE = 4
/** Windows the SDK listens to by default (Ear.swift:113). */
export const EAR_DEFAULT_WINDOWS = 3

/** The periodic Hann window (Windowing.swift:21-27). */
export const hannPeriodic = (count: number): Float32Array => {
  const window = new Float32Array(Math.max(count, 0))
  if (count <= 1) {
    window.fill(1)
    return window
  }
  for (let index = 0; index < count; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / count)
  }
  return window
}

/** The 400-sample periodic Hann window. */
export const EAR_HANN = hannPeriodic(EAR_N_FFT)

/**
 * Reflect-pad by pad samples on each side, without repeating the edge sample, matching
 * torch.stft(center=True) (Windowing.swift:34-41).
 */
export const reflectPad = (samples: Float32Array, pad: number): Float32Array => {
  if (pad <= 0 || samples.length === 0) return Float32Array.from(samples)
  const out = new Float32Array(samples.length + 2 * pad)
  for (let index = 0; index < pad; index += 1) {
    out[index] = samples[Math.min(pad - index, samples.length - 1)] ?? 0
  }
  out.set(samples, pad)
  for (let index = 0; index < pad; index += 1) {
    out[pad + samples.length + index] = samples[Math.max(samples.length - 2 - index, 0)] ?? 0
  }
  return out
}

/** A parsed mel filterbank: mels x bins, mel-major. */
export interface MelFilterbank {
  readonly mels: number
  readonly bins: number
  readonly values: Float32Array
}

/**
 * Parse the filterbank asset: uint32 LE mels, uint32 LE bins, then mels*bins float32 LE,
 * mel-major (Frontend.swift:223-242).
 *
 * @param bytes - the whole asset
 * @returns the parsed bank
 * @throws Error when the document is truncated or its header disagrees with its size
 */
export const parseMelFilters = (bytes: Uint8Array): MelFilterbank => {
  if (bytes.length < 8) throw new Error('the mel filterbank is truncated')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const mels = view.getUint32(0, true)
  const bins = view.getUint32(4, true)
  if (mels === 0 || bins === 0) throw new Error('the mel filterbank declares zero mels or bins')
  const count = mels * bins
  if (bytes.length !== 8 + count * 4) {
    throw new Error('the mel filterbank is truncated: ' + String(bytes.length) + ' bytes for ' + String(count) + ' values')
  }
  const values = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    values[index] = view.getFloat32(8 + index * 4, true)
  }
  return { mels, bins, values }
}

// The portable path's real-DFT bases, built once (STFT.swift:79-89). Float64 here; the
// source uses Float32 tables, so feature values agree to float32 rounding, not bit-for-bit.
const FWD_COS = new Float64Array(EAR_N_FFT * EAR_BINS)
const FWD_SIN = new Float64Array(EAR_N_FFT * EAR_BINS)
for (let t = 0; t < EAR_N_FFT; t += 1) {
  for (let k = 0; k < EAR_BINS; k += 1) {
    const angle = (2 * Math.PI * k * t) / EAR_N_FFT
    FWD_COS[t * EAR_BINS + k] = Math.cos(angle)
    FWD_SIN[t * EAR_BINS + k] = -Math.sin(angle)
  }
}

/** A dense power spectrogram: frames rows of bins, frame-major. */
export interface PowerSpectrum {
  readonly frames: number
  readonly bins: number
  readonly power: Float64Array
}

/**
 * Squared-magnitude STFT of a signal: reflect pad nFFT/2, window each frame, exact real DFT
 * (STFT.swift:109-158). Frames = 1 + (padded - nFFT) / hop.
 */
export const stftPower = (samples: Float32Array): PowerSpectrum => {
  const padded = reflectPad(samples, EAR_N_FFT / 2)
  if (padded.length < EAR_N_FFT) return { frames: 0, bins: EAR_BINS, power: new Float64Array(0) }
  const frames = 1 + Math.trunc((padded.length - EAR_N_FFT) / EAR_HOP)
  const power = new Float64Array(frames * EAR_BINS)
  const windowed = new Float64Array(EAR_N_FFT)
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * EAR_HOP
    for (let t = 0; t < EAR_N_FFT; t += 1) {
      windowed[t] = (padded[offset + t] ?? 0) * (EAR_HANN[t] ?? 0)
    }
    const row = frame * EAR_BINS
    for (let bin = 0; bin < EAR_BINS; bin += 1) {
      let re = 0
      let im = 0
      for (let t = 0; t < EAR_N_FFT; t += 1) {
        const value = windowed[t] ?? 0
        const at = t * EAR_BINS + bin
        re += value * (FWD_COS[at] ?? 0)
        im += value * (FWD_SIN[at] ?? 0)
      }
      power[row + bin] = re * re + im * im
    }
  }
  return { frames, bins: EAR_BINS, power }
}

/**
 * The model's log-mel features: [mels * frames], mel-major (Frontend.swift:65-106).
 *
 * Audio is truncated or zero-padded to exactly one 30 s window first; only the first
 * 'frames' STFT frames are used (the transform computes 3001 for 480000 samples).
 *
 * @param samples - any-length mono samples at 16 kHz
 * @param filters - the parsed mel bank
 * @returns float32 features, ready to reshape to [1, mels, frames]
 */
export const logMelFeatures = (samples: Float32Array, filters: MelFilterbank): Float32Array => {
  const signal = new Float32Array(EAR_WINDOW_SAMPLES)
  const take = Math.min(samples.length, EAR_WINDOW_SAMPLES)
  signal.set(samples.subarray(0, take))
  const spectrum = stftPower(signal)
  const frames = Math.min(EAR_FRAMES, spectrum.frames)
  const log = new Float64Array(filters.mels * EAR_FRAMES)
  let peak = -Number.MAX_VALUE
  for (let mel = 0; mel < filters.mels; mel += 1) {
    const filterBase = mel * filters.bins
    for (let frame = 0; frame < frames; frame += 1) {
      const row = frame * EAR_BINS
      let energy = 0
      for (let bin = 0; bin < filters.bins; bin += 1) {
        const weight = filters.values[filterBase + bin] ?? 0
        if (weight === 0) continue
        energy += weight * (spectrum.power[row + bin] ?? 0)
      }
      const value = Math.log10(Math.max(energy, EAR_CLAMP_MIN))
      log[mel * EAR_FRAMES + frame] = value
      if (value > peak) peak = value
    }
  }
  const floor = peak - EAR_FLOOR_DECADES
  const features = new Float32Array(log.length)
  for (let index = 0; index < log.length; index += 1) {
    features[index] = (Math.max(log[index] ?? 0, floor) + EAR_AFFINE_ADD) / EAR_AFFINE_DIVIDE
  }
  return features
}

/** One candidate window and its syllable-modulation score. */
export interface ModulationScore {
  readonly offset: number
  readonly score: number
}

/**
 * Per-window syllable-modulation scores (Frontend.swift:163-221).
 *
 * RMS envelope at 'hop', then the difference of one-pole 8 Hz and 2 Hz low-passes as a
 * band-pass; per-window band/total energy ratios read out of running sums. Windows carrying
 * less than 2% of the loudest candidate's loudness score 0 rather than rank.
 */
export const modulationScores = (
  samples: Float32Array,
  options: { readonly hop: number; readonly window: number; readonly step: number },
): readonly ModulationScore[] => {
  const frames = Math.trunc(samples.length / options.hop)
  if (frames <= 8) return [{ offset: 0, score: 0 }]
  const envelope = new Float64Array(frames)
  const quarter = options.hop / 4
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0
    const base = frame * options.hop
    for (let index = base; index < base + options.hop; index += 4) {
      const value = samples[index] ?? 0
      sum += value * value
    }
    envelope[frame] = Math.sqrt(sum / quarter)
  }

  const rate = EAR_SAMPLE_RATE / options.hop
  const coefficient = (hz: number): number => 1 - Math.exp((-2 * Math.PI * hz) / rate)
  const fast = coefficient(8)
  const slow = coefficient(2)
  let lowFast = 0
  let lowSlow = 0
  const bandEnergy = new Float64Array(frames + 1)
  const totalEnergy = new Float64Array(frames + 1)
  const loudness = new Float64Array(frames + 1)
  for (let frame = 0; frame < frames; frame += 1) {
    const value = envelope[frame] ?? 0
    lowFast += fast * (value - lowFast)
    lowSlow += slow * (value - lowSlow)
    const syllabic = lowFast - lowSlow
    bandEnergy[frame + 1] = (bandEnergy[frame] ?? 0) + syllabic * syllabic
    totalEnergy[frame + 1] = (totalEnergy[frame] ?? 0) + (value - lowSlow) * (value - lowSlow)
    loudness[frame + 1] = (loudness[frame] ?? 0) + value * value
  }

  const windowFrames = Math.max(Math.trunc(options.window / options.hop), 1)
  const raw: { readonly offset: number; readonly ratio: number; readonly loud: number }[] = []
  for (let offset = 0; offset <= Math.max(samples.length - options.window, 0); offset += options.step) {
    const from = Math.min(Math.trunc(offset / options.hop), frames)
    const to = Math.min(from + windowFrames, frames)
    if (to <= from) continue
    const band = (bandEnergy[to] ?? 0) - (bandEnergy[from] ?? 0)
    const total = (totalEnergy[to] ?? 0) - (totalEnergy[from] ?? 0)
    raw.push({ offset, ratio: total > 0 ? band / total : 0, loud: (loudness[to] ?? 0) - (loudness[from] ?? 0) })
  }
  if (raw.length === 0) return [{ offset: 0, score: 0 }]
  const peak = raw.reduce((maximum, entry) => Math.max(maximum, entry.loud), 0)
  return raw.map((entry) => ({ offset: entry.offset, score: entry.loud >= 0.02 * peak ? entry.ratio : 0 }))
}

/**
 * Start offsets of the most speech-like 30 s windows, ascending (Frontend.swift:137-150).
 *
 * Candidates are every window/3 samples; short audio (<= one window) is listened to from 0.
 */
export const windowOffsets = (samples: Float32Array, count: number): readonly number[] => {
  const want = EAR_WINDOW_SAMPLES
  if (samples.length <= want) return [0]
  const step = Math.max(Math.trunc(want / 3), 1)
  const scored = modulationScores(samples, { hop: EAR_HOP, window: want, step })
  const selected = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(count, 1))
    .map((entry) => entry.offset)
  return selected.sort((a, b) => a - b)
}
