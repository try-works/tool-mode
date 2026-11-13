# Judge review — Component inventory
### Tool-mode · launch v2 · 16b · Component inventory
**Round 1 · art direction, craft & accessibility**

Reviewed at 1:1 (1440 × 1520) from `overview.png`, the four section crops and all 21 component crops. I did not edit the Paper file, source, or any asset; this document is the only output.

---

## 0. Verdict

This is a confident, editorial specimen sheet with a real point of view: cream field, white units, one black display line, mono meta, saturated family blocks, and a dark functionality band. The premise — an inventory, not a landing page — is the right one, and several ideas are genuinely good (the card anatomy, the uniform tile, the shared 660 × 300 panel scale, the `media_find_moments` / `tools_plan` / `stt_transcribe` icons).

It is not yet a usable inventory. Three systemic problems suppress everything:

1. **The type is microscopic.** More than 70 text runs sit at 6–8 px; the page's navigational labels (sections, family tags, tile statuses, hashes) are the smallest type on the sheet. Measured contrast for those runs is 1.76–3.70:1, against a 4.5:1 floor. This is not a subtle accessibility miss; at normal viewing size most of the meta data cannot be read at all.
2. **Family identity is asserted, not shown.** The header says "grouped by family," but the 16 tiles are a continuous 8 × 2 grid with no group boundaries, the family prefix is 7 px at ~2:1, and the tile colours are not family-coded: the seven Embedding tools use seven different hues, and Tongue's tool tile is lilac while its model card is deep purple.
3. **CODE MODE and MCP do not read as different functionality types.** They are the same 660 × 300 dark card, with the same inset, the same 7 px kicker, the same large off-white title, the same mono microcopy, the same acid accent, the same bottom caption and the same empty lower half. The difference is only the contents (code vs. boxes) and the ground colour. Structurally they are one component with two payloads.

There is also one objective defect and one broken diagram: two tool icons (`decision_score`, `semantic_rank`) overlap their own captions, and the MCP connector is not connected (measured below).

### Scores

Scores assess each component's own concept, composition and execution. The shared 6–8 px type floor is scored once, systemically (item 1 of the top 10), not repeated in all 23 grades; otherwise every score would be capped at 4. Judged as production UI rather than a specimen, **no component here ships until the type floor is fixed.**

| # | Component | Type | Score | One-line verdict |
|---|---|---|---|---|
| 1 | Laya | Model card | **7** | Strongest card; the hero is loud but says "stripes," not "decision." |
| 2 | Needle | Model card | **6** | Beautifully toned; an equalizer and a floating brace, not extraction. |
| 3 | Embedding Gemma 2 | Model card | **6** | Cleanest composition; the only 2-line title breaks the row's rhythm. |
| 4 | Tongue | Model card | **5** | A flag/swatch where a language signal should be. |
| 5 | Voz | Model card | **4** | Two squares, 55% empty; nothing about speech. |
| 6 | decision_choose | Tool icon | **7** | Clear selected row; missing the "choice" cue. |
| 7 | decision_score | Tool icon | **3** | Bar chart collides with and obscures its caption; duplicates ranking. |
| 8 | decision_test | Tool icon | **5** | A checkmark means "valid," not "test"; duplicates validate_record. |
| 9 | tools_plan | Tool icon | **8** | Distinct and legible; dots read as a version number. |
| 10 | structured_extract | Tool icon | **5** | A lone brace means "code"; the same glyph is the CODE MODE hero. |
| 11 | validate_record | Tool icon | **7** | Instantly legible; the check escapes its box. |
| 12 | extract_with_repair | Tool icon | **4** | A refresh arrow means "retry"; no "extract" is shown. |
| 13 | multimodal_embed | Tool icon | **6** | Good family rhyme; four stroke weights, two rings disappear. |
| 14 | semantic_rank | Tool icon | **3** | Same bars as decision_score, and it collides with its caption too. |
| 15 | semantic_similarity | Tool icon | **7** | Clear overlap; the two rings aren't optically equal. |
| 16 | semantic_classify | Tool icon | **5** | Staggered pills read as tags; low-contrast grey pills. |
| 17 | semantic_deduplicate | Tool icon | **6** | Overlap reads as merge; the black square swallows the grey. |
| 18 | dedupe_and_rank | Tool icon | **4** | A stripped semantic_rank; neither dedupe nor rank is visible. |
| 19 | media_find_moments | Tool icon | **8** | Best-in-set icon; reads as video/timeline immediately. |
| 20 | lang_detect | Tool icon | **6** | Clear "text," weak "detect"; not tied to Tongue. |
| 21 | stt_transcribe | Tool icon | **7** | Clear audio; could be playback rather than transcription. |
| 22 | CODE MODE | Functionality | **5** | Strong title; the evidence is 7 px, the braces are the hero, and 80 px is empty. |
| 23 | MCP | Functionality | **4** | The transport diagram is disconnected and the host box dominates. |

**Mean: 5.6 / 10** — models 5.6, tools 5.7, functionality 4.5.

The shape of that score is the story: the concepts hold up (several 7–8s), the cadence and the information architecture do not. Most fixes below are not new graphics; they are type, order, connection and proportion.

---

## 1. What is working

- **The editorial framing.** A specimen sheet on `#E8E4DB` with `#FFFFFF` units and `#0A0A0B` ink is a deliberate, grown-up choice. It reads as a working document, not a pitch deck.
- **The card anatomy.** Index → name → descriptor → count → state is the right order, and the 140 px colour hero over a 200 px white panel is a repeatable split. Laya's full-bleed crop and Needle's flat colour field show the range the system can hold.
- **The tile container.** Sixteen equal 160 px tiles is the correct decision for an inventory; it makes every tool comparable. The icon style — chunky geometric forms, one dark ink plus tints, no gradients — is coherent and ownable.
- **Three genuinely good icons.** `media_find_moments` (play + timeline), `tools_plan` (1 · 2 · 3), and `stt_transcribe` (waveform) are readable at a glance without the label.
- **The functionality band.** Giving the two "types" a dark, full-width, 300 px frame is a strong separation from the units above. The title voice ("One program. Three calls." / "Three exposed.") is confident and specific — rare in component sheets.
- **Colour restraint.** The page is almost entirely cream, white, black and the family hues. The saturation earns its place; the sheet never becomes a rainbow.
- **The mono voice.** `FUNCTIONALITY / CODE MODE`, `ONE TRACE / HOST-REPORTED` is a good system. It is simply set three steps too small.

