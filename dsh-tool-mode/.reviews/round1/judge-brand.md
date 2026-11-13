# Component inventory — brand & editorial review

**Reviewer:** senior brand / editorial designer (independent, round 1)
**Subject:** Tool Mode — "Component inventory." (1440 × 1520 artboard)
**Viewed:** overview.png, models-row.png, tools-grid.png, function-code.png, function-mcp.png, all 23 component crops.
**Method:** judged at 1:1 — the PNG is 1:1 with the artboard, so no scaling assumptions are involved. Text is measured from its rendered ink; quoted em sizes are inferred from that ink (ink is ~30–40% smaller). Geometry, ink bounds and colour sampled from overview.png; contrast computed to WCAG 2.x. Nothing in the Paper file or in source was edited. Live/interaction states were not available.

---

## Verdict

**This is a confident editorial page that has not yet become a design system.** The masthead, the paper stock (#E8E4DB), the hairline section rules, the cover art and the copy voice are authored and distinctive. The information layer is not: labels are set between roughly 5.5 and 8 px (4–7 px of ink), the right side of the page has four different edges, colour claims to encode families but does not, and sixteen icons are drawn in at least five idioms. The page currently reads as a beautifully art-directed poster *of* a catalogue; the job is to make it behave as the catalogue.

The strongest asset is the identity: a serif-italic wordmark, a warm uncoated-paper ground, flat riso-saturated covers and a single UI accent, lime #D1F969. The serif appears again only by accident, in the tools_plan numerals; the lime appears only in the last section. The page has a brand, but the brand has not been extended into a system. Fixing that — plus the legibility floor — is where most of the remaining quality lives.

## Scorecard

| Group | Component | Score |
|---|---|---|
| 01 Model cards | Laya | **7** |
| | Needle | **6** |
| | Embedding Gemma 2 | **5** |
| | Tongue | **4** |
| | Voz | **5** |
| 02 Tool icons | decision_choose | **4** |
| | decision_score | **3** |
| | decision_test | **6** |
| | tools_plan | **3** |
| | structured_extract | **4** |
| | validate_record | **5** |
| | extract_with_repair | **5** |
| | multimodal_embed | **5** |
| | semantic_rank | **3** |
| | semantic_similarity | **7** |
| | semantic_classify | **4** |
| | semantic_deduplicate | **3** |
| | dedupe_and_rank | **3** |
| | media_find_moments | **7** |
| | lang_detect | **6** |
| | stt_transcribe | **6** |
| 03 Functionality | CODE MODE | **6** |
| | MCP | **5** |
| **Aggregate** | 23 components | **4.9 / 10** |

System marks, for orientation: typographic hierarchy **6**, composition **6**, colour **4**, iconography **4**, editorial voice **8**, distinctiveness **7**, coherence as one system **5**.

Scores are scoped to each component as presented; the cross-cutting legibility defect (micro-labels, 2:1 meta) is counted once, in the system tests and in change #1, not re-deducted in every row.

---

## The page as an authored system — seven tests

| Test | Verdict | Evidence |
|---|---|---|
| One spine | **Fail** | Right-hand text lands on four edges: header folio ends at x=1258, footer folio at x=1318, section meta at x=1393, rules/grid at x=1407. Left margin is 44 px, right margin 32 px. |
| One type scale | **Fail** | 60 / 30 / 24 / 13 / 10 / 7 / 6 / 5 / 4 px with no 9–10 px step. The last three steps are below a readable label size. |
| One colour rule | **Fail** | Families ramp hue on one card and value on another; #C4B7FA is used for two different families; #92CFC4 (Embedding) sits between Needle's #80B59F and #AAD7C2. |
| One icon grammar | **Fail** | Stroke widths 2–14 px; two type-icons in two faces; the check is used by two tools; bars are used by five. |
| One surface language | **Fail** | Model cards: radius 18, soft 40 px shadow. Tiles: radius 14, flat. Panels: radius 0, flat. |
| One status vocabulary | **Fail** | "READY" and "MCP EXPOSED" share one badge slot; the MCP legend then counts "3 exposed / 13 ready" as if they were mutually exclusive. |
| One editorial voice | **Pass** | "Component inventory." / "One program. Three calls." / "Nothing estimated" — consistent fragment-plus-period voice. |

Six of seven fail. That ratio matches the gut read: the page has a point of view, but not yet a grammar.

### Composition

The frame is disciplined where the reader looks first. Content is 1364 px wide on a 1440 canvas; the masthead sits 40 px above the H1; the H1 ink is 580 × 56 px; sections are separated by 1 px rules at y=222, 640 and 1060, each followed 12 px later by a 7 px mono kicker. That rule-plus-kicker rhythm repeats three times without a slip and is the most convincing "authored" moment on the page.

The weakness is everything to the right of the text. The layout has no right spine (four edges, above), and the run-in details behave as independent floating objects: the CARD/ICON/FUNCTION legend sits at y=169–173, in the same band as the 13 px deck, 1 px above the deck's cap line, and ends 188 px inside the right edge. It is not a working key — nothing below uses its square/dot/bar markers — so it reads as a competing byline. Section 03 compounds this: its two 660 px panels plus a 24 px gutter total 1344 px, 20 px short of the 1364 px grid, so the last major row ends visibly inside the edge that every rule above it honours.

The model row is otherwise well proportioned: 5 × 260 px cards on a 16 px gutter, a 140 px art window over a 200 px information field. But the row is broken by one card (see Embedding Gemma 2) and the covers do not share a composition rule: Laya is left-band-plus-bars, Needle is bottom-aligned bars plus a corner brace, Embedding is left-aligned capsules, Tongue is full-bleed stripes, Voz is two offset squares. At 1x they read as five album covers, not five records in one catalogue.

### Typographic hierarchy

The display pair is excellent. "Component inventory." is set large, tight and confident, with a period that does the editorial work; the 60 → 13 px jump is dramatic and correct. The card titles at ~30 px are also well cut for the grotesque, and the mono metadata voice (labels, counts, hashes, code) is a coherent second system: sans for human content, mono for machine facts.

Then the scale collapses. Between the 13 px deck and the 10 px card subtitle there is no step; below 10 px the page uses 7 (section kickers), 6 (card eyebrows, panel captions, folios), 5 (card units, tile names) and 4 px (tile status, card indices). At 1x, the tool names are not readable — the primary name of the primary object in section 02 is set smaller than the section's own kicker. The card's "TOOLS" unit is 5 px at 2.30:1; the hash is 5 px of ink at 1.96:1. This is not a "small type" style; it is below the floor where the words function as words rather than texture.

Two typographic bugs sit on top of the scale problem. First, the display line-height is ~0.88: on Embedding Gemma 2 the descender of line 1 ends 3 px above the cap of line 2, so the two-line title nearly touches itself. Second, the metric line is two different components: on Laya/Needle/Embedding it is a ~24 px numeral plus a 5 px mono unit ("3 TOOLS"); on Tongue/Voz the unit is set at 15 px caps, the same size as the numeral ("1 TOOL"), so the number loses its hierarchy and the unit reads as part of the number.

### Colour

The base palette is the best thing on the page: warm paper #E8E4DB, near-black ink #0A0A0B, white cards, five deep ink grounds (#3342D0, #1A392B, #132967, #360F47, #1F2B39) and a single acid accent (#D1F969). It feels printed, not generated.

The tint system does not hold. Twenty-one coloured surfaces (5 covers + 16 tiles) are produced by three different rules: Laya ramps hue (orange → salmon → pink), Needle ramps value (sage → mint → palest mint → deep sage), Embedding uses seven different hues (pale blue, periwinkle, mint, lilac, sky, teal, pale blue). As a result the section's own claim — "16 UNITS / GROUPED BY FAMILY" — is not visible: #C4B7FA is used for both semantic_deduplicate (Embedding) and lang_detect (Tongue); #92CFC4 (semantic_classify) sits between two Needle greens; #A6CFFB and #B0D7FB are indistinguishable light blues in the same family; #4F9B8F and #639D87 are near-neighbours across families. The deep covers and the pastel tiles also belong to two different media references: the covers are riso ink, the tiles are Figma swatches.

### Iconography

Five of the sixteen marks are bar arrangements (decision_choose, decision_score, semantic_rank, dedupe_and_rank, stt_transcribe), so the icon grammar cannot separate choose / score / rank / dedupe / speech. Two pairs are near-identical in construction (semantic_classify's pills vs semantic_deduplicate's squares; semantic_rank's bars vs dedupe_and_rank's bars), and the check mark is shared by decision_test and validate_record. Stroke weight ranges from 2 px (the arrows in semantic_rank / dedupe_and_rank) to 14 px (decision_choose's bars), a 7× spread with no optical-size rule. Two type-icons use two different faces (tools_plan is serif, lang_detect is sans), and two icons collide with their own labels (decision_score, semantic_rank).

Credit where it is due: semantic_similarity, media_find_moments, lang_detect and stt_transcribe are the marks that survive at 1x, because they use a large simple silhouette and one or two shapes. They are the models for the redraw.

### Voice

The copy is the most ownable part of the page after the masthead. "Component inventory.", "One program. Three calls.", "Three exposed.", "Nothing estimated", "One trace / host-reported" — short, declarative, machine-literate, with the period as a signature. "Three exposed." is the one that goes too far: it withholds its noun, and the panel's only explanation is the diagram. Add the noun ("Three tools exposed.") or a 13 px deck.

"NOTHING ESTIMATED" is the most interesting line on the page and it is set at 6 px in the footer, where it reads as legal dust. If the inventory's ethics claim is "nothing estimated", it should be a colophon line at 10–11 px. Conversely, if the 44 / 38 / 61 ms in the CODE panel are illustrative rather than captured, the claim is contradicted by the artefact; label the panel "example trace" or wire it to a real trace.

### References and distinctiveness

The references are legible and mostly good: the Swiss specimen-sheet frame (hairline rules, mono kickers, numbered sections), the mid-century sleeve / Suprematist geometric covers, and a print-ink palette. The weaker reference is the developer-terminal section — black and forest panels, giant braces, lime — which is the most generic visual language on the page and is repeated three times (the CODE panel's braces, the structured_extract icon, the brace on Needle's cover). The page's most generic element is also its most repeated.

Distinctiveness today: **7/10**. Ownable assets: the serif-italic wordmark ("tool" roman, "mode" italic — a genuinely good idea), the paper/ink palette, and the specimen-grid concept. But the serif appears only twice — the wordmark and, unaccountably, the tools_plan numerals — and the lime appears only in section 03, and the rest of the page could be any well-made developer-tool documentation page. The fix is not more decoration; it is to *use* the ownable assets: the wordmark's serif as the display numeral voice, and lime as the functionality accent introduced before section 03.

---

## 01 — Model cards

**Row-level finding.** The cards are 260 × 340 px (140 art + 200 content) on a 16 px gutter, radius 18 px, with a soft shadow that extends ~40 px below the card; the tiles below are flat. Within the card, the title is ~30 px, the subtitle 10 px, the numeral ~24 px, the unit 5 px of ink, the eyebrow 6 px, the hash 5 px, the badge 5 px on an 18 px capsule. The badge is bottom-anchored; everything above it is in flow, which is why one two-line title moves the whole middle of its card.

### Laya — 7/10
**Biggest issue:** the single badge reads "MCP EXPOSED" where the other four read "READY", so one slot carries two different axes (transport vs state) and Laya's readiness silently disappears.
**Fix:** replace the capsule with two fixed mono tags at 8 px / 4.5:1 — "MCP" (transport) and "READY" (state) — on every card, Laya showing both; if only one can be shown, use state on the card and transport on the tiles.

### Needle — 6/10
**Biggest issue:** the cover's brace (23 × 53 px, 4 px stroke) floats in the top-right with ~40 px of empty field around it while the four bars are bottom-aligned on the left; the two marks share neither grid nor baseline, so the brace reads as a speck that survived a crop.
**Fix:** either delete it, or make it structural: 56 px tall, 5 px stroke (the same weight as the icon braces), flush right at 18 px, vertically centred on the tallest bar's top; and add the matching 18 px left margin to the bars so the art has a perimeter.

### Embedding Gemma 2 — 5/10
**Biggest issue:** the two-line title is the only reflowed card: with a ~26 px line pitch and a 3 px gap between the descender and the next cap, it pushes the subtitle and numeral down 12 px, shrinking the numeral-to-badge gap from 29 px to 17 px and breaking the row's baseline.
**Fix:** give every title a fixed two-line field (64 px) and set display line-height to 1.06; better, keep every title to one line by demoting "Embedding" to the family line (title "Gemma 2", subtitle "embedding") — a content fix that also resolves the row.

### Tongue — 4/10
**Biggest issue:** its metric is a different component: "TOOL" is set at 15 px caps, the same optical size as the numeral, where every other card sets its unit at 5 px — so the singular cards read as one large all-caps word, not as a number with a unit.
**Fix:** one metric component for all five — numeral 24 px, unit 8 px mono, 0.08 em tracking, 6 px gap, singular "TOOL" / plural "TOOLS" as separate spans — and never concatenate the unit into the count string.

### Voz — 5/10
**Biggest issue:** the cover is left-shifted and half-empty: the two-square group occupies 18–164 px of the 260 px field (~97 px dead on the right), and the small square is #5A6C8C on #1F2B39, 2.71:1, so it half-disappears.
**Fix:** centre the 146 px group optically (≈57 px left and right) and lift the small square to a value with ≥3:1 (e.g. #6E84A8) or draw it as a 2 px outline; keep the large square at full ink.

---

## 02 — Tool icons

**Section-level finding.** All 16 tiles are 160 × 160 px with a 12 px horizontal / 14 px vertical gutter and a 14 px radius. Each carries three pieces of micro-type: family index at 4 px (1.83:1 on the warmest tile), name at 5 px (3.56:1), status at 4 px (2.07:1). That alone makes the section unreadable at 1x. On top of it, the grid is 8 × 2, so the seven-tool Embedding family is split across the row break, and the section's "grouped by family" claim has no visible group header. **Fix the tile before the icons:** names at 10 px mono, status at 8 px, eyebrow at 8 px, all at ≥4.5:1; either 4 × 4 with family blocks or 5 explicit family bands; 16 px gutters both axes; 176 px tiles if necessary.

### decision_choose — 4/10
**Biggest issue:** the 112 × 14 px three-bar stack is the heaviest mark in the set and reads as a menu/skeleton, not a choice; the two outer bars are the same muted brown at about 1.6:1.
**Fix:** three 40 × 7 px options inside a 64 px box, the selected one in ink and the others at 45%; no full-bleed width.

### decision_score — 3/10
**Biggest issue:** the five bars run into the tool name (the label is overprinted on the chart), the tallest bar is fourth so the mark does not read as a scale, and two bars sit at 1.65–1.85:1 on coral.
**Fix:** four ascending bars in a 64 × 52 px box ending 10 px above the name, one ink, plus a 1 px baseline; keep the whole mark clear of the label band.

### decision_test — 6/10
**Biggest issue:** the check is the same glyph as validate_record, so two tools in two families cannot be told apart; its ~7 px stroke is also heavier than the 5 px the outline marks use.
**Fix:** keep the check at 5 px and add a small × above it (test = pass/fail), or use a two-state toggle; give validate_record a document plus check.

### tools_plan — 3/10
**Biggest issue:** "1·2·3" is type, not an icon, and it is set in a serif that appears nowhere else on the page — at 1x it reads as a different brand or a typo.
**Fix:** either draw three numbered rows at icon scale (32 × 5 px rows with 6 px counters), or commit to type-icons and set the numerals in the same face as lang_detect's A at 30 px tabular, dots removed.

### structured_extract — 4/10
**Biggest issue:** a 42 px curly brace is a syntax glyph, not an extraction, and it is the third use of the same brace (CODE MODE panel, Needle cover), so the motif carries no tool-specific meaning.
**Fix:** brace reduced to 3 px stroke plus one 12 px pill detached to its right — the brace is the container, the pill is what was extracted.

### validate_record — 5/10
**Biggest issue:** the check crosses the frame's bottom-left border — the only icon that breaks its own frame — so it reads as a clipping error; the 10 px frame radius is also the roundest form in the set.
**Fix:** inset the check 10 px, reduce the frame radius to 8 px, unify the stroke at 5 px; or drop the frame for a document outline.

### extract_with_repair — 5/10
**Biggest issue:** a circular refresh arrow means "reload"; nothing says "extract" or "repair", and its 5 px ring is the heaviest Needle mark.
**Fix:** a 24 px arrow orbiting a 28 px document/brace at 4 px, one ink, arrowhead ≤10 px.

### multimodal_embed — 5/10
**Biggest issue:** four identical rings in four unexplained greys; the four modalities are indistinguishable and one ring sits at 2.25:1 on the pale-blue ground.
**Fix:** four 18 px rings in a single ink on a 2 × 2 grid at 5 px; if modality must be encoded, use four distinct inner glyphs (text bar, image square, audio wave, video triangle).

### semantic_rank — 3/10
**Biggest issue:** the ascending bars collide with the tool name and the 2 px arrow beside 14 px bars looks like two different icons spliced together.
**Fix:** 64 × 48 px box, bars ending 12 px above the label, arrow 5 px with a 12 px head, integrated at the top right of the last bar.

### semantic_similarity — 7/10
**Biggest issue:** the two rings are drawn as two separate strokes, leaving a visible seam in the lens, and the grey right ring reads as disabled.
**Fix:** one compound path with an even-odd overlap (the lens knocked out), single ink, 5 px stroke.

### semantic_classify — 4/10
**Biggest issue:** three pills cascade diagonally with no container or outcome, and the rear pill falls to 2.48:1 on the mint, so at 1x the mark is essentially one black pill.
**Fix:** a 64 px three-row list with the selected row checked, or a pill entering a bin — one ink, inactive rows at 40%.

### semantic_deduplicate — 3/10
**Biggest issue:** two offset rounded squares is the same construction as semantic_classify's pills, so the two Embedding operations look like siblings; nothing is shown being removed.
**Fix:** two 28 px squares overlapping, the rear one at 25% with an ×, or three→two with the removed square ghosted; single ink, 5 px radii.

### dedupe_and_rank — 3/10
**Biggest issue:** two 8 px bars and a 2 px arrow fill about a quarter of the tile, and the mark is a thinner echo of semantic_rank.
**Fix:** the duplicate pair (two 18 px overlapping squares) plus the sorted four-bar list at 5 px, both inside 64 × 48 px.

### media_find_moments — 7/10
**Biggest issue:** three unrelated weights — a filled 44 px triangle, a 6 px rail and three 14 px square knobs — with the triangle floating 12 px above the rail.
**Fix:** playhead on the rail (triangle lowered to it), rail 4 px, knobs 8 px, triangle 28 px, all one ink; mark the found moment with the single accent.

### lang_detect — 6/10
**Biggest issue:** its "A" is sans while tools_plan's numerals are serif — two type-icons, two faces — and the two rules beneath sit left of the A's optical centre.
**Fix:** pick one face for type-icons (the wordmark serif is the better brand move), A at 46 px, rules 4 px at 100% and 55% width centred on the A's axis.

### stt_transcribe — 6/10
**Biggest issue:** the seven-bar waveform is the fifth bar-based icon, so it does not distinguish speech from score/rank/choose; its square caps clash with the rounded check and rings.
**Fix:** keep the wave but place it inside a 2 px quote bracket or pair it with a text cursor; define one cap style for the set (recommend rounded, to match decision_test).

---

## 03 — Functionality types

### CODE MODE — 6/10
**Biggest issue:** the panel is top-heavy — 87 px of empty black between the last code line and the chips — while the right third is spent on 56 px decorative braces that have no relation to the code they bracket; the chips are unlabelled and the 6 px provenance caption is invisible.
**Fix:** turn the right third into a trace column: a 44 / 38 / 61 ms time aligned to each of the three code lines with a hairline rule (a real column, not floating chips), delete the floating braces or use them to bracket the code block itself, and make the caption an 8 px labelled footer ("Example trace" if the times are illustrative).

### MCP — 5/10
**Biggest issue:** the connector is broken: the bright lime junction dot sits 21 px above the connector's axis, no line joins it to the three boxes, and the 1 px #587B41 box borders are only 2.60:1 on the forest ground — the host and the tools read as two disconnected groups.
**Fix:** draw the whole diagram as one SVG: host box → 1 line on a single axis → junction dot on that axis → orthogonal bus with equal 12 px stubs into all three boxes; raise the borders to ≥3:1 (or 2 px); right-align the diagram to the panel's 20 px padding (it currently leaves ~100 px dead on the right); separate "3 exposed / 13 ready" from "host-reported" as a caption rather than a third peer line.

**Panel-level:** the two 660 px panels total 1344 px against the 1364 px grid (20 px short); CODE MODE uses 20 px left / 32 px right padding and MCP 20 px left / 100 px right. Set both panels to the same 1352/1364 box and the same 20 px padding, and give them a shared footer baseline.

---

## Ranked top 10 — by expected impact

1. **Raise the legibility floor and rebuild the label scale (impact 5/5, effort M).** Set an 8–9 px minimum for all mono labels at ≥4.5:1; add the missing 9–10 px step between the 13 px deck and the 10 px subtitle; delete the 4–5 px hash and the duplicate index, and promote the tile name and status (10 / 8 px type) rather than shrinking them. This touches all 23 components and removes the single strongest "unfinished" signal on the page.
2. **Restructure section 02 into real family blocks (impact 5, effort M).** Replace the 8 × 2 matrix with five bands (3 / 4 / 7 / 1 / 1) and a family header per band, or a 4 × 4 grid; give the grid 16 px gutters both axes and 176 px tiles so a 10 px name fits. The current grid breaks the seven-tool Embedding family across the row and makes the "grouped by family" label untrue.
3. **Redraw the icon set on one grid (impact 5, effort L).** One 64 × 56 px icon box, one 5 px stroke, one ink, at most one tint; no glyph over 64 px; resolve the three collisions (check shared by decision_test/validate_record; classify vs dedupe; rank vs dedupe_and_rank); remove the per-icon label collisions; unify type-icons on one face. Keep the four marks that already read at 1x (similarity, media, lang, stt) as the reference for the silhouette.
4. **Define one colour rule for all 21 surfaces (impact 4, effort M).** One hue per family and four ordered tints built from the cover ground (e.g. 70 / 55 / 40 / 25% mix with paper); remove the exact duplicate #C4B7FA and the cross-family greens; raise the tile tints toward the covers' ink chroma or lower the covers toward the pastels — pick one medium. This makes the legend and the section label true, and resolves the print-vs-screen split.
5. **Fix the model-card row as one component (impact 4, effort S/M).** One metric component (24 px numeral + 8 px unit, 6 px gap, TOOL/TOOLS as spans); a 64 px two-line title field on all five; display line-height 1.06; move focus to the badge by splitting transport from state. This resolves the row's only reflow, the "1 TOOL" anomaly and the 5 px ink unit.
6. **Recompose section 03 as a pair (impact 4, effort M).** Give CODE MODE a real trace column instead of 87 px of void and floating braces; draw MCP as one SVG with the junction dot on the axis and an orthogonal bus; raise the 1 px borders from 2.6:1 to ≥3:1; push both panels to the full 1364 px grid. Section 03 is what the page argues is its distinctive idea; it should not be its least resolved region.
7. **Establish the layout spine (impact 3, effort S).** Choose one content width — 1352 px at 44 px margins, or 1364 at 38 px — and set every section meta, folio and panel to it; that fixes the four right edges (1258 / 1318 / 1393 / 1407), the 12 px grid overhang and the 20 px section-03 shortfall in one pass. Cheap, and it is the most visible evidence for "one system".
8. **Fix the status vocabulary (impact 3, effort S).** Define transport (MCP / host) and state (ready) as separate facts; show "MCP" + "READY" where both are true; make the legend read "3 MCP-exposed · 16 ready" (or similar) with one definition of ready. As written, the card, the tiles and the legend contradict one another.
9. **Make the covers earn their space (impact 3, effort M).** One composition grammar for the five (single mark cluster, one shared margin, bottom-align on one baseline), and encode the tool count in the mark (3 / 4 / 7 / 1 / 1). That turns five beautiful but arbitrary abstractions into a data-bearing system, and fixes Tongue's irregular stripes and Voz's 97 px dead margin.
10. **Promote the assets the brand already owns (impact 3, effort S/M).** Use the wordmark's serif italic as the display numeral voice (metric numbers, section numerals) and for both type-icons; introduce lime as the functionality accent in section 01 (a status dot, the section rules' ticks) so it is not a surprise in section 03; reuse the mark's arrow geometry as the flow arrow in the MCP diagram. This is the cheapest route from "a very good dev-tool docs page" to a recognisable brand.

**Cheap extras (do with the above):** delete the CARD/ICON/FUNCTION legend (it is not a working key and it competes with the deck); keep one running folio, same size, same edge; drop the card's duplicate "#01" or the eyebrow's "/ 01"; label or remove the hex hashes; align the wordmark's left ink to the 44 px spine (it currently starts at x=36); choose one shadow policy (cards float at 18 px radius + 40 px shadow while tiles are flat); set the 13 px right inset of the section meta to 0.

---

## What to keep

- "Component inventory." — the scale, tracking and period are right; do not touch the display setting.
- The paper/ink palette and the hairline section rules; the 12 px rule-to-kicker rhythm is the page's best system detail.
- The five cover grounds — #3342D0, #1A392B, #132967, #360F47, #1F2B39 — and the acid accent. This is a real palette.
- The specimen-grid idea (flat colour field + one mark + name + state). It is the right container for an inventory; it needs a legible label and a real family grouping, not a replacement.
- The copy voice, especially "One program. Three calls." and "Nothing estimated" — promote the latter out of the 6 px footer.
- The four icons that read at 1x: semantic_similarity, media_find_moments, lang_detect, stt_transcribe.

---

## Appendix — measurements

**Geometry** (overview.png, 1440 × 1520, 1:1)

| Item | Value |
|---|---|
| Content box | x 44–1407 (1364 px); left margin 44, right 32 |
| Model cards | 260 × 340 (art 140 + info 200); gutter 16; radius 18; shadow ~40 px |
| Tool tiles | 160 × 160; gutter 12 horizontal / 14 vertical; radius 14; no shadow |
| Functionality panels | 660 × 300; gutter 24; radius 0; total 1344 (20 px short) |
| Section rules | y = 222, 640, 1060; kickers 12 px below; ≈8 px mono |
| Section 01 content | y 258–597; rule → cards 36 px |
| Section 02 content | y 680–1013; rule → label 12 px; label → tiles 24 px |
| Section 03 content | y 1100–1399; footer 1452–1457 |

**Type** (rendered em size, with ink height in parentheses)

| Role | Rendered size | Notes |
|---|---|---|
| H1 | ≈60 px (56 px ink) | grotesque, tight tracking |
| Deck | 13 px (13 px ink) | |
| Model title | ≈30 px (27 px ink) | line pitch ≈26 px = 0.88 |
| Model subtitle | ≈10 px (9 px ink) | |
| Metric numeral | ≈24 px (17 px ink) | |
| Metric unit | ≈7 px (5 px ink) | Tongue/Voz: ≈20 px (15 px ink) — the bug |
| Card eyebrow | ≈7 px (6 px ink) | |
| Card hash / index | ≈6 px (5 px ink) | |
| Section kicker | ≈8 px (6 px ink) | mono, wide tracking |
| Panel headline | ≈30 px | grotesque |
| Code | 10 px | mono |
| Chips | ≈7 px | mono |
| Panel captions | ≈7 px (5 px ink) | mono |
| Tile name | ≈6 px (5 px ink) | mono |
| Tile status / eyebrow | ≈5.5 px (4 px ink) | mono |

**Colour**

| Token | Value |
|---|---|
| Paper | #E8E4DB |
| Ink | #0A0A0B |
| Card | #FFFFFF |
| CODE panel | #101012 |
| MCP panel / Needle ground | #1A392B |
| Accent lime | #D1F969 (10.5:1 on #1A392B) |
| Cover grounds | #3342D0, #1A392B, #132967, #360F47, #1F2B39 |
| Tile tints | #ED7445 #F09071 #ECB9CF (Laya) · #80B59F #AAD7C2 #CCEADE #639D87 (Needle) · #C0DCF2 #94A6F9 #B0D7FB #92CFC4 #C4B7FA #A6CFFB #4F9B8F (Embedding) · #C4B7FA (Tongue) · #CDD8E8 (Voz) |

**Contrast failures (WCAG 2.x, small text 4.5:1)**

| Element | Colour | Ratio |
|---|---|---|
| Card unit "TOOLS" | #ABABAB on #FFFFFF | 2.30 |
| Card eyebrow | #ACACAC on #FFFFFF | 2.27 |
| Card hash / index | #B9B9B9 on #FFFFFF | 1.96 |
| Card subtitle | #818181 on #FFFFFF | 3.90 |
| Section kicker | #83817D on #E8E4DB | 3.06 |
| Header folio | #84827D on #E8E4DB | 3.03 |
| Section meta (right) | #9E9B96 on #E8E4DB | 2.18 |
| Footer | #95928D on #E8E4DB | 2.44 |
| Tile name (warmest tile) | #623322 on #ED7445 | 3.56 |
| Tile status | #9A4D30 on #ED7445 | 2.07 |
| Tile eyebrow | #A75333 on #ED7445 | 1.83 |
| MCP box borders | #587B41 on #1A392B | 2.60 |
| Voz second square | #5A6C8C on #1F2B39 | 2.71 |

(The pill text at #5A5A5A is 6.9:1 and passes; it is unreadable because it is 5 px, not because of contrast. The 1 px pill border at #A6A6A6 is 2.5:1 as a graphic.)
