# Extension matrix

- profile base URL: `http://127.0.0.1:3198`
- generated: 2026-10-25T10:44:50.035Z
- exit: 1

| extension | status | duration | blocker / detail |
| --- | --- | --- | --- |
| tongue | PASS | 6.3s | prepare: prepared |
| voz | SKIPPED | 31.6s | the extension's tools cannot load: onnxruntime-node ^1.20.0 is not installed inside the extension: the npm registry http://127.0.0.1:4873 could not be reached for adm-zip within 120000 ms (metadata timeout): fetch failed |
| embeddinggemma | PASS | 200.1s | prepare: prepared |
| laya | FAIL | 8.9s | gateway/internal: the npm registry http://127.0.0.1:4873 could not be reached for adm-zip within 120000 ms (metadata timeout): fetch failed |
| minilm-embed | FAIL | 15.4s | gateway/internal: the npm registry http://127.0.0.1:4873 could not be reached for @huggingface/jinja within 120000 ms (metadata timeout): fetch failed |
| minilm-rerank | PASS | 109.2s | prepare: prepared |
| needle | PASS | 54.7s | prepare: prepared |
| declarative-recipes | PASS | 28.4s | installed 0.1.0 via registry (resolved 0.1.0) |
