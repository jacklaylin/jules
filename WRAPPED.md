# Jules Wrapped: card system design

Status: planning draft, October 12, 2026. No application changes yet. Visual reference: the Wrapped board in the "Jules — Agentic Personal Shopper Identity" artifact (copy in `jules-handoff.zip → reference-boards/Wrapped.dc.html`). Content rules from [STYLE-REPORT-CONTENT-TEST.md](STYLE-REPORT-CONTENT-TEST.md) and [VOICE.md](VOICE.md) still apply.

## The idea in one paragraph

Every import (Gmail now; outfit photos, wishlist and chat later) writes to one **evidence store** (section 0), kept strictly separate from the inferred profile. Code computes **signals** from the evidence store: plain numbers with a strength score, such as "71% of known colors are black, n=24". A **card library** turns strong signals into card candidates. A deterministic **selector** picks and orders 5–9 cards per person, and **one model call** writes the copy for those cards only. Signals that are strong and unusual are what make a reading personal: if someone only buys black, the monochrome signal outscores everything else and gets the joke. Nobody gets a card their data can't support.

## Pipeline

```
Sources ──► 1. Evidence ──► 2. Enrich ──► 3. Signals ──► 4. Candidates ──► 5. Select ──► 6. Write ──► 7. Validate ──► Render
(gmail,     items +       per-item,     pure code,     card library     code          1 model      code
 photos,    events +      model, once,  every run      gates + scores                 call
 chat…)     provenance    cached
```

| Stage | Who | Cost | Re-runs when |
|---|---|---|---|
| 1. Evidence | `evidence` table (section 0) | none | import or correction |
| 2. Enrich | Model, per item, cached by item ID + evidence fingerprint | ~1 small call per new item batch | new items only |
| 3. Signals | Code | negligible | every evidence change |
| 4. Candidates | Code | negligible | every evidence change |
| 5. Select | Code | negligible | evidence change, hide/feedback |
| 6. Write | Model, one call, three tones | one call per reading | selected set or facts change |
| 7. Validate | Code | negligible | every write |

This keeps the boundary from `lib/style.js`: **the model normalizes and writes, code counts and decides.** Numbers never come from the writing call.

## 0. One evidence store (implemented)

Founder requirement, October 12, 2026: proof and inference never mix, and proof lives in exactly one place. Implemented in `db/019_evidence.sql`; see [ARCHITECTURE.md](ARCHITECTURE.md) for inputs, agent skills and every data store.

What Wrapped relies on:

- Purchase history is a view rebuilt from `purchase_event` and `correction` rows in the `evidence` table. Wrapped signals read that view, never a stored copy.
- Profile facts are beliefs that cite evidence (`evidence_ids`, `basis`). A Wrapped card is not a belief; "remember this?" writes a confirmed belief citing the card's evidence plus the user's confirmation.
- A Wrapped reading stores its selection, copy and the evidence IDs it used, so stale readings can be detected after corrections or deletions.
- Enrichment (category, color family, item type) is a normalization of what a receipt says. It is stored with the purchase evidence and its model version, never as a belief about the person.

## 1. Purchase evidence: what each item needs

Today a Gmail receipt item has merchant, order reference, product, SKU, brand, color (raw text), size label/system, quantity, source events with dates, recipient corrections, and an outcome (returned/cancelled/unknown). For Wrapped it also needs these, all nullable and quoted from evidence:

| New field | Where | Why |
|---|---|---|
| `unit_price`, `currency` | extraction (quoted, like other fields) | price range, splurge, "your number" |
| `discounted` (true/false/null) | extraction, only when the receipt shows a markdown or promo line | sale card |
| `category` (fixed list: tops, knitwear, shirts, trousers, denim, outerwear, dresses, shoes, bags, accessories, activewear, underwear/basics, other) | enrichment | category mix, repeats, splurge category |
| `color_family` (fixed list: black, white, grey, navy, blue, brown/tan, cream/beige, green/olive, red, pink, yellow/orange, purple, multi/pattern, unknown) | enrichment, from `color` + product name | palette, monochrome |
| `item_type` (short noun: "crewneck sweater", "white sneaker") | enrichment | starter pack, repeat offender |

