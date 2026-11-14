/**
 * The 960-point DFT the clear graph was trained on.
 *
 * WHY NOT 1024. DeepFilterNet3 frames with n_fft = 960 and 481 bins (libDF). A power-of-two
 * FFT of 1024 would be the obvious engineering choice and would produce a DIFFERENT
 * spectrogram, silently out of distribution for the model. So the transform here is an
 * exact 960-point DFT, implemented as Bluestein's algorithm over a radix-2 FFT of
 * 2048 points: mathematically identical to the naive sum, and far cheaper.
 *
 * CONVENTIONS, stated once because two of them are easy to get backwards:
 * - forward: X[k] = sum x[n] e^{-2*pi*i*k*n/N} (the sign vDSP's forward DFT uses);
 * - `inverseUnscaled`: sum X[k] e^{+2*pi*i*k*n/N}, i.e. N times the mathematical IDFT.
 *   The clear STFT wants exactly this, because libDF/vDSP's inverse DFT is UNSCALED and
 *   the forward pass carries the compensating 1/n_fft gain.
 *
 * Instances hold scratch buffers, so one instance is used sequentially (the STFT does
 * that). Nothing here is thread safe.
 *
 * @module fft
 */

/** A complex FFT of one fixed power-of-two size. */
export class Radix2Fft {
  /** The transform size. */
  readonly n: number
  private readonly cos: Float64Array
  private readonly sin: Float64Array
  private readonly reverse: Uint32Array

  /**
   * @param n - the transform size, a power of two
   */
  constructor(n: number) {
    if (!Number.isInteger(n) || n < 2 || (n & (n - 1)) !== 0) {
      throw new Error('the FFT size must be a power of two')
    }
    this.n = n
    const half = n / 2
    this.cos = new Float64Array(half)
    this.sin = new Float64Array(half)
    for (let k = 0; k < half; k += 1) {
      const angle = (2 * Math.PI * k) / n
      this.cos[k] = Math.cos(angle)
      this.sin[k] = Math.sin(angle)
    }
    const bits = Math.round(Math.log2(n))
    this.reverse = new Uint32Array(n)
    for (let i = 0; i < n; i += 1) {
      let value = i
      let reversed = 0
      for (let bit = 0; bit < bits; bit += 1) {
        reversed = (reversed << 1) | (value & 1)
        value >>= 1
      }
      this.reverse[i] = reversed
    }
  }

  /**
   * Transform in place.
   *
   * @param real - the real part, length `n`
   * @param imag - the imaginary part, length `n`
   * @param inverse - true for the inverse convention, which also divides by `n`
   */
  transform(real: Float64Array, imag: Float64Array, inverse: boolean): void {
    const n = this.n
    if (real.length !== n || imag.length !== n) throw new Error('the FFT buffers must match the transform size')
    for (let i = 0; i < n; i += 1) {
      const j = this.reverse[i] ?? i
      if (i < j) {
        const tr = real[i] ?? 0
        real[i] = real[j] ?? 0
        real[j] = tr
        const ti = imag[i] ?? 0
        imag[i] = imag[j] ?? 0
        imag[j] = ti
      }
    }
    const sign = inverse ? 1 : -1
    for (let length = 2; length <= n; length <<= 1) {
      const half = length >> 1
      const step = n / length
      for (let start = 0; start < n; start += length) {
        let twiddle = 0
        for (let j = 0; j < half; j += 1) {
          const c = this.cos[twiddle] ?? 1
          const s = sign * (this.sin[twiddle] ?? 0)
          const a = start + j
          const b = a + half
          const br = real[b] ?? 0
          const bi = imag[b] ?? 0
          const tr = br * c - bi * s
          const ti = br * s + bi * c
          const ar = real[a] ?? 0
          const ai = imag[a] ?? 0
          real[b] = ar - tr
          imag[b] = ai - ti
          real[a] = ar + tr
          imag[a] = ai + ti
          twiddle += step
        }
      }
    }
    if (inverse) {
      const scale = 1 / n
      for (let i = 0; i < n; i += 1) {
        real[i] = (real[i] ?? 0) * scale
        imag[i] = (imag[i] ?? 0) * scale
      }
    }
  }
}

/** The DFT size the clear graph was trained on. */
const DFT_SIZE = 960

/** A power of two at least 2*960-1, as Bluestein requires. */
const BLUESTEIN_SIZE = 2048

/** An exact 960-point DFT (Bluestein over a radix-2 FFT). */
export class Dft960 {
  private readonly fft = new Radix2Fft(BLUESTEIN_SIZE)
  private readonly chirpReal = new Float64Array(DFT_SIZE)
  private readonly chirpImag = new Float64Array(DFT_SIZE)
  private readonly kernelReal = new Float64Array(BLUESTEIN_SIZE)
  private readonly kernelImag = new Float64Array(BLUESTEIN_SIZE)
  private readonly scratchReal = new Float64Array(BLUESTEIN_SIZE)
  private readonly scratchImag = new Float64Array(BLUESTEIN_SIZE)
  private readonly zeroImag = new Float64Array(DFT_SIZE)

