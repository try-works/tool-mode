---
title: Settings
description: Manage models, extensions, custom tools, and visibility from DSH.
---

# Settings

Tool Mode adds a settings page to DSH. The page may be labelled **Tool Mode** or
**Model as Tool**, depending on the build.

The Settings surface is the normal way to manage the plugin. A profile's
`cordis.patch.yml` remains the deployment default and can pin a model selection.

## Models

Each catalog model is a row:

- **Name and provider** — what the model is and who publishes it.
- **Availability** — whether it can run in this process.
- **Reason** — the concrete blocker when unavailable.
- **Toggle** — enable or disable the tool for this profile.

Disabling a model removes its tool from the agent's next turn. Enabling a model
that cannot run fails with the resolver's reason and writes nothing; silently
recording a failed enable would install a broken tool on the next restart.

A deployment config can set the default selection with `models` and `exclude`.
The Settings choice is layered on top:

- `disable` wins over the config default;
- `enable` adds to the config selection;
- reset returns the model to the config default.

## Extensions

The Settings page can install an extension package, prepare its assets, enable it,
and remove it. Installation and activation are separate:

- **installed** means the package bytes are present;
- **prepared** means required assets are present;
- **enabled** means the host may register the tools.

An extension can be installed but unavailable. The row explains which condition
is missing.

See [Install extensions](install-extensions.md).

## Custom tools

The **Create tool** tab lets you author an HTTP, prompt, or composite tool without
writing code. Saved tools are profile-scoped and can optionally be exposed over
MCP.

See [Custom tools](custom-tools.md).

## Tool Insights

Tool Insights shows the tools that exist, their source, and their call history.
Use it to answer “is this tool available?”, “who owns it?”, and “what happened on
that call?”.

See [Tool Insights](tool-insights.md).

## Where state lives

Defaults on a normal DSH profile:

| Data | Default location |
|---|---|
| Model enable/disable state | `<DSH_HOME>/model-as-tool/state.json` |
| Receipts | Next to the state file, `<stateFile>.receipts.json` |
| Custom tools | `<stateFile directory>/custom-tools/` |
| MCP credentials | `<DSH_HOME>/model-as-tool/credentials.json` |
| Extension store | Profile `extensions/` directory, when configured |
| Model weights | Vendor cache, for example `~/.cache/desert-ant-models/` |

The plugin writes its own state file instead of rewriting your profile patch. This
avoids clobbering comments and fighting profile reloads.

You can redirect state with `stateFile`, `customToolsDir`, and `credentialsFile`.
See [Configuration](../reference/configuration.md#storage).

## Precedence

1. A profile patch row is the deployment default.
2. Settings changes are the user's choice on top of it.
3. A reset removes the user's choice.

If a setting appears to be ignored, check that the profile does not mount a second
`model-tools` row. A patch row replaces the whole `config`; it does not merge.

## Next

- [Configuration reference](../reference/configuration.md)
- [Troubleshooting](../help/troubleshooting.md)
