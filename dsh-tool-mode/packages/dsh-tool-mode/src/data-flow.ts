/**
 * Data-flow edges for a composed run (OBS-01 extension).
 *
 * A composition trace can say WHICH tools ran and in what order, and the receipt graph
 * can say which run a call belongs to. Neither says that the value returned by one
 * call was the value passed to another. This module observes that at the binding
 * boundary: every successful result is fingerprinted, and every argument is walked
 * for an earlier result's value.
 *
 * Two kinds of evidence are recorded, and they are deliberately distinct:
 *
 * - `same-reference`: the argument contains the SAME object identity a previous call
 *   returned (true runtime data flow).
 * - `same-value`: the argument contains a value whose canonical JSON is exactly equal
 *   to a previous call's result. This is equality evidence, not identity evidence: two
 *   independently produced equal values cannot be told apart, so an ambiguous result
 *   (more than one producer with the same fingerprint) produces NO edge rather than a
 *   guess.
 *
 * The tracker is bounded in depth, node count and serialized size, so a large vector
 * can never turn a provenance record into a data dump.
 *
 * @module @try-works/dsh-tool-mode/data-flow
 */

import { createHash } from 'node:crypto'

/** How the argument value was matched to an earlier result. */
export type DataFlowEvidence = 'same-reference' | 'same-value'

/** One observed edge: `from` produced a value that `to` received at `input`. */
export interface DataFlowEdge {
  /** The producer's trace call id (for example `call_1`). */
  readonly from: string
  /** The consumer's trace call id (for example `call_2`). */
  readonly to: string
  /** The argument path the value was found at (`$`, `query`, `documents[0].text`). */
  readonly input: string
  /** `same-reference` is identity; `same-value` is exact canonical equality. */
  readonly evidence: DataFlowEvidence
}

/** The tracker the runner feeds; one per program run. */
export interface DataFlowTracker {
  /** Edges INTO `to` from results recorded before this call. */
  edges(args: unknown, to: string): readonly DataFlowEdge[]
  /** Register a successful result so later arguments can be matched against it. */
  record(callId: string, value: unknown): void
}

/** Walk limits: provenance is bounded, never a payload copy. */
const MAX_DEPTH = 4
const MAX_NODES = 64
const MAX_ARRAY_ITEMS = 16
const MAX_OBJECT_KEYS = 32
const MAX_SERIALIZED_CHARS = 64 * 1024

/** A tracker that records nothing (used when the trace cap is already reached). */
export const NO_DATA_FLOW: DataFlowTracker = {
  edges: () => [],
  record: () => undefined,
}

/** Stable JSON text for a JSON-compatible value; undefined when it is not one. */
function stableJson(value: unknown): string | undefined {
  const seen = new WeakSet<object>()
  const encode = (node: unknown, depth: number): string | undefined => {
    if (depth > MAX_DEPTH + 1) return undefined
    if (node === null) return 'null'
    const kind = typeof node
    if (kind === 'string') return JSON.stringify(node)
    if (kind === 'number') return Number.isFinite(node as number) ? String(node) : undefined
    if (kind === 'boolean') return node === true ? 'true' : 'false'
    if (kind !== 'object') return undefined
    const object = node as object
    if (seen.has(object)) return undefined
    seen.add(object)
    try {
      if (Array.isArray(node)) {
        const items = node.slice(0, MAX_ARRAY_ITEMS).map(item => encode(item, depth + 1) ?? 'null')
        return `[${items.join(',')}]`
      }
      const record = node as Record<string, unknown>
      const keys = Object.keys(record).sort().slice(0, MAX_OBJECT_KEYS)
      const parts: string[] = []
      for (const key of keys) {
        const encoded = encode(record[key], depth + 1)
        if (encoded !== undefined) parts.push(`${JSON.stringify(key)}:${encoded}`)
      }
      return `{${parts.join(',')}}`
    } finally {
      seen.delete(object)
    }
  }
  const text = encode(value, 0)
  if (text === undefined || text.length > MAX_SERIALIZED_CHARS) return undefined
  return text
}

/** A bounded fingerprint of one JSON-compatible value. */
function digestOf(value: unknown): string | undefined {
  const text = stableJson(value)
  if (text === undefined) return undefined
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/** A path segment for an object key: dot form when safe, bracket form otherwise. */
function keyPath(base: string, key: string): string {
  const safe = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
  if (base === '$') return safe ? key : `$[${JSON.stringify(key)}]`
  return safe ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`
}

/** The evidence for one value, when an earlier call produced it. */
interface Producer {
  readonly callId: string
  readonly evidence: DataFlowEvidence
}

/** Create a bounded tracker. */
export function createDataFlowTracker(): DataFlowTracker {
  /** Fingerprint -> the call ids that produced exactly this value. */
  const byDigest = new Map<string, string[]>()
  /** Result object identity -> the call id that returned it. */
  const byIdentity = new WeakMap<object, string>()

  const producerOf = (value: unknown): Producer | undefined => {
    if (typeof value === 'object' && value !== null) {
      const identity = byIdentity.get(value)
      if (identity !== undefined) return { callId: identity, evidence: 'same-reference' }
    }
    const digest = digestOf(value)
    if (digest === undefined) return undefined
    const producers = byDigest.get(digest)
    if (producers === undefined || producers.length !== 1) return undefined
    return { callId: producers[0]!, evidence: 'same-value' }
  }

  return {
    edges(args, to) {
      const out: DataFlowEdge[] = []
      const seen = new Set<string>()
      const walk = (value: unknown, path: string, depth: number): void => {
        if (out.length >= MAX_NODES || depth > MAX_DEPTH) return
        const producer = producerOf(value)
        if (producer !== undefined && producer.callId !== to) {
          const key = `${producer.callId}|${path}|${producer.evidence}`
          if (!seen.has(key)) {
            seen.add(key)
            out.push({ from: producer.callId, to, input: path, evidence: producer.evidence })
          }
          // A matched node is the edge; descending into it would only restate it.
          return
        }
        if (value === null || typeof value !== 'object') return
        if (Array.isArray(value)) {
          value.slice(0, MAX_ARRAY_ITEMS).forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1))
          return
        }
        const record = value as Record<string, unknown>
        for (const key of Object.keys(record).slice(0, MAX_OBJECT_KEYS)) {
          walk(record[key], keyPath(path, key), depth + 1)
        }
      }
      walk(args, '$', 0)
      return out.sort((left, right) => left.from.localeCompare(right.from) || left.input.localeCompare(right.input))
    },
    record(callId, value) {
      if (typeof value === 'object' && value !== null) byIdentity.set(value, callId)
      const digest = digestOf(value)
      if (digest === undefined) return
      const producers = byDigest.get(digest)
      if (producers === undefined) byDigest.set(digest, [callId])
      else producers.push(callId)
    },
  }
}
