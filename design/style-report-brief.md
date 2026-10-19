# Jules style report (Wrapped): design brief

For Claude Design. This replaces the sample cards on the Wrapped board (`jules-handoff.zip → reference-boards/Wrapped.dc.html`) with templates built around the data Jules actually has. Written October 15, 2026. Engineering plan: [WRAPPED.md](../WRAPPED.md).

## What Jules is

Jules is a personal shopper you text over iMessage. At signup we get first name, birthday and gender. In onboarding the person connects Gmail and/or Shop, and Jules reads up to five years of clothing and accessory orders. The style report is the payoff right after onboarding: a story-style deck that is accurate, funny and good-looking enough to post.

## The goal

People screenshot and share their cards; their friends see them and sign up for Jules. Every design decision serves that: one big idea per card, readable as a 1-second Instagram story, unmistakably Jules, with a way back to "get yours".

Inspiration: Spotify Wrapped, starter pack memes, Dimensional (personality quiz results), dating app profiles.

## Each card is a template

Nobody sees the sample data. Every card is a **template** with:

- **Copy slots** with max lengths (write sample copy at the long end, too).
- **Data slots** (lists, counts, brand names, a percentage) that may be short or long.
- **Image slots** that may be filled or empty (see Images below).
- **Theme**: a set of about 6 color themes and 3 font pairings, chosen per user. Design these as tokens so code swaps them; don't hard-code one look per card. Reuse the Jules design system tokens (`DESIGN-SYSTEM.md`) as the base.

Show every template filled for **three different people** to prove it's a template, for example:

| Person | Data |
|---|---|
| Jack, 31 | Dries Van Noten, Auralee, Our Legacy, lots of SSENSE orders, MAAP cycling gear, mostly black and navy, 6 black tees |
| Priya, 26 | Reformation, Aritzia, Zara then COS, lots of dresses, pink and cream, sale-heavy |
| Dana, 58 | J.Crew, Eileen Fisher, L.L.Bean, few orders, mostly knitwear, very loyal to two stores |

Also show a **sparse** version (someone with only 6–8 orders found). A template must still look intentional with little data.

## Data rules the design must respect

- **Counts, not money.** No prices, totals or currency on any shareable card. "6 SSENSE orders" is fine; "$4,200 at SSENSE" is not.
- **Purchases, not wear.** We know what was bought, not what's worn. No "worn 41×", cost per wear or fit/body claims (those come later with outfit photos).
- **Returns are private by default.** A returns line can appear only if the person turns it on.
- **The person can hide any line or card** before sharing.

## Images

Receipts don't include product photos. Jules looks up an image for an item from its brand, name and color. Design for three states in every image slot:

1. **Product photo found**: square retailer thumbnails with inconsistent backgrounds and crops. Give them a consistent treatment (sticker, polaroid, cut-paper frame, color-matched tile) so a mix looks deliberate.
2. **No photo found**: an illustrated or typographic tile for the item type ("BLACK TEE ×6"). It should look as good as a photo, not like an error.
3. **Invented prop** (Starter pack only): a related item the person didn't buy but obviously goes with their shopping. Example: MAAP cycling kit orders → a fancy road bike. Props use the same visual treatment as real items.

Style icon photos are a separate case; see Style icon below.

## The templates (MVP: 7, each person gets 3–5)

Jules picks the cards each person's data supports best, so decks differ. Suggested order when all appear: Receipt → Starter pack → Gatekeeper → Then vs now → Style icon → Dating profile → Headline.

