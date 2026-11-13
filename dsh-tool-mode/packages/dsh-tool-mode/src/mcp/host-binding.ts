/**
 * Binding the MCP surface to the real DSH tool registry (MCP-08, MCP-09, MCP-12).
 *
 * Two requirements shape this module, and both are about where data comes from
 * rather than what it looks like:
 *
 * - **MCP-09**: DSH's model-facing `schemas()` projection INTENTIONALLY omits the
 *   output schema, so an export built from it would publish a tool with no declared
 *   result shape. The canonical schemas therefore come from the CONTRACTS, which is
 *   the only place that has them; `schemas()` is never consulted for a schema.
 * - **MCP-08**: invocation goes through the host's `execute` path with a
 *   server-issued call identity and the caller's abort signal. Resolving a tool and
 *   calling it directly would bypass the grant, the receipt and the result policy —
 *   the three things the host path exists to apply — so this module is given an
 *   executor rather than a registry to reach into.
 *
 * §16.4 defines the payload derivation precisely: an implementation returns the
 * domain payload with the reserved root `meta` OMITTED, and the payload schema is
 * the final tool schema with only that property and its required entry removed.
 * Everything else is preserved, because a schema that quietly dropped more would
 * under-declare the result.
 *
 * @module @try-works/dsh-tool-mode/mcp/host-binding
 */

import { Ajv, type ValidateFunction } from 'ajv'
import Ajv2020 from 'ajv/dist/2020.js'
import type { ToolContract } from '@try-works/tool-mode-contracts'
import { redactText } from './../receipt.ts'
import { normalizeCachePolicy } from './protocol.ts'
import type { ExternalCaller } from './client-grant.ts'
import type { McpHost, McpToolDefinition, ToolInvocationOutcome } from './server.ts'
import {
  accountInvocation,
  classifyOutcome,
  PhaseTimer,
  type InvocationAccounting,
} from '../invocation-accounting.ts'

/** The reserved root field the host authors, never the implementation. */
const RESERVED_META = 'meta'

/**
 * Two JSON-Schema dialects are in play: the host's contracts are draft-07 while
 * extension-declared output schemas may declare 2020-12 (laya does). Compiling a
 * 2020-12 schema with the draft-07 compiler throws "no schema with key or ref", which
 * turned three LISTED tools into permanent call failures. The dialect is read from the
 * schema's own `$schema`, never guessed.
 */
const draft7 = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true })
const draft2020 = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true })
const payloadValidators = new Map<string, ValidateFunction>()

/** The compiler that speaks the schema's declared dialect. */
function compilerFor(schema: unknown): Ajv | Ajv2020 {
  const declared = (schema as { readonly $schema?: unknown } | null)?.$schema
  return typeof declared === 'string' && declared.includes('2020-12') ? draft2020 : draft7
}

/**
 * Derive the payload schema from a contract's final output schema (§16.4).
 *
 * Only the reserved `meta` property and its `required` entry are removed. The rest
 * of the schema — including constraints on the remaining properties — is preserved
 * verbatim, because removing anything else would advertise a looser result than the
 * contract actually enforces.
 * @param outputSchema - the contract's output schema, including `meta`.
 * @returns the payload schema.
 */
export function derivePayloadSchema(
  outputSchema: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const clone = structuredClone(outputSchema as Record<string, unknown>)
  if (typeof clone.properties === 'object' && clone.properties !== null) {
    delete (clone.properties as Record<string, unknown>)[RESERVED_META]
  }
  if (Array.isArray(clone.required)) {
    clone.required = (clone.required as unknown[]).filter(entry => entry !== RESERVED_META)
  }
  return clone
}

/** One published tool as the host knows it. */
export interface PublishedTool {
  /** The tool name a caller uses. */
  readonly toolName: string
  /** The contract it implements, which carries the canonical schemas. */
  readonly contract: ToolContract
  /**
   * Why this tool is not exportable, when it is not (MCP-12).
   *
   * A host tool using a non-JSON callback, a UI-only API, an unsupported attachment
   * or a non-exportable policy must be REJECTED WITH A REASON rather than partly
   * serialized, so the reason travels with the tool instead of being discovered by a
   * caller whose call fails in a way nobody can explain.
   */
  readonly notExportableReason?: string
}

