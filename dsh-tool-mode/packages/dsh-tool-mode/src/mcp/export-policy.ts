/**
 * BASE-06 — the MCP export allowlist is a separate control from the native
 * `models` selection.
 *
 * `undefined` or a list containing `*` means the deployment did not configure a
 * separate MCP allowlist and preserves the existing surface. An EMPTY allowlist is
 * meaningful: it exports no inference tools. A named allowlist admits exactly those
 * names.
 *
 * Denied rows are returned as WITHHELD rows (with a reason) rather than removed,
 * so the existing MCP host status surface can explain why a tool is absent.
 *
 * @module @try-works/dsh-tool-mode/mcp/export-policy
 */

import type { PublishedTool } from './host-binding.ts'

/** The stable reason recorded for a tool denied by the allowlist. */
export const MCP_EXPORT_DENIED_REASON = 'the MCP export allowlist does not name this tool'

/**
 * Apply the operator's MCP export allowlist to the assembled publication surface.
 * @param published - every tool the host could publish.
 * @param allowlist - configured names; undefined means no separate MCP restriction.
 * @returns the same rows, with denied rows carrying a withholding reason.
 */
export function applyMcpExportPolicy(
  published: readonly PublishedTool[],
  allowlist: readonly string[] | undefined,
): readonly PublishedTool[] {
  if (allowlist === undefined || allowlist.includes('*')) return published
  const allowed = new Set(allowlist)
  return published.map(tool => allowed.has(tool.toolName)
    ? tool
    : { ...tool, notExportableReason: MCP_EXPORT_DENIED_REASON })
}
