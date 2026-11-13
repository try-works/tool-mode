# Extension matrix

- profile base URL: `http://127.0.0.1:3182`
- generated: 2026-10-24T01:28:34.834Z
- exit: 1

| extension | status | duration | blocker / detail |
| --- | --- | --- | --- |
| tongue | SKIPPED | 6.9s | the extension's tools cannot load: @desert-ant-labs/tongue ^3.6.0 is not installed inside the extension: @desert-ant-labs/tongue@3.6.0 declares a "prepare" lifecycle script; the installer never runs or silently skips install-time scripts (EXT-10) |
| voz | SKIPPED | 101.9s | the extension's tools cannot load: @desert-ant-labs/voz ^3.6.0 is not installed inside the extension: @bjorn3/browser_wasi_shim@0.3.0 declares a "prepare" lifecycle script; the installer never runs or silently skips install-time scripts (EXT-10); onnxruntime-node ^1.20.0 is not installed inside the extension: the tarball for onnxruntime-node@1.30.0 from registry.npmjs.org could not be read (timeout or transport, not the size cap): terminated |
| embeddinggemma | SKIPPED | 132.7s | the extension's tools cannot load: @huggingface/transformers ^3.0.0 is not installed inside the extension: onnxruntime-node@1.21.0 declares a "prepare" lifecycle script; the installer never runs or silently skips install-time scripts (EXT-10); onnxruntime-node ^1.20.0 is not installed inside the extension: the tarball for onnxruntime-node@1.30.0 from registry.npmjs.org could not be read (timeout or transport, not the size cap): terminated |
| laya | FAIL | 100.0s | gateway/internal: the tarball for onnxruntime-node@1.30.0 from registry.npmjs.org could not be read (timeout or transport, not the size cap): terminated |
| minilm-embed | FAIL | 101.5s | gateway/internal: the tarball for onnxruntime-node@1.30.0 from registry.npmjs.org could not be read (timeout or transport, not the size cap): terminated |
| minilm-rerank | FAIL | 101.1s | gateway/internal: the tarball for onnxruntime-node@1.30.0 from registry.npmjs.org could not be read (timeout or transport, not the size cap): terminated |
| needle | PASS | 11.9s | prepare: prepared |
| declarative-recipes | PASS | 2.3s | installed 0.1.0 via registry (resolved 0.1.0) |
