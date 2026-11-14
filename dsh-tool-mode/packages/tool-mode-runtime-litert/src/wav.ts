/**
 * WAV decoding and linear resampling for the ear tool.
 *
 * The same contract as the Phase 3 waveform processor (runtime-onnx/src/wav.ts): PCM 16-bit
 * or IEEE float32, mono or stereo, any declared rate. It is duplicated here deliberately so
 * the LiteRT deployment pulls in no ONNX dependency; the behaviour is identical.
 *
 * Every unsupported document is refused BY NAME rather than guessed at, because a
 * mis-decoded waveform is a wrong language with no other symptom.
 */

/** The rate the ear model expects. */
export const EAR_SAMPLE_RATE = 16_000

/** A decoded WAV: mono interleaved-averaged float samples at the SOURCE rate. */
export interface WavAudio {
  readonly sampleRate: number
  readonly channels: number
  readonly encoding: 'pcm16' | 'float32'
  readonly samples: Float32Array
}

const ascii = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0)

/** Fail with a named reason (a never-returning call, so callers can prune branches). */
function refuse(reason: string): never {
  throw new Error(reason)
}

/**
 * Decode a WAV document (RIFF/WAVE) to mono float samples at its declared rate.
 *
 * Accepted: PCM 16-bit and IEEE float32, one or two channels. Everything else refused by name.
 *
 * @param bytes - the file bytes
 * @returns the decoded audio
 * @throws Error naming the unsupported or malformed part
 */
export function decodeWav(bytes: Uint8Array): WavAudio {
  if (bytes.length < 12) refuse('the document is truncated: it is shorter than a RIFF header')
  if (ascii(bytes, 0) !== 'RIFF') refuse('the document is not a RIFF file: it starts with ' + JSON.stringify(ascii(bytes, 0)))
  if (ascii(bytes, 8) !== 'WAVE') refuse('the document is not a WAVE document: its form type is ' + JSON.stringify(ascii(bytes, 8)))

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | undefined
  let data: Uint8Array | undefined
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (body + size > bytes.length) refuse('the ' + JSON.stringify(id) + ' chunk is truncated: it declares ' + String(size) + ' bytes')
    if (id === 'fmt ') {
      if (size < 16) refuse('the fmt chunk is too short to describe a sample format')
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      }
    } else if (id === 'data' && data === undefined) {
      data = bytes.subarray(body, body + size)
    }
    offset = body + size + (size % 2)
  }

  if (format === undefined) refuse('the document has no fmt chunk, so its samples cannot be interpreted')
  if (data === undefined) refuse('the document has no data chunk')
  const encoding = format.audioFormat === 1 ? 'pcm16' : format.audioFormat === 3 ? 'float32' : undefined
  if (encoding === undefined) {
    refuse('the audio format ' + String(format.audioFormat) + ' is not supported; export PCM 16-bit or IEEE float32')
  }
  const requiredBits = encoding === 'pcm16' ? 16 : 32
  if (format.bitsPerSample !== requiredBits) {
    refuse(
      String(format.bitsPerSample) + ' bits per sample is not supported in this encoding; export '
        + (encoding === 'pcm16' ? 'PCM 16-bit' : 'IEEE float32'),
    )
  }
  if (format.channels !== 1 && format.channels !== 2) {
    refuse(String(format.channels) + ' audio channels is not supported; mono or stereo only')
  }
  if (!Number.isInteger(format.sampleRate) || format.sampleRate <= 0) {
    refuse('the sample rate ' + String(format.sampleRate) + ' is not a positive integer')
  }

  const bytesPerSample = requiredBits / 8
  const bytesPerFrame = bytesPerSample * format.channels
  if (data.length % bytesPerFrame !== 0) {
    refuse('the data chunk is ' + String(data.length) + ' bytes, which is not a whole number of ' + String(format.channels) + '-channel frames')
  }
  const frames = data.length / bytesPerFrame
  const samples = new Float32Array(frames)
  const dataOffset = data.byteOffset
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0
    for (let channel = 0; channel < format.channels; channel += 1) {
      const at = dataOffset + frame * bytesPerFrame + channel * bytesPerSample
      const value = encoding === 'pcm16' ? view.getInt16(at, true) / 32_768 : view.getFloat32(at, true)
      if (!Number.isFinite(value)) refuse('sample ' + String(frame) + ' of channel ' + String(channel) + ' is not finite')
      sum += value
    }
    samples[frame] = sum / format.channels
  }
  return { sampleRate: format.sampleRate, channels: format.channels, encoding, samples }
}

/**
 * Linearly resample mono samples (Resample.linear, AudioIO/Resample.swift:25-40).
 *
 * @param samples - mono source samples
 * @param fromRate - the source sample rate
 * @param toRate - the target sample rate
 * @returns the resampled samples; a copy when the rates match
 */
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!Number.isFinite(fromRate) || fromRate <= 0) throw new Error('the source sample rate must be a positive number')
  if (!Number.isFinite(toRate) || toRate <= 0) throw new Error('the target sample rate must be a positive number')
  if (samples.length <= 1 || fromRate === toRate) return Float32Array.from(samples)
  const outputLength = Math.round((samples.length * toRate) / fromRate)
  if (outputLength <= 0) return new Float32Array(0)
  const output = new Float32Array(outputLength)
  const step = fromRate / toRate
  const last = samples.length - 1
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * step
    const lower = Math.trunc(position)
    if (lower >= last) {
      output[index] = samples[last] ?? 0
      continue
    }
    const fraction = position - lower
    const start = samples[lower] ?? 0
    const end = samples[lower + 1] ?? start
    output[index] = start * (1 - fraction) + end * fraction
  }
  return output
}
