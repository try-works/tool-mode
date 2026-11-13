---
title: Changelog
description: User-facing changes to Tool Mode for DSH.
---

# Changelog

## 0.5.44

### Renamed package

The plugin package is now:

```text
@try-works/dsh-tool-mode
```

It was previously `@try-works/dsh-model-as-tool`. The old package is deprecated.

Existing config keys, tool names, state format, and behavior are unchanged. Update
the package name, the profile bundle entry, and any explicit patch row name, then
restart. See
[Migrating from the old package](getting-started/migrating-from-dsh-model-as-tool.md).

### Documentation

- Added this user-facing documentation tree.
- Added generated model and tool reference pages.
- Added migration, MCP, extension, custom-tool, security, and troubleshooting guides.

### MCP

- A known-but-withheld tool now explains its withholding reason in a tool-error
  result instead of returning an “unknown tool” protocol error.
- A genuinely unknown tool remains a protocol error.

## Earlier versions

This changelog begins at 0.5.44. For earlier changes, see the repository history.