---

## 2. The three systemic failures

### 2.1 Type: a 6–8 px ceiling, and a contrast cliff under it

Measured from the export (cap heights converted with Geist's ~0.715 cap ratio):

| Where | Size | Contrast on its ground | Verdict |
|---|---|---|---|
| Page display "Component inventory." | ~64–68 px (48 px cap) | #0A0A0B on cream ≈ 15.7:1 | Pass |
| Intro line | 16 px | #63615F on cream = **4.86:1** | Pass, barely |
| Section labels (`01 / MODEL CARDS`, `02 / TOOL ICONS`, `03 / FUNCTIONALITY`) | **7 px** | #83817D on cream = **3.06:1** | **Fail** |
| Model card name | 32 px (22 px cap) | 19.8:1 | Pass |
| Model meta (`MODEL / 01`) | **7 px** | token #9A9A9A = 2.85; rendered cores #B0B0B0 = **2.17:1** | **Fail** |
| Model subtitle | 14 px | rendered 3.90–4.88:1 | Borderline |
| Model hash (`#4F5DFF` …) | **≈6 px** | #BFBFBF on white = **1.84:1** | **Fail** |
| Tool family tag (`EMBEDDING / 05`) | **7 px** | **1.76–3.70:1** | **Fail** |
| Tool name (`semantic_rank`) | **8 px** | **3.42–8.56:1**; 4 of 16 below 4.5 | **Fail (4)** |
| Tool status (`READY` / `MCP / EXPOSED`) | **7 px** | **1.97–2.32:1** | **Fail (16/16)** |
| Panel kicker | 7 px | muted olive on #101012 | Fail by size |
| Code | 9–10 px / 12 px leading | #C8EF65 on #101012 = 14.47:1 | Pass, too small |
| Trace chips | 7 px | dim olive on #101012 | Fail by size |
| Panel footer | 7 px | muted / acid | Fail by size |
| Footer meta | 7 px | faint on cream | Fail by size |

At 96 dpi, 7 px is about 5.25 pt. This is below the point where mono uppercase with 0.1 em tracking holds its counters; the result is not "small type," it is texture. The sheet's structure — section names, family names, states, values — is carried almost entirely by type that cannot be read. And the hierarchy is inverted at exactly the level where it matters: the display is 64 px, the card name 32 px, and the thing that tells you what section you are in is 7 px, smaller than the badge inside a card.

**The type system should be rebuilt as a legible four-step scale**, preserving the editorial look:

| Role | Now | Target |
|---|---|---|
| Display | ~64 px | 64 px (keep) |
| Section name | 7 px mono | **14–16 px sentence** + the number at 10 px mono |
| Card name | 32 px | 32 px (keep) |
| Card descriptor | 14 px | 14 px, #5C5C5C (≥5:1) |
| Card meta / hash / index | 6–7 px | **9 px mono**, #6B6B6B on white (5.3:1); delete the hash |
| Tool name | 8 px | **11 px** (sentence or mono), #111 on the tile |
| Tool family / API name | 7 px | **9 px mono** at ≥4.5:1, or move to a list view |
| Tool status | 7 px | **9 px**, ink at ≥4.5:1 |
| Panel kicker / footer | 7 px | **10 px mono** |
| Code | 9–10 px | **12 px / 20 px leading** minimum |
| Trace chips | 7 px | **10 px** |

Two mechanical fixes make the scale possible without changing the layout: the tool caption block can grow from 20 px to 24 px inside the 160 px tile (see §4.1), and the model card can pay for a legible meta block by deleting the unreadable hash line and the duplicate index.

### 2.2 Family: the grid says "grouped," the eye sees confetti

The tool section's stated purpose is "grouped by family." Visually there is no grouping:

- **No boundaries.** Four families of 3, 4, 7, 1, 1 tools are laid into a continuous 8 × 2 grid with 12 px horizontal and 14 px vertical gutters. The 7-tool Embedding family breaks across the row; there is no header, rail, gap, rule or background band that marks where a family starts or ends.
- **No hue ownership.** The tile colours are not the family colours:

| Family | Model hero | Tool tiles (sampled) | Verdict |
|---|---|---|---|
| Laya | #3342D0 / #8C8CF7 / coral #ED7445 | #ED7445, #F09071, #ECB9CF | Coherent warm ramp |
| Needle | #1A392B | #80B59F, #AAD7C2, #CCEADE, #639D87 | Coherent green ramp |
| Embedding | #132967 | #C0DCF2, #94A6F9, #92CFC4, #C4B7FA, #A6CFFB, #4F9B8F, #CDD8E8 | **Seven hues: not a family** |
| Tongue | #360F47 | #C4B7FA | **Lilac ≠ purple; same tile as semantic_deduplicate** |
| Voz | #1F2B39 / #8CB4F2 | #CDD8E8 | Washed; weak link |

The reader's only fallback is the 7 px `EMBEDDING / 05` tag at 1.76–3.70:1. That is the wrong thing to make the least legible.

**Fix:** make family membership structural and chromatic at once.

- Order the 16 tiles contiguously by family: Laya → Needle → Embedding → Tongue → Voz.
- Insert a **24 px family gap** and a **2 px × 160 px family rule** in the family hue at the start of each run, plus a small family caption (10 px mono, 5:1) on the first tile of each run.
- Give each family **one hue and three tints** (not seven), e.g. Embedding: #132967 base, #6E8CC4 mid, #C0DCF2 light, #E7EEF8 wash. Tongue: #360F47 base, #7E4C92 mid, #C4B7FA light. Voz: #1F2B39 base, #6E87A0 mid, #CDD8E8 light.
- The cleanest long-term version is **one family per row, five rows**, with a 136 px left rail (family name 10 px mono, model name 16 px, 12 px swatch) and 160 px tiles flowing right at 12 px gaps. Embedding's 7 tiles = 1192 px, which fits the 1364 px content width. The sheet grows ~560 px; acceptable for an inventory, and it finally makes the 1-tool families (Tongue, Voz) look intentional.

### 2.3 Functionality: two skins of one card

The user's question — do CODE MODE and MCP genuinely read as different functionality types? — has a clear answer today: **no, not without their labels.** See §7 for the full argument and the split.

### 2.4 Density: the compression is inverted

The tool grid is compressed to the edge: 160 px per unit, three rows of 6–8 px type, 12 px inset, icons sometimes to the edge of the caption. The two panels, which carry the most explanation, are the emptiest objects on the sheet: CODE MODE has ~80 px of empty block between the code and the trace chips; MCP has roughly a third of its field empty; both titles take a quarter of the panel while the proof sits at 7 px. The most explanatory components should be the most legible and the best-proportioned. Right now the sheet is dense where it should be calm and empty where it should be dense.

---

## 3. Model cards (5)

**Shared issues (scored systemically, not repeated below):**

- Meta at 2.17:1 / 7 px; hash at 1.84:1 / ~6 px; section labels at 3.06:1 / 7 px.
- **Duplicate numbering:** "#01" top-right (3 px cap) and "MODEL / 01" (4 px cap) are the same number, 11 px apart, in two different styles. Remove one.
- **Two status axes:** "MCP EXPOSED" on Laya occupies the same badge slot as "READY" on the other four. A reader cannot tell whether Laya's three tools are ready; readiness is simply gone for that family. The panel then says "3 exposed / 13 ready" as if they were complementary.
- **No consistent illustration density:** Laya fills ~55% of its hero with ink, Needle ~35%, Embedding ~50%, Tongue **100%** (full-bleed stripes), Voz ~30%. The series has no common optical weight. Set a rule: 35–45% ink coverage, one focal form at ≥40% of the hero width, 24 px minimum clear margin (Tongue violates both ends; Voz violates the focal-size rule).
- **The shadow haze:** the card shadow is a wide blur that darkens the 16 px gutters to #DCD8CF and leaves a ~40 px grey band under the row (visible from y ≈ 612 to 638, above the section 02 rule). It reads as haze on the cream, not lift. Replace with 0 1px 2px rgba(10,10,11,.06) + 0 0 0 1px rgba(10,10,11,.04), or drop it and rely on the white/cream edge.
- **Family naming is inconsistent:** the card subtitle calls Laya "decision family," while the tool tags use the model name (`LAYA / 01`) as the family. Decide whether "family" = model or capability and use one word. The legend says "FUNCTION," the sections say "FUNCTIONALITY," the footer says "FUNCTIONALITY TYPES": one term, one spelling.

### 3.1 Laya — 7/10
**Biggest issue:** the hero does not encode "decision." Three orange stripes on ultramarine plus an unexplained lilac column read as a magazine crop; the middle row is not selected, weighted or checked, so the one thing a decision tool does is absent. The orange-on-ultramarine edge also vibrates — the highest-chroma pairing on the sheet — and makes this the loudest card by a wide margin.
**Precise fix:** draw a three-option stack inside the hero: three 200 × 24 px rows at x = 24, y = 36 / 72 / 108, 8 px radius; the selected row in full coral #ED7445 with a 16 px check at its right edge; the other two at 30% coral over #3342D0; delete the lilac block (or make it the selected row). Keep the bleed on the selected row only. This preserves the family colour and makes the capability legible before the name.

### 3.2 Needle — 6/10
**Biggest issue:** the mint equalizer bars + one floating brace do not say "structured extraction." The bars are the same bar-chart trope used by `decision_score`, `semantic_rank` and `dedupe_and_rank`, and the brace is a second, much thinner focal point in the top-right corner, unattached to anything.
**Precise fix:** make extraction the subject — a 120 × 120 document frame (4 px mint stroke, 16 px radius) with a 64 px brace cut into its right edge and a 24 × 24 mint "record" chip leaving the frame on a 2 px arrow. Drop the equalizer. If the bars stay, redraw them as document text lines on a 6 px rhythm, not a chart, and remove the brace.

### 3.3 Embedding Gemma 2 — 6/10
**Biggest issue:** the four identical capsules read as a loading skeleton or tab bar, and the shades are decorative rather than dimensional. As importantly, its two-line name is the only one in the row and pushes its subtitle and tool count **12 px below** the other cards (measured: subtitle y 483 vs 495; count y 503 vs 515), while the badge stays at 549 — so the card's internal spacing is compressed by 12 px relative to its siblings.
**Precise fix:** (a) reserve a 76 px two-line title slot in all five cards (min-height at 32 px / 1.12), so every subtitle, count and badge shares one y; pay for the extra 12 px by deleting the illegible hash line; (b) redraw the hero as four vector columns rising from a 2 px baseline (heights 48 / 72 / 56 / 88, 12 px gaps), one column at full ink and the others at 60 / 40 / 25%, so the repetition reads as dimensions, not tabs.

### 3.4 Tongue — 5/10
**Biggest issue:** horizontal lavender bands read as a flag, a swatch, or compressed-image banding — not language identification. There is no letterform, script or linguistic mark anywhere on the card, and the banding runs edge-to-edge (the only card with no clear margin), so it reads as a texture rather than a figure. The family link is also broken: the card is deep purple #360F47, its only tool tile is lilac #C4B7FA — the same lilac used by `semantic_deduplicate`.
**Precise fix:** use a letterform as the hero — "A" and "文" (or "A" and "ñ") at 96 px, one at full ink and one at 40%, on the family purple, with the band motif reduced to a 12 px baseline strip. Repaint the `lang_detect` tile in the family's deep purple + lilac tints so the card and its tool finally rhyme.

### 3.5 Voz — 4/10
**Biggest issue:** two rounded squares are semantically empty for speech → text, they occupy only ~30% of the hero, and nothing links the card to its tool's waveform icon. It is the quietest card in a row that is supposed to be a set of peers, and the emptiness reads as unfinished rather than restrained.
**Precise fix:** draw the transformation: five waveform bars on the left (heights 24 / 48 / 80 / 48 / 24, 12 px wide, 10 px gaps) resolving through a 2 px arrow into two text rules on the right (120 × 8 and 88 × 8, 12 px apart), in #8CB4F2 on #1F2B39 with the second blue at 55%. That fills 45% of the hero and makes "speech → text" literal; it also visually rhymes with the `stt_transcribe` tile.

---

## 4. Tool icons (16)

### 4.1 System-level problems

**a) Two icons are physically broken.** `decision_score` and `semantic_rank` both let their bar-chart artwork run into and over the tool name. Measured on `decision_score`: the caption occupies y 805–812, the tall black bar runs to y ≈ 813, and it crosses the last characters. This is not a taste issue; it is a layout collision. The 160 px tile needs a declared safe area.

