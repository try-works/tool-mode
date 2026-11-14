# Emo — emoji suggestions

## When to use

Call suggest_emojis when you want emoji candidates for a piece of text on device: a message,
caption, comment, note or chat line. Nothing leaves the machine; the text is not uploaded.

## Input

- text: 1..1024 Unicode code points, counted as [...text].length. Emoji and other astral
  characters count as one code point each, but a multi-code-point emoji (a family, a skin-tone
  sequence) counts as several - keep that in mind near the limit.
- Empty or whitespace-only text is refused as invalid input; it is not answered with an empty
  list. Check for blank text before calling.
- limit: how many suggestions to return, 1..20, default 5. The tool returns the top `limit`
  labels by descending probability, with exact ties broken by ascending label index.

## How to read the result

- suggestions: the ranked labels, each {emoji, confidence}. confidence is the label's raw
  softmax probability from the model.
- labels: always 812 - the size of the model's emoji label space. It is not the number of
  suggestions returned and it is not a confidence figure.
- The emoji strings come from the model's own emo_meta.json label list, so they are the
  vendor's labels rather than a local mapping. v1 applies no skin-tone variant.

## Suggestions are not promises

- A suggestion is a ranked hint, not a prediction that the user meant that emoji, and not a
  statement about their feelings. Present two or three candidates rather than asserting one.
- Confidences are uncalibrated: 0.4 is not a 40% chance of being right. Do not sort, threshold
  or report them as probabilities of correctness; use the order and your own judgement.
- The model card describes coverage of 23 languages. That is a card-sourced claim, not a
  measurement in this package, and the tool does not return a language.

## Caveats

- Short text is ambiguous: a single word, a name or an idiom can map to many emojis, and the top
  label is only a weak hint.
- Irony, slang, code-switching and text in scripts the tokenizer handles less well will produce
  weaker suggestions. The tokenizer is the vendor's EMTK segmenter with per-script n-gram
  features; its Swift-to-JS equivalence is not independently proven, so treat borderline cases
  as approximate.
- The pipeline is deterministic for the same text and limit.
