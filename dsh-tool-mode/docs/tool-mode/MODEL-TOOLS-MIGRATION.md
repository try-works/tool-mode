# Migrating from `model_tools` mutations

`model_tools` is now **read-only discovery**. Its old `enable`, `disable` and `reset`
actions were removed; a caller that needs to mutate model or extension state uses
`model_tools_manage`, which exists only when the operator grants it.

## Action mapping

| Old `model_tools` action | New action | Effect |
|---|---|---|
| `enable` (model) | `model_tools_manage` `{action:"enable", model}` | Publishes the model's already-installed catalogue tool. It does **not** install an npm package. |
| `disable` (model) | `model_tools_manage` `{action:"disable", model}` | Withdraws the tool; the package stays installed. |
| `reset` (model) | `model_tools_manage` `{action:"reset", model}` | Forgets the persisted enable/disable choice and re-applies the configured selection. |
| credentials revoke | `model_tools_manage` `{action:"credentials", sub:"revoke", clientId}` | Revokes one generated MCP client credential. |
| extension approve/deny/commit/rollback/prepare | `model_tools_manage` `{action:"extensions-*"}` | Staged extension lifecycle; installation itself stays a CLI/store operation. |

## What did not move

- `model_tools` `list`, `installed`, `describe`, `receipts`, `mcp`, `diagnostics`,
  `credentials` (`sub:"list"`), `extensions-pending` and `extensions-prepare-plan` are
  read-only and stay on `model_tools`.
- `tool_mode_list` / `tool_mode_describe` remain the DECL-07 discovery pair. External
  callers see only tools in their grant; the native caller sees the full catalogue.
- No action installs an arbitrary npm package. Extension install/activate/update/uninstall
  remain operator CLI/store operations (SEC-09); agent-initiated installation is at most
  a pending approval proposal, never a self-approved install.
- Installer/update/uninstall bindings are excluded from Code Mode by name.

## Permission model

- `model_tools_manage` is registered **only** with `managementGrant: true` (default
  false) and is excluded from Code Mode.
- External clients need both the management tool in their MCP grant and the operator
  grant; ordinary permission to run a model tool does not authorize management.
- Approvals are never self-approved: a pending approval must be decided by the operator,
  and a commit is one-shot and scope-bound.