**b) No common optical box or stroke.** The set mixes filled and stroked forms with footprints from ~48 px (the brace) to ~100 px (the charts, the plan numerals, the waveform), and stroke weights from 4 px (rank arrow) to 10 px (rings). The black check in `decision_test` is the heaviest object in the grid; the brace in `structured_extract` is the lightest. At 160 px, an icon set should share one optical square and one stroke.

**c) Eleven of sixteen icons reuse five tropes.** Bar charts: `decision_score`, `semantic_rank`, `dedupe_and_rank`. Checks: `decision_test`, `validate_record`. Pills: `decision_choose`, `semantic_classify`. Rings: `semantic_similarity`, `multimodal_embed`. Squares/boxes: `semantic_deduplicate`, `validate_record` (again). The grid can only be scanned by reading 8 px labels — which is the opposite of what an icon grid is for.

**d) The caption/status block is the least legible and carries the most state.** All 16 status lines are at 1.97–2.32:1. All 16 family tags are at 1.76–3.70:1. Four captions are below 4.5:1: `decision_choose` 3.56, `tools_plan` 4.13, `extract_with_repair` 3.59, `media_find_moments` 3.42.

**e) No family group boundaries** (see §2.2) and no consistency in tile hue.

**f) The API name is the only name.** The caption is the raw tool id (`semantic_deduplicate`) at 8 px. For an inventory that is defensible, but it means the reader must parse code identifiers to scan the grid. Give each tool a human name and keep the id as a secondary line, or at least set the id at 10–11 px.

