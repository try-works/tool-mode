---
title: Connect an MCP client
description: Expose Tool Mode tools over the MCP 2026-07-28 endpoint.
---

# Connect an MCP client

Tool Mode can serve its tools over **MCP 2026-07-28** on loopback HTTP. The
external client uses the same tool registry, per-client grant, and receipt path as
a native call.

This page is the setup guide. For wire-level details, see
[MCP protocol](../reference/mcp-protocol.md).

## 1. Enable the endpoint

Add this to the profile's patch:

```yaml
- id: model-tools
  config:
    mcpV3:
      enabled: true
      host: 127.0.0.1
      port: 3765
      path: /mcp
    approvedRoots:
      - "D:/fixtures"       # only if a tool takes a path
```

The endpoint binds to loopback. A routable bind is refused at startup.

## 2. Choose how the token is supplied

The token is never written in the patch. Use one of:

**Environment variable**

```sh
DSH_TOOL_MODE_MCP_TOKEN=<long-random-value> dsh --profile web
```

**Token file**

```yaml
    mcpV3:
      tokenFile: "C:/Users/you/.dsh/model-as-tool-mcp-token.txt"
```

The file contains the trimmed token. The environment variable wins when both are
present.

Generated client credentials are also supported through the credential store.
Each generated credential authenticates as its own client, so its grant is
independent.

## 3. Configure the client

For a client that launches a stdio bridge, use the installed binary and point it
at the endpoint:

```json
{
  "mcpServers": {
    "tool-mode": {
      "command": "dsh-tool-mode-mcp-stdio",
      "env": {
        "DSH_TOOL_MODE_MCP_URL": "http://127.0.0.1:3765/mcp",
        "DSH_TOOL_MODE_MCP_TOKEN": "<the-token>"
      }
    }
  }
}
```

If the binary is not on `PATH`, use the full path to
`node_modules/.bin/dsh-tool-mode-mcp-stdio` in the profile, or run it through the
package manager's exec command.

Clients that support remote HTTP MCP can connect to
`http://127.0.0.1:3765/mcp` with `Authorization: Bearer <token>` instead.

A missing token is reported on **stderr** and the process exits non-zero. The
stdio bridge never prints diagnostics to stdout, because stdout is protocol
traffic.

## 4. Verify

List the tools:

```sh
curl -sS http://127.0.0.1:3765/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/list" \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

A successful response lists the tools this caller may use. Call one with
`tools/call` and the same headers, including `Mcp-Name`.

## What is exported

- Tools published by an extension are exported by default.
- A tool without a declared output schema is withheld with a reason, not
  advertised with a partial shape.
- `model_tools` management stays host-local.
- Discovery tools may be exported depending on the caller's grant; check
  `tools/list`, not the documentation.
- Confidential tools are blocked at the MCP boundary. Their definitions and
  canonical values are not returned.

## Troubleshooting

| Symptom | Check |
|---|---|
| Connection refused | Is `mcpV3.enabled` true and the port listening? |
| 401 | Token missing or does not match the configured credential. |
| 400 with `-32022` | Client is using a legacy protocol; use `2026-07-28`. |
| Tool missing from `tools/list` | It may be withheld, unexported, or outside the client's grant. |
| Call refused with a withheld reason | Read the reason; it names the policy or publication decision. |

## Next

- [MCP protocol reference](../reference/mcp-protocol.md)
- [Security and permissions](security-and-permissions.md)
- [Troubleshooting](../help/troubleshooting.md)
