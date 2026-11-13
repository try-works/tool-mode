# MCP from a DSH host

Tool Mode serves the **MCP `2026-07-28`** protocol over **loopback HTTP**, with the DSH host
as the dispatcher: every external call goes through the same tool registry, per-client grant
and receipt ring as a native call. This document describes what the endpoint actually
advertises and how to turn it on; it deliberately says what is *absent*, because a client
that discovers a capability the host does not serve is worse than one that cannot connect.

## Enable it

```yaml
# your DSH profile patch
- id: model-tools
  config:
    mcpV3:
      enabled: true
      host: 127.0.0.1      # loopback only; a routable bind is refused at startup
      port: 3765
      path: /mcp
    # the tools an extension PUBLISHES are exported automatically; approvedRoots
    # is the separate grant for path-taking tools (audio, needle file inputs)
    approvedRoots:
      - "D:/fixtures"
```

Start DSH with the operator token:

```
DSH_TOOL_MODE_MCP_TOKEN=<long random value> dsh --profile web
```

The environment token WINS when present; for a desktop-launched host whose environment the
operator cannot change, point `mcpV3.tokenFile` at a file containing the trimmed token
instead:

```yaml
    mcpV3:
      enabled: true
      host: 127.0.0.1
      port: 3765
      path: /mcp
      tokenFile: "C:/Users/you/.dsh/dsh-tool-mode-mcp-token.txt"
```

The plugin logs `model-tools: MCP endpoint http://127.0.0.1:3765/mcp`. The endpoint is closed
when the plugin's activation is disposed. The token is **never** the literal config value: it
is read from the environment, that token file, or a generated credential in the credential
store.

## What is on the surface

| Tool source | Exported? | Notes |
| --- | --- | --- |
| Standard contract tools (catalogue/extension implementation) | yes | `text_embed`, `lang_detect`, … |
| Extension tools declared in a manifest | yes | `tools_plan`, `validate_record`, `multimodal_embed`, … |
| Declarative recipe tools | yes | `text_title`, `describe_image` |
| `tool_mode_run` | only when `hostedCode: true` **and** confinement evidence is accepted | CODE-10; absent means the disabled-until-granted state |
| `model_tools` | **never** | management stays host-local (CODE-07) |
| `tool_mode_list` / `tool_mode_describe` | no | they describe the surface, not serve it |

A tool whose output schema is not declared is withheld with a reason rather than advertised
with a partial shape. `tools/list` is the single source of truth.

## Protocol behavior

- **Stateless**: no `initialize` handshake, no session id, no `Mcp-Session-Id` header.
  Legacy clients get `HTTP 400` with `-32022` and `supported: ["2026-07-28"]`.
- `server/discover` and `tools/list`, `tools/call` are served. `prompts`, `resources`,
  `tasks`, `sampling`, `elicitation` and `roots` are **not advertised and not served**.
- `subscriptions/listen` is advertised only when a subscription registry is wired to the
  transport; the production host currently does not wire one.
- Responses are `application/json` or SSE (`text/event-stream`) as requested; cancellation
  propagates to the tool's signal.
- Request `_meta` must carry `io.modelcontextprotocol/protocolVersion`, `clientInfo` and
  `clientCapabilities`; the `Mcp-Method` / `Mcp-Name` headers must match the body.

## Authentication and grants

`Authorization: Bearer <token>` over `static-token`, or the embedded OAuth resource server.
Generated credentials from the credential store authenticate with their **own** client id, so
grants and receipts name the client rather than the operator. The default allowed set is the
live published surface; a per-client override can only NARROW it. `model_tools` is never in
any external grant. Path-taking tools authorize through the host grant's `approvedRoots` and
refuse a path outside them with `PATH_OUTSIDE_GRANT` — the grant is not widened by asking.

## Wire example

```
POST /mcp
Mcp-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: lang_detect
Authorization: Bearer ****
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
  "name":"lang_detect","arguments":{"text":"Bonjour tout le monde"},
  "_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28",
           "io.modelcontextprotocol/clientInfo":{"name":"probe","version":"1.0"},
           "io.modelcontextprotocol/clientCapabilities":{}}}}
```

```json
{"result":{"content":[{"type":"text","text":"{...}"}],
 "structuredContent":{"language":"fr","reliability":"confident","candidates":[...]},
 "resultType":"complete",
 "_meta":{"io.modelcontextprotocol/serverInfo":{"name":"@try-works/dsh-tool-mode","version":"0.5.16"}}}}
```

## What an MCP caller does NOT get

- The host-authored `meta` envelope (receipt id and the Code Mode call trace) is stripped
  from the MCP payload per MCP §16.4: the receipt is recorded internally, but it is not part
  of the externally advertised result shape. Do not build a client that expects it.
- `model_tools`, management actions, installs, prepares and removals.
- LAN/public usage: loopback only by construction.

## Verification

- Unit: `mcp-host-endpoint.test.ts` (listener binds, answers, closes with the host),
  `mcp-extension-surface.test.ts` (a real installed extension's tool appears on the wire),
  `mcp-host-binding.test.ts` (schema dialects, per-tool validator isolation, host path).
- Live: build an isolated instance (separate `DSH_HOME`, extension store copy, MCP port),
  then run `server/discover`, `tools/list` and a `tools/call` for every listed tool with real
  fixtures. An isolated instance is the only honest environment for that sweep: the main
  host's store is live and its owner pid must not be faked.

