# Deferred loading for heavy tool schemas (P3)

Status: implemented behind `config.deferHeavySchemas` (default **false**). P3 (task-36) added the
selection and the registrar/bindings paths; P3b (task-45) closed the verifier's gaps: the
declarative and model-runtime recipe lanes now apply the same selection, this page carries the
operator-facing semantics, and the tests assert the model-facing schema surface.

Requirement links: agent-tool-selection plan P3; EXT-33 (registration provenance unchanged),
DECL-07 (discovery unchanged), ARCH-05 (no MCP contract-surface change).

## What the flag does

```json
{ "deferHeavySchemas": true }
```

The flag is read at plugin REGISTRATION time (it takes effect on the next plugin load, not on a
live Settings save). When true, a selected tool's `defineTool` definition carries
`deferLoading: true`, which DSH projects into the model-facing schema. The decision is a pure
helper in `packages/dsh-tool-mode/src/registrar.ts`:

- explicit ids (always selected): `multimodal_embed`, `media_find_moments`,
  `extract_with_repair`, `structured_extract`, `tools_plan`, and the `semantic_*` prefix;
- otherwise selected when the serialized model-facing declaration (name + description +
  parameters) is **strictly greater than 1024 UTF-8 bytes**;
- disabled selects nothing, regardless of id or size.

Every registration path passes the decision through: per-model catalogue tools
(`registerModelTool`), contract tools (`registerContractTool`), extension contract
implementations (`registerContractImplementationTool`), module/extension-manifest tools, and
the **declarative** and **model-runtime** recipe lanes in `src/index.ts`. `tool_mode_list`,
the catalog and the MCP surface are unchanged: the MCP export never receives the marker.

## Selected at this revision (measured, 2026-11-15)

Measured over the 33 registerable catalogue + standard-contract declarations. Two
consistent-but-not-identical measurements exist: the selection helper measures each
declaration (**10,172 B of 26,563 B, 38.3%**; per-tool bytes in the table), while the
registration serialization measured at `defineTool` gives **10,024 B of 26,525 B
(37.8%)**, 16,501 B eager. The selected set is identical and per-tool deltas stay within
~6%. Byte counts move with descriptions, so the set is recomputed on every load rather
than pinned.

| Tool | Bytes | Why |
| --- | ---: | --- |
| `stt_transcribe` | 1,379 | threshold |
| `classify_nsfw` | 1,139 | threshold |
| `text_rerank` | 1,094 | threshold |
| `multimodal_embed` | 944 | explicit |
| `semantic_classify` | 910 | explicit (`semantic_*`) |
| `structured_extract` | 836 | explicit |
| `semantic_rank` | 819 | explicit (`semantic_*`) |
| `semantic_deduplicate` | 800 | explicit (`semantic_*`) |
| `media_find_moments` | 792 | explicit |
| `semantic_similarity` | 788 | explicit (`semantic_*`) |
| `tools_plan` | 671 | explicit |

`extract_with_repair` is an explicit id but a Needle MANIFEST tool rather than a standard
contract, so it is absent from that 33-declaration set; it is selected by name when that package
registers the tool (the extension-manifest path now applies the helper too).

## The honest limit: a provider hint, not a local byte reduction

`deferLoading: true` requests deferred definition loading from the PROVIDER. DSH's DeepSeek
adapter still serializes the full declaration and appends the flag:

```ts
tools: options.tools.map(tool => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.parameters,
  ...tool.deferLoading === true ? { defer_loading: true as const } : {},
}))
```

So this plugin removes **no bytes from its own request body**. Whether the provider keeps the
definition out of the model's context until activation is the provider's contract. The test's
"measured delta" is the deferrable declaration payload (what a provider MAY omit), not an
observed context reduction; the plan's acceptance is amended accordingly.

## The activation caveat (why the default is off)

Activation on DeepSeek requires a `developer/message` block of type `tool-addition`, which the
harness emits when the tool LIST changes between requests (agent-loop compares the current
tools against the previous header). A **stable first-party tool list emits no addition**, so
selected first-party tools can remain declared-but-unactivated for a whole session. Tools added
later (for example, an extension activated mid-session) do produce an addition and can then
activate. This is not a bug in the flag; it is the current DSH activation path.

**Therefore keep `deferHeavySchemas` false until the activation path (or a provider-side
deferred tool-search mechanism) is wired.** Enabling it changes availability semantics, not just
context size.

## Evidence

- `packages/dsh-tool-mode/tests/defer-loading.test.ts` — 14 tests: explicit ids, `semantic_*`
  prefix, strict threshold, disabled switch, real selected/eager sets, the three
  registrar/bindings registration routes, schema/description invariance, the synthetic
  declaration-payload delta, and the config default of false.
- `packages/dsh-tool-mode/tests/defer-loading-paths.test.ts` — 4 fixture tests that install a
  copied declarative package and the model-runtime fixture, activate them through the real
  extension service, and assert `ctx.tools.schemas()` carries `deferLoading: true` on the
  selected recipe/lane tool when the switch is on and omits it when off.
- Serializer evidence: `@deepseek-ai/dsh-llm-deepseek` is **not resolvable from this repo**
  (it is a harness workspace package, not a dependency). The serializer assertion therefore
  remains DSH-owned; DSH's own suite covers it
  (`packages/llm/llm-deepseek/tests/serialize.spec.ts`, "declares deferred tools with
  defer_loading and leaves others unmarked"). This plugin asserts the flag survives to the
  model-facing `schemas()` surface and documents the DSH evidence as external.