### 1. The receipt (opener)
A deadpan till receipt that proves Jules has read the person's orders (founder, October 18, 2026: the TOTAL punchline didn't land, and the receipt's job is proving knowledge, not commenting). Every line is something the person can check against their own inbox:
```
JACK · MEMBER SINCE MAR 2022
-----------------------------
FIRST ORDER · 14 MAR 2022
MAAP TEAM JERSEY, BLACK
-----------------------------
RIBBED CALF SOCK, BLACK   ×6
VILLAIN HOODIE            ×4
MUSCLE HALF CROP TOPS     ×6
-----------------------------
ITEMS KEPT                26
ITEMS NOT BLACK            5
LAST ORDER    1:14 AM · 3 OCT
-----------------------------
   NO EXCHANGES FOR COLOUR
```
- 3–5 lines: products bought more than once first, then item types and brands those products don't already cover. No store order counts.
- 2–4 fields: items kept and the last order always; then the most telling of items not in a dominant colour, the product reordered most (when it isn't a line) and stores used (when few). No sale counts until receipts carry a sale flag.
- The model only shortens product names (it may remove words from the receipt's own text, never add them) and writes one line of fine print, in store-policy voice. A failed check falls back to "PLEASE KEEP FOR YOUR RECORDS".
- The last order shows in the person's own time zone. Shared, it shows the time only, never the date, and is left out until a time zone is known.
- The person can hide any line, field or the first order.
- Footer: date range of orders found. Animation: receipt prints line by line.

### 2. Starter pack
The meme format: title ("The Quiet Menswear Guy Starter Pack"), 6–9 items in a loose grid with short captions, the person in the middle as "[YOU]" (an illustrated placeholder or initials, not a photo).
- Mostly real purchased item types with captions ("6 identical black tees. They're different."), plus 1–2 invented props.
- Animation: items drop in one by one.

### 3. Gatekeeper score
How niche your brands are, 0–100. A gauge or dial, the score, and the person's brands ranked from most to least obscure as chips.
- Copy: "You knew Auralee before your barista did."
- Must work with 3 brands or 15.

### 4. Then vs now
Two columns or a split card, earliest year vs latest year: top brands, colors or item types. "2021: all Zara. 2026: all COS. Growth." Needs two years with enough orders, so it's often absent.

### 5. Style icon: "It's a match"
A Tinder-style match screen: the person and their style icon side by side, "IT'S A MATCH" in big type, "**87%** match with **Jacob Elordi**". Underneath: three traits ("Big coat · Old loafers · Effortless on purpose"), a one-line why tied to the person's purchases, "based on 140 orders".
- **Icon side:** a freely licensed photo of the icon (e.g. Wikimedia Commons), with room for a small credit line. Many icons, especially fictional characters, won't have one: then show an empty photo frame with the icon's name below. This empty state is common in the MVP, so it must look intentional, not broken.
- **Person side:** only when the person has given us a photo (outfit photos from onboarding, or one added before sharing). Without one, the card shows **the icon alone**, still clearly a match. Design both layouts: side by side, and icon only.
- The percentage is real (computed), shown as a big number. Animation: the two cards slide in from the sides and "IT'S A MATCH" lands.
- Catalog: [style-icons-draft.md](style-icons-draft.md), about 38 icons. New icons should be cheap to add.

### 6. Dating profile
A Hinge-style profile: "**Jack, 31**", then 2–3 prompts and green/red flags built from shopping:
- "Loves: Dries Van Noten, black tees, feeling superior because he knows what Auralee is"
- "Green flag: owns one good coat. Red flag: owns six of the same tee."
- "Looking for: someone to talk to about JW Anderson"
- Photo slot: an outfit flat-lay assembled from the person's looked-up product images (or illustrated tiles).
- Age comes from birthday. Show gender or pronouns only if the person chooses; don't assume.

### 7. The headline (closer)
The Daily Jules newspaper: one headline about the person's strongest pattern ("Local Man Buys Sixth Black Tee, Calls It 'Different'"), a subhead, and a photo slot (product image or illustration). Last card, ends with the call to action.

## Story player (around the cards)

- Full-screen 9:16 on a phone, with tap-left/right zones and progress bars on top.
- **Share** on every card: exports a 1080×1920 PNG through the phone's share sheet.
- **Thumbs up / down** on every card (in the app only, never in the exported image). Thumbs down asks one quick reason: wrong, not funny, or don't want to share.
- **Hide line / hide card** controls.
- First screen: "Your style report is ready." Last screen: share all + "see your wishlist".

## Shared image and the way back

- Every exported card has the Jules wordmark and a short URL ("jules.style/r/jack" or similar) so the image works without a link.
- **Share landing page** (mobile first): someone opens a friend's link and sees that friend's card plus "Get your style report" leading to signup. This is the viral loop; make it irresistible.
- iMessage / social link preview for that page.

## Deliverables

1. The 7 templates, each filled for Jack, Priya, Dana and one sparse person, in at least 2 themes.
2. The image treatments: photo found, no photo (illustrated tile), invented prop.
3. The "It's a match" card with 5 sample icons (3 real people, 2 characters), each in both layouts (with the person's photo, icon only), plus the empty photo state.
4. Story player: the first card, a middle card with controls, thumbs-down follow-up, hide controls, the last card.
5. Exported PNG frame (1080×1920) for 2 cards.
6. Share landing page (phone and desktop) and link preview.
7. A short animation spec per card (entrance, duration ~3–5 s, what loops).
