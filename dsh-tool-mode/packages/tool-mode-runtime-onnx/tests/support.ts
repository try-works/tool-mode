/**
 * Shared fixtures and fakes for the runtime-onnx tests.
 *
 * Nothing here loads onnxruntime-node: the engine seam (`OnnxSessionLoader`) is small on
 * purpose so a unit test can be a DETERMINISTIC FAKE that proves the lifecycle, the WAV
 * pipeline, the frame merge and the provider contract. The gated real test in
 * `real-assets.test.ts` is the only place the native engine runs.
 *
 * WAV fixtures are BUILT byte by byte rather than committed, so a test states the exact
 * header it is exercising and a refusal test can produce a header a real recorder never
 * would.
 *
 * @module tests/support
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { InvocationContextV1, PreparedAssetMapV1 } from '@try-works/tool-mode-extension-sdk'
import type { ModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'

import type {
  OnnxFeed,
  OnnxLoadOptions,
  OnnxSessionLoader,
  OnnxTensor,
} from '../src/index.ts'

/** The pinned labels document (237 bytes at the pinned revision) as text. */
export function uhmLabelsJson(): string {
  return JSON.stringify(
    {
      id2label: { 0: 'not_filler', 1: 'uh', 2: 'um', 3: 'hmm', 4: 'and', 5: 'other' },
      label2id: { not_filler: 0, uh: 1, um: 2, hmm: 3, and: 4, other: 5 },
    },
    null,
    2,
  )
}

/** The pinned uhm labels in class order. */
export const UHM_LABELS = ['not_filler', 'uh', 'um', 'hmm', 'and', 'other'] as const

/** The validated recipe a code-free uhm package ships, typed but never parsed here. */
export function uhmRecipe(overrides: Partial<ModelRuntimeRecipe> = {}): ModelRuntimeRecipe {
  return {
    kind: 'model-runtime',
    schemaVersion: 1,
    provider: {
      package: '@try-works/tool-mode-runtime-onnx',
      export: 'createProviderFromRecipe',
      accelerators: ['cpu'],
    },
    model: { assetSet: 'uhm-onnx', fileName: 'uhm.onnx', format: 'onnx' },
    processor: { id: 'uhm/waveform-v1' },
    limits: { maxInputBytes: 4_194_304, timeoutMs: 120_000 },
    tool: {
      name: 'detect_fillers',
      description: 'Find filler words in a recording.',
      inputSchema: './schemas/detect-fillers.input.json',
      outputSchema: './schemas/detect-fillers.output.json',
    },
    ...overrides,
  }
}

/** Run a test body with a fresh temp directory that is always removed again. */
export async function withTempDir<A>(use: (dir: string) => Promise<A>): Promise<A> {
  const dir = await mkdtemp(join(tmpdir(), 'tool-mode-runtime-onnx-'))
  try {
    return await use(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Materialise a fake prepared asset set: the model bytes plus the pinned labels document.
 *
 * @param dir - the directory to write into
 * @returns the directory
 */
export async function writeUhmAssets(dir: string, modelBytes = new Uint8Array([1, 2, 3, 4])): Promise<string> {
  await writeFile(join(dir, 'uhm.onnx'), modelBytes)
  await writeFile(join(dir, 'labels.json'), uhmLabelsJson(), 'utf8')
  return dir
}

/**
 * A host-shaped prepared asset map that exposes the GROUP directory under the asset-set id.
 *
 * The real host exposes two projections: the group id resolves to the directory and each
 * asset id resolves to its file. Tests use both shapes.
 *
 * @param directory - the prepared directory
 * @returns the asset map
 */
export function preparedAssetsAsDirectory(directory: string): PreparedAssetMapV1 {
  return {
    assetIds: ['uhm-onnx', 'uhm-labels'],
    get: (assetId) =>
      assetId === 'uhm-onnx'
        ? { path: directory, digest: 'sha256:model-digest' }
        : assetId === 'uhm-labels'
          ? { path: join(directory, 'labels.json'), digest: 'sha256:labels-digest' }
          : undefined,
  }
}

/**
 * A host-shaped prepared asset map where the asset-set id resolves to the MODEL FILE.
 *
 * The host prefers an exact asset-id match over a group-id match, and the uhm lock's
 * asset id is the same string as its group id, so this is the projection production
 * actually sees.
 *
 * @param directory - the prepared directory
 * @returns the asset map
 */
export function preparedAssetsAsFile(directory: string): PreparedAssetMapV1 {
  return {
    assetIds: ['uhm-onnx', 'uhm-labels'],
    get: (assetId) =>
      assetId === 'uhm-onnx'
        ? { path: join(directory, 'uhm.onnx'), digest: 'sha256:model-digest' }
        : assetId === 'uhm-labels'
          ? { path: join(directory, 'labels.json'), digest: 'sha256:labels-digest' }
          : undefined,
  }
}

/** The call-scoped context the SDK requires. */
export function invocationContext(options: {
  readonly signal?: AbortSignal
  readonly resolvePath?: (candidate: string) => string
} = {}): InvocationContextV1 {
  const signal = options.signal ?? new AbortController().signal
  return {
    invocationId: 'invocation-1',
    signal,
    limits: { maxInputBytes: 4_194_304, maxAudioSeconds: 120, maxResultBytes: 4_194_304 },
    resolvePath: options.resolvePath ?? ((candidate) => candidate),
  }
}

/** Write channel-interleaved float frames as a WAV file. */
export interface WavSpec {
  readonly sampleRate?: number
  readonly channels?: number
  readonly format?: 'pcm16' | 'float32'
  /** Interleaved by channel. */
  readonly samples: Float32Array | readonly number[]
}

/** Build a little-endian WAV document around interleaved samples. */
export function buildWav(spec: WavSpec): Uint8Array {
  const format = spec.format ?? 'pcm16'
  const channels = spec.channels ?? 1
  const sampleRate = spec.sampleRate ?? 16_000
  const samples = Float32Array.from(spec.samples)
  if (samples.length % channels !== 0) throw new Error('the interleaved samples do not fill whole frames')
  const bitsPerSample = format === 'pcm16' ? 16 : 32
  const blockAlign = (bitsPerSample / 8) * channels
  const byteRate = sampleRate * blockAlign
  const data = new Uint8Array(samples.length * (bitsPerSample / 8))
  const view = new DataView(data.buffer)
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0))
    if (format === 'pcm16') {
      view.setInt16(index * 2, Math.round(value * 32_767), true)
    } else {
      view.setFloat32(index * 4, value, true)
    }
  }
  return assembleWav({ audioFormat: format === 'pcm16' ? 1 : 3, channels, sampleRate, bitsPerSample, blockAlign, byteRate, data })
}

