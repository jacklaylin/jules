# Spectrum closer: named types, draft for founder approval

Approved October 15, 2026. The Spectrum card shows six sliders computed from purchase history, then names the person's **type** with a one-line description in the Jules voice. This file defines the sliders, the 24 types and how a type is chosen. Next step: this becomes `data/spectrum-types.json`.

## The six sliders

Each slider runs 0–100 from its left pole to its right pole. Positions: **L** = 0–33, **M** = 34–66, **R** = 67–100. A slider without enough data is **hidden**, not guessed, and can't be used to pick a type.

| Slider | Left (0) ↔ Right (100) | Computed from | Minimum data |
|---|---|---|---|
| **Price** | Thrifty ↔ Spendy | Share of items by brand **Tier** on the niche list (V=0, M=33, P=67, L=100), averaged; resale items count one tier lower | 8 items with a matched brand |
| **Niche** | Mall ↔ Esoteric | The Gatekeeper score ([brand-niche-draft.md](brand-niche-draft.md)) | 3 matched brands covering half the orders |
| **Variety** | Uniform ↔ Chaos | How spread out item types, colors and brands are (normalized entropy), minus a penalty for repeat buys of the same item | 10 items, 6 with a color |
| **Era** | Trendy ↔ Classic | Share of items from brands with **Lean** C vs T on the niche list (60%), plus how steady the brand set is year to year (40%; new brands every year = trendy) | 8 items with a matched brand, orders in 2+ years for the steadiness part |
| **Sale** | Sale hunter ↔ Full price | Share of orders **not** flagged as sale or discounted | 8 orders with a known sale flag |
| **Stores** | One store ↔ Store hopper | 1 minus store concentration (Herfindahl index of order share by store), rescaled | 8 orders |

The sliders are shown as positions only. No price, no amount, no count of money.

## How a type is chosen

1. Each type lists 2–3 required positions. A type **fits** when all its required positions match and those sliders are visible.
2. Among fitting types, pick the one with the **most** required positions; break ties by how far the required sliders sit from 50 (more extreme wins).
3. Nothing fits, or 4+ sliders are in M → **The Middle Path** (if 4+ sliders are visible) or **The Blank Canvas** (if 3 or fewer are visible).
4. The description must be true for **anyone** who fits, so lines only talk about what the sliders measure, never about specific items, colors or brands.

## The 24 types

Key: L = left pole, R = right pole. Price L thrifty / R spendy · Niche L mall / R esoteric · Variety L uniform / R chaos · Era L trendy / R classic · Sale L sale hunter / R full price · Stores L one store / R store hopper.

| # | Type | Required positions | One-liner |
|---|---|---|---|
| 1 | The Quiet Gatekeeper | Niche R · Variety L · Era R | Labels nobody at the party can name, bought on repeat and never once explained |
| 2 | The Sale Romantic | Sale L · Variety R · Stores R | Falls hard for whatever just got marked down, anywhere on the internet, and somehow it all works out |
| 3 | The Creature of Habit | Stores L · Variety L | Same store, same kind of thing, every time, and honestly the system is undefeated |
| 4 | The Archive Diver | Price L · Niche R | Cult labels at friendly prices, found three pages deep in a search most people would have abandoned |
| 5 | The Full-Price Purist | Sale R · Price R · Era R | Classic labels at full price with no waiting around for a sale that was never part of the plan |
| 6 | The Store Hopper | Stores R · Variety R | A different checkout every time, and the order history reads like a travel diary |
| 7 | The Uniform | Variety L · Era R | Found the formula a long time ago and has been quietly restocking it ever since |
| 8 | The Trend Sprinter | Era L · Stores R · Variety R | Always on this season's thing and already halfway to next season's |
| 9 | The Heritage Head | Era R · Niche L · Price R | Sticks to the classics so firmly that trends just bounce off |
| 10 | The Bargain Bloodhound | Sale L · Price L · Niche L | Can smell a markdown from three tabs away |
| 11 | The Luxury Loyalist | Price R · Stores L · Sale R | One very nice store, full price, every time, no notes |
| 12 | The Esoteric Explorer | Niche R · Stores R · Variety R | Twelve labels deep and each one harder to pronounce than the last |
| 13 | The Chaos Collector | Variety R · Era L | No two orders look like they came from the same closet, which is exactly the charm |
| 14 | The Steady Classicist | Era R · Variety L · Niche L | Knows exactly what works and sees no reason to discuss it further |
| 15 | The Sale-Rack Scholar | Sale L · Niche R | Knows the cult labels and also knows exactly when they go on sale |
| 16 | The Investment Piece | Price R · Sale R | Nicer labels at full price, every single time, zero haggling |
| 17 | The Mall Marathoner | Niche L · Era L · Stores R | Has done a lap of the whole mall and checked out at most of it |
| 18 | The Comfort Zone | Stores L · Niche L · Price L | Found the good basics store early and saw no reason to leave |
| 19 | The Wildcard | Variety R · Sale L · Era L | Every order is a plot twist, and the plot is mostly markdowns |
| 20 | The Curator | Niche R · Price R · Stores L | One very curated store doing a lot of heavy lifting for a very particular closet |
| 21 | The Classic With a Secret | Era R · Niche R | Classic everything until the labels come out and nobody has heard of any of them |
| 22 | The Sale Strategist | Sale L · Stores L | Knows exactly when one particular store marks things down and is ready at the refresh |
| 23 | The Middle Path | Fallback, 4+ sliders visible | Perfectly balanced on every slider, which is either very zen or very suspicious |
| 24 | The Blank Canvas | Fallback, 3 or fewer sliders visible | Not enough receipts to read yet, which is its own kind of mystery |

