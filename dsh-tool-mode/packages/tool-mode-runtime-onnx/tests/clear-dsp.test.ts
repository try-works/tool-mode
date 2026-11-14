/**
 * Clear DSP tests (processor clear/stft-v1).
 *
 * Every constant here is taken from the PRIMARY SOURCE (desert-ant-core, commit
 * baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7), not from the model card: the graph takes
 * host-computed STFT/ERB features, so a wrong window, hop or normalization is silent
 * garbage. The tests pin the parameters that the source fixes, exercise the pure DSP on
 * synthetic signals, and prove the response budget arithmetic.
 *
 * @module tests/clear-dsp
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
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
} from '../src/clear-dsp.ts'
import { decodeWav } from '../src/wav.ts'

/** A deterministic pseudo-random sample in [-1, 1]. */
function noise(length: number, seed = 11): Float32Array {
  let state = seed >>> 0
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    out[i] = (state / 0xffff_ffff) * 2 - 1
  }
  return out
}

/** A sine at the given amplitude and frequency (48 kHz by default). */
function sine(length: number, amplitude = 1, frequency = 1000, sampleRate = CLEAR_SAMPLE_RATE): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate)
  return out
}

/** Max absolute value of a signal. */
function peak(samples: Float32Array): number {
  let max = 0
  for (const value of samples) max = Math.max(max, Math.abs(value))
  return max
}

describe('clear DSP constants (primary source: Sources/Clear/DSP.swift L31-46)', () => {
  it('pins the STFT geometry the graph was trained on', () => {
    assert.equal(CLEAR_SAMPLE_RATE, 48_000)
    assert.equal(CLEAR_FFT_SIZE, 960)
    assert.equal(CLEAR_HOP_SIZE, 480)
    assert.equal(CLEAR_N_FREQ, 481)
    assert.equal(CLEAR_N_ERB, 32)
    assert.equal(CLEAR_N_DF, 96)
    assert.equal(CLEAR_LOOKAHEAD, 2)
    assert.equal(CLEAR_CHUNK_FRAMES, 200)
    assert.equal(CLEAR_NORM_ALPHA, 0.99)
  })

  it('pins the 32 fixed ERB widths, which must sum to nFreq', () => {
    assert.equal(CLEAR_ERB_WIDTHS.length, 32)
    assert.equal(CLEAR_ERB_WIDTHS.reduce((sum, width) => sum + width, 0), CLEAR_N_FREQ)
    assert.deepEqual([...CLEAR_ERB_WIDTHS].slice(0, 15), [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 5])
    assert.deepEqual([...CLEAR_ERB_WIDTHS].slice(-3), [50, 56, 67])
  })

  it('pins the mastering targets the SDK applies by default', () => {
    assert.equal(CLEAR_TARGET_LUFS, -19)
    assert.equal(CLEAR_MAX_GAIN_DB, 9)
    assert.equal(CLEAR_PEAK_CEILING_DBTP, -1.5)
  })
})

describe('vorbisWindow', () => {
  it('is sin(pi/2 * sin^2(pi/2 * (n+0.5)/480))', () => {
    const window = vorbisWindow()
    assert.equal(window.length, 960)
    for (const n of [0, 1, 239, 480, 719, 959]) {
      const s = Math.sin((0.5 * Math.PI * (n + 0.5)) / 480)
      const expected = Math.sin(0.5 * Math.PI * s * s)
      assert.ok(Math.abs((window[n] ?? 0) - expected) < 1e-6, 'w[' + String(n) + ']')
    }
  })

  it('satisfies the Princen-Bradley condition for hop 480', () => {
    const window = vorbisWindow()
    for (const n of [0, 1, 120, 240, 360, 479]) {
      const sum = (window[n] ?? 0) ** 2 + (window[n + 480] ?? 0) ** 2
      assert.ok(Math.abs(sum - 1) < 1e-5, 'w^2[' + String(n) + '] + w^2[' + String(n + 480) + '] = ' + String(sum))
    }
  })
})

