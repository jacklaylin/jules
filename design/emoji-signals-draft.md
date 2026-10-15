# "Your style in four emojis": draft for founder approval

Approved October 15, 2026. A fixed list of 42 emojis for the four-emoji card in the style report ([style-report-brief.md](style-report-brief.md)). Each emoji is **earned** by a signal computed from the person's purchase history. Nothing is guessed: if no emoji clears its threshold, it isn't shown. Next step: this becomes `data/emoji-signals.json`.

## Inputs (purchase history only)

Every signal below uses only: brand, store, item type, color, price **relative to the person's own orders** or the brand's tier ([brand-niche-draft.md](brand-niche-draft.md)), sale and resale flags, order dates, and repeat buys. Nothing about bodies, sizes, money amounts or reasons for buying. Returns are excluded (private by default).

Terms:

- **Items** = order lines that are clothing, shoes or accessories.
- **Colored items** = items with a known color. Color shares use colored items as the base, never all items.
- **Orders** = distinct checkouts. Store shares use orders as the base.
- **Typed items** = items with a known item type.

## How four are picked (proposal)

1. Compute every signal. An emoji is **eligible** when its threshold and minimum data are both met.
2. **Strength** = how far past the threshold the person is, scaled 0–1 (exactly at the threshold = 0, double the threshold or 100% = 1).
3. Pick the four strongest, with these limits so the row reads like a person, not a spreadsheet:
   - at most **one color** emoji (group C);
   - at most **two item-type** emojis (group I);
   - at most **one** from each pair that would say the same thing twice (🔁 and 📦, 🏷️ and 💎, 🗝️ and 🏬).
4. Fewer than four eligible → the card is **skipped**. No filler.
5. Order on the card: strongest first. The caption under each is the short label below, filled with the person's own count ("6 black tees" is fine; amounts never are).

## The list

**C = color · S = stores · P = price and sale · I = item type · A = activity · T = time · R = repeat · N = niche**