**g) Non-text contrast is below floor too.** The tinted icon parts are not decoration — they carry the data (bars, rings, pills). The muted pills on coral sit around 1.6:1 and the mid grey on lilac around 2.4:1. WCAG 1.4.11 asks 3:1 for meaningful graphics; raise the secondary tint or use one ink plus a single ≥3:1 tint.

**Safe-area recommendation (one rule for all 16):**
Inside the 160 px tile: **16 px top inset → 96 px icon box (ends at y + 112) → 8 px gap → 12 px name row → 4 px gap → 10 px status row → 18 px bottom inset.** Nothing, including shadows, may cross y + 112. The 72 × 72 optical square is centred in the 96 px box; two wide exceptions (timeline, waveform) may use 96 × 72. All strokes are 8 px at this size; all secondary inks must clear 4.5:1 for text and 3:1 for graphic parts.

### 4.2 Per icon

**decision_choose — 7/10**
- **Biggest issue:** three equal pills read as a list, not a choice; the black pill is a generic "selected row" with no cue for what selected it.
- **Fix:** three 200 × 24 px rows, 10 px gaps; put a 16 px check at the right of the selected row (or a 12 px caret at its left); keep the alternatives at 35% ink. The check is the verb.

**decision_score — 3/10**
- **Biggest issue:** the tallest bar overlaps and obscures the tool name (bar bottom y ≈ 813 vs. caption 805–812).
- **Fix:** constrain the icon to the safe area: four bars, 4 × 14 px wide, 16 px gaps, max height 64 px, baseline at y + 112. Keep the max bar black and the others at 35%. If you want a score (not a rank), replace the four bars with a horizontal gauge with a needle; see `semantic_rank`.

**decision_test — 5/10**
- **Biggest issue:** a checkmark is the universal glyph for "valid/approved," not "yes/no test," and it duplicates `validate_record`'s check.
- **Fix:** show a binary pair — a 32 px check at full ink and a 32 px cross at 35%, side by side with a 16 px gap and equal stroke — or a toggle with the knob to the right. Reserve the single check for `validate_record`.

**tools_plan — 8/10**
- **Biggest issue:** "1 · 2 · 3" reads as a version number at 1x; the 3 px middle dots and tight numeral spacing close the sequence up.
- **Fix:** replace the dots with 8 px dashes or arrows at 20 px gaps, or set `01  02  03` in a 36 px mono with 12 px gaps. Keep the numerals as the hero; this is one of the two best icons in the set.

**structured_extract — 5/10**
- **Biggest issue:** a lone brace means "code," and it is the same glyph that the CODE MODE panel uses as a 70 px hero — two different meanings for the same mark.
- **Fix:** make the brace 64 px and pair it with a 24 px square "record" chip leaving its right side on a 2 px arrow; or drop the brace for a document frame with a cut corner. Braces should belong to code surfaces only.

**validate_record — 7/10**
- **Biggest issue:** the check's tail crosses the box's bottom-left stroke, which at 160 px looks like a clipping bug.
- **Fix:** draw the box at 72 × 72 with a 16 px radius and a 4 px stroke; inset the check 10 px so its full stroke sits inside; use flat butt caps and a 6 px stroke. Center on the box's optical centre (the check's mass sits right of centre).

**extract_with_repair — 4/10**
- **Biggest issue:** a circular refresh arrow says "retry" or "undo," not "extract with repair"; there is no extraction component at all.
- **Fix:** compose it: a 56 px document/brace glyph on the left, a 2 px loop arrow leaving a repaired chunk and returning into the document on the right, and one solid chunk at full ink. Two parts, one verb.

**multimodal_embed — 6/10**
- **Biggest issue:** the 2 × 2 rings use four different inks and effectively four stroke weights; the top-left black ring is 3× heavier than the bottom-right, and the two dark rings nearly disappear on #C0DCF2.
- **Fix:** one 8 px stroke, 56 px rings, 16 px gaps; inks at 100 / 60 / 40 / 28% (minimum 3:1 against the tile). The four rings are a good family rhyme with the model card; make them read as channels, not four different icons.

**semantic_rank — 3/10**
- **Biggest issue:** it is the same metaphor as `decision_score` (four bars, tallest black) and it also overlaps its caption; the arrow is a fifth element floating in the top-right, unrelated to the bars.
- **Fix:** use an ordered list: three 120 × 12 px rules at 30% ink with 10 px "#1 #2 #3" numerals at the left; the first rule at 100% ink and 2 px thicker, or the same bars with a 20 px "#1" badge. Put the arrow inside the list (pointing down) or remove it. Keep all art above y + 112.