describe('ClearStft', () => {
  it('frames a one-second signal into 102 overlapping windows', () => {
    // padded = 480 prepad + max(ceil(48000/480)*480 + 960, 48000) = 480 + 48960.
    const stft = new ClearStft()
    const result = stft.forward(new Float32Array(CLEAR_SAMPLE_RATE))
    assert.equal(result.nFrames, 102)
    assert.equal(result.real.length, 102 * CLEAR_N_FREQ)
    assert.equal(result.imag.length, 102 * CLEAR_N_FREQ)
    for (const value of result.real) assert.ok(value === 0, 'a silent signal must have a zero spectrum')
  })

  it('places an impulse at the two frames that contain the 480-sample prepad', () => {
    // audio[0] lands at padded sample 480. Frame t starts at 480*t, so frame 0 sees it at
    // sample 480 (window[480]) and frame 1 at sample 0 (window[0]); both spectra are flat
    // with the 1/960 forward gain.
    const stft = new ClearStft()
    const audio = new Float32Array(CLEAR_SAMPLE_RATE)
    audio[0] = 1
    const result = stft.forward(audio)
    const window = vorbisWindow()
    for (let frame = 0; frame < result.nFrames; frame += 1) {
      for (let k = 0; k < CLEAR_N_FREQ; k += 1) {
        const at = frame * CLEAR_N_FREQ + k
        // Frame 0 holds the impulse at frame sample 480, and the DFT of a delta at m is
        // e^{-2*pi*i*k*m/N} = (-1)^k there; frame 1 holds it at sample 0, so it is flat.
        const expected = frame === 0
          ? ((k % 2 === 0 ? 1 : -1) * (window[480] ?? 0)) / 960
          : frame === 1 ? (window[0] ?? 0) / 960 : 0
        assert.ok(Math.abs((result.real[at] ?? 0) - expected) < 1e-6, 'frame ' + String(frame) + ' real[' + String(k) + ']: ' + String(result.real[at]))
        assert.ok(Math.abs(result.imag[at] ?? 0) < 1e-6)
      }
    }
  })

  it('round-trips a synthetic signal through inverse STFT', () => {
    const stft = new ClearStft()
    const audio = noise(CLEAR_SAMPLE_RATE, 3)
    const forward = stft.forward(audio)
    const back = stft.inverse(forward.real, forward.imag, forward.nFrames)
    assert.ok(back.length >= audio.length, 'the inverse must cover the whole signal')
    let worst = 0
    for (let i = 0; i < audio.length; i += 1) worst = Math.max(worst, Math.abs((back[i] ?? 0) - (audio[i] ?? 0)))
    assert.ok(worst < 1e-4, 'worst reconstruction error ' + String(worst))
  })

  it('reconstructs a sine without changing its amplitude', () => {
    const stft = new ClearStft()
    const audio = sine(24_000, 0.4)
    const forward = stft.forward(audio)
    const back = stft.inverse(forward.real, forward.imag, forward.nFrames)
    assert.ok(Math.abs(peak(back.subarray(0, audio.length)) - 0.4) < 1e-3)
  })
})

