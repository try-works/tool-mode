# Shapes — stroke recognition

## When to use

Call shape_recognize when a single hand-drawn stroke should become a geometric shape: a
PencilKit-style smart-shape snap, a diagram editor turning ink into a rectangle, or a
whiteboard tool offering the shape the user probably meant. The model is a 13-class stroke
classifier, so it is the first step before fitting or drawing the clean geometry.

## When not to use

- Multi-stroke shapes are not supported; only one stroke is read.
- It classifies the stroke, it does not fit precise geometry. Use the class to choose a fitting
  routine, then fit the geometry yourself.
- Do not use it on photographs or raster images: it takes an ordered point list.

## How to read the result

- shape is the top class: line, arrow, rectangle, ellipse, triangle, diamond, pentagon,
  hexagon, star, heart, cloud, scribble, or none.
- confidence is that class probability. The model rejects strokes below per-class gates, so a
  rejected stroke can come back as none with rejected: true instead of a confident wrong class.
- candidates ranks the alternatives; near-ties are expected for rough or ambiguous strokes.

## Caveats

- Tuned for deliberate single strokes. Very rough strokes are rejected by design, which is the
  right behaviour for a snap feature but not for a classifier that must always answer.
- The model is trained on canvas-coordinate outlines; resampling to 128 points and
  unit-scaling happen in the processor, so pass points in drawing order and in a consistent
  coordinate space.
- Do not use outputs to train a competing on-device model (Desert Ant Labs licence).

## Licensing

The weights are the Desert Ant Labs Source-Available License 1.0: the attribution notice
"Powered by Desert Ant Labs" is required, redistribution is not permitted, and a commercial
licence applies above the active-device threshold. The runtime (LiteRT.js) is Apache-2.0.
