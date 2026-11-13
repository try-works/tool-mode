---
title: Troubleshooting
description: Diagnose common installation, model, MCP, extension, and permission problems.
---

# Troubleshooting

Start with the exact error. Tool Mode names the missing condition more often than
it names a generic failure.

## Plugin and tools

### The plugin is not listed

- Confirm the package is in the profile's dependencies.
- Confirm `@try-works/dsh-tool-mode` is in `dsh.profile.bundles`.
- Restart DSH; a new plugin version does not hot-reload into a running process.
- Check that the profile has the `model-tools` row composed.

### No tools are registered

- Ask for `tool_mode_list`. If it returns an empty tool list, no model is enabled
  or no extension is active.
- Check Settings → Tool Mode for disabled rows.
- Check `models` and `exclude` in the profile patch.
- Check that the model's platform is supported.

### A model is unavailable

Read the reason on the row or in `tool_mode_list`:

| Reason | Fix |
|---|---|
| Missing native build | Use a supported platform, CLI, or bridge. |
| Apple-only | Run on Apple silicon or point a bridge at an Apple machine. |
| Closed beta | Wait for the vendor's SDK. |
| Missing runtime | Install the runtime, for example `onnxruntime-node`. |
| Missing extension | Install, prepare, and enable the extension. |
| Missing assets | Run the extension's prepare step. |

### `lang_detect` works but another model does not

Availability is per model. Tongue is pure JavaScript; Voz needs an ONNX runtime
and a large weight download. A working Tongue install does not imply Voz is
runnable.

### Voz first call fails or takes a long time

The first call downloads roughly 367 MB of weights. Check:

- disk space and network access;
- the vendor cache directory;
- whether a proxy or offline mode blocks Hugging Face;
- whether the runtime package is installed for this platform.

## MCP

### Connection refused

- Is `mcpV3.enabled` true?
- Is the port listening?
- Did the host bind loopback? A routable bind is refused.

### 401 Unauthorized

- Is the token present?
- Does the token match the configured environment variable or token file?
- Is the `Authorization` header exactly `Bearer <token>`?

### 400 with `-32022`

The client is using a legacy MCP version. Configure `2026-07-28`.

### Tool missing from `tools/list`

- It may be withheld because it declares no output schema.
- It may be outside the client's grant.
- It may be excluded by `mcpV3.exportTools`.
- It may be a management tool, which stays host-local.

### Calling a known tool says it is withheld

Read the reason. It names the policy or publication decision. The tool is not
malfunctioning; the host is refusing to publish it to this caller.

## Extensions

### Installed but not active

Check the lifecycle state:

1. package installed;
2. assets prepared;
3. approval granted, if required;
4. extension enabled;
5. runtime dependencies satisfied.

### Approval is pending

An operator must decide. If the deployment has no approval control, the action
refuses by name rather than waiting forever. See
[Install extensions](../guides/install-extensions.md#approvals).

### Install script refused

The installer refuses packages that need install-time lifecycle scripts by
default. Prefer a package with prebuilt artifacts, or have the operator enable the
preinstalled-dependency route deliberately.

## Files and permissions

### A path-taking tool refuses

Add the narrowest directory to `approvedRoots` and restart. An empty list fails
closed.

### Sandbox or permission error

The host's filesystem policy can refuse a path even when the tool's root allows
it. Check the host's sandbox/approval configuration.

## Code Mode

### `tool_mode_run` is withheld

Two conditions are required:

1. the operator grant (`hostedCode: true`);
2. valid confinement evidence for this package version and platform.

A missing, stale, failed, or partial evidence artifact closes the gate. Do not
bypass it; read the reason and use a normal tool.

## Getting help

Include:

- the DSH version and plugin version;
- the operating system and CPU;
- the exact tool call and error text;
- whether the call was native or MCP;
- the relevant Settings row or readiness reason.

Remove tokens and personal data before sharing logs.
