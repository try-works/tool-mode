# Extension matrix

- profile base URL: `http://127.0.0.1:3190`
- generated: 2026-10-25T07:55:38.797Z
- exit: 1

| extension | status | duration | blocker / detail |
| --- | --- | --- | --- |
| tongue | FAIL | 34.6s | gateway/internal: the tarball for @try-works/extension-desert-ant-tongue@0.1.3 from 127.0.0.1:4873 answered HTTP 500 after 8 attempts (not the size cap) |
| voz | FAIL | 34.2s | gateway/internal: the tarball for @try-works/extension-desert-ant-voz@0.1.5 from 127.0.0.1:4873 answered HTTP 500 after 8 attempts (not the size cap) |
| embeddinggemma | SKIPPED | 164.0s | the extension's tools cannot load: @huggingface/transformers ^3.0.0 is not installed inside the extension: onnxruntime-common@1.21.0 declares a "prepare" lifecycle script; the installer never runs or silently skips install-time scripts (EXT-10) |
| laya | PASS | 91.9s | prepare: prepared |
| minilm-embed | FAIL | 42.2s | gateway/internal: the npm registry http://127.0.0.1:4873 could not be reached for @huggingface/jinja within 30000 ms (metadata timeout): fetch failed |
| minilm-rerank | FAIL | 51.0s | gateway/internal: the tarball for @huggingface/transformers@4.3.1 from 127.0.0.1:4873 answered HTTP 500 after 8 attempts (not the size cap) |
| needle | FAIL | 35.9s | gateway/internal: the tarball for @try-works/extension-needle@0.1.2 from 127.0.0.1:4873 answered HTTP 500 after 8 attempts (not the size cap) |
| declarative-recipes | PASS | 18.5s | installed 0.1.0 via registry (resolved 0.1.0) |
