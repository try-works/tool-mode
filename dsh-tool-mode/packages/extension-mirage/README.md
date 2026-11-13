# Cactus Mirage Tool Mode extension

Four bounded tools over the pinned **Cactus Mirage** 2-bit vision model:

| Tool | What it returns |
|---|---|
| `mirage_describe` | scene, objects, text, relations, and a short generated reasoning trace |
| `mirage_detect` | objects with `[x1,y1,x2,y2]` boxes and scores, plus optional bitmap/polygon masks |
| `mirage_ocr` | text lines with boxes and detection scores |
| `mirage_extract` | ordered enum / bounded-integer / short-string / box form values as a `fields` array, with the engine's probabilities |

Boxes use the model's 0–1000 coordinate scale. All outputs are model predictions; they
are not verified facts. A `box` field references an earlier enum field and returns that object's box. The
engine's `-` enum probability or a `null` value is preserved as an abstention and is never converted into a fabricated choice.

## Runtime

- **Model:** `Cactus-Compute/mirage`, revision `3d03cee88c0acbe4e71b94b567ab14e6e55f40c9`
- **Engine:** Cactus 4.1.0 WASM, revision `4e822c9036be2eb0e47ef556df32a818bb1572ef`
- **Execution:** in-process WebAssembly; no native addon, no Python, no network call at inference
- **Image input:** a host-authorized path, decoded to RGB by Sharp (EXIF orientation applied)

Every downloaded artifact is pinned by byte size and SHA-256 in `models.lock.json`.
The loader and WASM are executable assets, so preparing them needs the separate
executable-preparation approval.

## Prepare

Either let the host prepare the `mirage-wasm` asset group, or point the extension at
local copies of the pinned files with configuration:

```yaml
configuration:
  loaderPath: /path/to/cactus.js
  wasmPath: /path/to/cactus.wasm
  weightsPath: /path/to/mirage.cact
  threads: 4
```

The paths are hints into the same digest check; bytes that do not match the pin are
refused before execution.

## Qualification

`docs/tool-mode/qualification/mirage.json` records a real run on the supplied 880×1486
screenshot: describe returned scene/objects/text, detect returned boxes and polygon
masks, OCR read the page text, and the form chose `stop` at 0.7418 on a stop-sign photo.
