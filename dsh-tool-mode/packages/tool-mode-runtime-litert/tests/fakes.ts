/**
 * Deterministic fakes for the LiteRT session tests.
 *
 * WHAT THESE PROVE: what the Effect session sends to the compiled model, how it maps
 * feeds to Tensors, how it serializes runs and how it maps failures. They prove NOTHING
 * about real LiteRT inference — that is the gated real-assets test's job.
 */

import type { CompiledLitertModel, LitertBoot, LitertFeed, LitertOutput } from '../src/model.ts'

export interface FakeBootState {
  loads: number
  readonly threadsSeen: (number | undefined)[]
  readonly modelBytesSeen: Uint8Array[]
  readonly runFeeds: (Readonly<Record<string, LitertFeed>>)[]
  closes: number
  activeRuns: number
  maxActiveRuns: number
}

export interface FakeBootOptions {
  readonly inputNames?: readonly string[]
  readonly outputNames?: readonly string[]
  readonly outputs?: Readonly<Record<string, LitertOutput>>
  readonly loadError?: Error
  readonly runError?: Error
  /** A macrotask delay inside run, so an unserialized pair would overlap. */
  readonly runDelayMs?: number
  /** Per-run outputs, for models whose answer changes across crops. */
  readonly runOutputs?: (callIndex: number, feeds: Readonly<Record<string, LitertFeed>>) => Readonly<Record<string, LitertOutput>>
}

export interface FakeBoot extends LitertBoot {
  readonly state: FakeBootState
}

/** A compiled model fake that records feeds and tracks overlap between runs. */
export const createFakeBoot = (options: FakeBootOptions = {}): FakeBoot => {
  const state: FakeBootState = {
    loads: 0,
    threadsSeen: [],
    modelBytesSeen: [],
    runFeeds: [],
    closes: 0,
    activeRuns: 0,
    maxActiveRuns: 0,
  }
  const compiled: CompiledLitertModel = {
    inputNames: options.inputNames ?? ['input'],
    outputNames: options.outputNames ?? ['output'],
    run: async (feeds) => {
      state.runFeeds.push(feeds)
      state.activeRuns += 1
      state.maxActiveRuns = Math.max(state.maxActiveRuns, state.activeRuns)
      try {
        if (options.runDelayMs !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, options.runDelayMs))
        }
        if (options.runError !== undefined) throw options.runError
        if (options.runOutputs !== undefined) return options.runOutputs(state.runFeeds.length - 1, feeds)
        return options.outputs ?? { output: new Float32Array([1, 2, 3]) }
      } finally {
        state.activeRuns -= 1
      }
    },
    close: () => {
      state.closes += 1
    },
  }
  return {
    state,
    load: async ({ modelBytes, threads }) => {
      state.loads += 1
      state.threadsSeen.push(threads)
      state.modelBytesSeen.push(modelBytes)
      if (options.loadError !== undefined) throw options.loadError
      return compiled
    },
  }
}
