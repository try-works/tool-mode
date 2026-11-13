---
title: Custom tools
description: Create HTTP, prompt, and composite tools from the DSH UI.
---

# Custom tools

Custom tools let you add a bounded tool without writing an extension. They are
profile-scoped, versioned, and can be exposed to the agent or to MCP.

Open **Settings → Tool Mode → Create tool**.

## Tool types

### HTTP

Calls a public HTTPS endpoint.

- The origin must be on the tool's explicit allowlist.
- Loopback, private, link-local, multicast, unspecified and cloud-metadata
  addresses are refused.
- There is no per-tool override for private networks in v1.

Use an operator-controlled MCP or bridge endpoint if you need an internal API.

### Prompt

Runs a bounded prompt through the deployment's configured chat model and returns
the text. Use it for a repeated transformation with a fixed instruction, not for
open-ended planning.

### Composite

Runs a bounded sequential pipeline of existing tools.

- Maximum 10 steps.
- Only tools on the composite's allowlist can be called.
- No loops or recursion.
- Destructive steps require approval.

## Create and test

1. Choose a type.
2. Fill in the name, description, and input schema.
3. Add the implementation details.
4. Use **Test** with a sample input.
5. Save.

The test runs through the same validation and execution path as a real call. A
test failure is a real failure; fix it before saving.

## Agent and MCP exposure

- A saved, enabled tool is visible to agents on their next turn.
- MCP exposure is **off by default** and is opt-in per tool.
- Disabling or deleting removes the tool from both surfaces.

A draft is never exposed or auto-saved.

## Secrets

A custom tool never stores a secret value. Use a credential reference such as
`WEATHER_API_KEY`; the host resolves it at call time through the DSH credential
service. Missing credentials fail closed with a named error.

Secrets must not appear in:

- the tool definition;
- the test input;
- the returned result;
- logs or receipts.

## Security limits

Custom tools are deliberately not arbitrary JavaScript or shell. The supported
execution types are HTTP, prompt, and composite. This keeps a user-authored tool
from becoming an unrestricted host process.

## Next

- [Tool Insights](tool-insights.md)
- [Security and permissions](security-and-permissions.md)
- [Configuration: custom tools](../reference/configuration.md#custom-tools)
