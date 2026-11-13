# Component inventory — product design review, round 1

**Reviewer role:** product design systems lead
**Subject:** the "tool mode" component inventory sheet (1440 × 1520)
**Scope:** 5 model cards, 16 tool icons, CODE MODE, MCP
**Method:** every judgement below is measured on the 1:1 crops (overview.png 1440×1520, models-row.png 1364×340, tools-grid.png 1364×334, function-code.png 660×300, function-mcp.png 660×300, 16 tiles at 160×160). "Type size" means glyph-band / cap height read from pixels, not a guess. Contrast is computed from sampled pixels. Tolerance ±1px.

---

## Verdict

**Overall: 4 / 10** — aesthetic direction **7 / 10**, system and legibility **3 / 10**.

This is a handsome, confident, editorial-looking sheet that inverts its own information hierarchy. The parts that are decorative are loud: 46%-height colour covers, 80px-tall lime braces, 16 saturated tiles. The parts a builder actually needs are whispered: tool names at **6px**, states at **5px**, the only hex values at **6px** and **1.8:1** contrast. A reader gets the *mood* of the system in two seconds and cannot get the *spec* in two minutes.

The sheet reads as a **showcase**, not an **inventory**. An engineer can rebuild the picture from it; they cannot build the system from it. Six decisions the components depend on are never stated on the sheet (see section 5).

**Grade distribution:** 5 model cards 4 / 6 / 5 / 4 / 4 — 16 tool icons 2–6 (mean 3.7) — CODE MODE 5 — MCP 4.

---

## 1. What is genuinely working (keep it)

1. **Palette discipline of the page.** Warm canvas #E8E4DB, pure white card faces, one near-black ink, exactly one accent lime #D4FD6A. No shadows, no gradients, 1px rules. It looks expensive because it is restrained.
2. **The claim copy is the best thing on the sheet.** "One program. Three calls." / "Three exposed." / "host-reported" / "nothing estimated" — terse, specific, no marketing. Keep this voice everywhere.
3. **The tool names are the real API names** (decision_choose, structured_extract, media_find_moments). That is the single most builder-respectful decision here.
4. **The page architecture is legible at a glance:** H1, three numbered sections, a tally footer. Section numbering, hairline rules and running heads all land in the same 40px margin.
5. **The conceptual model of MCP is right:** host in the middle, three tools exposed, "host-mediated" as the qualifier. Few sheets get that.
6. **Density.** 23 units on one screen without crowding — that is hard and mostly achieved.

---

## 2. The six systemic defects

These repeat across components, so they are graded once here and referenced (not re-litigated) in the per-component table.

### S1 — The sheet names containers, not units

Three things (model, tool, surface) have **five names**: "MODEL CARDS" / "UNITS" / "CARD"; "TOOL ICONS" / "UNITS" / "ICON"; "FUNCTIONALITY" / "TYPES" / "FUNCTION". The section-3 subhead is a negative definition only: **"2 TYPES / NOT CARDS OR ICONS"**. Section 01 says "5 UNITS / ONE PER FAMILY", which is circular — each model *is* a family.

A builder needs the noun to be stable, because it becomes the component name in code:

| now | should be | why |
|---|---|---|
| MODEL CARDS / UNITS / CARD | **Model** | the unit is a model; the card is one presentation of it |
| TOOL ICONS / UNITS / ICON | **Tool** | the icon is a property of the tool, not the unit |
| FUNCTIONALITY / TYPES / FUNCTION | **Surface** | Code Mode and MCP are call surfaces, not component types |

Also: **"MCP / THE TRANSPORT"** is wrong. MCP is an application protocol; the transport is stdio or streamable HTTP. On a sheet whose whole job is precision, that will mislead the first engineer who reads it. Rename to **"MCP / THE INTERFACE"** or **"MCP SERVER / 3 OF 16 TOOLS"**.

### S2 — The one cross-cutting fact is hidden inside the status slot

The sheet's entire value proposition is *which tools are reachable how*. That fact exists — but it is encoded **as a status**, so it silently deletes another status:

- 3 of 16 tiles say **MCP EXPOSED**, the other 13 say **READY**. A reader therefore concludes Laya's tools are *not ready*.
- Laya's model card says **MCP EXPOSED** where the other four say **READY** — so Laya's readiness is the one thing on the row you cannot read.
- The MCP card then says **"3 exposed / 13 ready / host-mediated"**, using "ready" for *not exposed*, while all 16 tiles use "READY" for *available*. The same word now means two things, and the two statements contradict each other.

