/**
 * R8 (0.5.106 report) — an aggregate-only output must say so, and name a per-item route.
 *
 * The hint is a CLAIM the author makes, never an inference from program text:
 * - `verifiability: 'aggregate'` renders a caveat that names the callable per-item route;
 * - `'per-item'` and no hint invent nothing;
 * - the field travels through define / from-run / clone / draft / promote / list / get;
 * - U44 purpose/verification and the 1000/6 digest cap are preserved.
 *
 * @module tests/verifiability-hint
 */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters -- SAFETY: this suite is a JSON/registry boundary: untrusted request objects are read field by field and a minimal fake store/deps stands in for the composition root. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildDirectiveDigest, DIRECTIVE_DIGEST_MAX_CHARS, DIRECTIVE_DIGEST_MAX_LINES } from '../src/library-digest.ts'
import type { AdvisoryVerifiability } from '../src/library-digest.ts'
import type { AdoptionDigestCandidate } from '../src/adoption-digest-ranking.ts'
import type { AgentAuthoringStore, AgentToolDefinition, AgentToolSummary } from '../src/agent-authoring.ts'
import { registerAuthoringTools } from '../src/authoring-surface.ts'

/** One digest row; `verifiability` is the R8 hint. */
type Row = AdoptionDigestCandidate & { readonly verifiability?: AdvisoryVerifiability }

function candidate(overrides: Partial<Row> & { readonly name: string }): Row {
  return {
    callableName: overrides.name,
    description: 'Count languages across a list of texts.',
    scope: 'workspace',
    uses: 0,
    failures: 0,
    ...overrides,
  }
}

describe('R8 — the aggregate caveat (digest)', () => {
  it('renders the aggregate caveat and names the callable per-item route', () => {
    const text = buildDirectiveDigest([
      candidate({ name: 'agent_counts', description: 'Counts matches in a batch.', verifiability: 'aggregate' }),
    ])
    assert.match(text, /Aggregate-only output/)
    assert.match(text, /not per-item verifiable/)
    // The route it names is the callable name, so the caller can run one item at a time.
    assert.match(text, /verify by calling agent_counts one item at a time/)
    assert.match(text, /^Use agent_counts\b/m)
  })

  it('renders no caveat for per-item or for no hint (never inferred)', () => {
    const perItem = buildDirectiveDigest([candidate({ name: 'agent_ok', verifiability: 'per-item' })])
    assert.doesNotMatch(perItem, /Aggregate-only/)
    const none = buildDirectiveDigest([candidate({ name: 'agent_unknown' })])
    assert.doesNotMatch(none, /Aggregate-only/)
    assert.doesNotMatch(none, /per-item verifiable/)
  })

  it('carries the caveat for a SUPPORTING artifact too', () => {
    const text = buildDirectiveDigest([
      candidate({ name: 'top_flow', description: 'Builds a summary.', lastUsedAt: '2026-06-02T00:00:00.000Z' }),
      candidate({ name: 'agent_batch', verifiability: 'aggregate' }),
    ])
    const line = text.split('\n').find(candidateLine => candidateLine.startsWith('Also available:'))
    assert.ok(line !== undefined)
    assert.match(line, /agent_batch/)
    assert.match(line, /aggregate-only/i)
    assert.match(line, /verify item by item with agent_batch|verify by calling agent_batch/)
  })

  it('preserves U44 verification and purpose next to the caveat, inside the 1000/6 cap', () => {
    const text = buildDirectiveDigest([
      candidate({
        name: 'agent_counts',
        description: 'Counts matches in a batch.',
        verification: 'Known to undercount empty lines; check one item before trusting totals.',
        verifiability: 'aggregate',
        unverified: true,
      }),
    ])
    assert.ok(text.includes('Counts matches in a batch.'))
    assert.ok(text.includes('Known to undercount empty lines'))
    assert.ok(text.includes('Aggregate-only output'))
    assert.ok(text.length <= DIRECTIVE_DIGEST_MAX_CHARS, 'length ' + String(text.length))
    assert.ok(text.split('\n').length <= DIRECTIVE_DIGEST_MAX_LINES)
  })
})

