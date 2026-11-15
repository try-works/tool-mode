# Inventory audit: models, extensions, tools

Status: audit + recommendation. No behavior changed by this document.
Sources read: `packages/dsh-tool-mode/catalog/desert-ant-models.json`,
`packages/extension-*/tool-mode.extension.json`, `client/index.template.js`,
`client/tool-insights.js`, `src/index.ts` (model_tools, tool_mode_list,
readToolSources, toolInventory), `src/tool-sources.ts`, `src/tool-inventory.ts`,
`scripts/gen-client-catalog.mjs`.

## 1. What exists today (counts are live repo facts)

| Entity | Count | Where it is defined | User-facing surface |
| --- | --- | --- | --- |
| Catalog model | 18 | `catalog/desert-ant-models.json` | Settings "Model as Tool" model rows, `model_tools list/describe`, `tool_mode_list` catalog rows |
| Provider-bound catalog model | 9 | `provider: { extension, modelId }` | as above, plus its provider extension row |
| Vendor/npm/CLI/bridge catalog model | 9 | align, clips, eye, face, gist, schemer, title, toxic, who | catalog row only (its tool is not registered here) |
| Shipped extension package | 16 | `packages/extension-*/tool-mode.extension.json` | Settings extension card, `model_tools` extension actions, Tool Insights owner, `tool_mode_list` extension rows |
| Extension that wraps a catalog model | 9 | clear, ear, emo, moderator, redact, shapes, tongue, uhm, voz | catalog row AND extension row (same model, two controls) |
| Extension with a model but no catalog row | 6 | embeddinggemma-2, laya, minilm-l6, minilm-rerank, needle3, mirage | extension row only; never shown as a model |
| Extension with no model | 1 | `extension-declarative-recipes` (contracts text.title / image.describe) | extension row only |
| Registered tool | 44 in the live host (varies by installs) | DSH registry: host control + contract bindings + extension tools + other plugins | chat tool cards, Tool Insights inventory, `tool_mode_list/describe`, MCP export |
| Host-owned tool names | 16 fixed + every bound contract tool | `TOOL_MODE_TOOL_NAMES` + runtime `registeredContracts` | Tool Insights "Tool Mode" group after 0.5.60 |

## 2. The overlap that confuses the user

- A runtime model such as Clear is a **catalog row** (summary, model toggle) and an
  **extension row** (Install / Prepare / Enable). The model toggle does nothing
  until the extension is installed and prepared, but that dependency is only
  visible as two separate lists.
- Six models are invisible as models: EmbeddingGemma 2, Laya, MiniLM-L6,
  MiniLM-Rerank, Needle 3, Mirage. A user looking for "the embedding model" finds
  an extension named `embeddinggemma`, not a model row.
- The same underlying capability can appear under different tool names: catalog
  `tool.name` vs the extension's manifest/recipe tool name (we aligned these for
  runtime models in 0.5.50, but the vendor route still advertises vendor names
  such as `align_transcript`, `recognize_shape` on other hosts).
- `tool_mode_list` mixes three universes (catalog rows, host tools, extension
  tools) and marks catalog rows "unavailable" when the model package is absent;
  `model_tools list` is model-centric and says nothing about the tool names a
  caller can actually invoke.
- Tool Insights grouped rows by origin, so **our own control/contract tools** were
  rendered under "Other plugins" until 0.5.60 fixed the attribution. The grouping
  itself duplicates the OWNER and KIND columns already present on every row.

## 3. The concepts are real; the USER-FACING LISTS need not mirror them

Internally the three entities answer different questions and should stay:

- **Model** — a capability + weights (catalog entry or extension-declared model).
- **Extension** — the installable, versioned **provider package** that carries one
  or more models, recipes, tools and contracts.
- **Tool** — the callable DSH surface a model or host exposes under a contract.

The audit conclusion: the split is an **implementation** boundary, not a user
concept. From the operator/model-caller point of view there is one object — the
model — with a lifecycle, and one tool surface. The extension is the "where it
comes from" detail of a model row.

