---
title: Tool Mode
description: Turn local and on-device models into callable tools for your DSH agent.
---

# Tool Mode

Tool Mode gives your DSH agent a **real tool for every model it can run locally**,
plus an honest explanation for every model it cannot run. The agent calls
`lang_detect`, `stt_transcribe`, `semantic_rank` or `mcp`-exported tools directly;
it never has to pretend a model is a chat endpoint.

## Start here

- **[Install Tool Mode](getting-started/installation.md)** — add the plugin to a DSH profile and verify it.
- **[Use your first tool](getting-started/first-tool.md)** — enable language detection and make a call.
- **[Connect an MCP client](guides/connect-an-mcp-client.md)** — use the same tools from Claude Desktop, Cursor, or another MCP client.

## What it gives you

- **A stable tool surface.** Contracts define names, inputs, outputs, limits, and
  unsupported cases. A model can be swapped without changing the tool schema.
- **Capability-aware registration.** A model is registered only when it can run in
  this process, or is deliberately exposed as unavailable so the reason is visible.
- **More than one route.** In-process npm packages, the Desert Ant CLI, a
  user-hosted bridge, and extension packages all use the same contracts.
- **A real MCP surface.** MCP `2026-07-28` over loopback HTTP, authenticated and
  scoped per client.
- **Local control.** Extensions, custom tools, and model choices are managed in
  DSH settings and stay on your machine.

## Requirements

- Node.js **24** or newer.
- DSH **0.2.1-rc.2** or newer.
- A supported platform for each model you want to run. The plugin starts cleanly
  when a model's runtime is missing and reports why.

## Documentation map

| Section | What it covers |
|---|---|
| [Getting started](getting-started/installation.md) | Install, first call, upgrade |
| [Concepts](concepts/how-tool-mode-works.md) | How tools, models, contracts, routes, and availability fit together |
| [Guides](guides/settings.md) | Settings, DSH use, MCP, extensions, custom tools, insights, security, Code Mode |
| [Reference](reference/tools.md) | Tools, models, configuration, MCP protocol, CLI |
| [Help](help/troubleshooting.md) | Troubleshooting, FAQ, limitations, changelog |

## Current scope

This documentation covers **DSH** and the `@try-works/dsh-tool-mode` package.
Other Tool Mode runtimes are documented separately when they ship.

Tool Mode is local-first. It uses the network when it downloads model weights,
when a custom HTTP tool calls an allowed public origin, or when an operator
configures a remote route. See [Security and permissions](guides/security-and-permissions.md).
