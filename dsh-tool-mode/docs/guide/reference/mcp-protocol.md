---
title: MCP protocol
description: Wire behavior of the Tool Mode MCP 2026-07-28 endpoint.
---

# MCP protocol

Tool Mode serves MCP **2026-07-28** over loopback HTTP. This page is for client
authors and integrators. For setup, see
[Connect an MCP client](../guides/connect-an-mcp-client.md).

## Endpoint

```text
http://127.0.0.1:3765/mcp
```

The bind address must be loopback. A routable bind is refused at startup.

## Stateless by design

The endpoint is **stateless**:

- no `initialize` handshake;
- no session id;
- no `Mcp-Session-Id` header.

A legacy client receives `HTTP 400` with `-32022` and a `supported` list containing
`2026-07-28`.

## Required request metadata

Every request carries:

- `Authorization: Bearer <token>`;
- `MCP-Protocol-Version: 2026-07-28`;
- `Mcp-Method` matching the body method;
- for `tools/call`, `Mcp-Name` matching `params.name`;
- `params._meta` containing:
  - `io.modelcontextprotocol/protocolVersion`;
  - `io.modelcontextprotocol/clientInfo`;
  - `io.modelcontextprotocol/clientCapabilities`.

A mismatched `Mcp-Method` or `Mcp-Name` header is rejected.

## Methods

Served:

- `server/discover`;
- `tools/list`;
- `tools/call`;
- `subscriptions/listen` only when a subscription registry is wired to the
  transport. The production host does not wire one.

Not advertised and not served:

- `prompts`;
- `resources`;
- `tasks`;
- `sampling`;
- `elicitation`;
- `roots`.

## Tool publication

- Extension tools are published from manifests.
- A tool without a declared output schema is withheld with a reason. It is not
  advertised with a partial shape.
- `model_tools` stays host-local.
- Discovery tools may be exported depending on the caller's grant; verify with
  `tools/list`.
- Confidential tools are blocked at this boundary before any canonical value is
  returned. Their definitions are not exposed.
- A caller's grant is enforced independently of the host's authority.

A withheld tool call returns a **tool-error result** with the recorded reason, not
an “unknown tool” protocol error. A genuinely unknown name remains a protocol
error.

## Example: list tools

```sh
curl -sS http://127.0.0.1:3765/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/list" \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

## Example: call a tool

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "lang_detect",
    "arguments": { "text": "Bonjour" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { "name": "example", "version": "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

Send with `Mcp-Method: tools/call` and `Mcp-Name: lang_detect`.

## Responses

Responses are `application/json` or `text/event-stream` as requested. Cancellation
propagates to the tool's abort signal.

A tool failure is a result with `isError: true` and a text explanation. A protocol
failure is a JSON-RPC error.

## Authentication

- Static bearer token from the environment or token file.
- Generated client credentials authenticate as their own client id.
- A generated credential's grant is independent of the host's grant.
- Token values are never returned by the protocol.

## Next

- [Connect an MCP client](../guides/connect-an-mcp-client.md)
- [Security and permissions](../guides/security-and-permissions.md)
- [Tools reference](tools.md)