/** Render Ajv errors as bounded, path-qualified text. */
function renderValidationErrors(errors: ValidateFunction['errors']): string {
  return (errors ?? [])
    .map(error => `${error.instancePath || '(root)'} ${error.message ?? 'is invalid'}`)
    .slice(0, 8)
    .join('; ')
}

/** Validator for the externally advertised payload schema. */
function payloadValidator(contract: ToolContract): ValidateFunction {
  const payloadSchema = derivePayloadSchema(contract.outputSchema)
  /**
   * Cache by the SCHEMA, not by `contract.contract`: an extension-published tool's
   * contract is synthesized by the host and has no contract id, so every extension
   * shared the key `undefined` and the FIRST compiled validator validated later calls.
   * That is the cross-tool leak where multimodal_embed was rejected against
   * decision_choose's schema.
   */
  const key = JSON.stringify(payloadSchema)
  const existing = payloadValidators.get(key)
  if (existing !== undefined) return existing
  const validate = compilerFor(payloadSchema).compile(payloadSchema)
  payloadValidators.set(key, validate)
  return validate
}

/**
 * Convert a host result into the MCP payload shape and validate it.
 *
 * Host-native results may include the reserved `meta` envelope because the DSH tool contract
 * validates that full value. MCP §16.4 publishes the payload schema with `meta` removed, so the
 * external value must be the same payload with only that reserved field omitted. A malformed host
 * result is returned as a tool error rather than a success-shaped `structuredContent`.
 */
function payloadForMcp(contract: ToolContract, value: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  const payload = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== RESERVED_META))
    : value
  const validate = payloadValidator(contract)
  if (!validate(payload)) {
    return { ok: false, reason: `tool result violates the advertised MCP output schema: ${renderValidationErrors(validate.errors)}` }
  }
  return { ok: true, value: payload }
}

/** What the binding needs from the host. */
export interface HostSurface {
  /** The tools the host currently publishes. */
  readonly published: readonly PublishedTool[]
  /**
   * Tools the host deliberately WITHHELD, by name, with the recorded reason (MCP-12).
   *
   * A caller that guesses a withheld name must learn why it is absent rather than
   * receiving the same `unknown tool` answer as a name that never existed. The map
   * is the publication decision, not a second lookup: it may include names omitted
   * from `published` entirely.
   */
  readonly withheld?: ReadonlyMap<string, string>
  /**
   * Execute one tool through the host path (MCP-08).
   *
   * Takes a server-issued call identity and the caller's signal; the implementation
   * MUST route this through the same execution path a native call uses.
   */
  execute(request: {
    readonly name: string
    readonly arguments: Readonly<Record<string, unknown>>
    readonly signal: AbortSignal
    /** Server-issued. A caller-supplied id would let a caller forge a receipt. */
    readonly callId: string
    /**
     * The AUTHENTICATED external caller and its derived grant (SEC-04).
     *
     * Absent for calls with no client identity (native paths). When present, the
     * implementation MUST authorize the call against THIS caller's grant rather than
     * the host's own — an external client is not the operator.
     */
    readonly caller?: ExternalCaller
  }): Promise<{
    readonly isError: boolean
    readonly value?: unknown
    readonly message?: string
  }>
}

/**
 * Build the MCP host surface over a DSH tool surface.
 *
 * @param options - the host surface and this server's identity.
 * @returns the MCP host the dispatch layer consumes.
 */
