# Ear — spoken language identification

## When to use

Call identify_language when you need to know what language a recording is in, on device: before
routing a voice memo to transcription, before choosing a translation target, or to tag a library
of user audio. Nothing is uploaded; the audio never leaves the machine.

## Audio input

- v1 decodes WAV only: RIFF/WAVE, PCM 16-bit or IEEE float32, mono or stereo (stereo is averaged
  channel-wise), at any declared sample rate (resampled to 16 kHz). 24-bit, other codecs and
  non-RIFF containers are refused by name rather than guessed - convert before calling.
- audio_path is an absolute path resolved against your granted filesystem.
- windows is optional: how many 30 second windows to listen to, 1..16, default 3 (the model's
  recommended count). Windows are spread across the recording - candidate positions every third
  of a window, ranked by syllabic modulation - so a long recording is sampled, not truncated.
- Audio of 30 seconds or less is accepted and zero padded to a single window. The upstream model
  notes this costs accuracy: about 87.6% for a 10 second clip versus 92.3% for 30 seconds.
- There is no duration cap, but decoding and resampling cost grow linearly with the file; the
  mel front end and the model run only for the selected windows.
- Expect a long call: on the benchmarked Windows/WASM host each 30 second window takes about 33
  seconds of CPU time, so the default three-window call takes about 99 seconds. The tool timeout is
  300 seconds - plan for the call instead of assuming it returns immediately.

## How to read the result

- language is the most likely canonical code; confidence is its folded probability and equals
  candidates[0].probability.
- candidates holds up to five {language, probability} objects, folded and sorted descending (ties
  by code ascending), winner first.
- windows is the integer count of 30 second windows actually listened to: 1 for a short clip,
  otherwise the requested count bounded by what the recording offers. It is not a list of
  timestamps and there are no per-window scores.
- isReliable is false when the top language is Norwegian, Swedish or Danish (the model confuses
  those three), and otherwise true only when the top-two margin is at least 0.25 after folding.
  Branch on isReliable before acting on language; on false, ask the user or collect more audio.

## Languages

- The model emits 103 labels in the order of languages.json; the list is the artifact, not a
  count in the documentation.
- After the yue -> zh fold there are 102 distinct canonical languages. yue and zh are separate
  model labels that both report as zh, and their probabilities are summed before ranking. This is
  the arithmetic behind the README's "102 languages" figure; the package records both numbers
  rather than copying either one.
- The Swift alias map is applied where a code exists: tl -> fil and nb -> no are kept but are
  no-ops for this label set, because languages.json contains fil and no and does not contain tl or
  nb.

## Caveats

- Probabilities are decision scores, not calibrated probabilities. Do not present confidence as a
  measure of certainty about a person, and keep a human review where the decision matters.
- The accuracies quoted above are upstream measurements on the vendor's corpora, not re-measured
  here. Expect lower accuracy on noisy audio, music, overlapping speakers, very short clips, and
  closely related languages; treat Danish, Norwegian and Swedish answers as unreliable by design.
- Language identification describes audio content; it is not a check on who is speaking, and it
  must not be used to infer nationality or ethnicity.
- The pipeline is deterministic for the same audio and the same windows setting.
