/**
 * WAV decoding and linear resampling for the ear tool.
 *
 * The decoder is the same contract as the Phase 3 waveform processor (PCM 16-bit or IEEE
 * float32, mono or stereo, any rate), duplicated here so the LiteRT deployment carries no
 * ONNX dependency. Everything unsupported is refused BY NAME.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { EAR_SAMPLE_RATE, decodeWav, resampleLinear } from '../src/wav.ts'
import { encodeWav, sine } from './ear-fixtures.ts'

const messageOf = (error: unknown): string => {
  assert.ok(error instanceof Error)
  return error.message
}

describe('decodeWav', () => {
  it('decodes PCM 16-bit mono', () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 1, -1])
    const decoded = decodeWav(encodeWav({ sampleRate: 16000, channels: 1, encoding: 'pcm16', samples }))
    assert.equal(decoded.sampleRate, 16000)
    assert.equal(decoded.channels, 1)
    assert.equal(decoded.encoding, 'pcm16')
    for (let index = 0; index < samples.length; index += 1) {
      assert.ok(Math.abs((decoded.samples[index] ?? 0) - (samples[index] ?? 0)) < 1 / 32000)
    }
  })

  it('decodes IEEE float32 and keeps exact values', () => {
    const samples = Float32Array.from([0.25, -0.75, 0.001])
    const decoded = decodeWav(encodeWav({ sampleRate: 44100, channels: 1, encoding: 'float32', samples }))
    assert.deepEqual(Array.from(decoded.samples), Array.from(samples))
    assert.equal(decoded.sampleRate, 44100)
  })

  it('averages stereo channels', () => {
    const samples = Float32Array.from([0.5, -0.5, 0.25, 0.75])
    const decoded = decodeWav(encodeWav({ sampleRate: 16000, channels: 2, encoding: 'float32', samples }))
    assert.deepEqual(Array.from(decoded.samples), [0, 0.5])
  })

  it('refuses non-RIFF, non-WAVE, 24-bit, three channels and extensible format by name', () => {
    assert.throws(() => decodeWav(new TextEncoder().encode('not a wav at all')), (e) => /RIFF/.test(messageOf(e)))
    assert.throws(
      () => decodeWav(encodeWav({ sampleRate: 16000, channels: 1, encoding: 'pcm16', samples: new Float32Array(4), audioFormat: 0xfffe })),
      (e) => /format|supported/.test(messageOf(e)),
    )
    assert.throws(
      () => decodeWav(encodeWav({ sampleRate: 16000, channels: 1, encoding: 'pcm16', samples: new Float32Array(4), bitsPerSample: 24 })),
      (e) => /24/.test(messageOf(e)),
    )
    assert.throws(
      () => decodeWav(encodeWav({ sampleRate: 16000, channels: 3, encoding: 'pcm16', samples: new Float32Array(6) })),
      (e) => /channels/.test(messageOf(e)),
    )
  })

  it('refuses a partial sample frame', () => {
    const bytes = encodeWav({ sampleRate: 16000, channels: 2, encoding: 'pcm16', samples: new Float32Array(4), truncateDataBytes: 6 })
    assert.throws(() => decodeWav(bytes), (e) => /whole number|truncated/.test(messageOf(e)))
  })
})

describe('resampleLinear', () => {
  it('doubles a 8 kHz signal to 16 kHz and keeps its shape', () => {
    const samples = sine({ sampleRate: 8000, seconds: 0.1, hz: 100, amplitude: 1 })
    const out = resampleLinear(samples, 8000, EAR_SAMPLE_RATE)
    assert.equal(out.length, Math.round(samples.length * 2))
    assert.ok(Math.abs((out[10] ?? 0) - (samples[5] ?? 0)) < 1e-3)
  })

  it('returns a copy when the rate already matches', () => {
    const samples = Float32Array.from([0.1, 0.2, 0.3])
    const out = resampleLinear(samples, EAR_SAMPLE_RATE, EAR_SAMPLE_RATE)
    assert.deepEqual(Array.from(out), Array.from(samples))
    assert.notEqual(out, samples)
    assert.notEqual(out.buffer, samples.buffer)
  })

  it('rounds the output length for a 44.1 kHz source', () => {
    const samples = new Float32Array(44100)
    const out = resampleLinear(samples, 44100, EAR_SAMPLE_RATE)
    assert.equal(out.length, Math.round((44100 * EAR_SAMPLE_RATE) / 44100))
  })

  it('refuses a non-positive rate', () => {
    assert.throws(() => resampleLinear(Float32Array.from([1]), 0, EAR_SAMPLE_RATE), /positive/)
    assert.throws(() => resampleLinear(Float32Array.from([1]), EAR_SAMPLE_RATE, -1), /positive/)
  })
})