**semantic_similarity — 7/10**
- **Biggest issue:** the two rings overlap, but the black ring carries 2× the optical weight of the grey and the intersection is not shown as a result; it reads as "two circles" more than "similar."
- **Fix:** two 64 px rings, 8 px stroke, 28 px overlap; fill the lens at 100% ink and the rings at 35%; equalize the stroke and align the pair in a 152 px optical box. A small "≈" between them is optional and probably unnecessary.

**semantic_classify — 5/10**
- **Biggest issue:** three staggered pills read as tags, and the stagger is arbitrary; the two grey pills are ~2.2:1 on the mint.
- **Fix:** show sorting rather than tags: three 16 px-tall bars at 35% ink, each captured into a 40 × 24 px slot on the right by a 2 px arrow, or three tags aligned left over three bins. Use one 4 px vertical rail at the left to make the alignment intentional, and lift the secondary ink to ≥4.5:1.

**semantic_deduplicate — 6/10**
- **Biggest issue:** two overlapping rounded squares read "merge/overlap" — the same language as similarity and classify — and the black square swallows the grey one, so no "result" exists.
- **Fix:** show two 56 px squares at 35% and 20% merging into one 56 px square at 100% ink via a 2 px arrow (or one solid square with a dashed duplicate fading out). Make the reduction, not the overlap, the idea.

**dedupe_and_rank — 4/10**
- **Biggest issue:** two bars + an arrow is a stripped-down `semantic_rank`; neither dedupe nor rank is present, and it is the weakest of the three bar tropes.
- **Fix:** two 24 px squares on the left (one grey, offset), a 2 px arrow, then one 24 px square + a 16 px mono "#1" on the right. This is a compound verb; show both halves.

**media_find_moments — 8/10**
- **Biggest issue:** the play triangle + scrubber says "play/timeline," not "find moments"; the three ticks read as plus signs.
- **Fix:** add a 20 px magnifier over one tick, or a 40 px bracket around a single moment; make the ticks 2 × 12 px lines. Keep everything else — this is the clearest icon in the set.

**lang_detect — 6/10**
- **Biggest issue:** "A" over two rules reads as typography/baseline, not detection, and it does not pair with Tongue's identity.
- **Fix:** pair "A" with "文" (or "ñ") at 44 px, one at full ink and one at 45%, and add 12 px corner brackets around the second; or put a magnifier over the A's counter. Tie the palette to Tongue's card.

**stt_transcribe — 7/10**
- **Biggest issue:** a waveform says audio, not speech-to-text; it could equally be play, record or listen.
- **Fix:** resolve the waveform into text — five bars on the left, a 2 px arrow, a 64 × 8 px text rule on the right (or two short rules under the bars). Keep the bar rhythm and the current contrast; this is already one of the stronger marks.

---

## 5. CODE MODE — 5/10

**Biggest issue:** the panel is proportioned around its decoration instead of its evidence. Two ~70 px acid braces occupy the right third and enclose nothing; the code is 9–10 px with no syntax hierarchy; the three trace chips — the only proof that a program ran — are 7 px, dim olive, 80 px below the last code line, and visually unconnected to the calls they time.

**Precise fix:**
- **Delete the giant braces.** They are the loudest element (acid on near-black) and they frame empty field. If the panel needs a "program" signal, use editor chrome instead: a 1 px top rule, a 44 px chrome strip with `program.ts` at 10 px mono and a 6 px acid run dot, and a line-number gutter (`01–04`, 8 px mono, 45% opacity) down the left.
- **Set the code at 12 px / 20 px**, left-aligned in a 56 px column with the gutter. Use syntax as the hierarchy: `const / await / return` in #C9FF4A, identifiers in #E8E4DB, placeholders at 50%, braces neutral. Right now everything is acid, so the eye gets no parse.
- **Move the evidence into the layout:** a right-hand trace lane (40% width), one 28 px row per call aligned to its code line, with a 1 px hairline from the code line to the row: `semantic_rank  44ms`, `decision_choose  38ms`, `structured_extract  61ms` at 10–11 px. Add a total at the bottom: `one trace · 143ms · host-reported` (10 px, 80% ink).
- This removes the 80 px void, raises the evidence from 7 px to 10–11 px, and makes the title's claim ("One program. Three calls.") visible as a structure rather than a slogan.
- The title can drop to **34–36 px** to give the body more room; it is currently the second-largest object in the panel and the braces are the first.

---

## 6. MCP — 4/10

**Biggest issue:** the transport diagram is not connected. Measured at 1:1: the 1 px acid line runs from the host's right edge to x = 995 at y = 1236; a 26 px acid dot sits at x = 996–1021, y = 1210–1236 — i.e. its bottom just touches the line's y and its centre floats **13 px above** the line — and there is an **11 px gap** before the first tool row at x = 1032. None of the three tool rows has a connector to the host, the dot, or each other. "Three exposed" is asserted by the title and the list, not shown by the drawing.

Secondary but visible:
- **The middle row (`decision_score`) has a drop shadow/duplicated edge.** The first and third rows are clean 1 px strokes. Without a legend, the middle row reads as "selected" or "hovered" for no reason. Remove it, or make selection explicit (and then explain it).
- **The host box dominates.** It is ~147 × 71 px with an 8 px label; each tool row is ~182 × 35 px. The host carries about twice the area of an exposed tool, and it is the emptiest large object on the sheet. The subject of the panel is the three exposed tools; the host should be a chip, not a monument.
- **The annotation rail is stray.** "3 exposed / 13 ready / host-reported" at 8 px is aligned to a 1 px vertical rule that starts inside the first row and ends inside the third; it reads as a stray tick. Its contrast is fine (5.16:1); its size and alignment are not.
- **The numbers mix axes.** 3 exposed + 13 ready = 16 is neat, but the grid uses "MCP / EXPOSED" and "READY" as if they were mutually exclusive states. A tool can be ready and exposed; the panel doesn't say which of the 13 "ready" are reachable over MCP, or whether the 3 exposed are ready.

