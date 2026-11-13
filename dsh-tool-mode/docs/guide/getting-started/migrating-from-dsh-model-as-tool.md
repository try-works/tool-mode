---
title: Migrating from the old package
description: Move a profile from @try-works/dsh-model-as-tool to @try-works/dsh-tool-mode.
---

# Migrating from the old package

The plugin package was renamed from:

```text
@try-works/dsh-model-as-tool  →  @try-works/dsh-tool-mode
```

The old npm package is deprecated. Config keys, tool names, state format and
behavior did not change in the rename.

## Update the dependency

In the profile's `package.json`, replace the old dependency:

```diff
- "@try-works/dsh-model-as-tool": "0.5.44"
+ "@try-works/dsh-tool-mode": "0.5.44"
```

Then install from the profile directory:

```sh
cd ~/.dsh/profiles/web
pnpm install --ignore-scripts
```

## Update the bundle list

Replace the old name in `dsh.profile.bundles`:

```diff
  "bundles": [
-   "@try-works/dsh-model-as-tool"
+   "@try-works/dsh-tool-mode"
  ]
```

## Update the patch row

The installed bundle patch mounts the row with the new package name. If your
profile's `cordis.patch.yml` names the package explicitly, change:

```diff
- name: "@try-works/dsh-model-as-tool"
+ name: "@try-works/dsh-tool-mode"
```

If you also point `extensionSourceDir` or `preinstalledDependenciesRoot` at the
old repository, update those paths to the new checkout.

## Restart and verify

Restart DSH after the dependency and bundle names change. Then check:

1. `tool_mode_list` returns the catalog;
2. a model tool still calls successfully;
3. if MCP is enabled, `tools/list` reports
   `"name": "@try-works/dsh-tool-mode"` in `serverInfo`.

## State and caches

The state directory name (`model-as-tool`) and the state format are unchanged.
Existing enable/disable choices, receipts and custom tools remain readable.

Model weights remain in the vendor cache; the rename does not move them.

## Rollback

To roll back, restore the old dependency and bundle entry and restart. Keep the
old package installed until the new profile has been verified. The old package
will not receive new features.

## Next

- [Installation](installation.md)
- [Troubleshooting](../help/troubleshooting.md)
- [Changelog](../changelog.md)
