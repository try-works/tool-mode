---
title: Models and availability
description: What runs where, why a model is unavailable, and how routes change that.
---

# Models and availability

Tool Mode ships with an **18-model Desert Ant catalog** and can add models through
extension packages. Availability is decided in the running process.

The complete table is generated at [Models](../reference/models.md). This page
explains how to read it and what to do when a model is unavailable.

## The catalog

The catalog is a description of models, not a promise that every model runs on
every machine. Each entry records the task, input/output, language coverage, size,
license, npm package, and platform support.

Two catalog models are verified runnable on Windows x64:

- **Tongue** — language identification, pure JavaScript, 2 MB of bundled weights.
- **Voz** — speech-to-text, needs `onnxruntime-node`, and downloads about 349 MB
  of weights on first use.

Other catalog models are unavailable on a typical Windows host for concrete
reasons:

- the vendor publishes a browser build but no Node native build;
- the model is Apple-only;
- the model is in closed beta with no shipping SDK.

The generated table records those reasons. Do not infer availability from the
vendor's marketing page; the model must have a route that this process can use.

## Extension models

Extension packages add tools and models beyond the 18-model catalog. Examples
include EmbeddingGemma 2, Laya, MiniLM, Needle, Mirage, and the harness vision/text
packages.

An extension model is available only when:

1. the extension is installed;
2. its assets are prepared, when it needs downloaded assets;
3. it is activated;
4. its runtime dependencies resolve on this platform.

See [Install extensions](../guides/install-extensions.md).

## Reading an unavailable result

Call:

```text
tool_mode_list
```

An unavailable tool includes a `readiness` string such as:

```text
unavailable: Tongue declares the Tool Mode extension
@try-works/extension-desert-ant-tongue, which is not installed or not resolvable
from this host. Install and activate that extension, or correct the catalog
binding.
```

Read the reason as an instruction:

| Reason | Action |
|---|---|
| Missing extension | Install and enable the extension. |
| Missing runtime | Install the platform runtime, such as `onnxruntime-node`. |
| No native build | Use another platform, the CLI route, or a bridge. |
| Apple-only | Run on Apple silicon or point the bridge at an Apple machine. |
| Closed beta | There is no shipping SDK; wait for the vendor. |
| Missing assets | Prepare the extension assets, then retry. |

## Routes that change availability

### Desert Ant CLI

On macOS and Linux, install the vendor CLI and put it on `PATH`. The plugin
detects `desertant` and can use it for every shipping model. Configure the command
with `cli.command` if it is not on `PATH`.

### User-hosted bridge

For models this machine cannot run, start a bridge on a machine that can, then set:

```yaml
remote:
  endpoint: http://mac-studio.local:8787
  token: <bridge-token>
```

The bridge is user-hosted. The plugin does not run a model service for you.

## Downloads and licensing

- Tongue's weights ship inside its npm package; no download.
- Voz downloads weights into the vendor cache on first use.
- Extensions may download assets during a deliberate **prepare** step.
- Weights are not redistributed by Tool Mode. Licenses and redistribution terms
  belong to the model vendor.

## Next

- [Models reference](../reference/models.md)
- [Configuration: routes](../reference/configuration.md#routes)
- [Security and permissions](../guides/security-and-permissions.md)
