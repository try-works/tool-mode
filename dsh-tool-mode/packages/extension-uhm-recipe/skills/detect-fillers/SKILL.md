# Uhm — filler-word detection

## When to use

Call detect_fillers on spoken audio before editing or captioning it: to cut the ums and uhs out
of a podcast, to mark hesitations for a transcript cleanup, or to measure how much of a take is
filler. It runs on the device and returns the exact millisecond spans, so a caller can cut them
without re-listening.

## When not to use

- It is not a transcriber. It names filler sounds, not words; use a speech-recognition tool for
  text.
- It is trained on English and transfers acoustically to Spanish, French, German and Dutch. Do
  not present it as per-language validated.
- Heavy background music, laughter, or several people talking over each other degrade it.
- Only WAV input is decoded (PCM 16-bit or float32, mono or stereo). Convert other containers to
  WAV first.

## How to read the result

- fillers: spans in milliseconds, start-inclusive and end-exclusive. type is one of uh, um, hmm,
  and or other; confidence is the mean frame probability over the span.
- "and" is detected as a filler class, but it is also a real English word. Treat an "and" span as
  a suggestion to review, not a cut.
- coverage.complete: false means only processedSeconds of totalSeconds were analysed. Never
  present a truncated scan as "no fillers in this recording".

## Caveats

- Filler detection is acoustic, not lexical: a filler that is whispered or covered by noise may
  be missed, and a word that sounds like a hesitation can be flagged.
- Do not cut automatically from this output alone. Review the spans, especially "and" and long
  spans.
- Do not use outputs or logs to train a competing on-device model (Desert Ant Labs licence).

## Licensing

The weights are the Desert Ant Labs Source-Available License 1.0: the attribution notice
"Powered by Desert Ant Labs" is required, redistribution is not permitted, and a commercial
licence applies above the active-device threshold. ONNX Runtime is MIT.