| # | Emoji | Label | Group | Earned when | Minimum data |
|---|---|---|---|---|---|
| 1 | 🖤 | All black | C | 70%+ of colored items are black | 10 colored items |
| 2 | 🤍 | White and cream | C | 40%+ of colored items are white, cream or ecru | 10 colored items |
| 3 | 🩶 | Fifty shades | C | 40%+ of colored items are grey or charcoal | 10 colored items |
| 4 | 💙 | Navy forever | C | 40%+ of colored items are navy or blue | 10 colored items |
| 5 | 🤎 | Camel coded | C | 40%+ of colored items are camel, tan, beige or brown | 10 colored items |
| 6 | 🩷 | Pink is a neutral | C | 25%+ of colored items are pink | 8 colored items |
| 7 | 🫒 | Olive branch | C | 25%+ of colored items are olive, khaki or green | 8 colored items |
| 8 | 🌈 | Full spectrum | C | 6+ color families and none above 30% | 15 colored items |
| 9 | 🔁 | Regular | S | One store has 50%+ of orders | 8 orders |
| 10 | 📦 | Doorstep VIP | S | 10+ orders from a single store | 10 orders |
| 11 | 🛍️ | Store hopper | S | 10+ distinct stores and none above 20% of orders | 15 orders |
| 12 | 🏷️ | Sale radar | P | 50%+ of orders flagged as sale or discounted | 8 orders with a known sale flag |
| 13 | 💎 | Top shelf | P | 40%+ of items from luxury-tier brands | 8 items with a matched brand |
| 14 | ♻️ | Second life | P | 25%+ of orders from resale stores or flagged pre-owned | 6 orders |
| 15 | 🗝️ | Gatekept | N | Gatekeeper score 65+ | Gatekeeper card rules (3+ matched brands) |
| 16 | 🏬 | Mall classic | N | Gatekeeper score 15 or lower | Gatekeeper card rules |
| 17 | 🔍 | Deep cut | N | 2+ brands scoring 80+ on the niche list | 2 matched brands |
| 18 | 🚲 | Cycling kit | A | 3+ cycling items or orders from cycling brands | 3 items |
| 19 | 🏃 | Running miles | A | 3+ running items or orders from running brands | 3 items |
| 20 | 🧘 | Studio regular | A | 4+ leggings, sports bras or studio sets | 4 items |
| 21 | 🏔️ | Trail ready | A | 3+ orders from outdoor/technical brands, or 3+ hiking items | 3 items |
| 22 | 🩱 | Swim season | A | 3+ swimwear items | 3 items |
| 23 | 👟 | Sneaker shelf | I | 5+ pairs of sneakers | 5 items |
| 24 | 👢 | Boot season | I | 3+ pairs of boots | 3 items |
| 25 | 👠 | Heels on file | I | 3+ pairs of heels | 3 items |
| 26 | 👗 | Dress first | I | Dresses are 20%+ of typed items | 4 dresses, 15 typed items |
| 27 | 👖 | Denim drawer | I | 5+ jeans or denim pieces | 5 items |
| 28 | 🧶 | Knitwear person | I | 6+ sweaters or cardigans | 6 items |
| 29 | 🧥 | Coat collector | I | 4+ coats or jackets | 4 items |
| 30 | 👔 | Suited | I | 5+ tailoring items (suits, blazers, dress shirts, ties) | 5 items |
| 31 | 👕 | Tee stack | I | 6+ T-shirts | 6 items |
| 32 | 🧢 | Hat rack | I | 3+ caps or hats | 3 items |
| 33 | 👜 | Bag habit | I | 3+ bags | 3 items |
| 34 | 💍 | Jewelry box | I | 4+ jewelry pieces | 4 items |
| 35 | 🕶️ | Shades | I | 2+ pairs of sunglasses | 2 items |
| 36 | 🧦 | Basics restock | I | 3+ separate orders of socks or underwear | 3 orders |
| 37 | 👯 | Same again | R | One item (same brand, type and color) bought 3+ times | 3 matching items |
| 38 | 🎨 | Every color | R | One item (same brand and type) bought in 3+ colors | 3 matching items |
| 39 | 🕰️ | Vintage hunter | R | 3+ items labeled vintage | 3 items |
| 40 | 🎄 | Holiday haul | T | 35%+ of orders placed in November–December | 12 orders across 2+ years |
| 41 | ⚡ | Speed round | T | 2+ separate weeks with 4+ orders each | 12 orders |
| 42 | 🐢 | Slow and steady | T | Orders in 3+ different years and never more than 2 in any month | 10 orders across 3+ years |

## Sample rows

- **Jack** (black and navy, 6 black tees, SSENSE, Auralee, MAAP): 🖤 🗝️ 🚲 👯 (or 📦 if SSENSE beats the repeat tee).
- **Priya** (Reformation, Aritzia, dresses, pink and cream, sale-heavy): 🏷️ 👗 🩷 🛍️.
- **Dana** (J.Crew, Eileen Fisher, L.L.Bean, few orders, knitwear, loyal to two stores): 🧶 🔁 🐢 🏬.
- **Sparse person** (6–8 orders): usually fewer than four eligible, so the card is skipped.

## Judgement calls for the founder

1. **Thresholds are first guesses** chosen so most testers earn 4–8 emojis. After the first 10 reports, compare how often each fires and tune; an emoji everyone gets (likely 👟 or 🛍️) should get a higher bar.
2. **Color uses colored items as the base.** Many receipts don't name a color; we don't count those as "not black".
3. **No money emojis.** 💸 and 💰 were left out on purpose (money rule). 💎 is earned by **brand tier**, not by amounts, and pairs with 🏷️ so nobody gets both "sale radar" and "top shelf".
4. **No motive or body emojis.** Nothing like 😍, 🤑, 🙈 or 🏋️ (fitness implies body). Activity emojis (🚲 🏃 🧘 🏔️ 🩱) describe what was bought, not the person.
5. **Returns are excluded entirely**, even though "returns champion" would be funny; it's private by default.
6. **🎄 relies on the October 12 decision** allowing seasonality for dated Gmail history. Cut it if Shop-only histories lack reliable dates.
7. **Night-owl (🌙) was cut**: order-email timestamps are often batched or in the merchant's time zone, so "ordered at 2 a.m." could be false.
8. **Gender-coded emojis** (👠 👗 👔) are earned only by items bought, never by signup gender, consistent with the style icon rule.

## Founder answers (October 15)

Approved as drafted.
