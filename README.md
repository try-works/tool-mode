# Tool Mode

**Give your DSH agent real tools for the models on your machine.**

[![npm](https://img.shields.io/npm/v/@try-works/dsh-tool-mode.svg)](https://www.npmjs.com/package/@try-works/dsh-tool-mode)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

Tool Mode turns local and on-device models into typed tools that an agent can
actually call. Instead of pretending a model is a chat endpoint, it registers
tools such as `lang_detect`, `stt_transcribe`, `semantic_rank` and
`structured_extract`, with explicit input/output schemas and an honest answer for
every model that cannot run on this machine.

> **New to Tool Mode?** Start with the
> **[documentation](dsh-tool-mode/docs/guide/index.md)** → installation takes a
> few minutes.

## Why Tool Mode

- **Tools, not model names.** The agent asks for `lang_detect`; which model or
  route serves it is a deployment decision. Swapping the model does not change
  the tool schema.
- **Capability-aware.** A model is registered only when it can run here, or is
  deliberately exposed as unavailable with the reason. No tool that fails on
  every call.
- **Local-first.** Models can run in-process, through the Desert Ant CLI, through
  a user-hosted bridge, or as an installed extension.
- **One surface for agents and MCP.** The same tools are available to DSH and to
  MCP clients over an authenticated loopback endpoint.
- **Operable.** Model toggles, extensions, custom tools, usage insights and
  security controls live in DSH settings.

## Install

Tool Mode is a DSH bundle. Install it into a profile:

```sh
dsh plugin --profile web add @try-works/dsh-tool-mode
```

Restart DSH, then open **Settings → Tool Mode**. Enable a model — **Tongue** is
the simplest first choice because its 2 MB model ships inside the npm package and
needs no runtime download.

Ask the agent:

> Detect the language of “Bonjour, comment allez-vous ?”

It calls `lang_detect` and returns the language with confidence and ranked
alternatives.

Full instructions, manual installs and upgrade notes are in
[Installation](dsh-tool-mode/docs/guide/getting-started/installation.md).

## Models

Tool Mode ships with the **18-model Desert Ant catalog**, plus models added by
extension packages. Availability depends on the platform, installed runtimes,
prepared assets and enabled extensions.

| Model | Task | Windows x64 |
| --- | --- | --- |
| Tongue | Language detection | **Yes** — pure JavaScript, weights bundled |
| Voz | Speech-to-text | **Yes** — ONNX Runtime, ~367 MB weights on first use |
| Title / Uhm | Apple-only models | Through an Apple machine or bridge |
| Most other catalog models | Various | No native Windows build; the reason is reported |

Use `tool_mode_list` for the live answer in your process. The complete table and
the reason for every unavailable model are in
[Models](dsh-tool-mode/docs/guide/reference/models.md).

## Use it from an MCP client

Enable the endpoint in your profile:

```yaml
- id: model-tools
  config:
    mcpV3:
      enabled: true
      host: 127.0.0.1
      port: 3765
      path: /mcp
```

Provide the bearer token through `DSH_TOOL_MODE_MCP_TOKEN` or a `tokenFile`, then
connect Claude Desktop, Cursor or another MCP client. The endpoint serves MCP
`2026-07-28` over loopback HTTP, with per-client grants and tool-level export
policy.

See [Connect an MCP client](dsh-tool-mode/docs/guide/guides/connect-an-mcp-client.md).
For wire behavior, see the
[MCP protocol reference](dsh-tool-mode/docs/guide/reference/mcp-protocol.md).

## What is in this repository

| Folder | Runtime | Status |
| --- | --- | --- |
| [`dsh-tool-mode`](dsh-tool-mode/) | DeepSeek Harness (DSH) | **Available** — plugin, contracts, extension SDK, extensions, tests |
| `opencode-tool-mode` | OpenCode | Planned |
| `pi-tool-mode` | Pi | Planned |

The DSH implementation is a monorepo. The published plugin is
[`@try-works/dsh-tool-mode`](https://www.npmjs.com/package/@try-works/dsh-tool-mode);
the repository also contains the model-free contracts, the public extension SDK,
first-party model extensions, and verification tooling.

## Documentation

| Read this | If you want to… |
| --- | --- |
| [Documentation home](dsh-tool-mode/docs/guide/index.md) | Start at the beginning |
| [Installation](dsh-tool-mode/docs/guide/getting-started/installation.md) | Add the plugin to a profile |
| [First tool](dsh-tool-mode/docs/guide/getting-started/first-tool.md) | Make a first successful call |
| [Using tools in DSH](dsh-tool-mode/docs/guide/guides/using-tools-in-dsh.md) | Day-to-day use with an agent |
| [Extensions](dsh-tool-mode/docs/guide/guides/install-extensions.md) | Add model tools beyond the catalog |
| [Custom tools](dsh-tool-mode/docs/guide/guides/custom-tools.md) | Create HTTP, prompt or composite tools |
| [Security](dsh-tool-mode/docs/guide/guides/security-and-permissions.md) | Understand tokens, grants and approvals |
| [Troubleshooting](dsh-tool-mode/docs/guide/help/troubleshooting.md) | Diagnose a missing tool or MCP problem |
| [Tool reference](dsh-tool-mode/docs/guide/reference/tools.md) | See every tool and its backing model |
| [Configuration](dsh-tool-mode/docs/guide/reference/configuration.md) | Change profile behavior |

## Requirements

- Node.js **24+**
- DSH **0.2.1-rc.2+**
- A supported platform for the model you want to run

The plugin starts cleanly without model runtimes; it reports what is missing
rather than failing at call time.

## Development

The DSH monorepo lives in [`dsh-tool-mode`](dsh-tool-mode/). Build, test and
verification commands run from there:

```sh
cd dsh-tool-mode
npm ci
npm run link:dsh -- --checkout /path/to/deepseek-harness
npm run build
npm test
npm run verify
```

`link:dsh` is required for local development because the DSH peer packages are
supplied by a DSH checkout rather than installed by npm.

Useful references:

- [Package README](dsh-tool-mode/README.md)
- [Extension authoring and contracts](dsh-tool-mode/docs/PLUGIN.md)
- [Internal specifications and evidence](dsh-tool-mode/docs/) — engineering
  material, not user documentation

## License

MIT. Model weights and SDKs keep their own vendor licenses; Tool Mode does not
redistribute model weights. See the model pages for the applicable terms.
