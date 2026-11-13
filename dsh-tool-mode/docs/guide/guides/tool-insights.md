---
title: Tool Insights
description: See which tools exist, where they came from, and how they are used.
---

# Tool Insights

Tool Insights is the visibility surface for the deployment's tools. It answers:

- Which tools are registered?
- Who owns each tool: host, extension, catalog model, or custom?
- Which calls succeeded, failed, or were refused?
- How long did a call take?
- Is a custom tool exposed to MCP?

Open it from **Settings → Tool Mode → Tool Insights**.

## Tool inventory

Each tool row shows its source and status. The source is one of:

- **host** — discovery, management, decisions, utilities;
- **catalog** — a Desert Ant model tool;
- **extension** — an installed extension;
- **custom** — a user-authored tool.

An unavailable tool stays visible with its readiness reason. This is often more
useful than hiding it: the reason names the missing package, runtime, or asset.

## Call history

The history records tool name, outcome, elapsed time, and a bounded receipt. It is
local to the profile.

The history is for debugging and accountability, not for reproducing full model
inputs and outputs. Large payloads are bounded or summarized.

## Privacy

- Insights data stays in the profile.
- It is not uploaded by Tool Mode.
- Model weights and secrets are not recorded.
- MCP calls are recorded through the same path as native calls, so external use is
  visible.

If you need to remove the data, stop DSH and delete the relevant state/receipt
files. See [Where state lives](settings.md#where-state-lives).

## Next

- [Using tools in DSH](using-tools-in-dsh.md)
- [Custom tools](custom-tools.md)
- [Security and permissions](security-and-permissions.md)
