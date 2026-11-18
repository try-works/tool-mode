/**
 * The Code Mode runtime entry point: `tool_mode_run`.
 *
 * The program runner is constructed by the composition root; this module owns
 * the advertised contract, the binding preflight, the probe path and the
 * provenance receipts. It never imports the composition root.
 *
 * @module runtime-surface
 */

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-shape-in-symbol-names, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof -- SAFETY: this is the program/report boundary: request arguments arrive as JSON and the runtime report is a validated external shape, then cast at the DSH tool seam. */

import type { Context } from '@deepseek-ai/cordis'
import type { AsyncLocalStorage } from 'node:async_hooks'
import { defineTool, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { BuiltScopeContext } from './artifact-scope-context.ts'
import { buildInvocationReceipt, type InvocationReceipt } from './receipt.ts'
import { schemaShape, type RunCaptureStore } from './run-capture.ts'
import type { SandboxTempScope } from './sandbox-temp.ts'
import type { ProgramRunner } from './tool-mode-run.ts'
import { externalRefusal, serveProgram } from './tool-mode-run.ts'
import { PACKAGE_VERSION } from './version.ts'

/** One name's binding resolution, as discovery reports it. */
export interface RuntimeBindingResolution {
  readonly resolved: boolean
  readonly reason?: string
  readonly action?: string
  readonly scope: string
  readonly scopeKey: string
}

/** What the runtime entry point needs from the composition root. */
export interface RuntimeSurfaceDeps {
  readonly ctx: Context
  readonly host: {
    readonly extension: string
    readonly extensionVersion: string
    readonly activationGeneration: number
    readonly nextReceiptId: () => string
    readonly recordReceipt?: (receipt: InvocationReceipt) => void
  }
  readonly programRunner: ProgramRunner
  readonly bindingPreflight: (name: string, scope?: BuiltScopeContext) => RuntimeBindingResolution
  readonly scopeFor: (exec: { agent?: unknown }) => BuiltScopeContext | undefined
  readonly catalogRevision: () => string
  readonly hostedCode: boolean
  readonly sandboxTempScope: SandboxTempScope
  readonly programAgentContext: AsyncLocalStorage<{ readonly agent?: unknown; readonly token?: unknown }>
  readonly programContextOf: (exec: unknown) => { readonly agent?: unknown; readonly token?: unknown }
  readonly recordFailedComposition: (receiptId: string, revision: string, contract: string) => void
  readonly scheduleSandboxTempPrune: () => void
  readonly runCaptureStore: () => RunCaptureStore | undefined
}

/**
 * Register `tool_mode_run`.
 * @param deps - runner, binding resolver and provenance callbacks.
 */
export function registerRuntimeTools(deps: RuntimeSurfaceDeps): void {
  const ctx = deps.ctx
  const host = deps.host
  const programRunner = deps.programRunner
  const bindingPreflight = deps.bindingPreflight
  const scopeForAuthoringCaller = deps.scopeFor
  const catalogRevision = deps.catalogRevision
  const config = { hostedCode: deps.hostedCode }
  const sandboxTempScope = deps.sandboxTempScope
  const programAgentContext = deps.programAgentContext
  const programContextOf = deps.programContextOf
  const recordFailedComposition = deps.recordFailedComposition
  const scheduleSandboxTempPrune = deps.scheduleSandboxTempPrune
  const runCaptureStore = deps.runCaptureStore
  ctx.tools.register(defineTool({
    name: 'tool_mode_run',
    description:
      'Run a program that calls Tool Mode tools (CODE-02). The requested `tools` list is '
      + 'a binding subset, not a grant: only names the host itself has granted are bound, '
      + 'and the whole request is refused when any name is unattainable. `tools` may be '
      + 'empty for a pure transform that computes only from `input`. Bindings are fixed when the run '
      + 'starts, so a tool defined during this run is available only to later runs. The report\'s '
      + 'meta.calls carries the bounded trace and meta.dataFlow the observed output-to-argument edges. '
      + 'Set probe:true (and omit code) to resolve the declared tools without executing.',
    parameters: {
      // Advisory only, and optional: the program's code is what runs, and the
      // literal CODE-02 payload `{ code, tools }` must be callable as advertised.
      description: { type: 'string', description: 'What the program does (advisory).' },
      code: { type: 'string', description: 'Body of an async TypeScript function. Omit only with probe:true.' },
      input: { type: 'json', description: 'Program data, bound structurally — never interpolated into source.' },
      probe: { type: 'boolean', description: 'Resolve the declared tools without executing the program.' },
      tools: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'The tool names the program will call.',
      },
      timeout_ms: { type: 'integer', description: 'A requested deadline; clamped to host policy.' },
    } as unknown as ParameterSchemaSpec,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          result: { type: 'json' },
          /** The composition identity, so from-run can accept one value. */
          runId: { type: 'string' },
          logs: { type: 'array', items: { type: 'string' } },
          /** probe:true only: one resolution per declared name, nothing executed. */
          preflight: { type: 'array' },
          gateOpen: { type: 'boolean' },
          meta: {
            type: 'object',
            additionalProperties: false,
            properties: {
              receiptId: { type: 'string', required: true },
              elapsedMs: { type: 'integer', required: true },
              toolCalls: { type: 'integer', required: true },
              catalogRevision: { type: 'string', required: true },
              warnings: { type: 'array', items: { type: 'string' } },
              /**
               * The bounded sub-call trace (name, ok, elapsedMs, previews, error). It is
               * DECLARED here because the output validator closes an object with no
               * explicit `additionalProperties`, so an undeclared field fails every run.
               */
              calls: { type: 'array' },
              /** DATA FLOW: which earlier result reached which argument. */
              dataFlow: { type: 'array' },
              /** Coverage: value-equality only, never complete. */
              dataFlowCoverage: { type: 'object', additionalProperties: true },
              /** The generated bindings the report already emits. */
              typescript: { type: 'string' },
            },
          },
        },
      } as unknown as ValueSchemaSpec,
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      /**
       * THE GATE, ENFORCED — the caller `mayExposeToClients()` never had, so the refusal
       * is now REACHABLE rather than a boolean nothing consults. This tool is only
       * served to callers when the confinement tests have passed; the in-process
       * pipeline below is the same one the external surface would use.
       */
      const refusal = externalRefusal(programRunner)
      if (refusal !== undefined) {
        const refusalScope = scopeForAuthoringCaller?.(exec)
        throw new Error(refusal.message
          + (refusalScope === undefined ? '' : ` Caller scope: ${refusalScope.scope} (${refusalScope.workspaceKey}).`))
      }
      const request = args as {
        readonly code?: string
        readonly tools?: readonly string[]
        readonly probe?: boolean
      }
      const declared = Array.isArray(request.tools) ? request.tools : []
      const bindScope = scopeForAuthoringCaller?.(exec)
      const preflight = declared.map(name => ({ name, ...bindingPreflight(name, bindScope) }))
      if (request.probe === true) {
        return {
          result: null,
          logs: [],
          preflight,
          gateOpen: config.hostedCode === true,
          meta: {
            receiptId: host.nextReceiptId(),
            elapsedMs: 0,
            toolCalls: 0,
            catalogRevision: catalogRevision(),
          },
        } as never
      }
      const unresolved = preflight.filter(entry => !entry.resolved)
      if (unresolved.length > 0) {
        throw new Error('the program requested tools it cannot bind:\n'
          + unresolved.map(entry =>
            `  ${entry.name}: ${entry.reason} at ${entry.scope} scope (${entry.scopeKey}) — ${entry.action}`,
          ).join('\n'))
      }
      if (typeof request.code !== 'string' || request.code.trim().length === 0) {
        throw new Error('tool_mode_run needs a non-empty code body; use probe:true to resolve tools without executing')
      }
      // The catalog revision is the LIVE extension-lifecycle generation when the
      // lifecycle is mounted (CODE-05 needs a revision that changes), falling
      // back to the host activation generation otherwise.
      const revision = catalogRevision()
      const receiptId = host.nextReceiptId()
      let report: Awaited<ReturnType<typeof serveProgram>>
      try {
        report = await sandboxTempScope.run(() => programAgentContext.run(
          programContextOf(exec),
          () => serveProgram(args as Record<string, unknown>, programRunner, {
            receiptId,
            catalogRevision: revision,
          }),
        ))
        scheduleSandboxTempPrune()
      } catch (error) {
        recordFailedComposition(receiptId, revision, 'tool_mode_run')
        throw error
      }
      // OBS-01: EVERY nested call gets its own provenance receipt, parented to the
      // program's composition receipt. The trace is the host's own observation.
      for (const call of report.meta.calls) {
        host.recordReceipt?.(buildInvocationReceipt({
          receiptId: host.nextReceiptId(),
          contract: `nested:${call.name}`,
          contractVersion: '1.0.0',
          implementationId: call.name,
          extension: host.extension,
          extensionVersion: host.extensionVersion,
          activationGeneration: Number(revision),
          executionLocation: 'host',
          modelIdentity: 'none',
          kind: 'nested',
          parentReceiptId: receiptId,
          // The composition identity, so every call the program made is recoverable
          // from data alone (not only by walking parent links).
          runId: receiptId,
          // Joins this receipt to the data-flow edges, which name trace call ids.
          ...call.callId === undefined ? {} : { callId: call.callId },
          // The wiring a preview cannot express: keys only, never values.
          argumentPaths: [...(call.argumentPaths ?? [])],
          outcome: call.ok ? 'ok' : 'failed',
        }))
      }
      // The program run's receipt is RECORDED like a contract invocation's, so
      // the receipts action can answer for it (EXT-35 symmetry the review named).
      host.recordReceipt?.(buildInvocationReceipt({
        receiptId,
        contract: 'tool_mode_run',
        contractVersion: PACKAGE_VERSION,
        implementationId: 'hosted-composition',
        extension: host.extension,
        extensionVersion: host.extensionVersion,
        activationGeneration: Number(revision),
        executionLocation: 'host',
        modelIdentity: 'none',
        // A direct composition is ITS OWN run, and the run succeeded: serveProgram
        // resolves only after the program completed.
        runId: receiptId,
        parentReceiptId: null,
        // The graph LABEL and how complete it is: value equality is not provenance.
        dataFlow: report.meta.dataFlow,
        dataFlowCoverage: report.meta.dataFlowCoverage,
        outcome: 'ok',
      }))
      // Run capture: the program and a shape-only input schema, never input
      // values. On by default so define-from-run works out of the box; the
      // profile can still turn it off with captureRunPrograms: false.
      const capture = runCaptureStore()
      if (capture !== undefined) {
        const captured = args as { code?: unknown; tools?: unknown; input?: unknown }
        const program = typeof captured.code === 'string' ? captured.code : ''
        if (program.length > 0) {
          capture.record({
            runId: receiptId,
            program,
            tools: Array.isArray(captured.tools) ? captured.tools.filter((tool): tool is string => typeof tool === 'string') : [],
            inputSchema: schemaShape(captured.input),
            parameterPaths: [...new Set(report.meta.calls.flatMap(call => call.argumentPaths ?? []))],
            contracts: report.meta.calls.map(call => call.name),
          })
        }
      }
      return { ...report, runId: report.meta.receiptId } as never
    },
  }))
}