/** Build a WAV with arbitrary header fields, for refusal tests. */
export interface RawWavOptions {
  readonly riff?: string
  readonly wave?: string
  readonly audioFormat?: number
  readonly channels?: number
  readonly sampleRate?: number
  readonly bitsPerSample?: number
  readonly data?: Uint8Array
  readonly omitData?: boolean
  readonly truncateAt?: number
}

/** Build a WAV byte for byte from the supplied header fields. */
export function rawWav(options: RawWavOptions = {}): Uint8Array {
  const channels = options.channels ?? 1
  const bitsPerSample = options.bitsPerSample ?? 16
  const sampleRate = options.sampleRate ?? 16_000
  const blockAlign = (bitsPerSample / 8) * channels
  const assembled = {
    riff: options.riff ?? 'RIFF',
    wave: options.wave ?? 'WAVE',
    audioFormat: options.audioFormat ?? 1,
    channels,
    sampleRate,
    bitsPerSample,
    blockAlign,
    byteRate: sampleRate * blockAlign,
    data: options.data ?? new Uint8Array(0),
    omitData: options.omitData ?? false,
  }
  return options.truncateAt === undefined ? assembleWav(assembled) : assembleWav({ ...assembled, truncateAt: options.truncateAt })
}

interface AssembleOptions {
  readonly riff?: string
  readonly wave?: string
  readonly audioFormat?: number
  readonly channels: number
  readonly sampleRate: number
  readonly bitsPerSample: number
  readonly blockAlign: number
  readonly byteRate: number
  readonly data: Uint8Array
  readonly omitData?: boolean
  readonly truncateAt?: number
}

/** Assemble a RIFF/WAVE document from explicit header fields. */
function assembleWav(options: AssembleOptions): Uint8Array {
  const fmt = new Uint8Array(24)
  const fmtView = new DataView(fmt.buffer)
  writeAscii(fmt, 0, 'fmt ')
  fmtView.setUint32(4, 16, true)
  fmtView.setUint16(8, options.audioFormat ?? 1, true)
  fmtView.setUint16(10, options.channels, true)
  fmtView.setUint32(12, options.sampleRate, true)
  fmtView.setUint32(16, options.byteRate, true)
  fmtView.setUint16(20, options.blockAlign, true)
  fmtView.setUint16(22, options.bitsPerSample, true)
  const dataChunk = options.omitData === true ? new Uint8Array(0) : options.data
  const dataHeaderSize = options.omitData === true ? 0 : 8
  const total = 12 + fmt.length + dataHeaderSize + dataChunk.length
  const document = new Uint8Array(total)
  const view = new DataView(document.buffer)
  writeAscii(document, 0, options.riff ?? 'RIFF')
  view.setUint32(4, total - 8, true)
  writeAscii(document, 8, options.wave ?? 'WAVE')
  document.set(fmt, 12)
  if (options.omitData !== true) {
    writeAscii(document, 12 + fmt.length, 'data')
    view.setUint32(12 + fmt.length + 4, dataChunk.length, true)
    document.set(dataChunk, 12 + fmt.length + 8)
  }
  const limit = options.truncateAt ?? document.length
  return document.slice(0, Math.max(0, Math.min(limit, document.length)))
}

