/**
 * The ear front end against the primary source's own arithmetic.
 *
 * PROVENANCE (Desert-Ant-Labs/desert-ant-core @ baf4e6e3b4655c8e54aa8d5a25215b5f35f899a7):
 * - Sources/Ear/Frontend.swift:9-10 (side? NO: nFFT/hop/mels/frames live in the meta), :25-40
 *   geometry, :48-63 Hann periodic + center STFT, :65-106 features, :163-221 modulation.
 * - Sources/AudioDSP/STFT.swift:68-106 (bins = nFFT/2 + 1), :109-158 (reflect pad, frames).
 * - Sources/AudioDSP/Windowing.swift:21-27 Hann periodic, :30-41 reflect pad (no edge repeat).
 * - Sources/Ear/ear_meta.json: sample_rate 16000, n_fft 400, hop 160, n_mels 80, frames 3000,
 *   window hann_periodic, log10, clamp 1e-10, floor 8 decades, affine add 4 divide 4.
 *
 * The analytical tone tests are exact rather than approximate: a 1 kHz sine over a 400-sample
 * frame has all its energy in bin 25 (16 kHz * 25 / 400), and a periodic Hann window sums to
 * 200, so the coherent power is 100^2 = 10000 and the affine feature is (4 + 4) / 4 = 2.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
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
  hannPeriodic,
  logMelFeatures,
  modulationScores,
  parseMelFilters,
  reflectPad,
  stftPower,
  windowOffsets,
} from '../src/ear-frontend.ts'
import { concatSegments, burst, melFiltersAtBin, melFiltersBytes, sine } from './ear-fixtures.ts'

describe('ear front-end constants', () => {
  it('pins the primary-source geometry', () => {
    assert.equal(EAR_SAMPLE_RATE, 16000)
    assert.equal(EAR_N_FFT, 400)
    assert.equal(EAR_HOP, 160)
    assert.equal(EAR_MELS, 80)
    assert.equal(EAR_FRAMES, 3000)
    assert.equal(EAR_BINS, 201)
    assert.equal(EAR_WINDOW_SAMPLES, 480000)
    assert.equal(EAR_CLAMP_MIN, 1e-10)
    assert.equal(EAR_FLOOR_DECADES, 8)
    assert.equal(EAR_AFFINE_ADD, 4)
    assert.equal(EAR_AFFINE_DIVIDE, 4)
    assert.equal(EAR_DEFAULT_WINDOWS, 3)
    assert.equal(EAR_HANN.length, 400)
  })

  it('builds the periodic Hann window named in the meta', () => {
    const window = hannPeriodic(8)
    // d = count for periodic: 0.5 - 0.5 cos(2 pi k / 8)
    assert.deepEqual(Array.from(window).map((v) => Math.round(v * 1e6) / 1e6), [0, 0.146447, 0.5, 0.853553, 1, 0.853553, 0.5, 0.146447])
  })

  it('reflect-pads without repeating the edge sample (torch.stft center=True)', () => {
    assert.deepEqual(Array.from(reflectPad(Float32Array.from([1, 2, 3, 4, 5]), 2)), [3, 2, 1, 2, 3, 4, 5, 4, 3])
    assert.deepEqual(Array.from(reflectPad(Float32Array.from([1, 2, 3]), 0)), [1, 2, 3])
  })
})

describe('mel filterbank parsing', () => {
  it('reads the uint32 header and little-endian float32 payload, mel-major', () => {
    const bytes = melFiltersBytes({ mels: 2, bins: 3 })
    const view = new DataView(bytes.buffer)
    view.setFloat32(8 + 0 * 4, 0.5, true)
    view.setFloat32(8 + 1 * 4, 1.5, true)
    view.setFloat32(8 + 2 * 4, -2.5, true)
    const filters = parseMelFilters(bytes)
    assert.equal(filters.mels, 2)
    assert.equal(filters.bins, 3)
    assert.deepEqual(Array.from(filters.values.slice(0, 3)), [0.5, 1.5, -2.5])
    assert.equal(filters.values.length, 6)
  })

  it('refuses a truncated filterbank by name', () => {
    assert.throws(() => parseMelFilters(new Uint8Array(4)), /truncated/)
    const bytes = melFiltersBytes()
    assert.throws(() => parseMelFilters(bytes.slice(0, bytes.length - 4)), /truncated/)
  })
})

describe('STFT and log-mel features', () => {
  it('puts a 1 kHz tone in bin 25 with coherent power 10000', () => {
    const samples = sine({ sampleRate: EAR_SAMPLE_RATE, seconds: 0.04, hz: 1000, amplitude: 1 })
    const spectrum = stftPower(samples)
    // 640 samples, reflect pad 200: 1 + (1040 - 400) / 160 = 5 frames.
    assert.equal(spectrum.frames, 5)
    assert.equal(spectrum.bins, 201)
    const frame = 2
    let bestBin = -1
    let bestPower = -1
    for (let bin = 0; bin < spectrum.bins; bin += 1) {
      const power = spectrum.power[frame * spectrum.bins + bin] ?? 0
      if (power > bestPower) {
        bestPower = power
        bestBin = bin
      }
    }
    assert.equal(bestBin, 25)
    assert.ok(Math.abs(bestPower - 10000) / 10000 < 1e-3, 'coherent power is 10000; got ' + String(bestPower))
  })

  it('turns the tone into a mel-major log-mel tensor anchored on the loudest bin', () => {
    const samples = sine({ sampleRate: EAR_SAMPLE_RATE, seconds: 0.04, hz: 1000, amplitude: 1 })
    const features = logMelFeatures(samples, parseMelFilters(melFiltersAtBin(25)))
    assert.equal(features.length, EAR_MELS * EAR_FRAMES)
    // Mel 25 passes bin 25: log10(10000) = 4 -> (4 + 4) / 4 = 2.
    assert.ok(Math.abs((features[25 * EAR_FRAMES + 2] ?? 0) - 2) < 1e-3, 'mel 25 frame 2 is 2.0')
    // A mel that passes nothing is clamped then floored at peak - 8 decades: (-4 + 4) / 4 = 0.
    assert.ok(Math.abs(features[0 * EAR_FRAMES + 2] ?? -1) < 1e-6)
  })

  it('pads audio shorter than one window with silence instead of rejecting it', () => {
    const short = sine({ sampleRate: EAR_SAMPLE_RATE, seconds: 0.5, hz: 220 })
    const fromShort = logMelFeatures(short, parseMelFilters(melFiltersBytes()))
    assert.equal(fromShort.length, EAR_MELS * EAR_FRAMES)
    // Padding is exactly "the same samples followed by zeros": compare with an explicitly
    // zero-padded window. (The floor is relative to the file's own peak, so comparing against
    // a separate all-silent file would be wrong.)
    const explicit = new Float32Array(EAR_WINDOW_SAMPLES)
    explicit.set(short)
    const fromExplicit = logMelFeatures(explicit, parseMelFilters(melFiltersBytes()))
    assert.deepEqual(Array.from(fromShort.slice(0, 500)), Array.from(fromExplicit.slice(0, 500)))
  })
})

describe('window selection', () => {
  it('scores silent candidate windows at zero and ranks syllabic bursts first', () => {
    const silence = new Float32Array(EAR_SAMPLE_RATE * 5)
    const bursts = burst({ sampleRate: EAR_SAMPLE_RATE, seconds: 5, hz: 300, onMs: 100, offMs: 100 })
    const samples = concatSegments([silence, bursts, silence, bursts])
    const scored = modulationScores(samples, { hop: EAR_HOP, window: EAR_SAMPLE_RATE, step: EAR_SAMPLE_RATE / 2 })
    assert.ok(scored.length > 10)
    assert.equal(scored[0]?.offset, 0)
    assert.equal(scored[0]?.score, 0, 'a fully silent window is excluded from ranking')
    const best = [...scored].sort((a, b) => b.score - a.score)[0]
    assert.ok(best !== undefined)
    // Bursts occupy 5-10 s and 15-20 s; the best one-second window must intersect one.
    const window = EAR_SAMPLE_RATE
    const overlaps = (startSeconds: number, endSeconds: number): boolean =>
      best.offset < endSeconds * EAR_SAMPLE_RATE && best.offset + window > startSeconds * EAR_SAMPLE_RATE
    assert.ok(
      overlaps(5, 10) || overlaps(15, 20),
      'the best window intersects a syllabic burst; got offset ' + String(best.offset),
    )
  })

  it('returns [0] for audio no longer than one window', () => {
    assert.deepEqual(windowOffsets(new Float32Array(EAR_WINDOW_SAMPLES), 3), [0])
    assert.deepEqual(windowOffsets(new Float32Array(1000), 3), [0])
  })

  it('spreads selected windows across a long recording, ascending', () => {
    const speechA = burst({ sampleRate: EAR_SAMPLE_RATE, seconds: 10, hz: 300, onMs: 100, offMs: 100 })
    const speechB = burst({ sampleRate: EAR_SAMPLE_RATE, seconds: 10, hz: 300, onMs: 120, offMs: 80 })
    const silence = new Float32Array(EAR_SAMPLE_RATE * 10)
    const longTail = new Float32Array(EAR_SAMPLE_RATE * 30)
    const samples = concatSegments([new Float32Array(EAR_SAMPLE_RATE * 5), speechA, silence, speechB, longTail])
    const offsets = windowOffsets(samples, 3)
    assert.equal(offsets.length, 3)
    assert.deepEqual([...offsets].sort((a, b) => a - b), [...offsets])
    assert.ok(offsets.every((offset) => offset % 160000 === 0), 'offsets use the window/3 step')
    assert.ok(offsets.every((offset) => offset <= samples.length - EAR_WINDOW_SAMPLES))
  })
})
