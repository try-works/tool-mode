# Extension matrix

- profile base URL: `http://127.0.0.1:3185`
- generated: 2026-10-25T06:21:16.179Z
- exit: 1

| extension | status | duration | blocker / detail |
| --- | --- | --- | --- |
| voz | PASS | 272.9s | prepare: prepared |
| embeddinggemma | FAIL | 307.3s | fetch failed |
| laya | PASS | 268.6s | prepare: prepared |
| minilm-embed | FAIL | 229.8s | gateway/internal: [DEPENDENCY_UNSATISFIED] onnxruntime-web@1.31.0-dev.20260914-8d85527a0 declares a "prepare" lifecycle script; the installer never runs or silently skips install-time scripts (EXT-10) |
| minilm-rerank | FAIL | 223.8s | gateway/internal: [DEPENDENCY_UNSATISFIED] onnxruntime-web@1.31.0-dev.20260914-8d85527a0 declares a "prepare" lifecycle script; the installer never runs or silently skips install-time scripts (EXT-10) |