Rules: enrichment never invents a color the receipt doesn't state ("Classic Tee" with no color → `unknown`). Prices are never inferred. Gifts and disputed/cancelled items are excluded from personal signals, as they are today. Returned items count as purchases for "what you bought" and are excluded from "what you kept".

Later sources add evidence rows of other kinds (`outfit_observation`, `wishlist_save`, `chat_statement`) to the same table. Cards say which kinds they need.

## 2. Signals

A signal is a small pure function over the evidence store:

```js
// lib/wrapped/signals/palette.js (shape, not final code)
export default {
  id: 'palette',
  needs: ['purchase'],              // evidence kinds
  compute(evidence) {
    const known = evidence.personal().filter(i => i.color_family && i.color_family !== 'unknown');
    if (known.length < 8) return null;
    const shares = shareBy(known, 'color_family');
    const top = shares[0];
    return {
      n: known.length,
      coverage: known.length / evidence.personal().length,
      facts: { shares, top },
      strength: strength({ n: known.length, value: top.share, baseline: BASELINE.palette_top_share }),
      extremity: top.share >= 0.7 ? 'high' : top.share >= 0.5 ? 'medium' : 'low',
      item_ids: known.filter(i => i.color_family === top.name).map(i => i.id),
    };
  },
};
```

**Strength** (0–1) is the single number the selector ranks on. It combines:

- **Sample size**: confidence ramps up with `n` and flattens out (e.g. `1 - e^(-n/10)`). Below a hard minimum the signal returns `null`.
- **Distinctiveness**: how far the value is from a typical shopper. With 10 users we can't learn baselines, so start with hand-set baselines in one file (`BASELINE.palette_top_share = 0.3`, `BASELINE.top_store_share = 0.3`, etc.) and revisit them after the first readings.
- **Coverage**: the fraction of items where the field is known. A palette built on 9 of 200 items is weak even if the 9 agree.
- **Recency**: optional; recent-two-years signals get a modest boost, matching how Gmail observations are already classified.

**Extremity** (low/medium/high) is separate from strength. It sets whether the card is allowed a joke. This is how "you only wear black" becomes a systematic rule rather than a one-off: the joke is only permitted when the data is extreme enough to carry it.

## 3. Card library (v1, Gmail only)

Each card declares its signal(s), gate, privacy class and what the writer may claim. The thresholds are starting values to tune, not commitments.

