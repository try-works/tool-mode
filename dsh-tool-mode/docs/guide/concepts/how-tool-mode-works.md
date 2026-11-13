---
title: How Tool Mode works
description: Models, tools, contracts, extensions, and the routes that connect them.
---

# How Tool Mode works

Tool Mode turns models into **tools**. A model is an implementation detail; the
agent sees a stable tool name, a schema, and an honest description of what the
tool can and cannot do.

## Four words

| Word | Meaning |
|---|---|
| **Model** | The thing that performs inference: Tongue, Voz, EmbeddingGemma, Laya, and so on. |
| **Tool** | The callable surface the agent uses: `lang_detect`, `stt_transcribe`, `semantic_rank`. |
| **Contract** | The tool's stable identity: name, input schema, output schema, semantics, limits, unsupported cases. |
| **Extension** | An independently versioned package that declares tools and supplies the model implementation. |

A tool can have more than one implementation. A contract says *what* is callable;
an implementation decides *which* model or route serves it in this deployment.

## The flow

```text
catalog / extension manifests
            │
            ▼
   availability check  ──► unavailable + reason
            │
            ▼
   registered tool + skill
            │
            ▼
      agent tool call
            │
            ▼
   implementation / route
            │
            ▼
        result or named error
```

The availability check runs before registration. That is why an unavailable
model is reported instead of producing a tool that would fail on every call.

## Routes

A model does not have to run inside the agent process. Tool Mode supports four
routes:

1. **In-process npm package.** The default for supported platforms and runtimes.
2. **Desert Ant CLI.** Available on macOS and Linux; covers every shipping model.
3. **User-hosted bridge.** An HTTP bridge on a machine that can run a model. The
   plugin does not host the model as a service.
4. **Extension.** A Tool Mode package that declares its own tools, schemas, and
   model assets.

The route is selected from what is installed and configured. The tool schema is
unchanged.

## Skills

Each registered tool can publish a **skill**. The skill teaches the agent when to
reach for the tool, when not to, and how to read its result. Skills are not a
second API; they are guidance attached to the same tool.

You can disable skill registration with `registerSkills: false`, but most agents
select tools better with the skill present.

## What is intentionally absent

- **No model-specific code in the host.** A model is added by installing an
  extension or configuring a route, not by editing the host.
- **No hidden fallback.** A tool that cannot run is not silently replaced by a
  different model.
- **No automatic remote upload.** A local tool runs locally unless you configure a
  remote route or a custom HTTP tool.

## Next

- [Models and availability](models-and-availability.md)
- [Configuration reference](../reference/configuration.md)
- [Install extensions](../guides/install-extensions.md)
