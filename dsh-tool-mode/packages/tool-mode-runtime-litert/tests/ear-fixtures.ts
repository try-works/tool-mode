/**
 * Deterministic ear fixtures: WAV bytes, a synthetic 80x201 mel filterbank, the meta document
 * and a 103-code language list. No audio or model bytes are committed; the real artifact is
 * only read by the gated test from .assets/ear.
 */

/** A WAV document built sample by sample (PCM 16-bit or IEEE float32). */
export interface WavFixtureOptions {
  readonly sampleRate: number
  readonly channels: 1 | 2 | 3
  readonly encoding: 'pcm16' | 'float32'
  /** Interleaved samples: frame-major, then channel. */
  readonly samples: Float32Array
  /** Override the fmt bits-per-sample field, to build refused variants. */
  readonly bitsPerSample?: number
  /** Override the fmt audio-format field (e.g. 0xFFFE for extensible), to build refused variants. */
  readonly audioFormat?: number
  readonly truncateDataBytes?: number
}

const writeAscii = (out: Uint8Array, offset: number, text: string): void => {
  for (let index = 0; index < text.length; index += 1) out[offset + index] = text.charCodeAt(index)
}

export const encodeWav = (options: WavFixtureOptions): Uint8Array => {
  const bits = options.bitsPerSample ?? (options.encoding === 'pcm16' ? 16 : 32)
  const audioFormat = options.audioFormat ?? (options.encoding === 'pcm16' ? 1 : 3)
  const bytesPerSample = options.encoding === 'pcm16' ? 2 : 4
  const frames = Math.floor(options.samples.length / options.channels)
  const dataBytes = options.truncateDataBytes ?? frames * options.channels * bytesPerSample
  const out = new Uint8Array(44 + dataBytes)
  const view = new DataView(out.buffer)
  writeAscii(out, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(out, 8, 'WAVE')
  writeAscii(out, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, audioFormat, true)
  view.setUint16(22, options.channels, true)
  view.setUint32(24, options.sampleRate, true)
  view.setUint32(28, options.sampleRate * options.channels * bytesPerSample, true)
  view.setUint16(32, options.channels * bytesPerSample, true)
  view.setUint16(34, bits, true)
  writeAscii(out, 36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let index = 0; index < frames * options.channels; index += 1) {
    const at = 44 + index * bytesPerSample
    if (at + bytesPerSample > out.length) break
    const value = options.samples[index] ?? 0
    if (options.encoding === 'pcm16') {
      view.setInt16(at, Math.max(-32768, Math.min(32767, Math.round(value * 32767))), true)
    } else {
      view.setFloat32(at, value, true)
    }
  }
  return out
}

/** A small sine, so tests can construct audio without fixtures. */
export const sine = (options: {
  readonly sampleRate: number
  readonly seconds: number
  readonly hz: number
  readonly amplitude?: number
  readonly phase?: number
}): Float32Array => {
  const count = Math.round(options.sampleRate * options.seconds)
  const out = new Float32Array(count)
  const amplitude = options.amplitude ?? 0.5
  const phase = options.phase ?? 0
  for (let index = 0; index < count; index += 1) {
    out[index] = amplitude * Math.sin(phase + (2 * Math.PI * options.hz * index) / options.sampleRate)
  }
  return out
}

/** Amplitude bursts at a syllabic rate, useful for the window-selection tests. */
export const burst = (options: {
  readonly sampleRate: number
  readonly seconds: number
  readonly hz: number
  readonly onMs: number
  readonly offMs: number
  readonly amplitude?: number
}): Float32Array => {
  const count = Math.round(options.sampleRate * options.seconds)
  const out = new Float32Array(count)
  const on = Math.round((options.onMs / 1000) * options.sampleRate)
  const off = Math.round((options.offMs / 1000) * options.sampleRate)
  const amplitude = options.amplitude ?? 0.5
  for (let index = 0; index < count; index += 1) {
    const phase = index % Math.max(on + off, 1)
    if (phase < on) out[index] = amplitude * Math.sin((2 * Math.PI * options.hz * index) / options.sampleRate)
  }
  return out
}

/** Concatenate segments into one mono signal. */
export const concatSegments = (segments: readonly Float32Array[]): Float32Array => {
  const total = segments.reduce((sum, segment) => sum + segment.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const segment of segments) {
    out.set(segment, offset)
    offset += segment.length
  }
  return out
}

/** A deterministic 103-code language list with the interesting codes at known indices. */
export const EAR_LANGUAGE_CODES: readonly string[] = (() => {
  const codes: string[] = []
  for (let index = 0; index < 103; index += 1) codes.push('l' + String(index).padStart(3, '0'))
  codes[0] = 'en'
  codes[1] = 'fr'
  codes[2] = 'no'
  codes[3] = 'sv'
  codes[4] = 'da'
  codes[5] = 'yue'
  codes[6] = 'zh'
  return codes
})()

/** The languages.json document the processor reads (the model's label order). */
export const earLanguagesJson = (): string => JSON.stringify(EAR_LANGUAGE_CODES)

/** The ear_meta.json document, matching the pinned artifact. */
export const earMetaJson = (overrides: { readonly n_mels?: number; readonly input?: string; readonly output?: string } = {}): string =>
  JSON.stringify({
    model: 'ear',
    version: '0.2.1',
    task: 'spoken-language-identification',
    audio: { sample_rate: 16000, channels: 1, window_seconds: 30, recommended_windows: 3 },
    frontend: {
      n_fft: 400,
      hop_length: 160,
      n_mels: overrides.n_mels ?? 80,
      frames: 3000,
      window: 'hann_periodic',
      log: 'log10',
      clamp_min: 1e-10,
      floor_below_peak_db: 8,
      affine: { add: 4.0, divide: 4.0 },
      input_shape: [1, 80, 3000],
      filterbank: 'mel_filters.f32',
    },
    artifacts: {
      litert: { file: 'ear.tflite', input: overrides.input ?? 'mel', output: overrides.output ?? 'output_0' },
      filterbank: { file: 'mel_filters.f32', layout: 'uint32 mels, uint32 bins, then mels*bins float32, little-endian, mel-major' },
    },
    output: { logits: 103, order: 'languages.json' },
    languages: EAR_LANGUAGE_CODES,
  })

/** An 80x201 mel filterbank whose filter m passes bin m, as little-endian float32. */
export const melFiltersBytes = (options: { readonly mels?: number; readonly bins?: number } = {}): Uint8Array => {
  const mels = options.mels ?? 80
  const bins = options.bins ?? 201
  const out = new Uint8Array(8 + mels * bins * 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, mels, true)
  view.setUint32(4, bins, true)
  for (let mel = 0; mel < mels; mel += 1) {
    for (let bin = 0; bin < bins; bin += 1) {
      view.setFloat32(8 + (mel * bins + bin) * 4, bin === mel ? 1 : 0, true)
    }
  }
  return out
}

/** A filterbank where one mel passes an arbitrary bin (for the analytical feature test). */
export const melFiltersAtBin = (bin: number): Uint8Array => {
  const bytes = melFiltersBytes()
  const view = new DataView(bytes.buffer)
  for (let mel = 0; mel < 80; mel += 1) {
    for (let candidate = 0; candidate < 201; candidate += 1) {
      const at = 8 + (mel * 201 + candidate) * 4
      view.setFloat32(at, mel === bin && candidate === bin ? 1 : 0, true)
    }
  }
  return bytes
}
