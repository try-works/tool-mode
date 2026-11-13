# RC2 — the embeddinggemma prepare failure and the asset-cache fix

Task-131 findings (2026-10-19, profile `web`, plugin 0.4.7).

## The verbatim failure

The earlier harness run surfaced the transport half of the failure:

```
fetch failed
```

— the bare Node/undici `TypeError` a range fetch reports when the transfer dies
mid-stream. No ENOSPC text reached the caller: the acquisition path
(`src/asset-acquisition.ts` `acquireAsset`, the catch at the chunk loop)
reports whatever the source throws, and the HTTP source collapses its
failures into that one generic message.

## The disk-space math (the second, silent half)

The web profile's asset-cache root was the state-adjacent default:

```
C:\Users\erikb\.dsh\profiles\web\extensions\profiles\default\asset-cache
```

— on C:, which had **~0.38 GB (≈ 408 MB) free** at the time. The
embeddinggemma `models.lock.json` pins, in the `embeddinggemma-2` set:

| asset | bytes |
|---|---|
| model.onnx_data | 1,084,170,240 |
| vision_encoder.onnx_data | 671,026,176 |
| audio_encoder.onnx_data | 1,172,750,848 |
| tokenizer | 32,170,510 |
| **total** | **≈ 2,960,117,774 (2.96 GB)** |

The FIRST asset alone (1.08 GB) exceeds the whole free space, so no transfer
could ever complete: the streaming write runs out of room mid-transfer
(ENOSPC), which the transport then reports as `fetch failed`. The store's
`profiles/default` state shows the outcome honestly in its own vocabulary:
`readiness: { "embeddinggemma-2": "needs-preparation" }` — the prepare never
flipped it. No partial blob survived (the acquisition keeps partials as
`.partial-<digest>` siblings; the transport failure left none large enough to
matter, and C: was too full to hold one).

## The fix

1. **Preflight before any transfer** (`src/prepared-assets.ts`, the registry's
   `prepare`): the bytes actually MISSING from the content-addressed cache
   (a digest hit transfers nothing) are summed and compared against the free
   space at the cache root via an injectable probe (default:
   `statfs` at the nearest existing ancestor). Insufficient space refuses
   with a named, actionable reason — never a bare fetch failure:

   ```
   [extension-asset-space-insufficient] the asset cache root <path> needs
   <missing bytes> bytes for <n> missing asset(s) but only <free> bytes are
   free. Configure assetCacheRoot on a volume with at least that much free
   space, or free space, and retry.
   ```

2. **Configurable cache root**: `assetCacheRoot` (default stays the
   state-adjacent `asset-cache` directory). The web profile's `model-tools`
   block in `cordis.patch.yml` now sets `assetCacheRoot: "E:/dsh-asset-cache"`
   (E: has ~430 GB free); the directory is created on boot by the registry.

3. **Cache hits short-circuit**: the preflight counts only missing blobs, so a
   pre-seeded digest cache prepares with zero free space and zero transfers.

## Tests

`packages/dsh-tool-mode/tests/asset-cache-preflight.test.ts`:

- insufficient space refuses with the named code, the exact required/available
  bytes and the cache path, with **zero** source reads;
- a digest cache hit succeeds with zero free space and zero source reads;
- the `assetCacheRoot` config override surfaces end to end through the
  management `prepare` call (the refusal quotes the configured root).

## Residual risks

- A transfer interrupted by a genuinely unstable network still reports the
  transport's message (retryable), and the partial blob is kept for a ranged
  resume — the preflight only removes the *predictable* disk-space failure.
- The preflight counts only blobs absent from the cache; a corrupted cached
  blob re-downloads inside the loop and is not part of the estimate (rare,
  and the digest verification still refuses tampered bytes).
