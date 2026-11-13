---
title: FAQ and limitations
description: Common questions about locality, network use, models, MCP, and licensing.
---

# FAQ and limitations

## Is Tool Mode fully local?

Mostly, but not unconditionally. Local models run in the process or through a
local route. The network is used when:

- a model or extension downloads weights;
- a custom HTTP tool calls an allowed public origin;
- the operator configures a remote bridge or remote decision provider.

Tongue needs no network after install. Voz downloads weights on first use.

## Does it send my text to a model provider?

Not unless you configure a remote route, a bridge, or a custom HTTP tool. The
default for a supported local model is local inference.

## Is this a chat model?

No. Tool Mode turns models into typed tools. The agent calls `lang_detect` or
`stt_transcribe`; it does not chat with a model endpoint. The DSH chat model can
still decide to call those tools.

## Which models work on my machine?

Call `tool_mode_list`. The table in [Models](../reference/models.md) shows the
catalog and the platform status, but the live answer depends on your OS, CPU,
installed runtimes, extensions, and enabled models.

## Why are some catalog models unavailable?

Typical reasons:

- no prebuilt native binary for your platform;
- an Apple-only framework;
- a closed beta with no shipping SDK;
- a missing extension or asset.

The row names the specific reason.

## Can I use Apple-only models on Windows?

Not directly. Run a user-hosted bridge on an Apple machine and point the plugin at
it. The plugin does not host the model as a service, and the model license may
restrict redistribution or hosted use.

## Can I use the same tools from Claude, Cursor, or another MCP client?

Yes, when the MCP endpoint is enabled. The client connects over loopback HTTP or
through the stdio bridge. Each client gets its own grant.

## Where are models and settings stored?

- Settings/state: under `<DSH_HOME>/model-as-tool/`.
- Custom tools: the profile-scoped custom-tool store.
- Weights: the vendor cache, for example `~/.cache/desert-ant-models/`.
- Extensions: the configured extension store.

See [Where state lives](../guides/settings.md#where-state-lives).

## Can I redistribute the model weights?

Follow the model vendor's license. Tool Mode does not bundle or mirror weights.
Some models are source-available, not open source.

## What happens to Tool Insights data?

It stays in the profile. It is not uploaded by Tool Mode. Large inputs and outputs
are bounded or summarized, and secrets are not recorded.

## How do I uninstall everything?

Remove the plugin dependency and bundle entry, then restart. Delete the
`model-as-tool` state directory and the vendor model cache only if you also want
to remove saved choices, receipts, custom tools, and downloaded weights.

## What is still limited?

- Not every catalog model has a Node build for every platform.
- Some model SDKs are closed beta.
- Code Mode is conditional and withheld until its release gate holds.
- Extension and asset preparation can require operator approval.
- MCP serves tools only; prompts, resources, sampling, and roots are not served.

For the current release evidence and known blocked items, see the repository's
release report. User-facing docs describe behavior, not a claim that every
specification item is complete.

## Next

- [Troubleshooting](troubleshooting.md)
- [Security and permissions](../guides/security-and-permissions.md)
- [Changelog](../changelog.md)
