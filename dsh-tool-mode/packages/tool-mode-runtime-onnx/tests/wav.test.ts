/**
 * WAV decode, resample and windowing tests (PHASE3 processor uhm/waveform-v1, steps 1-2).
 *
 * These are pure functions over bytes, so the tests can state the exact header and the
 * exact sample values they expect. A recorder never produces most of the rejected
 * headers; a corrupt file does.
 *
 * @module tests/wav
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  UHM_HOP_SAMPLES,
  UHM_SAMPLE_RATE,
  UHM_WINDOW_SAMPLES,
  decodeWav,
  resampleLinear,
  windowsOf,
} from '../src/index.ts'
import { buildWav, rawWav } from './support.ts'

/** Decode a document that is expected to succeed. */
function mustDecode(bytes: Uint8Array) {
  const result = decodeWav(bytes)
  if (!result.ok) assert.fail('expected the WAV to decode: ' + result.reason)
  return result.audio
}

/** Assert a decode refusal whose reason matches a pattern. */
function refused(bytes: Uint8Array, pattern: RegExp): void {
  const result = decodeWav(bytes)
  assert.ok(!result.ok, 'expected the WAV to be refused')
  assert.match(result.reason, pattern)
}

describe('decodeWav', () => {
  it('decodes 16 kHz mono PCM 16-bit to float samples', () => {
    const audio = mustDecode(buildWav({ samples: [0, 0.5, -0.5, 1, -1] }))
    assert.equal(audio.encoding, 'pcm16')
    assert.equal(audio.sampleRate, 16_000)
    assert.equal(audio.channels, 1)
    assert.equal(audio.samples.length, 5)
    assert.equal(audio.samples[0], 0)
    assert.ok(Math.abs((audio.samples[1] ?? 0) - 0.5) < 1e-4)
    assert.ok(Math.abs((audio.samples[2] ?? 0) + 0.5) < 1e-4)
    assert.ok(Math.abs((audio.samples[3] ?? 0) - 1) < 1e-4)
    assert.ok(Math.abs((audio.samples[4] ?? 0) + 1) < 1e-4)
  })

  it('decodes float32 mono samples unchanged', () => {
    const audio = mustDecode(buildWav({ format: 'float32', samples: [0.25, -0.75, 1] }))
    assert.equal(audio.encoding, 'float32')
    assert.deepEqual(Array.from(audio.samples), [0.25, -0.75, 1])
  })

  it('down-mixes stereo by averaging the channels', () => {
    const audio = mustDecode(buildWav({ format: 'float32', channels: 2, samples: [1, 0, 0.5, 0.5, -1, 1] }))
    assert.equal(audio.channels, 2)
    assert.equal(audio.samples.length, 3)
    assert.deepEqual(Array.from(audio.samples), [0.5, 0.5, 0])
  })

  it('keeps a stereo 16-bit file decodable', () => {
    const audio = mustDecode(buildWav({ channels: 2, samples: [1, 1, -1, -1] }))
    assert.equal(audio.channels, 2)
    assert.equal(audio.samples.length, 2)
  })

  it('refuses a document that is not RIFF/WAVE', () => {
    refused(rawWav({ riff: 'RIFX' }), /RIFF/)
    refused(rawWav({ wave: 'WAVX' }), /WAVE/)
    refused(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), /RIFF/)
  })

  it('refuses a truncated header', () => {
    refused(buildWav({ samples: [0, 0] }).slice(0, 20), /truncated|fmt|header/i)
  })

  it('refuses a document with no data chunk', () => {
    refused(rawWav({ omitData: true }), /data/)
  })

  it('refuses an unsupported sample format', () => {
    refused(rawWav({ audioFormat: 2 }), /format|PCM|float/i)
    refused(rawWav({ bitsPerSample: 24, data: new Uint8Array(3) }), /bits|format/i)
    refused(rawWav({ bitsPerSample: 8, data: new Uint8Array(1) }), /bits|format/i)
  })

  it('refuses an unsupported channel count', () => {
    refused(rawWav({ channels: 0 }), /channel/i)
    refused(rawWav({ channels: 3 }), /channel/i)
  })

  it('refuses a channel count above two even in a float file', () => {
    refused(rawWav({ audioFormat: 3, bitsPerSample: 32, channels: 4, data: new Uint8Array(16) }), /channel/i)
  })

  it('refuses a data chunk that is not a whole number of frames', () => {
    refused(rawWav({ channels: 2, data: new Uint8Array(3) }), /frame|data/i)
  })

  it('refuses a zero sample rate', () => {
    refused(rawWav({ sampleRate: 0 }), /sample rate/i)
  })
})

