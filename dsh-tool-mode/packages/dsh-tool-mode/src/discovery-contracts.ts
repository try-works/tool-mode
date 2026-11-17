/**
 * DECL-07 read-only discovery contracts.
 *
 * These tools were registered natively but withheld from MCP, so an authorized
 * external caller could not read the catalogue or per-tool schemas. Their contracts
 * are published independently of any model package; the execution path is the ordinary
 * DSH tool runtime, not a private MCP-only handler.
 */

import type { ToolContract } from '@try-works/tool-mode-contracts'

/**
 * The `tool_mode_list` result shape.
 *
 * P4 split the surface in two: `tools` is what a program may bind, and `unavailable`
 * explains every catalogued model that cannot be called here. `unavailable` is declared
 * (and left optional, so a caller that validates an older payload is not broken) because
 * this schema is the MCP-advertised one — an undeclared field fails the external
 * validation with "must NOT have additional properties".
 */
const discoveryOutputSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['catalogRevision', 'tools'],
  properties: {
    catalogRevision: { type: 'string' },
    tools: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        /**
         * DECL-01/task-52: the contract facts a discovery artifact pins itself against.
         * `contract`/`contractVersion` are null when the tool publishes no contract, and
         * `schemaAvailable` says whether a `tool_mode_describe` call would return schemas.
         */
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          state: { type: 'string', enum: ['callable', 'not-installed', 'unavailable'] },
          toolName: { type: 'string' },
          readiness: { type: 'string' },
          model: { type: ['string', 'null'] },
          extension: { type: ['string', 'null'] },
          route: { type: 'string' },
          executionKind: { type: 'string' },
          recipeDigest: { type: ['string', 'null'] },
          contract: { type: ['string', 'null'] },
          contractVersion: { type: ['string', 'null'] },
          schemaAvailable: { type: 'boolean' },
          /** PREFLIGHT: true when a program may bind it (callable is not enough). */
          bindable: { type: 'boolean' },
        },
      },
    },
    /** Authored artifacts and the read-only repeated-shape report (0.5.83+). */
    authoring: {
      type: 'object',
      additionalProperties: true,
    },
    unavailable: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'model', 'extension', 'state', 'reason'],
        properties: {
          name: { type: 'string' },
          model: { type: 'string' },
          extension: { type: ['string', 'null'] },
          state: { type: 'string', enum: ['callable', 'not-installed', 'unavailable'] },
          reason: { type: 'string' },
        },
      },
    },
  },
}

/**
 * `tool_mode_describe` advertises the two contract facts its result already carries.
 *
 * `tool_mode_list` has a different per-tool shape (readiness, no semantics), so the
 * two tools do not share one open item schema. Both fields are declared here so an
 * MCP client can rely on them; the item stays open for implementation-specific facts.
 */
const describeOutputSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['catalogRevision', 'tools'],
  properties: {
    catalogRevision: { type: 'string' },
    tools: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          name: { type: 'string' },
          /** The contract this tool publishes, and its version (null when none). */
          contract: { type: ['string', 'null'] },
          contractVersion: { type: ['string', 'null'] },
          /** PREFLIGHT: false for control tools (CODE-07) and confidential tools. */
          bindable: { type: 'boolean' },
          semantics: { type: 'object', additionalProperties: true },
          unsupported: { type: 'array', items: { type: 'string' }, maxItems: 64 },
        },
      },
    },
  },
}

/** `tool_mode_list` — permitted tools, readiness and catalog revision. */
export const TOOL_MODE_LIST_CONTRACT: ToolContract = {
  contract: 'host.tool_mode_list',
  version: '1.2.0',
  toolName: 'tool_mode_list',
  description:
    'List the tools this caller may use. `tools` are the names that can be CALLED now; each row carries '
    + '`bindable`, true when a program may bind it (false for CODE-07 control tools and MCP-11 confidential '
    + 'tools). `unavailable` lists catalogued models that cannot be called here with its readiness state and '
    + 'reason. Read-only discovery (DECL-07): it never installs, prepares, activates or changes anything.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      scope: {
        type: 'string',
        description: 'Optional authored-artifact filter: session | workspace | global | all.',
      },
    },
    required: [],
  },
  outputSchema: discoveryOutputSchema,
  semantics: { readOnly: true, sideEffects: false },
  limits: {},
  unsupported: ['Mutating the catalog or model selection.'],
}

/** `tool_mode_describe` — schemas, model facts, limits and catalog revision. */
export const TOOL_MODE_DESCRIBE_CONTRACT: ToolContract = {
  contract: 'host.tool_mode_describe',
  version: '1.1.0',
  toolName: 'tool_mode_describe',
  description:
    'Describe one or more tools by name: the selected input/output schemas, the resolved model, limits, '
    + '`contract`/`contractVersion` and `bindable` (whether a program may bind it, without provoking a '
    + 'refusal), plus the catalog revision. A catalog name that cannot be called is explained with its '
    + 'readiness state, the reason and the action that would clear it, instead of a schema. Read-only '
    + 'discovery (DECL-07): it never installs, prepares, activates or changes anything.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['tools'],
    properties: {
      tools: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    },
  },
  outputSchema: describeOutputSchema,
  semantics: { readOnly: true, sideEffects: false },
  limits: { maxTools: 64 },
  unsupported: ['Mutating the catalog or model selection.'],
}
