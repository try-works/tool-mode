---
title: Use your first tool
description: Enable a model and make a real tool call.
---

# Use your first tool

This walkthrough enables **Tongue**, the language detector, and calls
`lang_detect`. Tongue is pure JavaScript and ships its 2 MB model inside the npm
package, so it needs no runtime download or accelerator.

## 1. Open Tool Mode settings

In DSH, open **Settings → Tool Mode** (the page may be labelled **Model as Tool**
in older builds).

Every catalog model is listed with:

- its name and provider;
- whether it can run in this process;
- the reason it cannot run, when unavailable;
- an enable/disable control.

## 2. Enable Tongue

Turn on **Tongue**. If the model is already enabled by the deployment config, the
control reflects that default.

If the toggle is unavailable, read the reason on the row. A model that cannot run
is not registered; enabling it would only create a tool that fails at call time.

## 3. Make the call

Ask the agent:

> Detect the language of “Bonjour, comment allez-vous ?”

The agent calls:

```json
{
  "name": "lang_detect",
  "arguments": { "text": "Bonjour, comment allez-vous ?" }
}
```

A result looks like:

```json
{
  "language": "fr",
  "reliability": "confident",
  "tooCloseToCall": false,
  "candidates": [
    { "language": "fr", "probability": 0.99 },
    { "language": "en", "probability": 0.004 }
  ]
}
```

The exact probabilities depend on the input. `reliability` is the honest summary:
short or ambiguous text can be `low` confidence or `tooCloseToCall`.

## 4. Optional: try speech-to-text

Voz needs `onnxruntime-node`. On the first transcription it downloads about
**367 MB** of weights into the vendor cache. That is a real download, not part of
the plugin install.

If Voz is unavailable, the row explains whether the runtime or the model package
is missing. Install the optional runtime, restart, then try:

> Transcribe `C:\audio\standup.wav`.

The tool is `stt_transcribe`; the result includes text and timing information.

## 5. Understand an unavailable model

Call:

```text
tool_mode_list
```

An unavailable model is still listed when it is part of the catalog. The
`readiness` field names the concrete blocker, for example a missing native build,
an Apple-only framework, or a missing extension. Fix the cause or choose a model
that can run on this machine.

## Next

- [Models and availability](../concepts/models-and-availability.md)
- [Using tools in DSH](../guides/using-tools-in-dsh.md)
- [Tool reference](../reference/tools.md)
- [Connect an MCP client](../guides/connect-an-mcp-client.md)
