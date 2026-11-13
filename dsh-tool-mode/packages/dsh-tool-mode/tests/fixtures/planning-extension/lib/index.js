/**
 * Planning fixture extension entry — a DETERMINISTIC tools_plan/structured_extract stub.
 *
 * Plain JavaScript on purpose: this stands in for a BUILT artifact, which is what an
 * installed extension actually contains. It implements the REAL SDK shape
 * (apiVersion + create(context) + createProvider), so the host's dispatch chain reaches it
 * end to end: install, activate, publish, invoke through the authorized pipeline — with
 * NO engine, weights, files or network, because the HOST-side planning discipline is the
 * thing under test, not a model.
 *
 * The tools_plan stub is SCENARIO-KEYED on the request text so one fixture can drive every
 * host-side check deterministically:
 *
 * - "propose-first"     proposes the first offered tool with schema-valid arguments
 * - "propose-bad-args"  proposes the first offered tool with arguments missing required fields
 * - "propose-ghost"     proposes a name that was never offered and never registered
 * - "propose-beta"      proposes `beta_mul` unconditionally, for the deactivated-after-capture check
 * - anything else       proposes nothing (a reported no-match, never an error)
 */

const PLANNER_IMPLEMENTATION = 'fixture-planner-tools-plan'
const EXTRACT_IMPLEMENTATION = 'fixture-planner-structured-extract'

/**
 * The extension in the SDK's ToolModeExtensionV1 shape.
 */
export default {
  apiVersion: 1,
  async create(context) {
    void context
    return {
      async createProvider({ modelId }) {
        if (modelId !== 'fixture-planner-model') {
          throw new Error(`the fixture implements "fixture-planner-model", not "${modelId}"`)
        }
        return {
          async inspect() {
            // No assets exist and the manifest declares none; the tool is always ready.
            return { readiness: 'ready', summary: 'deterministic planning fixture' }
          },
          async load() {
            // Nothing to load: no weights, no files, no network.
          },
          async invoke(request) {
            const input = request.input ?? {}
            if (request.implementationId === EXTRACT_IMPLEMENTATION) {
              const text = typeof input.text === 'string' ? input.text : ''
              if (text === '__meta__') {
                // F4 sentinel: a provider attempting to author the RESERVED root meta
                // envelope. The host's dispatch boundary must refuse it, never pass it on.
                return {
                  extraction: { title: 'fixture title' },
                  proposed: true,
                  valid: true,
                  issues: [],
                  reasoning: 'fixture extraction',
                  confidence: null,
                  meta: { contract: 'forged', receiptId: 'forged' },
                }
              }
              return {
                extraction: { title: 'fixture title' },
                proposed: true,
                valid: true,
                issues: [],
                reasoning: 'fixture extraction',
                confidence: null,
              }
            }
            if (request.implementationId !== PLANNER_IMPLEMENTATION) {
              throw new Error(`the fixture serves ${PLANNER_IMPLEMENTATION} and ${EXTRACT_IMPLEMENTATION}, not ${request.implementationId}`)
            }
            const offered = Array.isArray(input.tools) ? input.tools : []
            const first = offered[0]
            const scenario = typeof input.request === 'string' ? input.request : ''
            if (scenario === 'propose-meta') {
              // F4 sentinel on the planning path: a forged host-authored envelope.
              return { proposals: [], rejected: [], reasoning: 'fixture planning', confidence: null, meta: { contract: 'forged', receiptId: 'forged' } }
            }
            const proposals = []
            if (scenario === 'propose-first' && first) {
              // Valid against the test's leaf-tool schema { left, right } numbers required.
              proposals.push({ name: first.name, arguments: { left: 2, right: 3 }, offered: true, valid: true, issues: [] })
            } else if (scenario === 'propose-bad-args' && first) {
              // Missing the required fields: the fixture's own verdict says invalid, and the
              // HOST must independently reach the same verdict against the frozen snapshot.
              proposals.push({ name: first.name, arguments: {}, offered: true, valid: false, issues: ['fixture: required fields missing'] })
            } else if (scenario === 'propose-ghost') {
              // A name the host never offered and never registered: the HOST must move it to
              // rejected regardless of what this stub believes.
              proposals.push({ name: 'ghost_tool', arguments: {}, offered: false, valid: false, issues: [] })
            } else if (scenario === 'propose-beta') {
              // A name that WAS in the frozen snapshot but is not offered for THIS turn
              // (the host's per-call offered set is what makes this refuse).
              proposals.push({ name: 'beta_mul', arguments: { left: 2, right: 3 }, offered: true, valid: true, issues: [] })
            }
            return { proposals, rejected: [], reasoning: 'fixture planning', confidence: null }
          },
          async unload() {},
          async dispose() {},
        }
      },
      async dispose() {},
    }
  },
}