## 4. Proposed unification

### 4.1 One Models list

One list unioning:

1. the 18 catalog models, and
2. every installed/shipped extension-declared model that has no catalog row
   (embeddinggemma-2, laya, minilm-l6, minilm-rerank, needle3, mirage).

Each row:

| Field | Meaning |
| --- | --- |
| name / summary | user-facing model |
| provider | extension package + installed version, or npm/CLI/bridge route |
| tools | the callable tool name(s) and contract id |
| state | `not installed` → `installed` → `needs preparation` → `active` |
| actions | Install (when the provider package is absent), Prepare (when assets are unmet), Enable/Disable |

Extension packages with **no model** (`declarative-recipes`) keep a small
"Tool providers" subsection, or are represented only through their tools. No
model is ever listed twice.

### 4.2 One Tools table

One table; **origin becomes a filter and a column, not a section**. Columns:
tool, owner, kind, model/provider, state, calls, success, last used, MCP.
The existing filters (origin, state, search) stay. Remove the
"Tool Mode · N / Other plugins · N" split.

### 4.3 One discovery surface

`tool_mode_list` stays the permitted-tool surface (DECL-07) but should list only
what a caller can actually invoke, with readiness as a field — not catalog rows
for models that are not registered. Model-centric discovery stays in
`model_tools`; both should report the same `modelId ↔ toolName ↔ readiness`
triple so they never disagree.

## 5. Phased plan

| Phase | Change | Risk |
| --- | --- | --- |
| P1 | Flatten Tool Insights into one table (origin filter/column). | Low — client render + 2 tests |
| P2 | One Models list in Settings: union catalog + extension models, inline Install/Prepare/Enable, "Tool providers" fallback section. | Medium — merges two interaction flows; keep existing action handlers |
| P3 | Server `modelTools.inventory` (read-only) exposing the unified rows so the page, MCP and other clients share one view. | Medium — new wire method (Remote descriptor) or reuse `toolInventory` |
| P4 | Align `tool_mode_list` readiness with actually-registered tools; document the model/extension/tool vocabulary in the user docs. | Low |

## 6. Edge cases the unification must keep

- A model may have several tools (Laya: 6; Needle: 4; EmbeddingGemma: 7).
  The model row shows them; the tools table still lists each tool separately.
- Asset preparation and executable approval remain explicit per model; installing
  still never activates implicitly except through the page's install follow-through.
- A catalog model whose vendor package is absent stays visible and explains why.
- Extensions with no model are not forced into the models list.
- MCP exposure remains a per-tool fact (the table's MCP column), never implied by
  activation.

## 7. Success criteria

- One place to install/prepare/enable every model.
- No model appears twice; no extension that wraps a model needs a second visit.
- One tools table; origin is metadata, not structure.
- `model_tools` and `tool_mode_list` agree on model ↔ tool ↔ readiness.

## 8. Shipped update (2026-11-15)

The recommendation is implemented: one user-facing Models list (24 rows, lifecycle inline,
Tool providers for model-less extensions), one Tools table with origin/kind as columns, and
one model ↔ tool ↔ readiness triple shared by `model_tools`, `tool_mode_list` and the MCP
surface. Discovery (0.5.65) now separates registered `tools` from `unavailable` entries, so
a listed name can never be refused as unattainable.

**Usage review cadence (P7).** Tool Insights already shows a never-called tool as such
(`tool-inventory` and `tool-insights-render` tests pin "never called"), and the table carries
owner, kind, state and calls. Use it on a regular cadence:

1. Sort by calls over the last 30 days; zero-call tools are description/latency candidates.
2. Compare a zero-call tool's composed description length and its family siblings before
   rewriting prose; if the tool is genuinely unused, remove the binding rather than keeping
   a confusing option.
3. Re-run the golden description diff after any prose change so the review is visible.