/** Write five ASCII characters at an offset. */
function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) target[offset + index] = text.charCodeAt(index)
}

/** A sine wave as interleaved mono float samples. */
export function sine(seconds: number, frequency = 440, sampleRate = 16_000): Float32Array {
  const total = Math.max(1, Math.round(seconds * sampleRate))
  const samples = new Float32Array(total)
  for (let index = 0; index < total; index += 1) {
    samples[index] = 0.25 * Math.sin((2 * Math.PI * frequency * index) / sampleRate)
  }
  return samples
}

/** One model output row: a probability at one class and the remainder spread over the rest. */
export function probabilityRow(classIndex: number, probability: number, classes = 6): number[] {
  const row = new Array<number>(classes).fill((1 - probability) / (classes - 1))
  row[classIndex] = probability
  return row
}

/** A float32 tensor a fake engine can return. */
export interface Float32Tensor {
  readonly data: Float32Array
  readonly dims: readonly number[]
}

/** Build an output tensor from explicit probability rows. */
export function tensorFromRows(rows: readonly (readonly number[])[], options: {
  readonly frames?: number
  readonly classes?: number
  readonly dims?: readonly number[]
} = {}): Float32Tensor {
  const classes = options.classes ?? rows[0]?.length ?? 6
  const frames = options.frames ?? rows.length
  const data = new Float32Array(frames * classes)
  for (let frame = 0; frame < Math.min(rows.length, frames); frame += 1) {
    const row = rows[frame]
    if (row === undefined) continue
    for (let column = 0; column < Math.min(row.length, classes); column += 1) {
      data[frame * classes + column] = row[column] ?? 0
    }
  }
  return { data, dims: options.dims ?? [1, frames, classes] }
}

/** The number of 20 ms frames a window of a given sample count can emit (model geometry). */
export function frameCountFor(totalSamples: number, frameSamples = 320): number {
  return Math.ceil(totalSamples / frameSamples)
}

/**
 * Build sparse model rows: every frame defaults to a confident not_filler row.
 *
 * @param frames - how many frames the window emits
 * @param entries - the frames that carry a different class
 * @param classes - the class count
 * @returns one probability row per frame
 */
export function sparseRows(
  frames: number,
  entries: readonly { readonly frame: number; readonly classIndex: number; readonly probability: number }[],
  classes = 6,
): number[][] {
  const rows = Array.from({ length: frames }, () => probabilityRow(0, 1, classes))
  for (const entry of entries) {
    if (entry.frame < 0 || entry.frame >= frames) continue
    rows[entry.frame] = probabilityRow(entry.classIndex, entry.probability, classes)
  }
  return rows
}

/** One observed engine call. */
export interface FakeRunCall {
  readonly index: number
  readonly feeds: Readonly<Record<string, OnnxFeed>>
}

/** What a fake engine loader exposes to a test. */
export interface FakeLoader {
  readonly loader: OnnxSessionLoader
  readonly loads: OnnxLoadOptions[]
  readonly calls: FakeRunCall[]
  readonly releases: () => number
}

/** Options for a fake engine loader. */
export interface FakeLoaderOptions {
  readonly inputNames?: readonly string[]
  readonly outputNames?: readonly string[]
  readonly executionProvider?: string
  readonly run: (call: FakeRunCall) => Promise<Readonly<Record<string, OnnxTensor>>>
  readonly onRelease?: () => void
}

/** A deterministic engine loader that records what it was asked to do. */
export function fakeLoader(options: FakeLoaderOptions): FakeLoader {
  const loads: OnnxLoadOptions[] = []
  const calls: FakeRunCall[] = []
  let releases = 0
  const loader: OnnxSessionLoader = {
    load: async (loadOptions) => {
      loads.push(loadOptions)
      return {
        inputNames: options.inputNames ?? ['audio'],
        outputNames: options.outputNames ?? ['frames'],
        executionProvider: options.executionProvider ?? 'cpu',
        run: async (feeds) => {
          const call: FakeRunCall = { index: calls.length, feeds }
          calls.push(call)
          return options.run(call)
        },
        release: async () => {
          releases += 1
          options.onRelease?.()
        },
      }
    },
  }
  return { loader, loads, calls, releases: () => releases }
}

/** Assert that a promise rejects with a message matching a pattern. */
export async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof Error, 'expected an Error rejection')
    return error
  }
  assert.fail('expected the promise to reject, but it resolved')
}
