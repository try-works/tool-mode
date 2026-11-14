/**
 * Frames, spans and coverage tests (PHASE3 processor uhm/waveform-v1, steps 3-5).
 *
 * The model output is the ONLY input these functions take, so the tests can state a frame
 * timeline exactly and assert what a caller is told: which 20 ms frames are fillers, how a
 * one-frame gap is tolerated, how two windows that disagree about the same moment are
 * arbitrated, and where a span is clipped to the audio length.
 *
 * @module tests/frames
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  UHM_FILLER_THRESHOLD,
  UHM_FILLER_TYPES,
  UHM_FRAME_MS,
  UHM_FRAME_SAMPLES,
  UHM_HOP_SAMPLES,
  UHM_SAMPLE_RATE,
  UHM_WINDOW_SAMPLES,
  parseUhmLabels,
  uhmResultFromWindows,
  windowsOf,
  type AudioWindow,
  type UhmWindowRun,
} from '../src/index.ts'
import { UHM_LABELS, sparseRows, tensorFromRows, uhmLabelsJson } from './support.ts'

/** A window with no audio content: the tests only use its start offset. */
function windowAt(index: number, startSample: number, windowSamples = UHM_WINDOW_SAMPLES): AudioWindow {
  return { index, startSample, samples: new Float32Array(windowSamples) }
}

/** One window run from explicit sparse frame entries. */
function runFrom(
  window: AudioWindow,
  entries: readonly { readonly frame: number; readonly classIndex: number; readonly probability: number }[],
  frames = 1499,
): UhmWindowRun {
  const tensor = tensorFromRows(sparseRows(frames, entries))
  return { window, data: tensor.data, dims: tensor.dims }
}

/** Whole seconds in samples. */
function samples(seconds: number): number {
  return Math.round(seconds * UHM_SAMPLE_RATE)
}

describe('parseUhmLabels', () => {
  it('accepts the pinned id2label document and returns the class order', () => {
    const parsed = parseUhmLabels(JSON.parse(uhmLabelsJson()))
    if (!parsed.ok) assert.fail('expected the labels to parse: ' + parsed.reason)
    assert.deepEqual(parsed.labels, UHM_LABELS)
  })

  it('accepts a bare array of labels', () => {
    const parsed = parseUhmLabels([...UHM_LABELS])
    if (!parsed.ok) assert.fail('expected the labels to parse: ' + parsed.reason)
    assert.deepEqual(parsed.labels, UHM_LABELS)
  })

  it('refuses a table that is not six classes', () => {
    const parsed = parseUhmLabels({ id2label: { 0: 'not_filler', 1: 'uh' } })
    assert.ok(!parsed.ok)
    assert.match(parsed.reason, /six|6/i)
  })

  it('refuses a table whose first class is not not_filler', () => {
    const parsed = parseUhmLabels({
      id2label: { 0: 'uh', 1: 'not_filler', 2: 'um', 3: 'hmm', 4: 'and', 5: 'other' },
    })
    assert.ok(!parsed.ok)
    assert.match(parsed.reason, /not_filler/i)
  })

  it('refuses a filler label the output contract cannot name', () => {
    const parsed = parseUhmLabels({
      id2label: { 0: 'not_filler', 1: 'uh', 2: 'um', 3: 'hmm', 4: 'and', 5: 'erm' },
    })
    assert.ok(!parsed.ok)
    assert.match(parsed.reason, /erm/)
  })

  it('refuses duplicate labels and non-string labels', () => {
    const duplicate = parseUhmLabels({
      id2label: { 0: 'not_filler', 1: 'uh', 2: 'uh', 3: 'hmm', 4: 'and', 5: 'other' },
    })
    assert.ok(!duplicate.ok)
    assert.match(duplicate.reason, /repeat|duplicate/i)
    const nonString = parseUhmLabels({ id2label: { 0: 'not_filler', 1: 1, 2: 'um', 3: 'hmm', 4: 'and', 5: 'other' } })
    assert.ok(!nonString.ok)
  })

  it('refuses a document with no id2label', () => {
    const parsed = parseUhmLabels({ label2id: { not_filler: 0 } })
    assert.ok(!parsed.ok)
    assert.match(parsed.reason, /id2label/i)
  })
})

