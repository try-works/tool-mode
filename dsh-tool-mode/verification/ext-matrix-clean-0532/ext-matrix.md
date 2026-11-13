# Extension matrix

- profile base URL: `http://127.0.0.1:3183`
- generated: 2026-10-25T03:38:38.881Z
- exit: 1

| extension | status | duration | blocker / detail |
| --- | --- | --- | --- |
| tongue | PASS | 13.6s | prepare: prepared |
| voz | SKIPPED | 125.8s | the extension's tools cannot load: @desert-ant-labs/voz ^3.6.0 is not installed inside the extension: the dependency @types/dom-mediacapture-transform@0.1.12 ships an unparseable package.json: ENOENT: no such file or directory, open 'D:\DEV\dsh-temp\dsh-optional-runtime-wbnxNW\node_modules\.dep-50404-mvn9jqg0\package.json'; onnxruntime-node ^1.20.0 is not installed inside the extension: the tarball for onnxruntime-node@1.30.0 from registry.npmjs.org could not be read (timeout or transport, not the size cap): terminated |
| embeddinggemma | SKIPPED | 355.8s | the extension's tools cannot load: @huggingface/transformers ^3.0.0 is not installed inside the extension: the tarball for onnxruntime-node@1.21.0 from registry.npmjs.org could not be read (timeout or transport, not the size cap): terminated; onnxruntime-node ^1.20.0 is not installed inside the extension: the tarball for onnxruntime-node@1.30.0 from registry.npmjs.org could not be read (timeout or transport, not the size cap): terminated |
| laya | FAIL | 166.4s | gateway/internal: the tarball for onnxruntime-node@1.30.0 from registry.npmjs.org could not be read (timeout or transport, not the size cap): terminated |
| minilm-embed | FAIL | 119.6s | gateway/internal: the tarball for onnxruntime-node@1.30.0 from registry.npmjs.org could not be read (timeout or transport, not the size cap): terminated |
| minilm-rerank | FAIL | 119.8s | gateway/internal: the tarball for onnxruntime-node@1.30.0 from registry.npmjs.org could not be read (timeout or transport, not the size cap): terminated |
| needle | PASS | 27.8s | prepare: prepared |
| declarative-recipes | PASS | 5.6s | installed 0.1.0 via registry (resolved 0.1.0) |
