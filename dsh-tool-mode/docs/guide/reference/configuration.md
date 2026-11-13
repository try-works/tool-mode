---
title: Configuration
description: Profile config keys, defaults, and examples.
---

# Configuration

Tool Mode is configured by a `model-tools` row in the profile's
`cordis.patch.yml`. The installed bundle supplies the defaults; add a row only
when you need to override them.

> **Patch rows replace the whole `config` object.** They do not merge key by key.
> Restate every key you need to keep.

## Minimal example

```yaml
- id: model-tools
  config:
    models: []
    exclude: []
    mcpV3:
      enabled: true
      host: 127.0.0.1
      port: 3765
      path: /mcp
```

## Model selection

| Key | Default | Meaning |
|---|---|---|
| `models` | `[]` | Model ids to expose. Empty means every model that can run here. A non-empty list is intersected with availability. |
| `exclude` | `[]` | Model ids to remove after `models`. |
| `exposeUnavailable` | `false` | Register a tool even when its runtime is missing, so the failure appears at call time. |
| `providers` | `{}` | Map a contract to a preferred model id, for example `stt.transcribe: voz`. An unavailable preference is ignored in favor of the first eligible implementation. |

Naming a model that cannot run does not create a broken tool. It is simply not
registered, and `tool_mode_list` reports why.

## Tools and skills

| Key | Default | Meaning |
|---|---|---|
| `registerSkills` | `true` | Publish one skill per registered tool. |
| `registerControlTool` | `true` | Register the read-only `model_tools` management view. |
| `managementGrant` | `false` | Allow the separate management tool to mutate models, extensions, and credentials. |
| `legacyAliases` | `false` | Register deprecated per-model compatibility aliases. |
| `repairAttempts` | `1` | Bounded repair attempts for repair-capable tools (0–8). |

## Routes

```yaml
- id: model-tools
  config:
    allowNpm: true
    cli:
      enabled: true
      command: desertant
    remote:
      endpoint: http://mac-studio.local:8787
      token: <bridge-token>
```

| Key | Default | Meaning |
|---|---|---|
| `allowNpm` | `true` | Allow in-process npm model packages. |
| `cli.enabled` | `true` | Use the Desert Ant CLI when found on `PATH`. |
| `cli.command` | `desertant` | Command name or absolute path. |
| `remote.endpoint` | unset | User-hosted bridge base URL. |
| `remote.token` | unset | Bearer token sent to the bridge. |

A bridge is user-hosted. Tool Mode does not run a model service.

## MCP

```yaml
- id: model-tools
  config:
    mcpV3:
      enabled: true
      host: 127.0.0.1
      port: 3765
      path: /mcp
      tokenFile: C:/Users/you/.dsh/dsh-tool-mode-mcp-token.txt
      exportTools: ["lang_detect", "stt_transcribe"]
    approvedRoots:
      - "D:/fixtures"
```

| Key | Default | Meaning |
|---|---|---|
| `mcpV3.enabled` | `false` | Serve the MCP endpoint. |
| `mcpV3.host` | `127.0.0.1` | Bind address. Loopback only. |
| `mcpV3.port` | `3765` | TCP port. |
| `mcpV3.path` | `/mcp` | HTTP path. |
| `mcpV3.tokenFile` | unset | File containing the bearer token. `DSH_TOOL_MODE_MCP_TOKEN` wins when set. |
| `mcpV3.exportTools` | `["*"]` | MCP-only export allowlist. `[]` exports no inference tools. |
| `mcpV3.grants` | deployment default | Per-client grant policy. |
| `mcpV3.catalogTtlMs` | `0` | Catalog cache TTL. |
| `mcpV3.catalogCacheScope` | `private` | Cache scope; must remain private. |
| `approvedRoots` | `[]` | Filesystem roots path-taking tools may read. Empty fails closed. |
| `confidentialTools` | `[]` | Tool names whose canonical result may not cross the MCP/Code Mode boundary. |

See [MCP protocol](mcp-protocol.md) for wire behavior.

## Extensions

| Key | Default | Meaning |
|---|---|---|
| `extensionStore` | unset | Directory of the extension store. Unset means the extension lifecycle is not mounted. |
| `extensionSourceDir` | unset | First-party extension checkouts for developer-mode installs. |
| `extensionInstallSource` | `auto` | `registry`, `directory`, or `auto`. |
| `extensionRegistry` | npm | Registry used for extension installs. |
| `extensionDependencyDepth` | `12` | Dependency graph depth bound. |
| `extensionDependencyPackages` | `256` | Dependency package-count bound. |
| `allowPreinstalledDependencies` | `false` | Allow already-materialized dependencies with install scripts. |
| `allowExecutablePreparation` | `false` | Allow executable assets to be prepared. |
| `requireActivationApproval` | `false` | Require operator approval before activating an extension. |

Source-directory installs are developer mode and require
`extensions.allowSourceDirectories: true`.

## Custom tools

| Key | Default | Meaning |
|---|---|---|
| `customToolsEnabled` | `true` | Load and register custom tools. |
| `customToolsDir` | `<state dir>/custom-tools` | Profile-scoped custom-tool store. |

## Storage

| Key | Default | Meaning |
|---|---|---|
| `stateFile` | `<DSH_HOME>/model-as-tool/state.json` | Enable/disable choices. |
| `persist` | `true` | Persist choices across restarts; `false` is session-only. |
| `credentialsFile` | `<DSH_HOME>/model-as-tool/credentials.json` | Generated MCP credentials. |
| `recordReceipts` | `true` | Record bounded invocation receipts. |
| `captureProfile` | `standard` | `metadata-only` refuses harness-backed execution where bodies cannot be retained consistently. |

## Catalog and advanced behavior

| Key | Default | Meaning |
|---|---|---|
| `catalogFile` | bundled Desert Ant catalog | Custom catalog document. |
| `playbookFile` | bundled playbooks | Custom skill/playbook document. |
| `hostedCode` | `false` | Operator grant for Code Mode. Still requires confinement evidence. |
| `networkPolicy` | `any` | `no-network` refuses extensions whose declared network behavior is ineligible. |
| `harnessModel` | auto | Explicit `{ provider, model }` for declarative extensions. Auto is default-safe. |
| `harnessProvider` | unset | Explicit provider for tests or custom deployments. |
| `compositionV3`, `multimodalV3`, `harnessExecutorV3`, `recipesV3`, `captureV3` | defaults | Advanced execution, media, and capture tuning. Change only with a specific need. |

## Precedence

1. A profile patch row is the deployment default.
2. Settings enable/disable choices are layered on top.
3. Disable wins; enable adds; reset removes the user's choice.

If a setting is ignored, check for a duplicate `model-tools` row. A second row
does not merge; it replaces.

## Next

- [MCP protocol](mcp-protocol.md)
- [Security and permissions](../guides/security-and-permissions.md)
- [Models and availability](../concepts/models-and-availability.md)

