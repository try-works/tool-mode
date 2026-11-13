---
title: CLI
description: Command-line entry points for diagnostics, preparation, MCP stdio, and credentials.
---

# CLI

The package installs three executables:

- `dsh-tool-mode` — launcher and diagnostics;
- `dsh-tool-mode-mcp-stdio` — MCP stdio bridge;
- `dsh-tool-mode-credentials` — human-only MCP credential management.

## `dsh-tool-mode`

```text
dsh-tool-mode serve [--config tool-mode.json] [--json]
dsh-tool-mode doctor [--config tool-mode.json] [--json]
dsh-tool-mode prepare --tool <toolName> [--config tool-mode.json] [--json]
dsh-tool-mode mcp-stdio
```

| Command | Purpose |
|---|---|
| `serve` | Boot the headless host composition. Fails with the missing seam when the DSH composition runtime is not resolvable. |
| `doctor` | Report configuration, package/runtime compatibility, platform readiness, and the launcher seam without secrets. |
| `prepare --tool` | Resolve the extension serving a tool and run its digest-verified prepared-assets acquisition. |
| `mcp-stdio` | Start the stdio bridge. |

`--json` emits structured output on stdout. Failures exit non-zero.

The config document defaults to `./tool-mode.json` or `DSH_TOOL_MODE_CONFIG`.

## `dsh-tool-mode-mcp-stdio`

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `DSH_TOOL_MODE_MCP_URL` | `http://127.0.0.1:3765/mcp` | Endpoint to bridge to. |
| `DSH_TOOL_MODE_MCP_TOKEN` | required | Bearer token. Missing token exits non-zero with guidance on stderr. |

Stdout carries protocol traffic only. Diagnostics go to stderr.

## `dsh-tool-mode-credentials`

```text
dsh-tool-mode-credentials generate --scheme static-token --client-id <id>
dsh-tool-mode-credentials generate --scheme oauth-resource-server --client-id <id> [--scope a,b,c]
dsh-tool-mode-credentials list [--store <path>]
dsh-tool-mode-credentials revoke --client-id <id> [--store <path>]
```

The generated secret is printed **once** to stdout. It is never echoed again. A
lost secret is replaced by revoking the client and generating a new one.

This command is for the operator. The model-visible management surface refuses
credential generation so a secret cannot enter a transcript.

## Next

- [MCP protocol](mcp-protocol.md)
- [Configuration](configuration.md)
- [Troubleshooting](../help/troubleshooting.md)
