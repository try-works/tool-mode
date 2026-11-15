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

/** How complete the observed graph is — a value-equality graph is never full provenance. */
export interface DataFlowCoverage {
  /** The only method available at the binding boundary: exact value equality. */
  readonly method: 'value-equality'
  /** Always false: a transformed value or a control-flow-dependent value has no edge. */
  readonly complete: false
  /** Traced calls after the first, i.e. calls that could have consumed an earlier result. */
  readonly consumers: number
  /** Consumers with at least one inbound edge. */
  readonly matched: number
  /** Trace call ids of consumers with no inbound edge. */
  readonly unresolved: readonly string[]
}

/**
 * Summarise how much of a trace the value graph explains.
 *
 * A quiet graph must not look like a simple program: `complete: false` plus the
 * unresolved consumer ids say which calls the graph failed to explain.
 * @param calls - the traced calls, in dispatch order.
 * @returns the coverage facts.
 */
export function dataFlowCoverage(calls: readonly { readonly callId?: string; readonly input?: readonly DataFlowEdge[] }[]): DataFlowCoverage {
  const consumers = calls.slice(1)
  const unresolved = consumers
    .filter(call => (call.input ?? []).length === 0)
    .map(call => call.callId ?? 'unknown')
  return {
    method: 'value-equality',
    complete: false,
    consumers: consumers.length,
    matched: consumers.length - unresolved.length,
    unresolved,
  }
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
  /** True when the matched value is a WHOLE result, not one of its nested values. */
  readonly root: boolean
}

/** Create a bounded tracker. */
export function createDataFlowTracker(): DataFlowTracker {
  /** Fingerprint -> the call ids that produced exactly this value. */
  const byDigest = new Map<string, string[]>()
  /** Root fingerprint -> the call ids that returned exactly this whole result. */
  const rootByDigest = new Map<string, string[]>()
  /** Result object identity -> the call id that returned it. */
  const byIdentity = new WeakMap<object, string>()
  /** Objects that are a WHOLE result (not merely a nested value). */
  const rootObjects = new WeakSet<object>()
  const unique = (ids: readonly string[] | undefined): string | undefined =>
    ids !== undefined && ids.length === 1 ? ids[0] : undefined

  const producerOf = (value: unknown): Producer | undefined => {
    if (typeof value === 'object' && value !== null) {
      const identity = byIdentity.get(value)
      if (identity !== undefined) {
        return { callId: identity, evidence: 'same-reference', root: rootObjects.has(value) }
      }
    }
    const digest = digestOf(value)
    if (digest === undefined) return undefined
    // A whole result is more informative than one of its fields; when the argument is the
    // whole object, report ONE edge instead of an edge per field.
    const root = unique(rootByDigest.get(digest))
    if (root !== undefined) return { callId: root, evidence: 'same-value', root: true }
    const producers = byDigest.get(digest)
    if (producers === undefined || producers.length !== 1) return undefined
    return { callId: producers[0]!, evidence: 'same-value', root: false }
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
          // A WHOLE-result match (identity, or the whole object's fingerprint) is the
          // edge; descending would only restate it as N field edges. A FIELD match keeps
          // walking, because a more specific field is the useful edge; containers are
          // pruned below.
          // A root match at `$` is the argument OBJECT itself; descend so a field that
          // was actually passed (token vs a same-shaped object) wins. A field/root match
          // below `$` is the whole value and yields exactly one edge.
          if (producer.evidence === 'same-reference' || (producer.root && path !== '$')) return
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
      const isWithin = (child: string, parent: string): boolean =>
        parent === '$' ? child !== '$' : child.startsWith(`${parent}.`) || child.startsWith(`${parent}[`)
      const specific = out.filter(edge => !out.some(other =>
        other.from === edge.from && other.to === edge.to && other.input !== edge.input
        && isWithin(other.input, edge.input)))
      return specific.sort((left, right) => left.from.localeCompare(right.from) || left.input.localeCompare(right.input))
    },
    record(callId, value) {
      // Register the whole result AND its nested JSON values. A program usually passes a
      // FIELD of a result (`result.title`), not the whole envelope, so indexing only the
      // root would miss the ordinary case.
      const seen = new WeakSet<object>()
      let registered = 0
      const register = (node: unknown, depth: number): void => {
        if (registered >= MAX_NODES || depth > MAX_DEPTH) return
        registered += 1
        if (typeof node === 'object' && node !== null) {
          if (seen.has(node)) return
          seen.add(node)
          byIdentity.set(node, callId)
        }
        const digest = digestOf(node)
        if (digest !== undefined) {
          const producers = byDigest.get(digest)
          if (producers === undefined) byDigest.set(digest, [callId])
          else if (!producers.includes(callId)) producers.push(callId)
        }
        if (node === null || typeof node !== 'object') return
        if (Array.isArray(node)) {
          node.slice(0, MAX_ARRAY_ITEMS).forEach(item => register(item, depth + 1))
          return
        }
        const record = node as Record<string, unknown>
        for (const key of Object.keys(record).slice(0, MAX_OBJECT_KEYS)) register(record[key], depth + 1)
      }
      if (typeof value === 'object' && value !== null) rootObjects.add(value)
      const rootDigest = digestOf(value)
      if (rootDigest !== undefined) {
        const roots = rootByDigest.get(rootDigest)
        if (roots === undefined) rootByDigest.set(rootDigest, [callId])
        else if (!roots.includes(callId)) roots.push(callId)
      }
      register(value, 0)
    },
  }
}
