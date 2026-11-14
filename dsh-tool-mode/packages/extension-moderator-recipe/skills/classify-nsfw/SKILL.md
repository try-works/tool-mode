# Moderator — adult-content image screening

## When to use

Call classify_nsfw on an image before storing, publishing or forwarding it: a user upload, a
shared album, a thumbnail, or a frame extracted from user video. It scores the image on device
and returns a decision at your threshold, so nothing has to leave the machine to be screened.

## Adult-content-only scope — read this first

- The model is an adult-content classifier only. It makes no claim about minors, and no claim
  about non-adult content. Do not use it, or describe it, as a child-safety or general
  appropriateness gate.
- Scores are decision scores, not calibrated probabilities. A score of 0.8 is not 80% likely;
  do not present it as a confidence figure or use it as a legal determination.
- This is a triage aid. Keep human review on any decision the model is the only gate on.

## Input

- v1 decodes PNG only: 8-bit RGB or RGBA, non-interlaced. JPEG is refused by name, and so are
  palette, grayscale, 16-bit and interlaced PNGs. Convert other formats before calling.
- image_path is an absolute path resolved against your granted filesystem; nothing is uploaded.
- Optional settings: quality fast (1 crop) / balanced (4 crops, default) / accurate (8 crops);
  threshold 0..1 (default 0.5); policy standard (all five heads, default) or allowTopless
  (counts all but nipples).

## How to read the result

- isNSFW is score >= threshold under the chosen policy; score is the max over the counted heads,
  itself maxed over the scored crops.
- regions gives the five per-head scores (nipples, genitals, buttocks, nude, sexAct), each the
  max over the crops. Use them for policies such as allow-topless rather than re-deriving the
  rule.
- crops is the number of crops scored (1, 4 or 8) - an indicator of the quality used, not
  per-crop detail.
- The pipeline is deterministic for the same image and settings. Lower the threshold to trade
  specificity for recall; fast is for video frame sampling, accurate for a single image.

## Caveats

- Accuracy is lower on crowded scenes, extreme close-ups, low light and low resolution.
- Anime, hentai and heavily censored imagery are out of scope; the model is trained on photoreal
  content.
- A high score can be a false positive (medical, classical art, swimwear). Review before acting.
- Flat, uniformly coloured synthetic images are out-of-distribution: one mid-grey test image
  scored NSFW at 0.569 at the default threshold with balanced quality, while black and white did
  not. Treat that as a property of flat synthetic input, not as a claim about real photographs or
  as a calibration signal; use real-content evaluation if you need one.
- Do not use outputs or logs to train a competing on-device model (Desert Ant Labs licence).

## Licensing

The weights are the Desert Ant Labs Source-Available License 1.0: the attribution notice
"Powered by Desert Ant Labs" is required, redistribution is not permitted, and a commercial
licence applies above the active-device threshold. LiteRT.js is Apache-2.0.