  constructor() {
    // w[k] = exp(-i*pi*k^2/N), with k^2 reduced modulo 2N for precision (as the Swift
    // reference does: exp(-i*pi*(k*k mod 2N)/N)).
    for (let k = 0; k < DFT_SIZE; k += 1) {
      const reduced = (k * k) % (2 * DFT_SIZE)
      const angle = (-Math.PI * reduced) / DFT_SIZE
      this.chirpReal[k] = Math.cos(angle)
      this.chirpImag[k] = Math.sin(angle)
    }
    const bReal = new Float64Array(BLUESTEIN_SIZE)
    const bImag = new Float64Array(BLUESTEIN_SIZE)
    bReal[0] = this.chirpReal[0] ?? 1
    bImag[0] = -(this.chirpImag[0] ?? 0)
    for (let k = 1; k < DFT_SIZE; k += 1) {
      const re = this.chirpReal[k] ?? 0
      const im = -(this.chirpImag[k] ?? 0)
      bReal[k] = re
      bImag[k] = im
      bReal[BLUESTEIN_SIZE - k] = re
      bImag[BLUESTEIN_SIZE - k] = im
    }
    this.fft.transform(bReal, bImag, false)
    this.kernelReal.set(bReal)
    this.kernelImag.set(bImag)
  }

  /**
   * Transform a complex frame with Bluestein.
   *
   * @param inputReal - the real part of the input
   * @param inputImag - the imaginary part of the input
   * @param offset - where the 960-sample frame starts
   * @param outReal - the real output buffer
   * @param outImag - the imaginary output buffer
   * @param outOffset - where the 960 bins start in the output buffers
   */
  private forwardComplex(
    inputReal: ArrayLike<number>,
    inputImag: ArrayLike<number>,
    offset: number,
    outReal: Float32Array,
    outImag: Float32Array,
    outOffset: number,
  ): void {
    const scratchReal = this.scratchReal
    const scratchImag = this.scratchImag
    for (let n = 0; n < DFT_SIZE; n += 1) {
      const xr = inputReal[offset + n] ?? 0
      const xi = inputImag[offset + n] ?? 0
      const wr = this.chirpReal[n] ?? 0
      const wi = this.chirpImag[n] ?? 0
      scratchReal[n] = xr * wr - xi * wi
      scratchImag[n] = xr * wi + xi * wr
    }
    for (let n = DFT_SIZE; n < BLUESTEIN_SIZE; n += 1) {
      scratchReal[n] = 0
      scratchImag[n] = 0
    }
    this.fft.transform(scratchReal, scratchImag, false)
    for (let n = 0; n < BLUESTEIN_SIZE; n += 1) {
      const ar = scratchReal[n] ?? 0
      const ai = scratchImag[n] ?? 0
      const br = this.kernelReal[n] ?? 0
      const bi = this.kernelImag[n] ?? 0
      scratchReal[n] = ar * br - ai * bi
      scratchImag[n] = ar * bi + ai * br
    }
    this.fft.transform(scratchReal, scratchImag, true)
    for (let k = 0; k < DFT_SIZE; k += 1) {
      const cr = scratchReal[k] ?? 0
      const ci = scratchImag[k] ?? 0
      const wr = this.chirpReal[k] ?? 0
      const wi = this.chirpImag[k] ?? 0
      outReal[outOffset + k] = cr * wr - ci * wi
      outImag[outOffset + k] = cr * wi + ci * wr
    }
  }

  /**
   * Forward DFT of a REAL frame (the STFT analysis case).
   *
   * @param real - the real input buffer
   * @param offset - where the 960-sample frame starts
   * @param outReal - the real output buffer
   * @param outImag - the imaginary output buffer
   * @param outOffset - where the 960 bins start in the output buffers
   */
  forward(
    real: ArrayLike<number>,
    offset: number,
    outReal: Float32Array,
    outImag: Float32Array,
    outOffset: number,
  ): void {
    this.forwardComplex(real, this.zeroImag, offset, outReal, outImag, outOffset)
  }

  /**
   * The UNSCALED inverse DFT: sum X[k] e^{+2*pi*i*k*n/N}, i.e. N times the mathematical
   * IDFT. conj(F(conj(X))) computes it with one forward transform.
   *
   * @param real - the real spectrum buffer
   * @param imag - the imaginary spectrum buffer
   * @param offset - where the 960 bins start
   * @param outReal - the real time-domain output
   * @param outImag - the imaginary time-domain output
   * @param outOffset - where the 960 samples start in the output buffers
   */
  inverseUnscaled(
    real: ArrayLike<number>,
    imag: ArrayLike<number>,
    offset: number,
    outReal: Float32Array,
    outImag: Float32Array,
    outOffset: number,
  ): void {
    const conjReal = new Float64Array(DFT_SIZE)
    const conjImag = new Float64Array(DFT_SIZE)
    for (let k = 0; k < DFT_SIZE; k += 1) {
      conjReal[k] = real[offset + k] ?? 0
      conjImag[k] = -(imag[offset + k] ?? 0)
    }
    this.forwardComplex(conjReal, conjImag, 0, outReal, outImag, outOffset)
    for (let n = 0; n < DFT_SIZE; n += 1) {
      outImag[outOffset + n] = -(outImag[outOffset + n] ?? 0)
    }
  }
}
