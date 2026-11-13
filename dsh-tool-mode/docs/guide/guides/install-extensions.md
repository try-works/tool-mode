---
title: Install extensions
description: Add model tools beyond the built-in catalog.
---

# Install extensions

An **extension** is an independently versioned package that declares one or more
tools and supplies the model implementation behind them. Extensions are how Tool
Mode grows without adding model-specific code to the host.

## Before you start

Extension management needs a store. Set it in the profile patch:

```yaml
- id: model-tools
  config:
    extensionStore: C:/Users/you/.dsh/profiles/web/extensions
```

Without `extensionStore`, the host does not mount the extension lifecycle. The
Settings page can still describe the catalog, but installation is unavailable.

## Install from the registry

1. Open **Settings → Tool Mode → Extensions**.
2. Choose an extension and select **Install**.
3. Wait for the package and its dependency tree to install.
4. **Prepare** assets if the extension declares downloadable files.
5. **Enable** the extension.

Installing and enabling are separate on purpose. An installed extension whose
assets are missing must not register a tool that cannot run.

The installer verifies the registry package integrity. A package-level registry
refusal is a named error; it is never silently retried from a local directory.

## Install from a source directory

Source-directory installs are **developer mode**. They are only available when the
operator explicitly allows them:

```yaml
    extensions:
      allowSourceDirectories: true
    extensionSourceDir: D:/DEV/tool-mode/dsh-tool-mode/packages
```

The installer copies the tree; it does not link it. The installed extension lands
inactive. This route is for developing an extension, not for normal use.

## Prepare assets

Some extensions need downloaded model files. The prepare step:

- shows what will be downloaded;
- verifies the declared digest;
- records readiness only after the assets are complete.

A download is opt-in. Preparing is a deliberate operator action, not something
that happens during install. If a required asset is not ready, the extension stays
unavailable with the missing asset named.

## Approvals

Some operations can require operator approval:

- activating an extension, when activation approval is enabled;
- preparing executable assets, when executable preparation approval is enabled;
- destructive or gated steps inside a composite custom tool.

A pending approval is not an error. The extension or action is waiting for the
operator. If no approval control is available in the deployment, the action
refuses with a named code instead of hanging.

## Dependency rules

Extensions declare their dependencies. The installer:

- bounds the dependency graph by depth and package count;
- refuses packages that need install-time lifecycle scripts, unless the operator
  explicitly allows preinstalled dependencies;
- never runs an install script silently.

This is a security boundary. Prefer packages that ship prebuilt artifacts, or use
the operator's preinstalled-dependency route deliberately.

## Update, disable, remove

- **Disable** removes the extension's tools from the next agent turn.
- **Update** installs a new version; restart or reactivate as prompted.
- **Remove** deletes the installed copy. State under the profile's extension store
  may remain until cleaned.

If an extension installs but its tool is missing, use
`tool_mode_list` or the extension row to see whether it is installed, prepared,
approved, and enabled.

## Next

- [Models and availability](../concepts/models-and-availability.md)
- [Security and permissions](security-and-permissions.md)
- [Troubleshooting](../help/troubleshooting.md)
