/**
 * WAV decoding, resampling and windowing (PHASE3 processor uhm/waveform-v1, steps 1-2).
 *
 * Two facts drive the whole module:
 *
 * - **The model consumes 16 kHz mono float samples.** A caller's file may be any rate,
 *   one or two channels, PCM 16-bit or float32, so decode and resample are separate steps
 *   with separate tests rather than one opaque pipeline.
 * - **The window geometry is the MODEL's, not the caller's.** 30 s windows with a 1 s
 *   overlap and a zero-padded final window are pinned constants (480000 samples, hop
 *   464000). The overlap exists so a filler word spanning a window boundary is seen
 *   whole by one of the two windows; the frame timeline in `frames.ts` merges them.
 *
 * @module wav
 */

/** The model's sample rate. */
export const UHM_SAMPLE_RATE = 16_000

/** One model window, in samples (30 s at 16 kHz). */
export const UHM_WINDOW_SAMPLES = 480_000

/** The overlap between consecutive windows, in samples (1 s). */
export const UHM_OVERLAP_SAMPLES = 16_000

/** The hop between consecutive windows: window minus overlap. */
export const UHM_HOP_SAMPLES = UHM_WINDOW_SAMPLES - UHM_OVERLAP_SAMPLES

/** One model output frame, in samples (20 ms at 16 kHz). */
export const UHM_FRAME_SAMPLES = 320

/** One model output frame, in milliseconds. */
export const UHM_FRAME_MS = 20

/** A decoded WAV: mono float samples at the SOURCE rate. */
export interface WavAudio {
  /** The rate the file declares. */
  readonly sampleRate: number
  /** The channel count the file declares. */
  readonly channels: number
  /** Which sample encoding was decoded. */
  readonly encoding: 'pcm16' | 'float32'
  /** Mono samples at the source rate; stereo is averaged. */
  readonly samples: Float32Array
}

/** What {@link decodeWav} returns. */
export type WavDecodeResult =
  | { readonly ok: true; readonly audio: WavAudio }
  | { readonly ok: false; readonly reason: string }

/** One window of samples, always exactly `windowSamples` long. */
export interface AudioWindow {
  /** Window index, in order. */
  readonly index: number
  /** Absolute sample offset of the window start. */
  readonly startSample: number
  /** The window samples, zero padded past the end of the audio. */
  readonly samples: Float32Array
}

/** The window geometry to apply. */
export interface WindowGeometry {
  readonly windowSamples: number
  readonly hopSamples: number
}

/** Read five ASCII bytes as text. */
function ascii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  )
}

/** Refuse a document with a named reason. */
function refuse(reason: string): WavDecodeResult {
  return { ok: false, reason }
}

/**
 * Decode a WAV document (RIFF/WAVE) to mono float samples.
 *
 * Accepted: `WAVE_FORMAT_PCM` with 16 bits, and `WAVE_FORMAT_IEEE_FLOAT` with 32 bits,
 * one or two channels. Everything else is refused BY NAME rather than guessed at, because
 * a mis-decoded waveform is a wrong transcript with no other symptom.
 *
 * @param bytes - the file bytes
 * @returns the decoded audio, or the reason it cannot be decoded
 */