## Sample people

- **Jack** (Dries, Auralee, Our Legacy, lots of SSENSE, mostly black and navy, repeat black tees): Niche R, Variety L, Era R, Price R → **The Quiet Gatekeeper** (3 matches beats The Investment Piece's 2).
- **Priya** (Reformation, Aritzia, Zara then COS, lots of dresses, sale-heavy): Sale L, Era L, Stores R, Variety R → **The Sale Romantic** (3 matches; The Wildcard also fits with 3, Sale Romantic wins if its sliders are further from 50).
- **Dana** (J.Crew, Eileen Fisher, L.L.Bean, few orders, loyal to two stores): Stores L, Niche L, Era R, Variety L → **The Steady Classicist** (3 matches).
- **Sparse person** (6–8 orders): most sliders hidden → **The Blank Canvas**.

## Voice check

Every line was written against the founder's rules:

- One sentence each, no short-sentence-plus-period punchline, no closing period on the card.
- About shopping only: no body, size, fit, money amounts or reasons for buying.
- No pronouns for the person (no he, she, they or you); lines are written as descriptions of a shopper.
- Teasing aimed at the habit, never at the person. "Suspicious" (Middle Path) and "heavy lifting" (Curator) are the sharpest lines; soften them if they read harsh.

## Judgement calls for the founder

1. **Price and Era need editorial anchors.** Price relative only to the person's own orders would put everyone in the middle, so Price uses the brand **Tier** and Era uses the brand **Lean** from the niche list. Both are coarse labels and never shown.
2. **Descriptions are slider-level only.** A line like "oxford shirts and good boots" would be false for half the people who fit The Heritage Head, so specific items, colors and brands are left to the other cards.
3. **Sale ↔ Full price needs a reliable sale flag.** If most receipts don't say whether something was discounted, that slider will often be hidden, and types 2, 10, 15, 19, 22 will rarely appear. Worth checking on the first 10 imports.
4. **Fallbacks are two types, not one.** The Middle Path is for real balance across visible sliders; The Blank Canvas is for missing data. Keeping them apart avoids telling someone with 140 orders that there's nothing to read.
5. **Resale counts one tier lower** on Price, so a Grailed archive habit can land on The Archive Diver rather than reading as spendy.
6. **Twenty-four is enough for 10 testers.** Some combinations (e.g. Spendy + Sale hunter + Mall) have no named type and fall through to The Middle Path. If testers land there often, add types for the combinations that show up.

## Founder answers (October 15)

Approved as drafted, including all six judgement calls. On call 3: if the sale flag turns out to be rare in real imports, **drop the Sale slider** (and the types that need it: 2, 10, 15, 19, 22) instead of building around missing data.
