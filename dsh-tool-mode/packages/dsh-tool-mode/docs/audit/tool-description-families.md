# Tool description families — embedding/ranking and decisions (P6)

These are STANDARD-CONTRACT tools, so their names, schemas and limits come from
`@try-works/tool-mode-contracts`. The contracts package carries no when-to-use
metadata, so the distinguishing guidance is a reviewed HOST-SIDE table
(`CONTRACT_DISAMBIGUATION` in `src/tool-description.ts`) composed into every
description by `contractToolDescription`. This page is the human-readable copy of
that table. Extension-manifest/recipe tools use the same mechanism through a second
reviewed table (`EXTENSION_TOOL_DISAMBIGUATION`), applied by `extensionToolDescription`
when its caller passes the tool name; `dedupe_and_rank` is its first entry. The family
test checks that every tool here is described and names a
sibling, and that the static golden list reflects it.

Keys are the CALLER-FACING tool names. The plan draft said `suggest_title` and
`extract_fields`; the registered names are `text_title` (contract `text.title`) and
there is no `extract_fields` contract yet (Schemer is closed beta), so the second
is not listed: a dead entry would never reach a description.

| Tool | Choose it when | Prefer a sibling instead |
| --- | --- | --- |
| `text_embed` | You need reusable 384-dimensional text vectors for an index, search or clustering. | `text_rerank` for cross-encoder logits; `multimodal_embed` for media; `semantic_rank` to order candidates. |
| `text_rerank` | A known list must be reordered by cross-encoder relevance logits. | `text_embed` when vectors are reused; `semantic_rank` when cosine ranking is enough. |
| `text_title` | You need a bounded title and one-sentence description for a text document. | `describe_image` for images; `tools_plan` for tool calls. |
| `describe_image` | You need a description of visible content in one approved image. | `text_title` for text; `semantic_classify` to place the description in a label set; there is no OCR contract. |
| `multimodal_embed` | An image or audio input, or mixed text and media, must share one vector space. | `text_embed` for text only; `media_find_moments` for windows; `semantic_similarity` to compare two items. |
| `semantic_similarity` | You compare exactly two texts with a 0-1 embedding cosine. | `semantic_rank` for many candidates; `text_embed` to persist vectors; `semantic_classify` to pick a label. |
| `semantic_rank` | You order many candidates by embedding cosine to one query. | `text_rerank` for cross-encoder relevance; `semantic_similarity` for one pair; `semantic_classify` to assign labels. |
| `semantic_classify` | You assign one of a bounded label set, with abstention allowed. | `semantic_rank` when candidates are free text; `decision_choose` for a stated decision. |
| `semantic_deduplicate` | You group near-duplicate texts into greedy clusters. | `semantic_rank` to order rather than group; `media_find_moments` for media windows. |
| `dedupe_and_rank` | You need near-duplicate clusters AND how those clusters rank against a query, in one call. | `semantic_deduplicate` for clusters only; `semantic_rank` for individual ranking; `text_embed` for raw vectors. |
| `media_find_moments` | You need the timestamped windows of approved media most relevant to a query. | `multimodal_embed` to embed a whole item; `text_embed` for text; `text_rerank` for documents. |
| `decision_choose` | You pick one option from a bounded set for a stated decision. | `decision_test` for yes/no; `decision_score` to rate options; `tools_plan` to propose calls. |
| `decision_test` | You test one binary predicate against supplied text. | `decision_choose` to select among options; `decision_score` to grade them. |
| `decision_score` | You score options on the declared 0-10 scale for one criterion. | `decision_choose` for a single option; `decision_test` for a boolean verdict. |
| `tools_plan` | You propose a read-only tool plan against the host-frozen snapshot. | `decision_choose` to choose one option; `text_title` for a title. |