export function createMcpHost(options: {
  readonly surface: HostSurface
  readonly serverInfo: { readonly name: string; readonly version: string }
  /** Called for each tool withheld, so a reason is recorded rather than lost. */
  readonly onWithheld?: (tool: PublishedTool) => void
  /**
   * Called once per EXTERNAL invocation, with its accounting (OBS-02).
   *
   * Wired EXPLICITLY because an external call is not automatically an agent-loop
   * transcript: DSH observes `ctx.tools.execute`, and an MCP caller reaches the same
   * pipeline through a different door. Without this the external half of the traffic has
   * no receipt at all.
   *
   * It receives TIMINGS, A CLASS and SIZES — never the payload. The result is deliberately
   * NOT passed in, so an implementation of this hook cannot duplicate a large result into a
   * second log, which is the other half of what OBS-02 forbids.
   *
   * The invoked TOOL NAME rides alongside the accounting (task-13): external MCP calls are
   * not session events, so a ledger that answers "which tools were used over MCP" needs
   * the name here rather than re-deriving it from a session log that does not exist.
   */
  readonly onAccounted?: (accounting: InvocationAccounting, toolName: string) => void
  /** The engine that served the call, recorded WITH the measurement (OBS-05). */
  readonly engineVersion?: string
  /** Operator-blocked confidential tools (MCP-11); refused before lookup/execution. */
  readonly confidentialTools?: readonly string[]
  /**
   * The catalog caching policy carried on `tools/list` and `server/discover` (P26-14).
   *
   * Accepted as the UNVALIDATED config shape and validated HERE, once, so a bad
   * operator value is refused with a named error at construction rather than surfacing
   * as a per-request failure. Absent = private/0.
   */
  readonly cachePolicy?: { readonly ttlMs?: number; readonly cacheScope?: string }
  /** Explicit catalog facts attached to discovery results (P26-14). */
  readonly catalogFacts?: () => Record<string, unknown>
}): McpHost {
  // P26-14: validate the configured policy before any request can read it. This keeps
  // the private/0 default when unset and refuses a non-private scope / bad TTL.
  const cachePolicy = normalizeCachePolicy(options.cachePolicy)
  let counter = 0
  return {
    serverInfo: options.serverInfo,
    cachePolicy,
    ...options.catalogFacts === undefined ? {} : { catalogFacts: options.catalogFacts },

    listTools(): readonly McpToolDefinition[] {
      const out: McpToolDefinition[] = []
      for (const published of options.surface.published) {
        // MCP-12: a tool that cannot be exported faithfully is withheld entirely,
        // with its reason recorded. Exporting a partial tool would tell a client the
        // tool exists and then fail in a way the client cannot interpret.
        if (published.notExportableReason !== undefined) {
          options.onWithheld?.(published)
          continue
        }
        out.push({
          name: published.toolName,
          description: published.contract.description,
          // Both schemas come from the CONTRACT. `schemas()` omits output, so using
          // it here would publish a tool with no declared result shape (MCP-09).
          inputSchema: published.contract.inputSchema,
          outputSchema: derivePayloadSchema(published.contract.outputSchema),
          // Nothing in this binding imports from another MCP server, so no tool is
          // a re-export (MCP-13).
          importedFromMcp: false,
        })
      }
      return out
    },

    /**
     * Why a known tool is absent from the catalog, when the host recorded it.
     *
     * `callTool` already explains a withheld name when it is reached directly; the
     * dispatcher needs the same fact BEFORE it can decide the name is unknown, or
     * the protocol layer turns the explanation into a generic invalid-params error.
     * Confidential tools are deliberately omitted: their existence must not leak.
     */
    withheldReason(name: string): string | undefined {
      if (options.confidentialTools?.includes(name) === true) return undefined
      return options.surface.withheld?.get(name)
    },

    async callTool(name, args, signal, caller): Promise<ToolInvocationOutcome> {
      if (options.confidentialTools?.includes(name) === true) {
        return {
          structured: null,
          text: `"${name}" is blocked by the operator confidentiality policy (MCP-11)`,
          isError: true,
        }
      }
      const definition = options.surface.published.find(tool => tool.toolName === name)
      // A tool that is not EXPORTABLE must not be callable either. Looking only for
      // its presence in `published` would let a client invoke by name exactly the
      // tool the export deliberately withheld — defeating MCP-12 through the back
      // door, since a client that guessed the name would get a partial result the
      // export refused to promise.
      if (definition === undefined || definition.notExportableReason !== undefined) {
        // A name the host KNOWS but withheld explains itself; only a name it has
        // never heard of may say "unknown tool" (slice 3).
        const recorded = definition?.notExportableReason ?? options.surface.withheld?.get(name)
        return {
          structured: null,
          text: recorded === undefined
            ? `unknown tool ${JSON.stringify(name)}`
            : `tool ${JSON.stringify(name)} is withheld: ${recorded}`,
          isError: true,
        }
      }
      /**
       * ACCOUNTING, wrapped around the dispatch (OBS-02).
       *
       * The timer measures the external call's own phases and the outcome is classified
       * from what was OBSERVED, not assumed — a cancelled external call must not be
       * recorded as a failure, so the abort state is read from the caller's own signal.
       * The CALLER'S grant identity rides the record (SEC-04): identity only, never the
       * payload, so the operator can tell which client called.
       */
      const callId = `mcp_${Date.now().toString(36)}_${(++counter).toString(36)}`
      const timer = new PhaseTimer()
      timer.begin('inference')
      let outcome: Awaited<ReturnType<HostSurface['execute']>>
      try {
        outcome = await options.surface.execute({
          name,
          arguments: args,
          signal,
          // Server-issued, monotonically increasing. A caller-supplied identity would
          // let a caller forge a receipt (BASE-05).
          callId,
          ...caller === undefined ? {} : { caller },
        })
      } catch (error) {
        options.onAccounted?.(accountInvocation({
          receiptId: callId,
          timings: timer.finish(),
          failureClass: classifyOutcome({ ok: false, aborted: signal.aborted }),
          reason: error instanceof Error ? redactText(error.message) : String(error),
          input: args,
          engineVersion: options.engineVersion ?? 'unknown',
          ...caller === undefined ? {} : { grantId: caller.grantId, clientId: caller.clientId },
        }), name)
        throw error
      }

      // CORRELATION (the round-65 review's finding): the contract payload's
      // reserved meta carries the NATIVE receipt id the host dispatch issued, so
      // the external accounting joins the native ring by that id when the result
      // carries one — the two rings are no longer unjoinable. A value without
      // meta (a tool that predates the meta contract) falls back to the
      // server-issued id.
      const nativeReceiptId = (() => {
        const meta = (outcome.value as { meta?: { receiptId?: unknown } } | undefined)?.meta
        return typeof meta?.receiptId === 'string' ? meta.receiptId : callId
      })()

      options.onAccounted?.(accountInvocation({
        receiptId: nativeReceiptId,
        timings: timer.finish(),
        failureClass: classifyOutcome({
          ok: outcome.isError !== true,
          aborted: signal.aborted,
          refused: outcome.isError === true,
        }),
        ...outcome.isError === true && outcome.message !== undefined ? { reason: redactText(outcome.message) } : {},
        input: args,
        // An error carries no result, so nothing crossed the boundary as output.
        output: outcome.isError === true ? undefined : outcome.value,
        engineVersion: options.engineVersion ?? 'unknown',
        ...caller === undefined ? {} : { grantId: caller.grantId, clientId: caller.clientId },
      }), name)

      if (outcome.isError) {
        return {
          structured: null,
          // Bounded by the dispatch layer when it becomes a tool-error result.
          text: outcome.message ?? 'the tool failed without reporting a reason',
          isError: true,
        }
      }
      const payload = payloadForMcp(definition.contract, outcome.value ?? null)
      if (!payload.ok) {
        return { structured: null, text: payload.reason, isError: true }
      }
      return {
        structured: payload.value,
        text: renderBounded(payload.value),
      }
    },
  }
}

/**
 * Render a bounded, model-readable representation of a canonical value.
 *
 * Bounded because a result is copied into a model's context, and an unbounded
 * rendering of a large value would consume it silently.
 * @param value - the canonical value.
 * @returns the text rendering.
 */
function renderBounded(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return text.length > 100_000 ? `${text.slice(0, 100_000)}…(truncated)` : text
}