describe('resampleLinear', () => {
  it('returns a copy at the native rate', () => {
    const input = new Float32Array([0, 1, 2, 3])
    const output = resampleLinear(input, 16_000, 16_000)
    assert.notEqual(output, input)
    assert.deepEqual(Array.from(output), [0, 1, 2, 3])
  })

  it('interpolates linearly when up-sampling', () => {
    const output = resampleLinear(new Float32Array([0, 1, 2, 3]), 8_000, 16_000)
    assert.equal(output.length, 8)
    const expected = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3]
    for (let index = 0; index < expected.length; index += 1) {
      assert.ok(Math.abs((output[index] ?? 0) - (expected[index] ?? 0)) < 1e-6, 'sample ' + String(index))
    }
  })

  it('interpolates linearly when down-sampling', () => {
    const output = resampleLinear(new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]), 16_000, 8_000)
    assert.equal(output.length, 4)
    const expected = [0, 2, 4, 6]
    for (let index = 0; index < expected.length; index += 1) {
      assert.ok(Math.abs((output[index] ?? 0) - (expected[index] ?? 0)) < 1e-6, 'sample ' + String(index))
    }
  })

  it('refuses a non-positive sample rate', () => {
    assert.throws(() => resampleLinear(new Float32Array([0]), 0, 16_000), /sample rate/i)
    assert.throws(() => resampleLinear(new Float32Array([0]), 16_000, 0), /sample rate/i)
  })

  it('returns an empty array for empty audio', () => {
    assert.equal(resampleLinear(new Float32Array(0), 44_100, 16_000).length, 0)
  })
})

describe('windowsOf', () => {
  it('produces one zero-padded window for audio shorter than 30 s', () => {
    const samples = new Float32Array(16_000).fill(0.5)
    const windows = windowsOf(samples)
    assert.equal(windows.length, 1)
    assert.equal(windows[0]?.startSample, 0)
    assert.equal(windows[0]?.samples.length, UHM_WINDOW_SAMPLES)
    assert.equal(windows[0]?.samples[0], 0.5)
    assert.equal(windows[0]?.samples[16_000], 0)
    assert.equal(windows[0]?.samples[UHM_WINDOW_SAMPLES - 1], 0)
  })

  it('overlaps by one second: exactly 30 s still needs two windows', () => {
    const samples = new Float32Array(UHM_WINDOW_SAMPLES)
    const windows = windowsOf(samples)
    assert.equal(windows.length, 2)
    assert.equal(windows[1]?.startSample, UHM_HOP_SAMPLES)
    assert.equal(UHM_WINDOW_SAMPLES - UHM_HOP_SAMPLES, UHM_SAMPLE_RATE)
  })

  it('advances by the hop for long audio and pads only the last window', () => {
    const samples = new Float32Array(UHM_WINDOW_SAMPLES + UHM_HOP_SAMPLES)
    const windows = windowsOf(samples)
    assert.equal(windows.length, 3)
    assert.deepEqual(windows.map((window) => window.startSample), [0, UHM_HOP_SAMPLES, 2 * UHM_HOP_SAMPLES])
    assert.equal(windows[2]?.samples.length, UHM_WINDOW_SAMPLES)
  })

  it('produces no window for empty audio', () => {
    assert.deepEqual(windowsOf(new Float32Array(0)), [])
  })

  it('copies the window so a caller cannot mutate the source through it', () => {
    const samples = new Float32Array(10).fill(1)
    const windows = windowsOf(samples, { windowSamples: 8, hopSamples: 4 })
    const first = windows[0]
    if (first === undefined) assert.fail('expected a window')
    first.samples[0] = 9
    assert.equal(samples[0], 1)
  })

  it('accepts explicit geometry and refuses geometry that would skip audio', () => {
    const samples = new Float32Array(100)
    assert.equal(windowsOf(samples, { windowSamples: 40, hopSamples: 30 }).length, 4)
    assert.throws(() => windowsOf(samples, { windowSamples: 40, hopSamples: 50 }), /hop/i)
    assert.throws(() => windowsOf(samples, { windowSamples: 0, hopSamples: 1 }), /window/i)
    assert.throws(() => windowsOf(samples, { windowSamples: 10, hopSamples: 0 }), /hop/i)
  })
})
