# HousePlan design system

The seed comes from the six Codex boards in `design/codex/screens/` (01 discovery, 02 overview, 03 calculator, 04 estimate, 05 compare, 06 paywall) and from BRD §7: "light warm neutral background, dark readable text, restrained forest/teal accent, orange only for pending/warnings."

## Seed

| Role | Light | Dark | Use |
|---|---|---|---|
| **Brand hue (spruce)** | `#17332E` | `#CFE3DC` | Headlines, the money summary card, the "Save revision" button |
| **Ink** (discovery, photo fades) | `#10241F` | `#0B1A17` | Discovery copy ground, photo washes |
| **Accent (teal)** | `#2C7A69` | `#4FB39B` | The one button you want pressed, progress, "cheaper" |
| **Ground (plaster)** | `#F4EFE7` | `#121816` | Screen background, with a trace of the brand hue |
| **Surface** | `#FBF8F3` | `#1A2220` | Cards that need lifting |
| **Line** | `#E4DDD1` | `#2A3431` | Hairlines and dividers |
| **Text / muted** | `#17231F` / `#5F6B66` | `#E9EEEC` / `#9AA6A1` | Body copy |

**Semantic set** (desaturated, never the accent): good `#3E7D5A`, warning (pending, unpriced, stale) amber `#B7791F` on `#FBEFD9`, critical (over budget, more expensive) rose `#B5545C` on `#F6E3E2`.

**Icon discs** (one colour per meaning, everywhere): money/costs terracotta `#C9785F`, estimate/calculators ochre `#C99A45`, rooms/structure sage `#7F9A7A`, quotes/documents slate `#5F7896`, services/electrical teal `#4E8F8C`, alerts rose `#B5545C`, account/settings spruce `#3F5E57`, procurement/materials clay `#A9825F`.

## Type

- **Display:** Newsreader (600/700): headlines, hero numbers ("$184,500"), category names on the estimate.
- **Body:** Inter (400/500/600): everything else. Numbers in tables use tabular figures.
- Sentence case everywhere. No tracked-out all-caps eyebrows except one small "PROJECT OVERVIEW" label on the photo hero.

## Shape

The radius encodes hierarchy: pills 999 > sheets 28 > cards 20 > tiles 16 > buttons 14 > inputs 12. Depth comes from light and a surface step, not stacked shadows.

## Signature elements

1. **The blueprint drawing.** Rooms and calculators show the actual room as a fine spruce floor plan on a faint grid, with dimension lines and arrow ticks (`5 m`, `4 m`), doors as swing arcs and windows as double lines. It is drawn from the room's own measurements (`src/ui/FloorPlan.tsx`).
2. **The money card.** A spruce card with one hero number (cash still needed) over four labelled figures: Estimated, Committed, Billed, Paid. Never "spent".
3. **The completeness meter.** A bar with a marker, plus the honest line "Known subtotal · N unpriced lines · M undecided categories".
4. **Source badges.** Small pills beside every number: Measured, Calculated, Your rate, Benchmark, Quote, Missing.
5. **Diverging bars** on comparisons: teal for cheaper, rose for more expensive, around a centre line.

## Components

Tile grids instead of pills (`ChoiceTile`, full width, `minWidth: '30%'`), a custom tab bar (Projects · Calculators · Advisor · Settings), PhotoBand on tab screens, DetailHero on detail screens, arched photo empty states with one action, bottom sheets for choices, and large numeric entry with a persistent unit label.
