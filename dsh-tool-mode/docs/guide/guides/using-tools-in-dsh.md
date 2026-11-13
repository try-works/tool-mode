---
title: Using tools in DSH
description: How the agent discovers, calls, and reads Tool Mode tools.
---

# Using tools in DSH

You do not have to name a model. Describe the task; the agent selects a tool from
the registered surface.

## What the agent sees

A typical session sees tool families such as:

- **Language and audio:** `lang_detect`, `stt_transcribe`.
- **Semantics:** `text_embed`, `text_rerank`, `semantic_similarity`,
  `semantic_rank`, `semantic_classify`, `semantic_deduplicate`.
- **Media:** `describe_image`, `media_find_moments`.
- **Structured work:** `structured_extract`, `extract_with_repair`,
  `validate_record`, `tools_plan`.
- **Decisions:** `decision_choose`, `decision_score`, `decision_test`, and related
  tools.
- **Management and discovery:** `model_tools`, `tool_mode_list`,
  `tool_mode_describe`.
- **Code Mode:** `tool_mode_run`, only when released.

Which tools are present depends on installed extensions, enabled models, and the
caller's grants. `tool_mode_list` is the authoritative list.

## Discovery

Ask the agent:

> What Tool Mode tools are available, and are any unavailable?

It calls `tool_mode_list`, which returns readiness and the reason for anything
that cannot run.

For one tool:

```json
{
  "name": "tool_mode_describe",
  "arguments": { "tools": ["semantic_rank"] }
}
```

The result includes the schema, semantics, limits, unsupported cases, and the
backing model or extension.

## Calling

Natural language is usually enough:

> Rank these release notes against the query “breaking changes”.

The agent chooses `semantic_rank` and supplies the query and candidates. If you
want to be explicit, name the tool and provide structured arguments.

Use a tool when:

- the task is bounded and has a typed result;
- the model should run locally;
- you want a stable schema rather than a chat completion;
- the result needs to be recorded, ranked, or passed to another tool.

Use the chat model for open-ended reasoning, planning, and writing that is not a
bounded tool call.

## Skills

When skill registration is on (the default), each tool carries a skill that
describes when to use it and when not to. A skill is guidance, not a separate API.
If the agent picks the wrong tool, the skill is often the place to correct it.

## Runtime choices

Enable and disable models in Settings. The next agent turn sees the change.

An enable can fail. The reason is the same availability explanation shown in
`tool_mode_list`; nothing is written when the enable is refused.

## Reading errors

A failed tool call returns a normal tool result with `isError: true` and an
explanation. Common causes:

- the model became unavailable after registration;
- the input does not satisfy the schema;
- a file path is outside the approved roots;
- a model asset download failed;
- an external MCP client lacks the tool grant.

The error text is meant to be actionable. If it says a prerequisite is missing,
fix the prerequisite rather than retrying the same call.

## Next

- [Tool reference](../reference/tools.md)
- [Connect an MCP client](connect-an-mcp-client.md)
- [Troubleshooting](../help/troubleshooting.md)