describe('clearFeatures', () => {
  it('computes ERB dB with the -60..-90 state ramp over 40', () => {
    const nFrames = 1
    const real = new Float32Array(CLEAR_N_FREQ)
    const imag = new Float32Array(CLEAR_N_FREQ)
    const features = clearFeatures(real, imag, nFrames)
    assert.equal(features.featErb.length, nFrames * CLEAR_N_ERB)
    for (let band = 0; band < CLEAR_N_ERB; band += 1) {
      const init = -60 + band * ((-90 - -60) / (CLEAR_N_ERB - 1))
      const state = -100 * (1 - CLEAR_NORM_ALPHA) + init * CLEAR_NORM_ALPHA
      const expected = (-100 - state) / 40
      assert.ok(Math.abs((features.featErb[band] ?? 0) - expected) < 1e-5, 'band ' + String(band))
    }
  })

  it('averages power per ERB band and converts to dB', () => {
    const real = new Float32Array(CLEAR_N_FREQ)
    const imag = new Float32Array(CLEAR_N_FREQ)
    // Band 0 is two bins wide; give it a mean power of 1. Band 31 is 67 bins wide.
    real[0] = 1
    real[1] = 1
    const features = clearFeatures(real, imag, 1)
    const init0 = -60
    const state0 = 0 * (1 - CLEAR_NORM_ALPHA) + init0 * CLEAR_NORM_ALPHA
    assert.ok(Math.abs((features.featErb[0] ?? 0) - (0 - state0) / 40) < 1e-5)
  })

  it('unit-normalizes the first 96 complex bins with a 1e-3..1e-4 ramp', () => {
    const real = new Float32Array(CLEAR_N_FREQ)
    const imag = new Float32Array(CLEAR_N_FREQ)
    for (let k = 0; k < CLEAR_N_DF; k += 1) real[k] = 2
    const features = clearFeatures(real, imag, 1)
    for (const k of [0, 1, 95]) {
      const init = 0.001 + k * ((0.0001 - 0.001) / (CLEAR_N_DF - 1))
      const state = 2 * (1 - CLEAR_NORM_ALPHA) + init * CLEAR_NORM_ALPHA
      const expected = 2 / Math.sqrt(state)
      assert.ok(Math.abs((features.featSpecReal[k] ?? 0) - expected) < 1e-5, 'k=' + String(k))
      assert.equal(features.featSpecImag[k], 0)
    }
  })

  it('carries the running state across frames', () => {
    const real = new Float32Array(CLEAR_N_FREQ * 2)
    const imag = new Float32Array(CLEAR_N_FREQ * 2)
    real[0] = 1
    real[CLEAR_N_FREQ] = 3
    const features = clearFeatures(real, imag, 2)
    const alpha = CLEAR_NORM_ALPHA
    // Frame 0 band 0 mean power = (1^2 + 0^2) / 2; frame 1 band 0 = (3^2 + 0^2) / 2.
    const db0 = 10 * Math.log10(0.5 + 1e-10)
    const state0 = db0 * (1 - alpha) + -60 * alpha
    const db1 = 10 * Math.log10(4.5 + 1e-10)
    const state1 = db1 * (1 - alpha) + state0 * alpha
    const expected = (db1 - state1) / 40
    assert.ok(Math.abs((features.featErb[CLEAR_N_ERB] ?? 0) - expected) < 1e-5)
  })
})

describe('clearChunkInputs', () => {
  it('packs one full 200-frame window with a two-frame feature lookahead', () => {
    const nFrames = 250
    const specReal = new Float32Array(nFrames * CLEAR_N_FREQ)
    const specImag = new Float32Array(nFrames * CLEAR_N_FREQ)
    const featErb = new Float32Array(nFrames * CLEAR_N_ERB)
    const featSpecReal = new Float32Array(nFrames * CLEAR_N_DF)
    const featSpecImag = new Float32Array(nFrames * CLEAR_N_DF)
    for (let frame = 0; frame < nFrames; frame += 1) {
      for (let k = 0; k < CLEAR_N_FREQ; k += 1) specReal[frame * CLEAR_N_FREQ + k] = frame
      for (let k = 0; k < CLEAR_N_ERB; k += 1) featErb[frame * CLEAR_N_ERB + k] = frame + 1000
      for (let k = 0; k < CLEAR_N_DF; k += 1) featSpecReal[frame * CLEAR_N_DF + k] = frame + 2000
    }
    const chunk = clearChunkInputs({ specReal, specImag, featErb, featSpecReal, featSpecImag, nFrames, start: 0 })
    assert.equal(chunk.chunkFrames, 200)
    assert.equal(chunk.validFrames, 200)
    assert.equal(chunk.spec.length, 200 * CLEAR_N_FREQ * 2)
    assert.equal(chunk.featErb.length, 200 * CLEAR_N_ERB)
    assert.equal(chunk.featSpec.length, 200 * CLEAR_N_DF * 2)
    // Interleaved complex at (t, k) = (re, im), spectrum read at the window frame.
    assert.equal(chunk.spec[(0 * CLEAR_N_FREQ + 0) * 2], 0)
    assert.equal(chunk.spec[(1 * CLEAR_N_FREQ + 3) * 2], 1)
    // Features are read two frames ahead.
    assert.equal(chunk.featErb[0], 2 + 1000)
    assert.equal(chunk.featSpec[0], 2 + 2000)
    assert.equal(chunk.featSpec[1], 0)
  })

  it('zero-fills the tail window and clamps the feature lookahead', () => {
    const nFrames = 203
    const specReal = new Float32Array(nFrames * CLEAR_N_FREQ).fill(1)
    const specImag = new Float32Array(nFrames * CLEAR_N_FREQ)
    const featErb = new Float32Array(nFrames * CLEAR_N_ERB).fill(1)
    const featSpecReal = new Float32Array(nFrames * CLEAR_N_DF).fill(1)
    const featSpecImag = new Float32Array(nFrames * CLEAR_N_DF)
    const chunk = clearChunkInputs({ specReal, specImag, featErb, featSpecReal, featSpecImag, nFrames, start: 200 })
    assert.equal(chunk.validFrames, 3)
    // The spectrum has frames 200, 201, 202 and then zeros.
    assert.equal(chunk.spec[0], 1)
    assert.equal(chunk.spec[(2 * CLEAR_N_FREQ) * 2], 1)
    assert.equal(chunk.spec[(3 * CLEAR_N_FREQ) * 2], 0)
    // Features have frames 202 only (start + 2) and then zeros.
    assert.equal(chunk.featErb[0], 1)
    assert.equal(chunk.featErb[1 * CLEAR_N_ERB], 0)
    assert.equal(chunk.featSpec[0], 1)
    assert.equal(chunk.featSpec[1 * CLEAR_N_DF * 2], 0)
  })

  it('scatters only the valid frames of a chunk back into the spectrogram', () => {
    const nFrames = 250
    const outReal = new Float32Array(nFrames * CLEAR_N_FREQ)
    const outImag = new Float32Array(nFrames * CLEAR_N_FREQ)
    const enhanced = new Float32Array(CLEAR_CHUNK_FRAMES * CLEAR_N_FREQ * 2)
    enhanced[0] = 7
    enhanced[(1 * CLEAR_N_FREQ + 2) * 2] = 8
    scatterEnhanced({ enhanced, chunkFrames: CLEAR_CHUNK_FRAMES, start: 200, validFrames: 50, outReal, outImag })
    assert.equal(outReal[(200 * CLEAR_N_FREQ + 0)], 7)
    assert.equal(outReal[((200 + 1) * CLEAR_N_FREQ + 2)], 8)
    assert.equal(outReal[(201 * CLEAR_N_FREQ + 0)], 0)
  })
})