**Precise fix:**
- Build one trunk: host chip's right edge → **8 px acid square port** centred on the trunk at (1002, 1236), labelled `mcp` at 8 px mono, 8 px above the trunk → **three 1 px branches** at x = 1018 to each row's left edge at x = 1032, each ending in a **6 px arrowhead**. A transport diagram needs visible direction and a visible port.
- Replace the dot with the port square (the dot is 26 px, larger than any label; it is the brightest object in the diagram and it means nothing).
- Shrink the host to a 96 × 32 px chip with a 4 px acid stroke and "HOST" at 10 px mono; give the exposed rows the weight.
- Make the three rows identical: 35 px tall, 1 px acid stroke, 0 radius, no shadow, text at 62% ink (≥4.5:1) and 10 px. If a state is wanted, add a 6 px square at the row's right edge with a legend, not a shadow.
- Put the annotations in the right rail (x = 1350), aligned to the three rows: `3 exposed` (acid) / `16 tools` (ink) / `host-reported` (muted) at 9 px, and delete the stray rule. If the 13 number is kept, label it precisely: `13 ready, no MCP` — or, better, fix the status axis (§8) so "ready" and "exposed" aren't competing.
- Add the other side of the transport. A protocol diagram with only one system is a list. Show a **client/agent boundary** on the right (or a second system), a dashed vertical "MCP" boundary at ~62%, and the three tools crossing it. Then the panel shows *exposure*, not just *a host with three tools*.

---

## 7. Do CODE MODE and MCP read as different functionality types?

