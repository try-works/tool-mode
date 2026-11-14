# Clear — speech enhancement

## When to use

Call enhance_speech on a spoken recording before publishing, captioning or transcribing it:
a podcast or interview recorded in a noisy room, a voice memo with room echo, or a remote
guest whose microphone is quiet. It denoises, dereverbs and loudness-normalises to a
podcast-ready 48 kHz mono WAV, on the device, and returns the audio bytes.

## When not to use

- Only WAV/RIFF input is accepted: PCM 16-bit or IEEE float32, mono or stereo. Convert other
  containers to WAV first; the processor refuses the rest by name.
- It enhances speech, not music: instruments and effects are treated as noise.
- It is not a source separator: overlapping speakers stay overlapping.
- It does not write a file. There is no output_path; the result carries base64 audio.

## How to read the result

- audio_base64 is a complete WAV file, 16-bit PCM mono at 48 kHz, standard base64 with no
  data: prefix. Decode it once and hand the bytes to whatever plays or stores audio.
- durationSeconds is the duration of the RETURNED audio. coverage.totalSeconds is the input
  duration; when they differ, coverage.complete is false and coverage.reason names the
  budget. Report truncation honestly instead of implying the whole recording was enhanced.
- The cap is derived, not fixed. At invoke time the provider reads the caller's
  maxResultBytes and processes only
  maxSamples = floor((floor((maxResultBytes - 1024) * 3 / 4) - 44) / 2)
  samples of 48 kHz audio (1024 B JSON allowance, 44 B WAV header, 2 B per sample, base64
  4/3). Everything past that is not processed. With the host default 8 MiB budget this is
  3,145,322 samples = 65.5275 s; with a 4 MiB budget it is about 31 s. A deployment that
  raises the budget gets more; the output schema deliberately declares no maxLength.

## Caveats

- The output is mono, 48 kHz, 16-bit PCM: stereo input is averaged down, so stereo placement
  is not preserved.
- Loudness is mastered to about -19 LUFS with a -1.5 dBTP limiter. If your pipeline applies
  its own normalisation, expect a second gain stage.
- The model improves intelligibility but cannot invent speech buried under music or clipping;
  review anything heavily degraded.

## Licensing

The weights are the Desert Ant Labs Source-Available License 1.0: the attribution notice
"Powered by Desert Ant Labs" is required, redistribution is not permitted, and a commercial
licence applies above the active-device threshold. ONNX Runtime is MIT.