describe('loudness', () => {
  it('returns nil for silence and for audio shorter than one 400 ms block', () => {
    assert.equal(integratedLufs(new Float32Array(CLEAR_SAMPLE_RATE), CLEAR_SAMPLE_RATE), null)
    assert.equal(integratedLufs(sine(10_000, 0.5), CLEAR_SAMPLE_RATE), null)
  })

  it('measures a 20 dB amplitude change as a 20 dB loudness change', () => {
    const loud = integratedLufs(sine(2 * CLEAR_SAMPLE_RATE, 1), CLEAR_SAMPLE_RATE)
    const quiet = integratedLufs(sine(2 * CLEAR_SAMPLE_RATE, 0.1), CLEAR_SAMPLE_RATE)
    assert.ok(loud !== null && quiet !== null)
    assert.ok(Math.abs((loud ?? 0) - (quiet ?? 0) - 20) < 0.05, 'difference ' + String((loud ?? 0) - (quiet ?? 0)))
  })

  it('caps upward gain at +9 dB', () => {
    const samples = sine(2 * CLEAR_SAMPLE_RATE, 0.001)
    const before = peak(samples)
    const measured = normalizeLoudnessInPlace(samples)
    assert.ok(measured !== null)
    // 0.001 is far below target-9dB, so the cap is what applies.
    const expected = before * Math.pow(10, CLEAR_MAX_GAIN_DB / 20)
    assert.ok(Math.abs(peak(samples) - expected) < 1e-6, 'peak ' + String(peak(samples)) + ' expected ' + String(expected))
  })

  it('applies min(maxGain, target - measured) and never exceeds the peak ceiling', () => {
    const samples = sine(2 * CLEAR_SAMPLE_RATE, 0.1)
    const before = peak(samples)
    const measured = integratedLufs(samples, CLEAR_SAMPLE_RATE)
    assert.ok(measured !== null)
    const applied = normalizeLoudnessInPlace(samples)
    assert.ok(applied !== null)
    const gainDb = Math.min(CLEAR_MAX_GAIN_DB, CLEAR_TARGET_LUFS - (measured ?? 0))
    const ceiling = Math.pow(10, CLEAR_PEAK_CEILING_DBTP / 20)
    const expectedPeak = Math.min(before * Math.pow(10, gainDb / 20), ceiling)
    assert.ok(peak(samples) <= ceiling + 1e-6)
    assert.ok(Math.abs(peak(samples) - expectedPeak) < 0.01, 'peak ' + String(peak(samples)) + ' expected ' + String(expectedPeak))
  })
})

