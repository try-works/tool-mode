---
title: Installation
description: Install Tool Mode into a DSH profile and verify the tool catalog.
---

# Installation

This page installs the DSH plugin into a DSH profile and verifies that its tools
are registered. For a first call, continue to
[Use your first tool](first-tool.md).

## Before you start

- **Node.js 24 or newer.**
- **DSH 0.2.1-rc.2 or newer.**
- A DSH profile you can restart. The examples use `web`, the profile used by the
  desktop app; replace it with your profile name.

Model availability is separate from installation. The plugin installs and starts
without any model runtime; models whose platform is unsupported stay visible as
unavailable. See [Models and availability](../concepts/models-and-availability.md).

## Install with the DSH plugin manager

The recommended route is the DSH plugin manager, so the profile records the
dependency and the bundle declaration together.

From a terminal:

```sh
dsh plugin --profile web add @try-works/dsh-tool-mode
```

If you use the desktop app, install `@try-works/dsh-tool-mode` from the plugin
manager instead and then restart DSH.

The package is a bundle: it ships `cordis.patch.yml`, and installing the bundle
adds the `model-tools` row plus the plugin to the profile's bundle list.

## Install manually

Use this route when you manage the profile's `package.json` yourself.

1. Add the dependency to the profile:

   ```sh
   cd ~/.dsh/profiles/web
   pnpm add @try-works/dsh-tool-mode
   ```

2. Add the package to `dsh.profile.bundles` in the profile's `package.json`:

   ```json
   {
     "dsh": {
       "profile": {
         "bundles": [
           "@try-works/dsh-tool-mode"
         ]
       }
     }
   }
   ```

3. Restart DSH. The bundle patch mounts the `model-tools` row.

If your profile already has a `model-tools` row, a second row is not added.
Edit the existing row instead; a patch row replaces the whole `config`, so keep
every key you still need.

## Verify the installation

Ask the agent to call:

```text
tool_mode_list
```

A working installation returns a catalog revision and a tool list. For a single
tool, call:

```text
tool_mode_describe { "tools": ["lang_detect"] }
```

The result includes the input/output schema, the backing model, readiness, and
the semantics the tool declares.

If the plugin is configured with MCP, the endpoint identity is the package name
and version:

```json
{
  "name": "@try-works/dsh-tool-mode",
  "version": "0.5.44"
}
```

## Upgrade

Upgrade the package through the same route you installed it, then restart DSH:

```sh
dsh plugin --profile web add @try-works/dsh-tool-mode@latest
```

Manual installs:

```sh
cd ~/.dsh/profiles/web
pnpm add @try-works/dsh-tool-mode@latest
```

Restart after the package changes. The running process does not hot-reload a
new plugin version.

## Uninstall

Remove the dependency and the bundle entry, then restart:

```sh
dsh plugin --profile web remove @try-works/dsh-tool-mode
```

State and caches are not deleted automatically. See
[Where state lives](../guides/settings.md#where-state-lives) if you want to remove
them deliberately.

## Next

- [Use your first tool](first-tool.md)
- [Migrate from the old package name](migrating-from-dsh-model-as-tool.md)
- [Troubleshooting](../help/troubleshooting.md)