/** The tool definition the surface registers, as this suite calls it. */
interface RegisteredDefinition {
  readonly name: string
  readonly execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** A minimal store that records what the surface forwards and serves list/get rows. */
function fakeStore() {
  const saved: { name: string; verifiability?: string }[] = []
  const rows: AgentToolSummary[] = []
  const store = {
    listTools: () => rows,
    listWorkflows: () => [],
    sessionWorkflows: () => [],
    sessionTools: () => [],
    getTool: (name: string) => rows.find(row => row.name === name),
    saveTool: (input: { name: string; verifiability?: string }) => {
      saved.push({ name: input.name, ...(input.verifiability === undefined ? {} : { verifiability: input.verifiability }) })
      const row = {
        id: 'agent_1', name: input.name, callableName: input.name, description: '', inputSchema: {}, tools: [], version: 1,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', scope: 'workspace', scopeKey: 'w',
        digest: 'd', shadowing: null, ...(input.verifiability === undefined ? {} : { verifiability: input.verifiability }),
      } as unknown as AgentToolSummary
      rows.push(row)
      return row as unknown as AgentToolDefinition
    },
    deleteTool: () => {},
  } as unknown as AgentAuthoringStore
  return { store, saved, rows }
}

/** Mount only the authoring surface against the fake store. */
function mountSurface(store: AgentAuthoringStore) {
  const definitions: RegisteredDefinition[] = []
  const deps = {
    ctx: {
      tools: {
        register: (definition: RegisteredDefinition) => { definitions.push(definition); return () => {} },
        schemas: () => [],
        get: () => undefined,
      },
    },
    store,
    adoption: () => ({ draftTtlMs: 86_400_000 }),
    ledger: { record: () => {} },
    scopeFor: () => ({ context: { scope: 'workspace', scopeKey: 'w' }, scope: 'workspace', requestedScope: 'workspace' }),
    sessionIdOfAgent: () => undefined,
    sessionLedger: () => undefined,
    registerWorkflow: () => true,
    registerAuthored: () => true,
    unregisterAuthored: () => true,
    workflowDisposers: new Map(),
    workflowToolNames: new Set(),
    authoredToolNames: new Set(),
    authoringRevision: () => 'r1',
    evidenceFor: () => ({ uses: 0, sessions: 0, failures: 0 }),
    recordArtifactFailure: () => {},
    scopeSettings: {},
    globalApprovalGranted: false,
    sandboxTempScope: {},
    scheduleSandboxTempPrune: () => {},
    programAgentContext: {},
    programContextOf: () => ({}),
    programRunner: {},
    recordAuthoredRun: () => {},
    host: { nextReceiptId: () => 'rcpt' },
    runCaptureStore: undefined,
  }
  registerAuthoringTools(deps as unknown as Parameters<typeof registerAuthoringTools>[0])
  const tools = definitions.find(definition => definition.name === 'tool_mode_tools')
  assert.ok(tools !== undefined, 'tool_mode_tools must be registered')
  return { execute: (args: unknown) => tools.execute(args, {}) }
}

describe('R8 — the surface carries the claim through define/list/get', () => {
  it('define forwards verifiability and list/get return it once stored', async () => {
    const fake = fakeStore()
    const surface = mountSurface(fake.store)
    const defined = await surface.execute({
      action: 'define', name: 'agent_counts', description: 'A helper.',
      inputSchema: { type: 'object', properties: {} }, program: 'return 1', tools: [],
      verifiability: 'aggregate',
    }) as { defined: boolean }
    assert.equal(defined.defined, true)
    assert.deepEqual(fake.saved, [{ name: 'agent_counts', verifiability: 'aggregate' }], 'define must forward the claim')

    const listed = await surface.execute({ action: 'list' }) as { tools: { verifiability?: string }[] }
    assert.equal(listed.tools[0]?.verifiability, 'aggregate', 'list returns the stored claim')

    const fetched = await surface.execute({ action: 'get', name: 'agent_counts' }) as { tool?: { verifiability?: string } }
    assert.equal(fetched.tool?.verifiability, 'aggregate', 'get returns the stored claim')
  })

  it('rejects an unknown verifiability value instead of guessing', async () => {
    const fake = fakeStore()
    const surface = mountSurface(fake.store)
    await assert.rejects(
      surface.execute({
        action: 'define', name: 'agent_bad', description: 'A helper.',
        inputSchema: { type: 'object', properties: {} }, program: 'return 1', tools: [],
        verifiability: 'maybe',
      }),
      /verifiability/i,
    )
    assert.deepEqual(fake.saved, [], 'nothing is stored for an invalid claim')
  })
})