describe('limiter', () => {
  it('holds a DC signal at the ceiling', () => {
    const samples = new Float32Array(4_800).fill(1)
    limitInPlace(samples, -6.0206, CLEAR_SAMPLE_RATE)
    const ceiling = Math.pow(10, -6.0206 / 20)
    for (const value of samples) assert.ok(value <= ceiling + 1e-6)
    assert.ok(Math.abs((samples[0] ?? 0) - ceiling) < 1e-5)
  })

  it('attenuates a whole 5 ms lookahead window BEFORE the peak arrives', () => {
    const samples = new Float32Array(1_000).fill(0.1)
    samples[300] = 1
    limitInPlace(samples, -6.0206, CLEAR_SAMPLE_RATE)
    const ceiling = Math.pow(10, -6.0206 / 20)
    // 240-sample lookahead: the envelope is already down at sample 60.
    assert.ok(Math.abs((samples[59] ?? 0) - 0.1) < 1e-6, 'before the window')
    assert.ok(Math.abs((samples[60] ?? 0) - 0.1 * ceiling) < 1e-5, 'inside the window: ' + String(samples[60]))
    assert.ok(Math.abs((samples[300] ?? 0) - ceiling) < 1e-5, 'at the peak')
    assert.ok(peak(samples) <= ceiling + 1e-6)
  })
})

describe('encodePcm16Wav', () => {
  it('writes a 16-bit PCM mono WAV that the decoder reads back', () => {
    const samples = sine(480, 0.5)
    const wav = encodePcm16Wav(samples, CLEAR_SAMPLE_RATE)
    assert.equal(wav.length, CLEAR_WAV_HEADER_BYTES + samples.length * 2)
    const decoded = decodeWav(wav)
    if (!decoded.ok) assert.fail('the encoded WAV must decode: ' + decoded.reason)
    assert.equal(decoded.audio.sampleRate, CLEAR_SAMPLE_RATE)
    assert.equal(decoded.audio.channels, 1)
    assert.equal(decoded.audio.encoding, 'pcm16')
    let worst = 0
    for (let i = 0; i < samples.length; i += 1) {
      worst = Math.max(worst, Math.abs((decoded.audio.samples[i] ?? 0) - (samples[i] ?? 0)))
    }
    assert.ok(worst <= 1 / 32_000 + 1e-6, 'quantisation error ' + String(worst))
  })

  it('clamps out-of-range samples instead of wrapping', () => {
    const wav = encodePcm16Wav(new Float32Array([2, -2]), CLEAR_SAMPLE_RATE)
    const decoded = decodeWav(wav)
    if (!decoded.ok) assert.fail('the encoded WAV must decode')
    assert.ok(Math.abs((decoded.audio.samples[0] ?? 0) - 1) < 1e-4)
    assert.ok(Math.abs((decoded.audio.samples[1] ?? 0) + 1) < 1e-4)
  })
})

describe('maxSamplesForResultBudget', () => {
  it('derives 65.527 s from the host default 8 MiB result budget', () => {
    const samples = maxSamplesForResultBudget(8 * 1024 * 1024)
    assert.equal(samples, 3_145_322)
    assert.ok(Math.abs(samples / CLEAR_SAMPLE_RATE - 65.52754166666667) < 1e-9)
  })

  it('reserves the JSON envelope and the WAV header so the whole payload fits', () => {
    for (const budget of [8 * 1024 * 1024, 1_048_576, 4 * 1024 * 1024]) {
      const samples = maxSamplesForResultBudget(budget)
      const wavBytes = CLEAR_WAV_HEADER_BYTES + samples * 2
      const base64Bytes = 4 * Math.ceil(wavBytes / 3)
      assert.ok(base64Bytes + CLEAR_OUTPUT_ENVELOPE_BYTES <= budget, 'budget ' + String(budget))
      // One more sample would not fit.
      const nextWav = CLEAR_WAV_HEADER_BYTES + (samples + 1) * 2
      const nextBase64 = 4 * Math.ceil(nextWav / 3)
      assert.ok(nextBase64 + CLEAR_OUTPUT_ENVELOPE_BYTES > budget || samples === 0, 'budget ' + String(budget))
    }
  })

  it('refuses a budget that cannot hold even a WAV header', () => {
    assert.equal(maxSamplesForResultBudget(0), 0)
    assert.equal(maxSamplesForResultBudget(-1), 0)
    assert.equal(maxSamplesForResultBudget(64), 0)
  })
})
