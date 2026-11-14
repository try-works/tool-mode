# @try-works/extension-redact

A Tool Mode module extension that runs the Desert Ant Labs Redact LiteRT artifact directly (no vendor SDK) and exposes it as the `redact_text` tool: labelled spans over UTF-16 offsets, plus honest coverage when the local window cap truncates a long document.

- Provider: `@try-works/tool-mode-runtime-dsh` (`createRuntimeProvider`) over `@try-works/tool-mode-runtime-litert`.
- Processors: `@try-works/tool-mode-runtime-processors` (offsets, windows, BIOES, deterministic PII).
- Tokenizer: the `tokenizers` Node binding against the pinned `tokenizer.json` (Unigram).
- Assets are not committed: run `node scripts/fetch-redact-assets.mjs` to prepare `.assets/redact`, then `TOOL_MODE_REAL_ASSETS=1 npx tsx --test packages/extension-redact/tests/*.test.ts` for the real inference gate.

Licensing: the model weights are source-available, not open source; see `tool-mode.extension.json` for all five licence layers.