**No — not without reading them.** Put them side by side and squint: they are the same object. 660 × 300, 21 px inner inset, 7 px mono kicker at the top left, a ~34–36 px off-white title, an acid accent, 7 px mono at the bottom left, and a large empty lower band. The only structural differences are content (a code block vs. a box list) and ground colour (#101012 vs. #1A392B). A reader learns "functionality = dark card," not "code vs. transport." That is the core failure of the brief.

There are two further category problems:

- **They are not peers.** CODE MODE is an execution surface; MCP is a transport protocol. Treating them as two "functionality types" in one parallel layout confuses the axes (how a program runs vs. how tools are exposed). The panel footers reveal the mismatch: CODE MODE's says `ONE TRACE / HOST-REPORTED` (a provenance claim), MCP's says `MCP / THE TRANSPORT` (a category label). The same slot is doing two different jobs.
- **The accent does two jobs.** In CODE MODE, acid covers the entire program and the giant braces — decoration plus syntax, no distinction. In MCP, acid draws the structure (strokes, port, kicker). One colour, two grammars.

**The fix is a design-language split, not a colour swap.** Give each type its own layout grammar, so the difference survives greyscale:

| | CODE MODE | MCP |
|---|---|---|
| **Model** | Runtime (a machine that runs) | Topology (a boundary that exposes) |
| **Grid** | 2 columns: code 60% / trace 40%; horizontal reading, line by line | 3 zones: host system / boundary / client; left-to-right crossing |
| **Lead element** | The program (type), not a shape | The boundary + branches (diagram), not a title |
| **Chrome** | Editor: file tab, line numbers, run dot, hairlines | Protocol: dashed boundary, port, arrowheads, endpoint labels |
| **Type** | 12 px mono, syntax colour, 10 px trace values | 9–10 px schema/labels, 12 px title max |
| **Colour job** | Syntax: acid = keyword, white = identifier, 50% = placeholder | Structure: acid = connection, ink = label, muted = provenance |
| **Proof** | Three timed calls + one trace, connected line-to-row | Three exposed tools crossing the boundary, counted |

And fix the shared chrome so it stops flattening them: use one 10 px kicker treatment (both acid or both muted), one footer semantics (both provenance or both category), and either give both panels the same radius policy or explicitly state "sharp = function type, round = unit" as a rule (it is currently latent: cards 16 px, tiles 12 px, panels 0).

The brace glyph is also overloaded three ways: the CODE MODE hero, the `structured_extract` icon, and (in the product) object syntax. Pick one owner. CODE MODE should own braces; `structured_extract` needs a different mark.

---

## 8. Cross-cutting: spacing, type, hierarchy, colour, consistency

### Spacing & geometry (measured)

- Content spans **x = 44–1408 (1364 px)**. Header marks start at x = 38; section labels at x = 38; the page code ends at x = 1258; the panel row ends at x = 1388; the units end at x = 1408.
- Model cards: 5 × 260 + 4 × 16 = 1364; 340 px tall (140 hero + 200 panel); 15 px inner inset.
- Tool tiles: 8 × 160; **12 px horizontal gutters, 14 px vertical**; 12 px inner inset.
- Panels: 660 × 300; **24 px gutter**; 21 px inner inset; row ends **20 px short** of the units' right edge.
- Section rhythm: rule at y = 221 → 12 px → 7 px label → **19 px** → cards (258). Rule at y = 640 → 11 px → label (651) → **23 px** → tiles (680). Rule at y = 1059 → 12 px → label (1071) → **23 px** → panels (1100). The label-to-content gap changes 19/23/23 for no reason.
- Outer margins: top 35 px, left 38/44, right 32/40/52, bottom 63 px. The page is not inset by one system.

**Fixes:** one gutter system (16 px; then panels = 674 + 16 + 674 = 1364 and the row ends at 1408); tool gutters 12/12 (or 16/16); inner insets 16 (cards) / 12 (tiles) / 24 (panels); section label-to-content gap 20 px; margins 44 left/right, 44 top, 44 bottom (or label the asymmetry as intentional and keep it).

### Type & hierarchy

- The page has display 64 → intro 16 → card 32 → count 24 → subtitle 14 → badge 8 → meta 7 → hash 6. The section label is 7 — the lowest level in the sheet — and the panel body (9 px) is below the card subtitle. The hierarchy is inverted at the two levels that carry navigation and proof.
- Small mono is set with wide tracking, which at 7 px closes the counters (see `EMBEDDING / 05` in the 7× crops: the letters fuse). Keep the tracking for 9–16 px; at 7 px it is a legibility tax with no payoff.
- Use one scale: **64 / 32 / 16 / 14 / 11 / 9**. Nothing below 9 px. The page will still look like the same sheet.

### Colour

- The palette is strong and should be kept: cream #E8E4DB, white #FFFFFF, ink #0A0A0B, muted #6B6B6B, rule #E8E4DB/#CDC9C1, family hues, acid #C9FF4A.
- The failure is **assignment**, not choice: seven hues inside one family, a lilac tool for a purple model, an acid accent shared by two different functions, and a badge system where the state colour is invisible at 2:1.
- Set a rule: each family = one hue + three tints (one for the hero, two for tiles); text ink is always #111/#0A0A0B on tiles; secondary text ≥4.5:1; no hue used for two families.
- The dark panels are good; MCP's #1A392B and CODE's #101012 are close enough to read as one "dark" against the cream. If they are meant to be different types, the difference has to be structural (above), not a 6-point hue shift.

### Consistency (the list I would put on the wall)

1. Three gutters (16 / 12+14 / 24) and four right edges (1408 / 1408 / 1388 / 1258).
2. Three inner insets (15 / 12 / 21).
3. Three radius languages (16 cards / 12 tiles / 0 panels); if deliberate, state it.
4. Panel kicker/footer colour logic inverted between CODE (muted) and MCP (acid).
5. Status axes mixed (READY vs MCP EXPOSED) and Laya tools have no readiness.
6. Duplicate indices (`#01` + `MODEL / 01`).
7. Hash values at 1.84:1 that do not match the fill (Laya fill #3342D0, printed line reads like #4F5DFF). Delete or correct.
8. Tongue/Voz tool hues do not match their cards; Embedding owns seven hues.
9. The brace means code, extraction and object literal in three places.
10. "Family" means model on the tiles and capability in the card subtitle.
11. "FUNCTION" / "FUNCTIONALITY" / "FUNCTIONALITY TYPES" for one idea.
12. One tile (`decision_score` in the MCP diagram) has an unexplained shadow.
13. Icon optical masses range from 48 px to 100 px with 4–10 px strokes.
14. The legend "CARD / ICON / FUNCTION" uses grey squares and a dot that appear nowhere on the sheet; it also floats 15 px above the intro's baseline and 240 px away from the text. Replace it with a real key (white card, saturated tile, dark panel) at 9 px, or delete it.
15. "NOTHING ESTIMATED" is a strong claim for a sheet whose trace times are sample values and whose hashes are unreadable; provenance is asserted at 7 px and contradicted by the evidence. Make the evidence legible before making the claim.

---

## 9. Ranked top-10 changes by expected impact

### 1. Rebuild the type system around a legibility floor
**Change:** set the scale to 64 / 32 / 16 / 14 / 11 / 9; section labels 14–16 px sentence + 10 px mono number; card meta 9 px #6B6B6B (5.3:1); delete the hash or set it at 9 px; tool names 11 px; family/API tags 9 px at ≥4.5:1; statuses 9 px at ≥4.5:1; code 12 px; chips 10 px; footer 9 px; kill every run below 9 px.
**Why first:** it affects >70 runs and every single component; it is the difference between an inventory and a texture. It also fixes the accessibility failure that currently blocks the entire sheet.
**Impact:** the sheet becomes readable at 100% and at 50% zoom; the hierarchy reads in the right order.

### 2. Make family identity structural and chromatic
**Change:** order tools contiguously by family; add 24 px group gaps, a 2 px × 160 px family rule in the family hue, and a 10 px family caption at the start of each run; restrict each family to one hue + three tints; repaint Tongue (#360F47 + #C4B7FA) and Voz (#1F2B39 + #CDD8E8); remove the 7-hue Embedding set. The cleaner version is five family rows with a 136 px left rail.
**Why:** the section's stated promise is "grouped by family," and today neither spacing nor colour groups it. This is the difference between a pile of 16 tiles and an inventory.
**Impact:** all 16 tools; scanning becomes possible without reading the 7 px tags.

### 3. Fix the two collisions and declare an icon safe area
**Change:** 16 px top inset / 96 px icon box ending at y + 112 / 8 px gap / 12 px name / 4 px gap / 10 px status / 18 px bottom. Redraw `decision_score` (4 × 14 px bars, max 64 px, baseline y + 112) and `semantic_rank` (ordered list, same rule). Nothing crosses y + 112.
**Why:** two tiles are objectively broken (artwork over the label), and the rule prevents recurrence in all 16.
**Impact:** 2 visible defects removed; the grid stops feeling handmade.

### 4. Assign a distinct visual verb to every tool
**Change:** break the five-trope repetition: score = gauge/needle; rank = numbered list; dedupe = two→one with an arrow; dedupe_and_rank = two squares → one square + "#1"; classify = sorting into bins; test = check/cross pair; validate = check-in-box only; extract = document/brace + leaving chunk; repair = extract + loop; embed = four rings at one stroke; lang = A/文 + detect brackets. Normalize to a 72 px optical square and an 8 px stroke.
**Why:** 11 of 16 icons reuse five tropes; the grid is only scannable by label today.
**Impact:** the icon set becomes usable at a glance; the labels become confirmation rather than the only channel.

### 5. Rebuild the MCP diagram as a connected transport
**Change:** one 1 px trunk at y = 1236; 8 px port square at x = 1002 labelled `mcp`; three branches to x = 1032 with 6 px arrowheads; remove the 26 px floating dot; shrink the host to a 96 × 32 chip; all three rows identical (35 px, 1 px stroke, no shadow); align the annotations to a real right rail at 9 px; add the client/boundary side.
**Why:** the current drawing literally does not connect, and it is the component that must prove "exposure."
**Impact:** MCP starts reading as a transport rather than a host with a list.

### 6. Re-proportion CODE MODE around the trace
**Change:** delete the giant braces; add editor chrome (file tab, line numbers, run dot); code 12/20 with keyword/identifier/placeholder roles; a right-hand trace lane with one row per call aligned to its line and a total line. Title down to 34–36 px.
**Why:** the evidence is 7 px, the decoration is 70 px, and there is an 80 px void; the panel currently argues the opposite of its point.
**Impact:** the title's claim becomes visible structure; the panel stops wasting a third of its area.

### 7. Split the functionality types by layout, not by hue
**Change:** CODE MODE = runtime (2-column code/trace, editor chrome, syntax colour); MCP = topology (host / boundary / client, dashed protocol line, port, arrows, schema labels). Different grids, different leads, different type sizes, different footer semantics; one kicker treatment.
**Why:** the brief's explicit question; today they are one card with two payloads and would not differ in greyscale.
**Impact:** a reader understands "code mode" vs "MCP" without the labels; the two panels stop being redundant.

### 8. Restore the model card's rhythm and one status axis
**Change:** reserve a 76 px two-line title slot in all five cards; align subtitle/count/badge to the same y; delete the hash and the duplicate `#01`; make the badge readiness on all five ("READY" 9 px or a dot) and put MCP exposure in the freed top-right slot as a 9 px port marker. Embedding's two-line name no longer shifts anything.
**Why:** the row currently has a 12 px break in two elements and two competing state systems. This is the cheapest visible polish in the set.
**Impact:** the model row reads as one system; states become legible and meaningful.

### 9. Give Tongue and Voz capability-specific heroes
**Change:** Tongue = A / 文 letterforms at 96 px on the family purple; Voz = waveform → two text rules in the family blues; Voz's tool tile hue lifted into the same ramp. Rebalance hero ink coverage to 35–45% across all five.
**Why:** two of five cards are semantically empty and two model/tool links are broken; the set's distinctiveness depends on the heroes, because the labels are the weakest text.
**Impact:** the row becomes five readable identities, not two strong ones and three patterns.

### 10. Rationalize the grid, insets and shadow
**Change:** unify gutters at 16 px; panels 674 + 16 + 674 = 1364 so the function row shares the units' right edge; tool gutters 12/12 (or 16/16); insets 16 (cards) / 12 (tiles) / 24 (panels); section label-to-content gap 20 px; replace the wide card shadow with a 1px/2px lift; align the section labels to the content edge or the header to 38, not both; fix the 14 px vertical tool gutter.
**Why:** the eye sees three rhythms and four right edges; the current shadow hazes the cream (gutters #DCD8CF, a 40 px band under the cards). These are the cues that separate "designed" from "assembled."
**Impact:** the whole sheet tightens; every section aligns to one grid.

---

## 10. Accessibility checklist

| Check | Status | Evidence / fix |
|---|---|---|
| All text ≥4.5:1 | **Fail** | 16/16 statuses 1.97–2.32; 16/16 family tags 1.76–3.70; 4/16 captions 3.42–4.13; model meta 2.17; hash 1.84; section labels 3.06. |
| Text size floor | **Fail** | >70 runs at 6–8 px; code 9–10 px; chips 7 px. Target ≥9 px meta, ≥12 px code. |
| Type hierarchy | **Fail** | Section labels (7 px) are the smallest type on the sheet; no mid-level heading between 64 px and 7 px. |
| Colour not the only carrier | **Fail** | Family identity is carried by hue + a 7 px tag at ~2:1. Add a family rule/position and a legible caption. |
| Icons have text labels | Pass structurally | Every tile has a caption; but the caption is 8 px. Raise to 11 px. |
| Non-text contrast | **Fail** | Several meaningful tints sit at ~1.6–2.5:1 against their tiles (pills on coral, grey on lilac); raise to ≥3:1. |
| Diagram has a text equivalent | **Fail** | MCP is a visual-only diagram with 8 px labels; add a caption line ("host exposes 3 of 16 tools over MCP; 13 ready") and a non-visual summary. |
| Focus/hover/selected states | Missing | One tile has an unexplained shadow; no state system is shown. A component inventory should show at least default / hover / exposed / disabled. |
| Motion sensitivity | N/A | Static artifact. |
| Semantic names | **Fail (copy)** | `semantic_deduplicate` and `dedupe_and_rank` both visible, both ambiguous; the human name should lead at 11 px, id second at 9 px. |

**A note on "NOTHING ESTIMATED":** the claim is good editorial discipline, but the timings are sample values and the hexes are unreadable. Either make them verifiable (readable hexes, a real trace citation) or drop the claim.

---

## 11. Measured reference

**Geometry (1:1 export, 1440 × 1520)**

| Item | Measurement |
|---|---|
| Content column | x = 44 → 1408 (1364 px) |
| Model cards | 5 × 260, gap 16, y = 258–598; hero 140, panel 200; inset 15 |
| Tool tiles | 8 × 160; horizontal gap 12, vertical gap 14; rows y = 680–839, 854–1013; inset 12 |
| Functionality panels | 660 × 300 each; x = 44–704, 728–1388; gap 24; y = 1100–1399; inset 21 |
| Section rules | y = 221, ~640, 1059; 7 px labels at 233, 651, 1071 |
| Footer | 7 px at y ≈ 1451; content bottom 1520 |
| Card shadow | gutters #DCD8CF vs. page #E8E4DB; a ~40 px band beneath the card row |
| MCP connector | line y = 1236, x ends 995; dot 996–1021 × 1210–1236; first row at x = 1032 |
| MCP rows | ~182 × 35; host ~147 × 71 |

**Contrast (measured / calculated)**

| Sample | Ratio |
|---|---|
| Section label on cream (#83817D / #E8E4DB) | 3.06 |
| Model meta on white (rendered #B0B0B0) | 2.17 |
| Model meta token #9A9A9A on white | 2.85 |
| Model hash on white (#BFBFBF) | 1.84 |
| Tool status on its tile | 1.97–2.32 |
| Tool family tag on its tile | 1.76–3.70 |
| Tool caption on its tile | 3.42–8.56 (4 fail) |
| Intro on cream (#63615F) | 4.86 |
| Code on #101012 (#C8EF65) | 14.47 |
| MCP annotation on #1A392B (#A1A89B) | 5.16 |
| Acid on MCP green (#C9FF4A / #1A392B) | 10.75 |

**Tile colours by family**

- Laya: #ED7445 / #F09071 / #ECB9CF
- Needle: #80B59F / #AAD7C2 / #CCEADE / #639D87
- Embedding: #C0DCF2 / #94A6F9 / #92CFC4 / #C4B7FA / #A6CFFB / #4F9B8F / #CDD8E8
- Tongue: #C4B7FA
- Voz: #CDD8E8

---

## 12. Sign-off criteria

A round-2 sheet passes when:

1. No text is below 9 px; no text is below 4.5:1 on its ground; the code is ≥12 px.
2. The 16 tools are visibly grouped in 3 / 4 / 7 / 1 / 1 runs with one hue per family and a legible family caption.
3. No icon touches its caption; all icons share one optical box and one stroke.
4. At least 12 of the 16 icons are distinguishable at 160 px without their labels.
5. CODE MODE and MCP are distinguishable in greyscale, at thumbnail size, with the labels hidden.
6. The MCP diagram has a connected host → port → three rows path with a visible direction.
7. All five model cards share one y for subtitle, count and badge; one status axis; no duplicate index; no unreadable hash.
8. One gutter, one inset system, one radius rule (stated if intentional), and a shadow that does not haze the cream.
9. The footer's claims are backed by legible evidence, or the claims are removed.

**The sheet is close.** Most of the work is not new art: it is 9 px instead of 7, 12 px instead of 9, a 24 px gap instead of 12, three branches instead of a floating dot, and two panels that are allowed to have different bones.