describe('uhmResultFromWindows', () => {
  it('publishes the filler class names and the threshold it uses', () => {
    assert.deepEqual(UHM_FILLER_TYPES, ['uh', 'um', 'hmm', 'and', 'other'])
    assert.equal(UHM_FILLER_THRESHOLD, 0.5)
    assert.equal(UHM_FRAME_MS, 20)
    assert.equal(UHM_FRAME_SAMPLES, 320)
  })

  it('emits a span for consecutive filler frames with the mean confidence', () => {
    const result = uhmResultFromWindows({
      runs: [
        runFrom(windowAt(0, 0), [
          { frame: 0, classIndex: 1, probability: 0.9 },
          { frame: 1, classIndex: 1, probability: 0.8 },
        ]),
      ],
      totalSamples: samples(1),
      labels: UHM_LABELS,
    })
    assert.equal(result.fillers.length, 1)
    const span = result.fillers[0]
    if (span === undefined) assert.fail('expected one span')
    assert.deepEqual({ startMs: span.startMs, endMs: span.endMs, type: span.type }, { startMs: 0, endMs: 40, type: 'uh' })
    // The model stores probabilities as float32, so the mean is compared with a tolerance.
    assert.ok(Math.abs(span.confidence - (0.9 + 0.8) / 2) < 1e-6)
    assert.equal(result.coverage.complete, true)
    assert.equal(result.coverage.totalSeconds, 1)
    assert.equal(result.coverage.processedSeconds, 1)
  })

  it('tolerates a one-frame gap but not two', () => {
    const oneGap = uhmResultFromWindows({
      runs: [
        runFrom(windowAt(0, 0), [
          { frame: 0, classIndex: 1, probability: 0.9 },
          { frame: 2, classIndex: 1, probability: 0.9 },
        ]),
      ],
      totalSamples: samples(1),
      labels: UHM_LABELS,
    })
    assert.equal(oneGap.fillers.length, 1)
    assert.equal(oneGap.fillers[0]?.startMs, 0)
    assert.equal(oneGap.fillers[0]?.endMs, 60)

    const twoGap = uhmResultFromWindows({
      runs: [
        runFrom(windowAt(0, 0), [
          { frame: 0, classIndex: 1, probability: 0.9 },
          { frame: 3, classIndex: 1, probability: 0.9 },
        ]),
      ],
      totalSamples: samples(1),
      labels: UHM_LABELS,
    })
    assert.equal(twoGap.fillers.length, 2)
    assert.deepEqual(twoGap.fillers.map((span) => [span.startMs, span.endMs]), [[0, 20], [60, 80]])
  })

  it('splits a gap between different classes even when the frames are adjacent', () => {
    const result = uhmResultFromWindows({
      runs: [
        runFrom(windowAt(0, 0), [
          { frame: 0, classIndex: 1, probability: 0.9 },
          { frame: 1, classIndex: 2, probability: 0.9 },
        ]),
      ],
      totalSamples: samples(1),
      labels: UHM_LABELS,
    })
    assert.deepEqual(result.fillers.map((span) => span.type), ['uh', 'um'])
  })

  it('applies the 0.5 threshold exactly and excludes confident not_filler rows', () => {
    const result = uhmResultFromWindows({
      runs: [
        runFrom(windowAt(0, 0), [
          { frame: 0, classIndex: 1, probability: 0.5 },
          { frame: 1, classIndex: 1, probability: 0.4999 },
          { frame: 2, classIndex: 0, probability: 0.99 },
          { frame: 3, classIndex: 4, probability: 0.51 },
        ]),
      ],
      totalSamples: samples(1),
      labels: UHM_LABELS,
    })
    assert.deepEqual(result.fillers.map((span) => [span.type, span.startMs]), [['uh', 0], ['and', 60]])
  })

  it('clips frames that start past the audio and clips a straddling span to the length', () => {
    const result = uhmResultFromWindows({
      runs: [
        runFrom(windowAt(0, 0), [
          { frame: 50, classIndex: 1, probability: 0.9 },
          { frame: 51, classIndex: 1, probability: 0.9 },
        ]),
      ],
      totalSamples: 16_100,
      labels: UHM_LABELS,
    })
    assert.equal(result.fillers.length, 1)
    assert.equal(result.fillers[0]?.startMs, 1000)
    assert.equal(result.fillers[0]?.endMs, 1006)
    assert.equal(result.coverage.totalSeconds, 16_100 / 16_000)
  })

  it('ignores a window whose frames all start past the audio', () => {
    const result = uhmResultFromWindows({
      runs: [
        runFrom(windowAt(0, 0), [{ frame: 1400, classIndex: 1, probability: 0.99 }]),
      ],
      totalSamples: samples(1),
      labels: UHM_LABELS,
    })
    assert.deepEqual(result.fillers, [])
  })

  it('arbitrates the overlapping moment in favour of the higher-confidence prediction', () => {
    const overlappingFrame = Math.round(UHM_HOP_SAMPLES / UHM_FRAME_SAMPLES)
    assert.equal(overlappingFrame, 1450)
    const result = uhmResultFromWindows({
      runs: [
        runFrom(windowAt(0, 0), [{ frame: overlappingFrame, classIndex: 1, probability: 0.6 }]),
        runFrom(windowAt(1, UHM_HOP_SAMPLES), [{ frame: 0, classIndex: 2, probability: 0.9 }]),
      ],
      totalSamples: UHM_WINDOW_SAMPLES + UHM_HOP_SAMPLES,
      labels: UHM_LABELS,
    })
    assert.equal(result.fillers.length, 1)
    assert.equal(result.fillers[0]?.type, 'um')
    assert.ok(Math.abs((result.fillers[0]?.confidence ?? 0) - 0.9) < 1e-6)
    // 1450 frames is exactly 29 s into the audio.
    assert.equal(result.fillers[0]?.startMs, overlappingFrame * UHM_FRAME_MS)
  })

  it('keeps the earlier window when two overlapping predictions tie exactly', () => {
    const result = uhmResultFromWindows({
      runs: [
        runFrom(windowAt(0, 0), [{ frame: 1450, classIndex: 1, probability: 0.8 }]),
        runFrom(windowAt(1, UHM_HOP_SAMPLES), [{ frame: 0, classIndex: 2, probability: 0.8 }]),
      ],
      totalSamples: UHM_WINDOW_SAMPLES + UHM_HOP_SAMPLES,
      labels: UHM_LABELS,
    })
    assert.equal(result.fillers.length, 1)
    assert.equal(result.fillers[0]?.type, 'uh')
  })

  it('joins a span across the window boundary when both windows continue the same filler', () => {
    const result = uhmResultFromWindows({
      runs: [
        runFrom(windowAt(0, 0), [
          { frame: 1449, classIndex: 1, probability: 0.8 },
          { frame: 1450, classIndex: 1, probability: 0.8 },
        ]),
        runFrom(windowAt(1, UHM_HOP_SAMPLES), [
          { frame: 0, classIndex: 1, probability: 0.9 },
          { frame: 1, classIndex: 1, probability: 0.9 },
        ]),
      ],
      totalSamples: UHM_WINDOW_SAMPLES + UHM_HOP_SAMPLES,
      labels: UHM_LABELS,
    })
    assert.equal(result.fillers.length, 1)
    assert.equal(result.fillers[0]?.startMs, 1449 * UHM_FRAME_MS)
    assert.equal(result.fillers[0]?.endMs, 1452 * UHM_FRAME_MS)
    // The overlapping frame is decided once, at its winning probability, so three frames
    // contribute: 1449 (.8), 1450 (.9 from the second window) and 1451 (.9).
    assert.ok(Math.abs((result.fillers[0]?.confidence ?? 0) - (0.8 + 0.9 + 0.9) / 3) < 1e-6)
  })

  it('accepts both [1, frames, classes] and [frames, classes] output geometry', () => {
    const rows = sparseRows(4, [{ frame: 1, classIndex: 1, probability: 0.9 }])
    const flat = tensorFromRows(rows, { dims: [4, 6] })
    const result = uhmResultFromWindows({
      runs: [{ window: windowAt(0, 0), data: flat.data, dims: flat.dims }],
      totalSamples: samples(1),
      labels: UHM_LABELS,
    })
    assert.deepEqual(result.fillers.map((span) => span.startMs), [20])
  })

  it('refuses output geometry that cannot name six classes', () => {
    const rows = sparseRows(4, [], 5)
    assert.throws(
      () =>
        uhmResultFromWindows({
          runs: [{ window: windowAt(0, 0), data: tensorFromRows(rows).data, dims: [1, 4, 5] }],
          totalSamples: samples(1),
          labels: UHM_LABELS,
        }),
      /class/i,
    )
    assert.throws(
      () =>
        uhmResultFromWindows({
          runs: [{ window: windowAt(0, 0), data: new Float32Array(4), dims: [4] }],
          totalSamples: samples(1),
          labels: UHM_LABELS,
        }),
      /shape|dims/i,
    )
    assert.throws(
      () =>
        uhmResultFromWindows({
          runs: [{ window: windowAt(0, 0), data: new Float32Array(3), dims: [1, 4, 6] }],
          totalSamples: samples(1),
          labels: UHM_LABELS,
        }),
      /length|size/i,
    )
  })

  it('refuses non-finite probabilities instead of emitting a silent empty result', () => {
    const rows = sparseRows(4, [])
    const row = rows[1]
    if (row === undefined) assert.fail('expected rows')
    row[1] = Number.NaN
    assert.throws(
      () =>
        uhmResultFromWindows({
          runs: [{ window: windowAt(0, 0), data: tensorFromRows(rows).data, dims: [1, 4, 6] }],
          totalSamples: samples(1),
          labels: UHM_LABELS,
        }),
      /non-finite|finite/i,
    )
  })

  it('handles empty audio with honest zero coverage', () => {
    const result = uhmResultFromWindows({ runs: [], totalSamples: 0, labels: UHM_LABELS })
    assert.deepEqual(result.fillers, [])
    assert.deepEqual(result.coverage, { complete: true, processedSeconds: 0, totalSeconds: 0 })
  })

  it('reports coverage from the source length, not from the padded window', () => {
    const result = uhmResultFromWindows({
      runs: [runFrom(windowAt(0, 0), [{ frame: 0, classIndex: 1, probability: 0.9 }])],
      totalSamples: 48_000,
      labels: UHM_LABELS,
    })
    assert.equal(result.coverage.totalSeconds, 3)
    assert.equal(result.coverage.processedSeconds, 3)
  })

  it('keeps spans in reading order', () => {
    const result = uhmResultFromWindows({
      runs: [
        runFrom(windowAt(0, 0), [
          { frame: 10, classIndex: 1, probability: 0.9 },
          { frame: 2, classIndex: 2, probability: 0.9 },
        ]),
      ],
      totalSamples: samples(1),
      labels: UHM_LABELS,
    })
    assert.deepEqual(result.fillers.map((span) => span.startMs), [40, 200])
  })
})

describe('windowsOf integration', () => {
  it('maps a real decoded-length window count into model geometry', () => {
    const samplesAt16k = new Float32Array(samples(1))
    const windows = windowsOf(samplesAt16k)
    assert.equal(windows.length, 1)
    const rows = sparseRows(1499, [{ frame: 10, classIndex: 1, probability: 0.9 }])
    const result = uhmResultFromWindows({
      runs: windows.map((window) => {
        const tensor = tensorFromRows(rows)
        return { window, data: tensor.data, dims: tensor.dims }
      }),
      totalSamples: samplesAt16k.length,
      labels: UHM_LABELS,
    })
    assert.equal(result.fillers.length, 1)
    assert.equal(result.fillers[0]?.startMs, 200)
  })
})
