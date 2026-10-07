# HousePlan design system

**Palette v2: cream, espresso and burnt orange** (2026-10-07). The owner rejected the first green palette (kept for history in `design/codex/screens-v1-green/`). The current boards are in `design/codex/screens/` (01 discovery, 02 overview, 03 calculator, 04 estimate, 05 compare, 06 paywall), rendered by Codex from `design/codex/screens.tsv`.

Why this palette: warm cream and espresso read as "home, timber, plaster" rather than "finance app". A single burnt-orange accent gives one unmistakable action per screen. Money-heavy screens stay calm because colour is reserved for meaning. There is no green anywhere: "good / cheaper" uses cobalt blue, which also keeps the palette safe for the most common colour-vision deficiency.

## Seed

| Role | Light | Dark | Use |
|---|---|---|---|
| **Brand (espresso)** | `#2A1E17` | `#F3E3D1` | Headlines, the money card, the "Save revision" button |
| **Ink** (discovery, photo fades) | `#1F1611` | `#110C09` | Discovery copy ground, photo washes |
| **Accent (burnt orange)** | `#C4561F` (pressed `#A8461A`) | `#F08A4B` | The one button you want pressed, active tab, progress. White text on `#C4561F` passes AA |
| **Accent tint (apricot)** | `#FBE4D6` | `#3A2418` | Selected tiles, highlights |
| **Ground (cream)** | `#FBF4EA` | `#17110D` | Screen background |
| **Surface** | `#FFFBF5` | `#241C16` | Cards that need lifting |
| **Line** | `#EADFCF` | `#3A2E25` | Hairlines and dividers |
| **Text / muted** | `#2A1E17` / `#7A6A5D` | `#F6ECE0` / `#B5A493` | Body copy |

**Semantic set** (never the accent, always with a word): good / cheaper **cobalt** `#2F5D8A` on `#E0E9F3`; warning (pending, unpriced, stale) **mustard** `#A87410` on `#FBF0D2`; critical (over budget, more expensive) **rose** `#B4474F` on `#F7E1E1`.

**Icon discs** (one colour per meaning, everywhere): money/costs burnt orange, estimate/calculators ochre `#93681A`, rooms/structure plum `#7E4A6E`, quotes/documents slate `#46607F`, services/progress cobalt `#2F5D8A`, alerts rose, account/settings espresso, procurement/materials clay `#8A5E36`. Chart segments: `#C4561F #C99A45 #5F7896 #8E5A7E #A9825F #2F5D8A #E9A27A #6B5243`.

## Type

- **Display:** Newsreader (600/700) for headlines, hero numbers and category names on the estimate.
- **Body:** Inter (400/500/600) for everything else, with tabular figures in tables.
- Sentence case everywhere.

## Shape

The radius encodes hierarchy: pills 999 > sheets 28 > cards 20 > tiles 16 > buttons 14 > inputs 12. Depth comes from light and a surface step, not from stacked shadows.

## Signature elements

1. **The blueprint drawing.** Each room is drawn as a fine espresso floor plan on a faint warm grid, with dimension lines, door swings and windows, from its own measurements (`src/ui/FloorPlan.tsx`). The same grid texture sits behind the app icon.
2. **The money card.** An espresso card with one cream hero number (cash still needed) over four labelled figures: Estimated, Committed, Billed, Paid. Never "spent".
3. **The completeness meter.** An orange bar with a marker, plus "Known subtotal · N unpriced lines · M undecided categories".
4. **Source badges** beside every number: Measured, Calculated, Your rate, Benchmark, Quote, Missing.
5. **Diverging bars** on comparisons: cobalt for cheaper, rose for more expensive.

## Icon

The house outline with a dimension line under it is cream on espresso, with an apricot door and dimension line on a faint blueprint grid. It is rendered from the same SVG as `Mark.tsx` by `design/tools/icons.mjs`.
