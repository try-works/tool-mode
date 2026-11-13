/**
 * MCP publication rows for custom tools.
 *
 * Custom tools are agent-visible by default, but MCP is a separate opt-in. A
 * tool that is not opted in is still returned as a WITHHELD row so the status
 * surface can explain the absence instead of silently omitting it.
 *
 * @module @try-works/dsh-tool-mode/custom-tools/mcp-surface
 */

import type { PublishedTool } from '../mcp/host-binding.ts'
import type { CustomToolRecord } from './types.ts'

/** Build the MCP surface rows for the active custom-tool records. */
export function customToolPublishedTools(records: readonly CustomToolRecord[]): readonly PublishedTool[] {
  return records.map(record => {
    const contract = {
      contract: record.id,
      version: String(record.version),
      toolName: record.name,
      description: record.description,
      inputSchema: record.parameters as Record<string, unknown>,
      outputSchema: (record.outputSchema ?? {}) as Record<string, unknown>,
      semantics: {},
      limits: { timeoutMs: record.policy.timeoutMs },
      unsupported: [],
    }
    if (!record.policy.mcpExpose) {
      return {
        toolName: record.name,
        contract,
        notExportableReason: 'MCP exposure is off for this custom tool',
      }
    }
    if (record.outputSchema === undefined) {
      return {
        toolName: record.name,
        contract,
        notExportableReason: 'the custom tool declares no output schema, so MCP cannot advertise a result shape',
      }
    }
    return { toolName: record.name, contract }
  })
}