export function decodeWav(bytes: Uint8Array): WavDecodeResult {
  if (bytes.length < 12) return refuse('the document is truncated: it is shorter than a RIFF header')
  if (ascii(bytes, 0) !== 'RIFF') {
    return refuse(`the document is not a RIFF file: it starts with ${JSON.stringify(ascii(bytes, 0))}`)
  }
  if (ascii(bytes, 8) !== 'WAVE') {
    return refuse(`the document is not a WAVE document: its form type is ${JSON.stringify(ascii(bytes, 8))}`)
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | undefined
  let data: Uint8Array | undefined
  let offset = 12

  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (body + size > bytes.length) {
      return refuse(`the ${JSON.stringify(id)} chunk is truncated: it declares ${String(size)} bytes`)
    }
    if (id === 'fmt ') {
      if (size < 16) return refuse('the fmt chunk is too short to describe a sample format')
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      }
    } else if (id === 'data' && data === undefined) {
      data = bytes.subarray(body, body + size)
    }
    // Chunks are word aligned.
    offset = body + size + (size % 2)
  }

  if (format === undefined) return refuse('the document has no fmt chunk, so its samples cannot be interpreted')
  if (data === undefined) return refuse('the document has no data chunk')

  const encoding = format.audioFormat === 1
    ? 'pcm16'
    : format.audioFormat === 3
      ? 'float32'
      : undefined
  if (encoding === undefined) {
    return refuse(`the audio format ${String(format.audioFormat)} is not supported; export PCM 16-bit or IEEE float32`)
  }
  const requiredBits = encoding === 'pcm16' ? 16 : 32
  const supportedLabel = encoding === 'pcm16' ? 'PCM 16-bit' : 'IEEE float32'
  if (format.bitsPerSample !== requiredBits) {
    return refuse(
      `${String(format.bitsPerSample)} bits per sample is not supported in this encoding; export ${supportedLabel}`,
    )
  }
  if (format.channels !== 1 && format.channels !== 2) {
    return refuse(`${String(format.channels)} audio channels is not supported; mono or stereo only`)
  }
  if (!Number.isInteger(format.sampleRate) || format.sampleRate <= 0) {
    return refuse(`the sample rate ${String(format.sampleRate)} is not a positive integer`)
  }

  const bytesPerSample = requiredBits / 8
  const bytesPerFrame = bytesPerSample * format.channels
  if (data.length % bytesPerFrame !== 0) {
    return refuse(
      `the data chunk is ${String(data.length)} bytes, which is not a whole number of ${String(format.channels)}-channel frames`,
    )
  }

  const frames = data.length / bytesPerFrame
  const samples = new Float32Array(frames)
  const dataOffset = data.byteOffset
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0
    for (let channel = 0; channel < format.channels; channel += 1) {
      const at = dataOffset + frame * bytesPerFrame + channel * bytesPerSample
      const value = encoding === 'pcm16' ? view.getInt16(at, true) / 32_768 : view.getFloat32(at, true)
      if (!Number.isFinite(value)) return refuse(`sample ${String(frame)} of channel ${String(channel)} is not finite`)
      sum += value
    }
    samples[frame] = sum / format.channels
  }

  return { ok: true, audio: { sampleRate: format.sampleRate, channels: format.channels, encoding, samples } }
}

/**
 * Resample mono samples with linear interpolation.
 *
 * Linear, not windowed-sinc: PHASE3 specifies linear, and the model was qualified on that
 * path. A file already at the target rate is copied so a caller never aliases the file
 * buffer.
 *
 * @param samples - mono source samples
 * @param fromRate - the source sample rate
 * @param toRate - the target sample rate
 * @returns the resampled samples
 */
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!Number.isFinite(fromRate) || fromRate <= 0) throw new Error('the source sample rate must be a positive number')
  if (!Number.isFinite(toRate) || toRate <= 0) throw new Error('the target sample rate must be a positive number')
  if (samples.length === 0) return new Float32Array(0)
  if (fromRate === toRate) return Float32Array.from(samples)

  const length = Math.max(1, Math.round((samples.length * toRate) / fromRate))
  const output = new Float32Array(length)
  const ratio = fromRate / toRate
  const last = samples.length - 1
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio
    const lower = Math.min(Math.floor(position), last)
    const upper = Math.min(lower + 1, last)
    const fraction = position - lower
    const start = samples[lower] ?? 0
    const end = samples[upper] ?? start
    output[index] = start + (end - start) * fraction
  }
  return output
}

/**
 * Slice mono samples into zero-padded model windows.
 *
 * A window starts at every hop while the audio lasts, so EXACTLY 30 s of audio still
 * produces two windows (the second repeats the final second). That is the pinned overlap,
 * not an off-by-one: a filler that starts in the last second must appear whole somewhere.
 *
 * @param samples - mono 16 kHz samples
 * @param geometry - window and hop sizes; defaults to the uhm geometry
 * @returns the windows, in order
 */
export function windowsOf(
  samples: Float32Array,
  geometry: WindowGeometry = { windowSamples: UHM_WINDOW_SAMPLES, hopSamples: UHM_HOP_SAMPLES },
): readonly AudioWindow[] {
  const { windowSamples, hopSamples } = geometry
  if (!Number.isInteger(windowSamples) || windowSamples <= 0) {
    throw new Error('the window sample count must be a positive integer')
  }
  if (!Number.isInteger(hopSamples) || hopSamples <= 0) {
    throw new Error('the hop sample count must be a positive integer')
  }
  if (hopSamples > windowSamples) {
    throw new Error('the hop must not exceed the window, which would skip audio between windows')
  }
  if (samples.length === 0) return []

  const windows: AudioWindow[] = []
  let index = 0
  for (let start = 0; start < samples.length; start += hopSamples) {
    const window = new Float32Array(windowSamples)
    window.set(samples.subarray(start, Math.min(start + windowSamples, samples.length)))
    windows.push({ index, startSample: start, samples: window })
    index += 1
  }
  return windows
}
