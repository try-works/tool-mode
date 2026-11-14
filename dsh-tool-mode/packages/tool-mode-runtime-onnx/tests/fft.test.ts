/**
 * FFT tests for the clear processor.
 *
 * The clear graph was trained on a 960-point DFT (libDF / DeepFilterNet3). A 1024-point
 * transform would be the same "size" to a careless implementation and a DIFFERENT
 * spectrogram to the model, so the tests pin the transform against a naive DFT rather
 * than against another FFT.
 *
 * @module tests/fft
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Dft960, Radix2Fft } from '../src/fft.ts'

/** A complex vector, for the comparison helpers. */
interface ComplexVector {
  readonly real: Float64Array
  readonly imag: Float64Array
}

/** The textbook DFT, e^{-2*pi*i*k*n/N}, for comparison only. */
function naiveDft(real: ArrayLike<number>, imag: ArrayLike<number>): ComplexVector {
  const n = real.length
  const outReal = new Float64Array(n)
  const outImag = new Float64Array(n)
  for (let k = 0; k < n; k += 1) {
    let sumReal = 0
    let sumImag = 0
    for (let t = 0; t < n; t += 1) {
      const angle = (-2 * Math.PI * k * t) / n
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const xr = real[t] ?? 0
      const xi = imag[t] ?? 0
      sumReal += xr * cos - xi * sin
      sumImag += xr * sin + xi * cos
    }
    outReal[k] = sumReal
    outImag[k] = sumImag
  }
  return { real: outReal, imag: outImag }
}

/** A deterministic pseudo-random vector in [-1, 1]. */
function pseudoRandom(length: number, seed = 7): ComplexVector {
  let state = seed >>> 0
  const next = (): number => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return (state / 0xffff_ffff) * 2 - 1
  }
  const real = new Float64Array(length)
  const imag = new Float64Array(length)
  for (let i = 0; i < length; i += 1) {
    real[i] = next()
    imag[i] = next()
  }
  return { real, imag }
}

/** Assert two complex vectors agree within a tolerance. */
function assertClose(actualReal: ArrayLike<number>, actualImag: ArrayLike<number>, expectedReal: ArrayLike<number>, expectedImag: ArrayLike<number>, tolerance: number): void {
  assert.equal(actualReal.length, expectedReal.length)
  let worst = 0
  for (let i = 0; i < expectedReal.length; i += 1) {
    worst = Math.max(worst, Math.abs((actualReal[i] ?? 0) - (expectedReal[i] ?? 0)), Math.abs((actualImag[i] ?? 0) - (expectedImag[i] ?? 0)))
  }
  assert.ok(worst <= tolerance, 'worst error ' + String(worst) + ' exceeds ' + String(tolerance))
}

describe('Radix2Fft', () => {
  it('matches the naive DFT for a complex power-of-two vector', () => {
    const input = pseudoRandom(64)
    const actualReal = Float64Array.from(input.real)
    const actualImag = Float64Array.from(input.imag)
    new Radix2Fft(64).transform(actualReal, actualImag, false)
    const expected = naiveDft(input.real, input.imag)
    assertClose(actualReal, actualImag, expected.real, expected.imag, 1e-9)
  })

  it('round-trips through the inverse', () => {
    const input = pseudoRandom(128)
    const real = Float64Array.from(input.real)
    const imag = Float64Array.from(input.imag)
    const fft = new Radix2Fft(128)
    fft.transform(real, imag, false)
    fft.transform(real, imag, true)
    assertClose(real, imag, input.real, input.imag, 1e-12)
  })

  it('refuses a length that is not a power of two', () => {
    assert.throws(() => new Radix2Fft(100), /power of two/i)
  })
})

describe('Dft960', () => {
  it('transforms an impulse to a flat spectrum', () => {
    const real = new Float32Array(960)
    real[0] = 1
    const outReal = new Float32Array(960)
    const outImag = new Float32Array(960)
    new Dft960().forward(real, 0, outReal, outImag, 0)
    for (let k = 0; k < 960; k += 1) {
      assert.ok(Math.abs((outReal[k] ?? 0) - 1) < 1e-5, 'real[' + String(k) + ']')
      assert.ok(Math.abs(outImag[k] ?? 0) < 1e-5, 'imag[' + String(k) + ']')
    }
  })

  it('matches the naive 960-point DFT for a real frame', () => {
    // The analysis transform is real-input only (the STFT feeds a windowed waveform); the
    // naive reference is given a zero imaginary part so the comparison is like for like.
    const input = pseudoRandom(960)
    const outReal = new Float32Array(960)
    const outImag = new Float32Array(960)
    new Dft960().forward(input.real, 0, outReal, outImag, 0)
    const expected = naiveDft(input.real, new Float64Array(960))
    assertClose(outReal, outImag, expected.real, expected.imag, 1e-4)
  })

  it('produces a Hermitian spectrum for real input', () => {
    const real = new Float32Array(960)
    for (let i = 0; i < 960; i += 1) real[i] = Math.sin(i / 7)
    const outReal = new Float32Array(960)
    const outImag = new Float32Array(960)
    new Dft960().forward(real, 0, outReal, outImag, 0)
    for (let k = 1; k < 480; k += 1) {
      assert.ok(Math.abs((outReal[k] ?? 0) - (outReal[960 - k] ?? 0)) < 1e-4, 'real symmetry ' + String(k))
      assert.ok(Math.abs((outImag[k] ?? 0) + (outImag[960 - k] ?? 0)) < 1e-4, 'imag symmetry ' + String(k))
    }
  })

  it('the unscaled inverse multiplies by N and recovers the frame', () => {
    // Forward a real frame, then the inverse path (which internally forwards the CONJUGATE
    // spectrum) must return N times the original frame with a vanishing imaginary part.
    const input = pseudoRandom(960)
    const real = Float32Array.from(input.real)
    const forwardReal = new Float32Array(960)
    const forwardImag = new Float32Array(960)
    const dft = new Dft960()
    dft.forward(real, 0, forwardReal, forwardImag, 0)
    const backReal = new Float32Array(960)
    const backImag = new Float32Array(960)
    dft.inverseUnscaled(forwardReal, forwardImag, 0, backReal, backImag, 0)
    for (let i = 0; i < 960; i += 1) {
      assert.ok(Math.abs((backReal[i] ?? 0) / 960 - (real[i] ?? 0)) < 1e-5, 'real ' + String(i))
      assert.ok(Math.abs((backImag[i] ?? 0) / 960) < 1e-5, 'imag ' + String(i))
    }
  })

  it('accepts an offset into a larger frame buffer', () => {
    const frame = new Float32Array(970)
    frame[5] = 1
    const outReal = new Float32Array(960)
    const outImag = new Float32Array(960)
    new Dft960().forward(frame, 5, outReal, outImag, 0)
    for (let k = 0; k < 960; k += 1) {
      assert.ok(Math.abs((outReal[k] ?? 0) - 1) < 1e-5)
      assert.ok(Math.abs(outImag[k] ?? 0) < 1e-5)
    }
  })
})