Fix — the highest-value information-architecture change on the sheet: the slot holds **two independent chips**, always both present.

    [ READY ]   [ MCP ]          or          [ READY ]   [ LOCAL ]

Model cards: READY + MCP 3/3 (Laya), READY + LOCAL (the rest). Tiles: the 3 show MCP, the 13 show LOCAL. MCP rail: **"3 of 16 exposed"**, never "13 ready".

### S3 — Micro-type: the most important strings are the smallest, and fail contrast

Measured on the crops:

| element | size | contrast | verdict |
|---|---|---|---|
| tile status "READY" | **5px** | **1.97–2.21:1** (darkest pixel, on #ED7445 / #C4B7FA / #4F9B8F) | not readable; not AA |
| tile tool name | **6px** | 3.4–4.7:1 — at 6px the strokes never reach full ink, so it renders as a blend | fails AA |
| tile family label | **6px** | same | fails |
| card eyebrow "MODEL / 04" | **7px** | **2.17:1** | fails |
| card hex footer | **6px** | **1.84:1** | unreadable |
| card chip label | **6px** | 11:1 (contrast fine, size not) | unreadable |
| card descriptor | **11px** | 4.48:1 | borderline fail |
| card name | 27px | — | fine |
| code block | 11px / 13 leading | — | fine |

So the only text at a comfortable size on a tool tile is **nothing**. The three tiers of information on a tile (family / name / state) are all set at the same 5–6px, in the same mono, in the same colour: **there is no hierarchy where hierarchy matters most**.

Fix (a hard floor, applied sheet-wide): **no text below 9px; meta text 9px; tool names 12px; body 13px; family and eyebrows 9px with 0.08em tracking; card descriptor 12px at #5F5F5C (at least 4.5:1)**. If a 160px tile cannot hold a 12px name, the tile is too small — make it 180px, not the name 6px.

### S4 — Colour encodes fill, not family

The sheet *looks* systematic; the colour logic is not. Measured tile fills:

- **Embedding's 7 tools span at least four hues**: #C0DCF2 pale blue, #94A6F9 periwinkle, #B0D7FB sky, #92CFC4 mint-teal, #C4B7FA lavender, #A6CFFB sky, #4F9B8F teal. Needle's 4 tiles are all greens. So one family is a tint ramp and another is a rainbow.
- **#C4B7FA is used twice across families** — semantic_deduplicate (Embedding) and lang_detect (Tongue) are the same colour. Two families, one swatch.
- **The MCP card background #1A392B is exactly Needle's cover colour.** Green already means Needle twice on the sheet; in section 3 it means "MCP".
- **Laya's card is periwinkle #8C8CF7 / blue #3342D0; its three tool tiles are orange #ED7445, coral #F09071, pink #ECB9CF.** The one model whose card colour does not predict its tools at all — and its unlabeled hex footer (#4F3DFF) matches the *card*, not the tools.

Fix: **one hue per family, three tints per hue, no hue reuse across families, and section 3 gets its own neutral.** Concretely — Laya #ED7445 (tints #F09071, #ECB9CF, #FBE3D9); Needle #4E8F76 (tints #80B59F, #AAD7C2, #CCEADE); Embedding #3B5BE0 (tints #94A6F9, #B0D7FB, #DDE6FD); Tongue #8B5CF6 (tints #C4B7FA, #E6DEFD); Voz #3E5B7D (tints #8FA9C6, #CDD8E8). CODE MODE #101012; MCP #101012 too, differentiated by copy, not by stealing a family colour.

### S5 — No icon grid, no ink rule, and two icons are drawn on top of their own captions

Optical sizes (bounding box on a 160px tile) range from **28 × 62** to **114 × 90** — a 4× spread with no common canvas:

    tools_plan            88 × 21     (a line of type, not a glyph)
    structured_extract    28 × 62     (a single brace — the emptiest tile on the sheet)
    extract_with_repair   41 × 37     (smallest mark in the grid)
    dedupe_and_rank      113 × 90     (largest mark in the grid)

Ink is inconsistent: some icons are 100% black (media_find_moments, stt_transcribe), some are black plus a 40% tint of their fill (decision_choose, dedupe_and_rank), some are black plus a complementary hue (decision_score has a brick bar, semantic_similarity has a blue ring, lang_detect has a lavender underline). No rule, so no icon looks like it belongs to the same set.

**The hard defect:** on decision_score and semantic_rank the bar chart is drawn **through the tool name**. The caption is literally illegible — "semantic_rank" reads as a smear under four bars. The icon reaches y=121 while the caption band is y=127–131, and the bars are composited above the text. Two of sixteen units have no readable name. That is the cheapest, highest-value fix on the sheet.

Fix: reserve a caption zone (icon box 72×72 centred at y=64, caption band y at least 112, 1px divider at y=108), clamp every glyph into the box, one ink (#0A0A0B at 100% — use weight, not tint, for a second object), 8px stroke on a 48px grid, 4px corner radius to match the tile.

### S6 — No layout anchors

- **Model cards:** the meta block floats under the name. "Embedding Gemma 2" wraps to two lines, so its descriptor / count / chip all sit **26–30px lower** than the other four. Only the chip is bottom-anchored; nothing else is.
- **Tool tiles:** family, name and status are three independent left-aligned strings with no shared rhythm (y=12 / 127 / 144), and the icon is centred 12px above the tile's optical centre.
- **The functionality pair does not share one geometry**, which is fatal for a two-up:
  - the connector line sits at **y=137**; the junction dot's centre is **(286, 116)** — **21px off its own line**, so the dot floats, and it is off the rows' axis as well (rows span y 90–241, centre 165);
  - the right-hand rail rule runs **y 110–191** while the rows run **y 90–241** — it visually braces only 2 of the 3 tools;
  - the host box is **y 98–173** (centre 135) against a row group centred at 165 — the box rides 30px high;
  - CODE MODE has a **79px dead band** (y 149 to 228) between the code block and the trace chips: 26% of the card is empty while its evidence sits at 7px;
  - the same footer slot is muted grey on CODE MODE and lime on MCP. Same role, two colours.

---

## 3. Component grades

Scale: 10 = a builder could ship it as-is; 7 = good with a documented gap; 5 = the idea reads but the craft needs a pass; 3 = miscommunicates; 1 = absent. Icon scores weight glyph clarity (60%) and tile craft (40%); the shared S3/S5 tile craft caps any icon at 8.

### 3.1 Model cards — 5 units

| # | Component | Score | The single biggest visual issue | The precise fix |
|---|---|---|---|---|
| 1 | **Laya** | **4** | Its status slot says "MCP EXPOSED" *instead of* "READY", so the row's only model with a special surface is also the only one whose readiness is unreadable — and its card hue (periwinkle/blue) contradicts its three orange tool tiles. | Two chips: READY plus MCP 3/3. Recolour the cover field to the family accent #ED7445 with the bar stack in tints of it (#F09071, #ECB9CF), so card to tiles is one hue. |
| 2 | **Needle** | **6** | Good cover idea (bars + brace) but the "{" is floated to the far right at about 40px cap against 90px bars, so it reads as a stray glyph rather than "structure". | Recompose the cover as a left-to-right transformation: 4 bars, then one brace at 56px cap, on the same optical baseline, 24px apart, one ink, family tints only. |
| 3 | **Embedding Gemma 2** | **5** | The two-line name pushes its meta block 26–30px below the other four cards, so the row has no scan line; and the leading is so tight that the descender of "g" nearly touches the "G" below. | Pin the meta block to the card bottom (grid-template-rows: auto 1fr auto), name top-aligned, descriptor + count + chips bottom-aligned; all five cards then share four baselines regardless of name length. Name leading 1.05, tracking −0.01em (currently about 0.95 / −0.03em). |
| 4 | **Tongue** | **4** | **"1 TOOL" is set at numeral size (17px cap) while every other card sets the unit at 6px.** One component, two type treatments, side by side in the same row — the most visible craft error on the sheet. | Render count and unit as two spans with fixed styles: numeral 22px/700, unit 9px/500 uppercase 0.08em, optically centred on the numeral's cap, 6px gap, tabular-nums, fixed 1ch numeral slot. Pluralise by count, never by string. |
| 5 | **Voz** | **4** | Same "1 TOOL" divergence, plus the emptiest cover on the sheet (two rounded rects on near-black) that communicates nothing about speech to text — the one model where the meaning is obvious and free. | Reuse the waveform vocabulary already proven on its stt_transcribe tile, in the family tint, and cut the cover from 155px to **100px (29%)**. Its descriptor "speech → text" is the clearest on the sheet — promote that treatment to all five. |

**Template issues that cap all five** (fix once, in the card component):

- **The cover is 46% of the card (155 / 340) and carries zero information.** It is the largest block of pixels and the least load-bearing. Either make it encode something (a capability strip, the tool-count rhythm, the family glyph) or cut it to about 100px and give the reclaimed 55px to the meta block.
- **Redundant corner mark.** "MODEL / 04" top-left and an "#04" top-right — the same index twice, and the "#" prefix primes the reader for a hex that then appears, unlabeled, 150px below at 1.84:1. Delete the corner mark; keep one index.
- **The unlabeled hex footer** is the only token-like datum on the card: 6px, 1.84:1, and ambiguous (cover colour? accent? model token? — for Laya it is none of its tools). Label it and pair it with a swatch: ACCENT with the hex at 9px in ink-3, right-aligned in the meta row.
- **Descriptors are inconsistent grammar and mostly categories, not capabilities**: "decision family" (a category), "structured extraction", "multimodal embeddings", "language ID", "speech → text" (a mapping). Use one verb-led pattern: choose / score / test — extract / validate / repair — embed / rank / classify / dedupe — identify language — transcribe speech.
- **About 50% of each card body's width is empty.** Put currency there: count right-aligned on the descriptor row, hex right-aligned on the chip row.
- The chip is 6px type in a 20px pill; it needs 9px type in 24px.

### 3.2 Tool icons — 16 units

| # | Tool | Score | The single biggest visual issue | The precise fix |
|---|---|---|---|---|
| 1 | decision_choose | **4** | Three stacked pills with the middle one darker reads as a **menu / hamburger**, or as text emphasis — not "choose one of N". The two-tone (orange + black) is the only meaning-carrier and it is accidental. | Show the act, not the list: three 12px rings in a column with the middle one filled, or a single fork where one line splits and one branch is taken. One ink. |
| 2 | decision_score | **2** | **The bars are drawn through the tool name** — "decision_score" is illegible. Secondary: the four bars share no baseline, so it reads as a broken chart rather than a score. | Clamp the icon to the 72px box (bars end at y of 100 or less), caption band at y 112 or below. Rebuild as a 5-step ascending ramp on one baseline, with the top step marked by shape, not tint. |
| 3 | decision_test | **4** | A giant **checkmark** is a *result*, not an action — it reads "passed/done", which is exactly the semantics already used by the tile's own status. The most generic Laya verb gets the loudest glyph. | Use a **criterion** metaphor: a 1px rule with a dot above and below it (a threshold), or a beaker. Save the tick for status, and never use one inside an icon. |
| 4 | tools_plan | **3** | The "icon" is **the string "1·2·3"** — a caption, not a glyph. It is also the flattest mark in the set (88 × 21) and the only one that cannot be redrawn at 24px. | Three 14px numbered squares on a stepped path, or a 3-node path with an arrowhead — something that survives a 24px raster and reads "sequence". |
| 5 | structured_extract | **4** | A lone "{" — the emptiest tile on the sheet (28 × 62 of 160px) and it now means two things on the page, because section 3's CODE MODE hero uses the same brace at 80px. | Draw the extraction: a 3-line block on the left, an arrow, a bracket shape on the right. Reserve literal braces for the CODE MODE card exclusively. |
| 6 | validate_record | **5** | The tick **crosses its own frame** — the check's tail escapes the rounded square at bottom-left. Legible as "validated doc", but it reads as sloppy. | Keep the doc plus tick; inset the tick 8px inside the frame; frame 48×56, tick 24×18, both 8px stroke, one ink. |
| 7 | extract_with_repair | **3** | A **circular refresh arrow** is the universal "retry/sync" glyph. It says the opposite of "repair" (it says: run it again). | A page with a corrected line — one struck line plus one replacement line — or a wrench/patch. If an arrow stays, pair it with a patch shape so it reads "fix", not "again". |
| 8 | multimodal_embed | **3** | Four rings in a 2×2 grid read as **apps / a dot grid**, and the two-tone (black, black, blue, blue) implies two categories that do not exist. Nothing signals *modalities*. | Three modality swatches entering one axis: a 16px text block, a 16px frame, a 16px waveform, converging on one dashed line. |
| 9 | semantic_rank | **2** | **The bars are drawn through the tool name** — "semantic_rank" is illegible. The bars themselves are fine and would be the second-best icon in the set. | Same clamp as decision_score; then differentiate the two bar icons by *direction*, not tint — score is an ascending ramp, rank is a ramp plus an arrow. |
| 10 | semantic_similarity | **6** | The clearest icon in the set — but it uses a black ring plus a **blue** ring, so the second object is distinguished by hue, the one mechanism an icon system cannot rely on. | Same two rings, same ink; separate them by weight and overlap mask (one 8px, one 6px, knock out the intersection). Treat this as the reference standard for the other 15. |
| 11 | semantic_classify | **3** | Three pills in a staircase read as **list / sort / order** — the same vocabulary as decision_choose and dedupe_and_rank. Nothing says "into categories". | 4 dots entering 2 bins (2 + 2), or 3 shapes snapping into 2 brackets. This is the only "grouping" mechanic in the set — use it once. |
| 12 | semantic_deduplicate | **3** | Two overlapping squares reads as **"duplicate" / "copy"** — literally the opposite of the tool. The offset-overlap mechanism is already used by semantic_similarity. | A stack of 3 offset copies collapsing to 1 solid square. Show 3 becomes 1. |
| 13 | dedupe_and_rank | **3** | Two bars plus an arrow reads as "compare, then next" and is nearly identical to semantic_rank's ramp+arrow, for a tool that is dedupe *and* rank. | Compose the two mechanics: a 3-to-1 collapse, then an ascending ramp. It is the one place a compound glyph is justified. |
| 14 | media_find_moments | **6** | Clear (play plus timeline with tick marks) but the solid black triangle is the heaviest mass in the grid, so it pulls the eye away from the reading order. | Outline the triangle (8px stroke) or reduce to 44px; keep the tick-marked rail. This and stt_transcribe are the two icons identifiable without a caption — use them as the benchmark for the other 14. |
| 15 | lang_detect | **2** | A capital **"A" over an underline** is the universal mark for **typeface / spelling / text**, not language. Together with tools_plan it makes two of sixteen "icons" be typography, which breaks the set. | An "A" plus a second script (A / 文) at the same size, 8px apart, or a globe with a glyph inside. If a letter appears, pair it with a different script so the *act* is visible. |
| 16 | stt_transcribe | **6** | The waveform is instantly readable — but it shares the bar vocabulary of decision_score, semantic_rank and dedupe_and_rank, so at 24px four tiles look alike. | Keep the waveform and make it the *only* symmetric bar glyph: 9 bars, round caps, 3px, mirrored, no baseline. Every data icon must then be asymmetric (ramp or arrow). |

**Tile craft (shared, caps the group):**

- **Caption band** y 112–152, name 12px/600, status 9px. Currently 5–6px with three flat tiers.
- **Gutter 12 to 16px** to match the model cards. At 12px, adjacent same-hue tiles (NEEDLE 02+03, EMBEDDING 03+04) fuse into single 330px blocks.
- **The tile's top-left family label duplicates the group.** If you group by family (headers or a hue spine), per-tile "EMBEDDING / 04" is redundant; if you keep it, drop "GROUPED BY FAMILY" from the section head, because the 8-column wrap splits Embedding across two rows and the claim is not visible.
- The icon sits 12px above the tile's centre; centre it in the space *above* the caption band instead.

### 3.3 Functionality

| Component | Score | The single biggest visual issue | The precise fix |
|---|---|---|---|
| **CODE MODE** | **5** | The card's **evidence is its smallest element**. "One program. Three calls." is proven by the trace chips (semantic_rank 44ms and two more) and they are 7px, muted, and marooned at the bottom past a **79px dead band** — while two 80px lime braces that enclose nothing (90px of void between them) out-shout everything. | Delete or demote the braces; move the trace **directly under the code block** (y about 172, 24px below), so claim to proof is one vertical read; raise the chips to 9px mono with 12×10 padding and a border at rgba(212,253,106,0.35). If the braces stay, make them *enclose* the code block (a pair at 1.4× its height, 60% opacity) so the glyph does structural work instead of decoration. |
| **MCP** | **4** | The diagram's **connector and junction do not meet**: the line ends at (279, 137) and the dot centre is (286, 116) — 21px apart — so the dot floats above the end of its own line. Then the rail rule braces only 2 of the 3 rows, and the host box rides 30px above the group it serves. | Draw a proper distribution: a vertical trunk at x=290 spanning y 90–241, three 20px stubs into each row's left edge, a junction dot at (290, 165) — the group centre. Centre the host box on the group (y 127–203). Make the rail rule span exactly 90–241 and align its 3 lines to the row centres (112 / 165 / 219). Right padding 90 to 40 to match the left card's gutter. |

**Both cards, as a pair:**

- They do not share a background system: CODE MODE #101012, MCP #1A392B (= Needle). Pick one dark surface for the pair (#101012) and let copy and the lime carry the difference.
- The **footer slot uses two colours**: muted on CODE MODE, lime on MCP. One role, one colour.
- The **eyebrow system is also two systems**: lime "FUNCTIONALITY / CODE MODE" but off-white "THE HOST"; lime "MCP / THE TRANSPORT" but muted "ONE TRACE / HOST-REPORTED". Decide: lime = section index only, muted = provenance only.
- **"13 ready" is a state lie** in the MCP rail (see S2). Replace with "3 of 16 exposed" / "13 not exposed" / "host-mediated", and give the numbers hierarchy: value 16px/700, label 9px.
- **Provenance risk:** 44ms / 38ms / 61ms reads as measured data, but the footer claims **"NOTHING ESTIMATED"**. If those numbers are illustrative, the sheet is making a false claim — the one thing a spec sheet cannot do. Either wire a real trace or label the chips "sample" and change the footer to something provable.

---

## 4. Grade table (all 23)

| Component | Score |
|---|---|
| Laya | 4 |
| Needle | 6 |
| Embedding Gemma 2 | 5 |
| Tongue | 4 |
| Voz | 4 |
| decision_choose | 4 |
| decision_score | 2 |
| decision_test | 4 |
| tools_plan | 3 |
| structured_extract | 4 |
| validate_record | 5 |
| extract_with_repair | 3 |
| multimodal_embed | 3 |
| semantic_rank | 2 |
| semantic_similarity | 6 |
| semantic_classify | 3 |
| semantic_deduplicate | 3 |
| dedupe_and_rank | 3 |
| media_find_moments | 6 |
| lang_detect | 2 |
| stt_transcribe | 6 |
| CODE MODE | 5 |
| MCP | 4 |
| **Sheet** | **4** |

Mean of the 23: **3.9**. Only 4 of 23 units score above 5; 9 score 3 or below.

---

## 5. Could an engineer build from this sheet?

**Not alone.** From the sheet you can build a *visual approximation* of these components in about two hours. You cannot build the *system*, because six decisions are absent and the components are internally inconsistent without them:

1. **No units.** Nothing on the sheet carries a size, padding, radius or type token. The only numeric-looking data is a 6px hex at 1.84:1. Every number in this review had to be reverse-engineered from pixels.
2. **No states.** One state per unit ("ready"); no default, hover, focus, disabled, loading or error, no empty state, no count above 9.
3. **No surface mapping.** Which of the 16 tools are MCP-callable — the product's core distinction — is inferable only by noticing that 3 tiles' status word happens to differ.
4. **No per-tool signature.** For 16 tools the sheet gives a name and a picture. An *inventory* needs one line of input to output per tool (text array to ids), or it is a poster.
5. **No icon asset rules.** Stroke, grid, corner radius, optical size, ink, minimum size (24px), safe area, export format. Without them the icons will be redrawn by whoever builds them and the set will drift on day one.
6. **No provenance or licence.** Five third-party models (Gemma-family among them) with no licence or source line, and latency figures with no source. For a sheet that says "nothing estimated", provenance is the one field that must exist.

Also missing: responsive or wrap behaviour at 8 columns, accessible names for the icons, contrast requirements, a naming convention for ids, and any statement of what the *card* is for versus the *tool tile* — they currently overlap in function, since both show a state, both show a count, and both show a family.

**The sheet is a portfolio piece. Make it a spec by adding one column, not one page:** a 240px right-hand column per section carrying size / padding / radius / type / states / surface. That single addition moves this from 4 to 8.

### Proposed spec the builder can ship from (derived from what is already there)

| Token | Value | Used for |
|---|---|---|
| canvas | #E8E4DB | page |
| surface | #FFFFFF | card bodies, tiles |
| ink | #0A0A0B | names, icons |
| ink-2 | #5F5F5C (4.9:1) | descriptors (replaces #777777 at 4.48) |
| ink-3 | #6B6B68 (at least 4.5:1 on white; do **not** use on fills) | eyebrows |
| rule | #D9D5CC | hairlines |
| accent | #D4FD6A | section 3 only |
| dark | #101012 | both functionality cards |
| radius | card 12 / tile 8 / chip 999 / icon 4 | — |
| spacing | 4 · 8 · 12 · 16 · 24 · 32 · 40 | 16 = component gutter, 40 = page margin |
| type display | 48 / 0.98 / −0.02em | H1 |
| type h2 | 36 / 1.0 / −0.02em | functionality claims |
| type name | 27 / 1.05 / −0.01em | model names |
| type body | 13 / 1.5 | general |
| type meta | **9 minimum** / 0.06em / uppercase | eyebrows, status, labels on **white only** |
| type mono | 11 / 13 | code |
| contrast | at least 4.5:1 for text; at least 3:1 for icons on fills | — |

Note the one structural consequence: **status text cannot live on a saturated fill at 9px and pass AA.** Move the status out of the colour field — onto the tile's white caption band, or into a white 20px footer strip. That single move fixes S3 and S5's contrast problem at once.

---

## 6. Ranked top 10 — by expected impact

| # | Change | Why it is this high | Impact | Effort |
|---|---|---|---|---|
| **1** | **Raise the sheet's type floor: nothing below 9px; tool name 12px; card meta 9px; status moves onto a white band.** | All 16 tool names are 6px, five card meta blocks are 5–6px, and both function cards put their evidence at 6–7px. This is the one change that touches nearly every unit and converts the sheet from "look at" to "read". | 5/5 | M |
| **2** | **Split the status slot: READY (state) plus MCP / LOCAL (surface), both always present, on all 5 cards and all 16 tiles.** | Fixes a false state model that currently appears on 19 units and contradicts the MCP card. This is correctness, not taste. | 5/5 | S |
| **3** | **Clamp icons to a 72px box, reserve the caption band, re-export the 2 icons drawn through their captions.** | Two units are literally unreadable and all 16 are optically inconsistent (28 to 114px). Cheapest fix with a visible result on first pass. | 4.5/5 | S |
| **4** | **Make colour mean family:** one hue plus three tints per model, no cross-family reuse, section 3 gets its own neutral; recolour Laya's cover to its own hue; move MCP off #1A392B. | Today colour is decorative; a reader cannot learn the 5 families from it, and one swatch serves two families. This is what makes 16 tiles navigable. | 4.5/5 | M |
| **5** | **Unify the count treatment and bottom-anchor the card meta block.** | "1 TOOL" versus "3 TOOLS" is the most visible inconsistency in the sheet; the un-anchored meta block breaks the row's scan line on 1 of 5 cards and will break it on the next 5. | 4/5 | S |
| **6** | **Rebuild the six misreadable icons** (decision_choose, decision_test, semantic_classify, semantic_deduplicate, lang_detect, extract_with_repair) and give the set one ink and one 48px grid. | Six of sixteen glyphs communicate the wrong act — dedupe reads as copy, repair reads as refresh, language reads as typography. Recognisability is the deliverable. | 4/5 | L |
| **7** | **Recompose CODE MODE:** delete the empty braces, move the trace under the code, raise the chips to 9px. | The card's only proof is its smallest element, past a 79px hole. The claim is excellent and currently unsupported by the layout. | 3.5/5 | S |
| **8** | **Fix the MCP diagram geometry:** junction on the trunk at (290, 165), trunk spanning 90–241, three stubs, host box centred, rail spanning the rows, right padding 40. | A diagram with a floating dot and a rule that braces 2 of 3 items teaches the wrong structure — and it is the sheet's only diagram. | 3.5/5 | M |
| **9** | **One vocabulary pass:** Model / Tool / Surface; delete "2 TYPES / NOT CARDS OR ICONS" and the dead legend; "THE TRANSPORT" becomes "THE INTERFACE"; "13 ready" becomes "3 of 16 exposed"; resolve folio "16" against "16 TOOLS"; verb-led descriptors. | These are the strings an engineer copies into code and a PM copies into a doc. Cheap, and they compound. | 3.5/5 | S |
| **10** | **Cut the covers from 46% to 29%** and spend the space on the meta block (count right-aligned, labeled hex chip, two chips). | Removes the sheet's largest zero-information block and fixes the card's half-empty right column in the same move. | 2.5/5 | M |

Deliberately *not* in the top 10 (do them, but they do not move the needle yet): shadow polish, hover states, the duplicated running head at top and bottom, the 12-versus-16px gutter delta. Those are what you fix after 1–10, and only after the type floor exists — otherwise you are polishing a 6px label.

---

## 7. Acceptance checks (how you will know round 2 is done)

1. **Type:** no text node below 9px. Tool names at least 12px. Card meta at least 9px. Measure bands; do not eyeball.
2. **Contrast:** every text/fill pair at least 4.5:1; every icon/fill pair at least 3:1 — especially the three "MCP EXPOSED" tiles and all five status labels.
3. **Collision:** zero bounding-box intersections between an icon and its caption across all 16 tiles.
4. **Alignment:** all 5 model cards share four baselines (name, descriptor, count, chip) within ±1px, regardless of name length.
5. **Colour:** each family uses 3 hues or fewer; no fill is used by two families; section-3 backgrounds are not a family colour; Laya's cover hue belongs to its tiles' hue family.
6. **State:** READY on 5/5 cards and 16/16 tiles; a surface tag on 5/5 and 16/16; no string says "ready" while meaning "not exposed".
7. **Icons:** one ink, one 48px grid, all glyphs legible at 24px, and 16/16 distinguishable in a shuffled row without captions.
8. **Truth:** every number on the sheet is either measured or explicitly labelled sample; every third-party model carries a source and licence line.

---

## 8. Measurement appendix (so the next reviewer does not re-derive this)

**Type bands (px, 1:1):** H1 45 tall, cap 34 (about 48px) · subtitle 11 (about 15px) · section label 6 (about 8px) · footer 5 · model name 27 · descriptor 9 (about 11px) · count numeral 17 (about 22px) · count unit 6 · card eyebrow 5 · card hex 5 · chip label 6 · tile family 4 (about 6px) · tile name 5 (about 6px) · tile status 4 (about 5px) · code 11/13 · code chips 7 · function headline 31 (about 36px) · function eyebrow 7 · function footer 6.

**Geometry:** page 1440, margin 40, content 1360 · model card 260×340 with a 155px cover (46%), gutter 16 · tile 160×160, gutter 12, radius 8 · grid 8 columns × 2 rows = 1364 (8 × 160 + 7 × 12) · functionality cards 300 tall on one shared baseline · CODE MODE content at 20 / 48 / 104 / 149, then a 79px void, then 228 / 275 · MCP host box (20–169, 98–173), rows (310–489; y 90–133 / 144–187 / 198–241, 10–11px gaps), connector at y=137, dot centre (286, 116), rail rule at x=510 spanning y 110–191.

**Colour samples:** tile fills — #ED7445, #F09071, #ECB9CF, #80B59F, #AAD7C2, #CCEADE, #639D87, #C0DCF2, #94A6F9, #B0D7FB, #92CFC4, #C4B7FA (twice), #A6CFFB, #4F9B8F, #CDD8E8 · covers — #8C8CF7 / #3342D0, #1A392B, #A6CFFB / #0B2A6B, #9773BB / #3D0B54, #97B7F9 · CODE MODE #101012 with #D4FD6A · MCP #1A392B with #D4FD6A and border #587B41 · canvas #E8E4DB · card surface #FFFFFF · headline ink #F0E9DD.

**Contrast (measured):** eyebrow on white 2.17:1 · hex on white 1.84:1 · descriptor on white 4.48:1 · tile status 1.97–2.21:1 · tile name 3.42–4.68:1 · chip label 11.19:1.

**Icon bounding boxes (w × h, 160px tile):** decision_choose 112×53 · decision_score 94×68 · decision_test 46×53 · tools_plan 88×21 · structured_extract 28×62 · validate_record 56×54 · extract_with_repair 41×37 · multimodal_embed 86×86 · semantic_rank 114×79 · semantic_similarity 104×62 · semantic_classify 104×66 · semantic_deduplicate 82×72 · dedupe_and_rank 113×90 · media_find_moments 112×68 · lang_detect 108×82 · stt_transcribe 74×66. Width spread 28–114px (4.1×); height spread 21–90px (4.3×).

*Reviewed against 27 exported PNGs in .reviews/round1. No source file and no Paper file was modified.*
