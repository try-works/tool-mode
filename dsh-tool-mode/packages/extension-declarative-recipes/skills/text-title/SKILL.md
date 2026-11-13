---
name: declarative-text-title
description: Produce a short, bounded title and description through the text_title declarative recipe.
---

# Declarative text title

Use the `text_title` tool when a caller needs a short title and one-sentence
description for supplied text. The recipe is data owned by the package; the host
broker executes it against the deployment's authorized harness model.

- Pass the text and the kind (page, section or document).
- The result is a JSON object with a bounded `title` and `description`.
- Do not treat the model's title as a verified fact; it is a generated label.
- If the deployment has no authorized harness model, the tool refuses; do not
  fabricate a title.
