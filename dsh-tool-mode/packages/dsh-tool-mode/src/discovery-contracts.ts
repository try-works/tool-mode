/**
 * DECL-07 read-only discovery contracts.
 *
 * These tools were registered natively but withheld from MCP, so an authorized
 * external caller could not read the catalogue or per-tool schemas. Their contracts
 * are published independently of any model package; the execution path is the ordinary
 * DSH tool runtime, not a private MCP-only handler.
 */

import type { ToolContract } from '@try-works/tool-mode-contracts'

/** The result shape both discovery tools return. */
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
  version: '1.0.0',
  toolName: 'tool_mode_list',
  description:
    'List the tools this caller is permitted to use, with readiness summaries and the current catalog '
    + 'revision. Read-only discovery (DECL-07): it never installs, prepares, activates or changes anything.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
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
  version: '1.0.0',
  toolName: 'tool_mode_describe',
  description:
    'Describe one or more tools by name: the selected input/output schemas, the resolved model, limits and '
    + 'the catalog revision. Read-only discovery (DECL-07): it never installs, prepares, activates or changes anything.',
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
