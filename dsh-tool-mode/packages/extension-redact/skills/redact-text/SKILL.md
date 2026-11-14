# Redact — PII and secret detection

## When to use

Call `redact_text` before text that may contain personal data leaves the process: logs, analytics payloads, support-ticket quotes, model prompts, exported fixtures, or a reply that will quote user content. It is also the right check before summarising or translating text you did not author.

## When not to use

Do not use it as a security boundary for a whole document: it scans text, not files, images or audio. Do not use it to prove a document is clean beyond `coverage` — when `coverage.complete` is false, only the reported prefix was processed. Do not rely on it for a label the model was not trained on; `ORG` is disabled by default and `IMEI` comes from the deterministic layer only.

## How to read the result

- `spans` are half-open UTF-16 ranges into the exact input. Slice the original text with `text.slice(start, end)`; `span.text` is that slice.
- `label` is the entity class (`EMAIL`, `PHONE`, `CREDIT_CARD`, `GIVEN_NAME`, …). `score` is the weakest token probability in the span, so it is a floor, not an average.
- `coverage.complete: false` means the local window cap stopped the scan. The reason names how many windows and tokens were processed; do not present a truncated result as exhaustive.

## Caveats

- The detector is a triage signal, not a compliance guarantee. Names, addresses and free-form identifiers are the hardest classes; review them.
- Deterministic checks (Luhn for cards and IMEI, mod-97 for IBAN) are precise but narrow. The model layer is broader but less certain.
- Outputs must not be used to train a competing on-device model (Desert Ant Labs licence).

## Licensing

The weights are the Desert Ant Labs Source-Available License 1.0: attribution (“Powered by Desert Ant Labs”) is required, redistribution is not permitted, and a commercial licence applies above the active-device threshold. The runtime code (LiteRT.js, tokenizers) is Apache-2.0.
