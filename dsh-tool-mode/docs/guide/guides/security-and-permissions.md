---
title: Security and permissions
description: Local-first behavior, MCP grants, confidentiality, extensions, and custom-tool safety.
---

# Security and permissions

Tool Mode is designed to run models locally where possible, but “local” is not the
same as “no network.” This page states the boundaries plainly.

## Network use

Tool Mode uses the network when:

- a model or extension downloads weights or assets;
- a custom HTTP tool calls an explicitly allowed public origin;
- an operator configures a remote route or a bridge;
- a remote decision provider is explicitly enabled.

Tongue is fully offline after install: its weights are in the npm package. Voz
downloads weights on first use. Extensions may prepare assets on request.

Set `networkPolicy: no-network` to refuse extensions whose declared network
behavior is not eligible. This is a strict deployment mode; read the extension's
declaration before enabling it.

## MCP authentication and grants

- The endpoint binds to loopback by default and refuses a routable bind.
- Authentication is a bearer token from an environment variable or token file.
- Generated client credentials authenticate as separate client identities.
- Each external client runs under its own grant, not the host's full authority.
- A tool the operator can use is still refused for a client that lacks the grant.

Do not commit tokens. Do not paste tokens into prompts or issue trackers.

## Confidential tools

An operator can mark a tool's canonical result as confidential. That tool is
blocked at the MCP and Code Mode boundaries **before** any value is returned.
Native callers are unaffected by this external-surface policy.

A confidential tool's definition and withheld reason are also kept from external
clients. A client that asks for it gets a policy refusal, not a leak.

## Filesystem roots

Path-taking tools use `approvedRoots`:

```yaml
approvedRoots:
  - "D:/fixtures"
  - "/Users/you/audio"
```

A path outside the approved roots is refused. Add the narrowest directory that
covers the data.

## Extension trust

Extensions run model code and may download assets. Install only extensions you
trust.

- Source-directory installs are developer mode and must be explicitly allowed.
- Install-time lifecycle scripts are refused by default.
- Executable assets require a separate operator approval.
- Activation can require approval when the deployment enables it.

A pending approval is a stop, not a suggestion. Do not work around it by editing
the extension store by hand.

## Custom tool safety

- HTTP tools: public HTTPS only; private networks are blocked.
- Secrets: references only, resolved per call; never stored in the definition.
- Prompt tools: bounded prompt, not arbitrary code.
- Composite tools: bounded steps, allowlist, no loops; destructive steps require
  approval.

## Model weights and licenses

Tool Mode does not redistribute model weights. A model's license controls whether
you may cache it, use it commercially, or serve it to others. The plugin does not
turn a model into a hosted service; a bridge must be on your own machine.

## Operator checklist

- [ ] Keep the MCP token out of source control.
- [ ] Grant the narrowest `approvedRoots`.
- [ ] Review extensions before enabling downloads or executable assets.
- [ ] Mark sensitive result tools confidential when exposing MCP.
- [ ] Use `networkPolicy: no-network` where appropriate.
- [ ] Remove unused custom tools and MCP clients.

## Next

- [MCP protocol](../reference/mcp-protocol.md)
- [Configuration reference](../reference/configuration.md)
- [Troubleshooting](../help/troubleshooting.md)