| Card | Signal | Gate (starting value) | Joke license when | Privacy | Notes |
|---|---|---|---|---|---|
| **The haul** (opener) | count | ≥5 personal items | never | share | Count, years spanned, number of stores. Always says "found in your Gmail", never "everything you bought". |
| **Starter pack** (centerpiece) | item_type frequency | ≥6 personal items, ≥4 distinct types | medium | share | Built from what was actually bought; no props like the mock's "oat flat white" unless a source supports them. Product photos only where we have a verified image. |
| **Your palette** | color_family | ≥8 known colors, coverage ≥40% | top share ≥50% | share | "Of the colors we could read". |
| **Monochrome** | color_family | top share ≥70%, n ≥10 | always (this is the joke card) | share | Replaces Palette when it fires; never both. |
| **Where you shop** | merchant share | ≥8 items, ≥2 merchants | top share ≥50% | share | Shopping history, not loyalty or favorite. |
| **Ride or die** | merchant across years | one merchant in ≥3 distinct years | medium | share | Merges into Where you shop if both fire weakly. |
| **Your number** | unit price distribution | ≥8 priced items | never mocks the amount | **in-app only** | Typical range (25th–75th percentile). The only card that shows amounts; it never appears in the story deck. |
| **The splurge** | spend share and median price by category | ≥2 categories each with ≥3 priced items in one currency, top category clearly ahead (≥1.5× the next) | medium | share, **relative terms only** | "Among the orders we found, you spent the most on outerwear." No amounts, totals or currency symbols on the story card. |
| **Shopping season** | purchase month distribution | ≥24 dated personal items across ≥2 calendar years; top month (or 2-month run) has ≥2× its expected share and recurs in ≥2 years | high | share | "You shop in November." Uses purchase evidence dates, says "in the orders we found", and never claims a complete history. |
| **Sale radar** | discounted share | ≥8 items with known sale status | share ≥60% or ≤10% | share | Never "you only buy on sale" when sale status is mostly unknown. |
| **Repeat offender** | same item_type + color_family | ≥3 purchases across ≥2 orders | always | share | The navy-sweater card. Never implies addiction or replenishment. |
| **What you buy most** | category share | ≥8 categorized items | top share ≥40% | share | |
| **Then vs now** | any of the above, recent vs historical | both windows have ≥6 items and a field shifts by ≥25 points | medium | share | E.g. "2022 was all Zara; this year it's mostly COS." Strong Wrapped energy, cheap to compute. |
| **The return desk** | outcome | ≥3 returns | low | **private, never in share by default** | Returns don't imply dislike or wrong size. |
| **Style icon** | icon catalog match (see below) | ≥10 personal items and ≥3 matchable attributes | always (it's a bit) | share | "You dress like [icon]. 87% match, based on 140 purchases." Playful by design. |
| **The headline** (closer) | strongest signal | always, if ≥3 other cards | yes, tone permitting | share | The "Daily Jules" card: one headline about the single highest-scoring signal. |

### Cards from the mock that wait for other sources

| Mock card | Blocked by | Unlocks with |
|---|---|---|
| Most worn, cost per wear, receipt "per wear" | No wear data in receipts | Outfit photo imports (repeated garments across dates) |
| Taste map / diamond archetype | Subjective axes need visual evidence, not product names | Outfit photos + saves; the model scores axes with cited observations |
| Taste twin | Multiple users with comparable data | Later, if ever |

### Style icon match

The match is a deliberate joke built for sharing, but the percentage is computed, not made up, so the same closet always gets the same icon.

- **Catalog.** About 100 icons in one editorial data file (`data/style-icons.json`), written by the founder, not generated per user. Each entry has a name, a one-line style summary, 3 display traits ("Tailored ease · Neutral base · One loud shoe"), an optional department (menswear/womenswear/either), and an attribute profile using the same vocabulary as our signals: palette (mostly black, neutrals, color), dominant categories, formality, price tier (relative), sale-leaning, pattern use, repeat-buying.
- **User profile.** Built in code from the user's signals (palette shares, category mix, relative price tier, sale share, repeat score). Attributes with too little data are left out rather than guessed.
- **Matching.** Weighted similarity over the attributes both sides have, so a sparse import matches on fewer attributes instead of on invented ones. The display percentage maps similarity onto a fixed, documented range (for example 62–97%) so it reads as a score, never 100%. Ties break deterministically so re-runs don't flip icons. Filter by department when the user's purchases make it clear; otherwise match across the whole catalog.
- **Copy.** The writer gets the icon, the shared attributes and the user's supporting facts, and explains the match in terms of clothes ("all-black, one good coat, no patience for prints"). It never compares bodies, faces or appearance and never implies an endorsement.
- **Images.** No photos of the icons unless we have rights to them. Use the name, the traits and an illustration or the user's own items. Before the public launch, get a quick legal check on using real people's names in a shareable card.

### Wildcard card (the personalization valve)

Thresholded signals cover the patterns we anticipated. To catch the ones we didn't ("bought the same Uniqlo tee in six colors", "every order from one store arrives in October"), the enrichment step also asks the model for up to **two hooks**: a claim plus the exact item IDs supporting it. Code checks the IDs belong to the user's personal items, recomputes the count itself, and discards the hook if the count disagrees. A validated hook becomes a `wildcard` candidate with a moderate fixed strength, so it competes with library cards but doesn't automatically win. If a hook type keeps appearing across users, promote it into the library.

## 4. Selection (deterministic)

1. Compute all signals, then all candidate cards that pass their gates.
2. Resolve exclusions: Monochrome replaces Palette; Ride or die merges into Where you shop when both are weak; Your number never enters the story deck.
3. **Score** = strength × card weight (hand-tuned, starts at 1.0) × penalty if the user hid this card type before.
4. **Arc**: The haul first → Starter pack second (if eligible) → body cards by score, at most one per signal family, with no two price/money cards adjacent → Headline last. Target 5–9 cards. Fewer is fine; a sparse import gets a short reading plus an invitation to add outfits.
5. **Spotlight**: the top-scoring body card moves to position 3 and is what the Headline and the iMessage teaser ("your reading's ready") are about. This is how strong price or store signal gets prioritized without special-casing.
6. Private and in-app-only cards appear in the in-app reading but are excluded from the share deck. Private cards (returns) can be shared by per-card opt-in, as on `/style`; in-app-only cards (Your number) cannot.
7. **Story-format rule:** no exact price amounts, totals or currency figures on any story/share card. Relative money language ("spent the most on", "your biggest category") is allowed.

Store the selection with the signal snapshot and a `evidence_hash` so a reading can be reproduced and a stale export detected.

## 5. Writing (one model call)

Input to the writer, per selected card: card type, the computed facts (already-final numbers and names), sample/coverage wording ("of the 140 orders we found since 2021"), `extremity`, allowed claims, forbidden claims, plus `VOICE.md`. Output: title + `nice` / `balanced` / `roast` for each card, the same three tones the style report already supports. Switching tone never changes facts and never calls the model again.

Joke rules carry over from the style report: about the clothes and the shopping, never the body, wealth or motives; not every card needs a joke; roast is only offered on cards with `extremity ≥ medium`.

## 6. Validation (code)

- Every number in the copy must appear in that card's facts. Checking digits against the facts is format validation, not intent routing.
- Store and brand names in the copy must come from the card's facts.
- No price, size or return details in a card whose privacy class forbids them.
- Story-format cards contain no currency amounts. Checked against the card's facts and a currency/number format check; relative money wording passes.
- Banned claims: "favorite", "loyal", "always", "every time", "you own", fit or size verdicts, "complete history".
- On failure, regenerate that card once; if it fails again, drop it and log the reason.

## 7. Feedback loop and observability

Log per reading: signals computed (with strength), candidates, selected, dropped and why, validation failures, tone chosen, cards hidden, cards corrected, cards shared. With 10 testers that's enough to tune thresholds and weights by hand. Card corrections use the existing structured correction path in `lib/receipt-feedback.js` (wrong recipient, duplicate, wrong color), and the reading regenerates only the affected cards.

A Wrapped observation is not a confirmed preference. As with the style report, a card can offer "remember this?" and only a yes writes to the taste profile.

## 8. Adding a new source later

A new source (outfit photos, wishlist saves) adds an evidence kind and its own enrichment. Existing cards are unchanged. New cards declare `needs: ['outfit_observation']` and are simply never candidates for users without that data. Cards that combine sources (e.g. "you buy color, you wear black": purchase palette vs outfit palette) declare both.

## Build order (when approved)

0. Evidence store (done, section 0).
1. Extraction + enrichment fields above, cached per item; backfill existing Gmail items once. Test that unstated colors and prices stay null.
   **Item tags (built, October 15, 2026; `lib/item-tags.js`):** `item_type`, `group` (fixed list), `color_family` (fixed list) and `resale`, written by one model call per 30 items. They live in `gmail_imports.data.item_tags`, keyed by item ID with a fingerprint of the item's current details, so a correction re-tags that item and nothing else. They are a cache, not evidence or beliefs; "Delete imported history" removes them with the row. A colour family needs the receipt's colour field or an exact quote from the product text, otherwise `unknown`. The worker tags after each import finishes; Admin → People → Purchase history has a "Tag purchases" button for older history and shows each item's tags. Unit prices were already extracted. **Not yet:** the `discounted` flag needs a re-read of the original emails (like the price re-read) and comes with the first card that uses it.
   **Receipt card and story player (built, October 15, 2026; `lib/style-report.js`, `/report`):** code picks 3–6 receipt lines (repeated item types, stores by order count, brands, a dominant colour family, a category group) plus a private returns line; one writer call adds the TOTAL joke, checked so every number and store/brand name appears in the lines and no money or loyalty claims slip in, with one retry and a fixed fallback. The report is saved as `gmail_imports.data.style_report` with the person's thumbs (and reason) and hidden lines; a rebuild keeps both. The person opens it at `/report` from a signed link texted from Admin → People → Purchase history → Style report. Sharing, other cards and automatic sending after onboarding come later.
   **Gatekeeper card (built, October 15, 2026):** the second card. Each kept purchase is matched to `data/brand-niche.json` (the approved list in `design/brand-niche-draft.md`) by its own brand, or by its store only when the receipt names no brand; label variants ("lululemon athletica", "Suit Supply B.V.") match technically and unknown labels are left out. Score = average niche of the person's most niche quarter of brands (at least 3, each counted once, founder October 16); shown only with 3+ brands covering half the orders. Code picks the verdict band; one writer call adds the one-liner, checked to name only the person's own brands and no numbers, with a fallback per band.
   **Then vs now and locked cards (built, October 16, 2026):** Then vs now compares the earliest and latest years with 6+ orders: top 3 brands by orders (the brand list's spelling), the most common colour family and item type from the tags (each needs 2+ items), all counted by code; one writer call stamps a verdict, checked to use only the card's brands and its two years. Every report has at least 3 cards: when fewer are real, built cards the person can't have yet are shown locked, saying from real counts what unlocks them (more orders, older orders). Locked cards take no thumbs and are never shared.
   **Share link (built, October 16, 2026):** the person taps Share to make an unguessable link (`/r/<22-character code>`, stored as `style_report.share`) that anyone can open without signing in; Stop sharing turns it off and a rebuild keeps it. The public view (`sharedView`) is an allow-list per card: no locked cards, hidden or returns lines, cards marked "Wouldn't share", feedback or ids. Cards talk about the person ("How niche is Jack's taste?") with third-person copy the writer produces alongside the in-app line, checked to never say "you", and end with "What about you?" and a link to sign up. Instagram export, link previews and referral tracking come later.
   **In / Out replaces Then vs now (built, October 16, 2026; founder):** the "in / out" meme as a notes-app list, earliest vs latest year with 6+ orders. Code picks every line: IN (up to 4) = first-ever categories, then categories whose share of the year jumped (a boost for ones that were zero, and for ones a specific item names, like "swim briefs" or "sunglasses"), then new brands only when categories don't fill it; OUT (up to 3) = "then" brands and categories that vanished or collapsed; STILL = brands bought 2+ times in both years and a colour leading both; stats (up to 2, most striking first) = breakup of the era (the brand bought most before, none in the latest year), niche score drift, brands bought, orders a year. One writer call adds only the closing line, checked against the card's own facts and numbers.
   **Four emojis (built, October 16, 2026):** every emoji in the approved list (`design/emoji-signals-draft.md`) is earned by a counted fact, and the caption is that fact; the four strongest win with at most one colour, two item types and one of each overlapping pair; fewer than four earned skips the card. Strength builds up to 4× the threshold (so they rank instead of tying), Basics restock needs 5 orders and the niche emoji measures 65→85 (founder tuning on live data). Sale radar and Vintage hunter wait for a sale flag and a vintage label.
   **Spectrum, the closer (built, October 16, 2026):** five sliders from purchases and the brand list (price from brand tier, each brand counted once and blended half typical, half most premium quarter (founder, October 16), niche from Gatekeeper, variety from how evenly types/colours/brands spread less repeats, era from classic vs trend-led brands plus year-to-year steadiness, stores from order concentration); a slider without enough data is hidden. The approved type (`data/spectrum-types.json`) with most matching positions wins, then the most extreme; 4+ middle sliders fall back to The Middle Path, 3 visible to The Blank Canvas. The Sale slider is dropped until receipts carry a sale flag (founder, October 15). The line is the approved copy; no writer call.
2. Signals + card library + selector as pure functions with fixture evidence sets (sparse, monochrome, one-store, sale-heavy, gift-heavy, two-era). Tests assert which cards are chosen and in what order, not copy.
3. Writer + validator, reusing the `/style` structured-output and tone pattern.
4. Render with the existing Wrapped card designs; share deck honors privacy classes.
5. Founder review on the real import, then 2–3 testers, recording which cards felt accurate, hidden, and shared.

## Founder decisions (October 12, 2026)

1. **Seasonality: allowed** as the gated Shopping season card. This applies to Wrapped's dated Gmail history. The `/style` report's ban on seasonality claims (`lib/style.js`) stays until it has dated sources of its own.
2. **Money: no exact amounts on story-format cards.** Relative terms such as "you spent the most on" are fine. Amounts appear only in the in-app Your number card.
3. **Style icon: keep the match percentage.** Build a curated catalog of about 100 icons with attribute profiles and a deterministic match. Optimized for sharing; legal check on names before public launch.

## Founder decisions (October 15, 2026)

These narrow the v1 card library above. Design brief: [design/style-report-brief.md](design/style-report-brief.md).

1. **MVP templates (each person gets 3–5):** Receipt (opener), Starter pack, Gatekeeper score, Then vs now, Style icon, Dating profile, Headline (closer). Palette is deprioritized. Archetype, taste map, most worn and taste twin come later.
2. **Receipt replaces The haul, Where you shop and What you buy most.** Its lines mix item counts and store counts ("Black tee ×6", "SSENSE orders ×14"), never amounts or wear counts. Returns are off by default and appear only if the person turns them on.
3. **Dating profile added.** First name and age (from the signup birthday), brands and repeat buys, green/red flags, and a joke "Looking for:" line. No fit or body claims until outfit photos exist.
4. **Gatekeeper score added.** How niche the person's brands are, from an editorial brand-obscurity list (new data file, same approach as the icon catalog).
5. **Product images are looked up** from item brand, name and color for the cards. A card must still work when no image is found.
6. **Starter pack may include invented props.** Overrides the October 12 "no props" note: 1–2 related items the person didn't buy, inferred from their purchases (MAAP cycling kit → a road bike). Props are a labeled card type in the data, are never written to purchase history or the taste profile, and never appear outside the Starter pack.
7. **Style icon is an "It's a match" card** (Tinder-style): the icon and the person side by side. MVP icon photos are freely licensed only (source, license and credit recorded per icon); icons without one show an empty photo frame with their name. No illustrations. Paid licensing (editorial licenses usually exclude promotional use; film/TV stills are licensed by studios) is deferred. The person's photo appears only if they provided one (outfit photos or added before sharing); otherwise the card shows the icon alone. The catalog starts at 38 icons (draft: [design/style-icons-draft.md](design/style-icons-draft.md)), real people and characters across ages, genders and vibes, including those who have died. Signup gender is not used for matching. Legal check on names and photos stays a public-launch gate.
8. **Thumbs up/down on every card**, with an optional reason (wrong / not funny / wouldn't share). Logged per card type with the signals that produced it, to tune gates and weights.
9. **Share loop:** every exported card carries a short link to a "get your style report" page with a referral code; measure shares → clicks → signups per card type.
