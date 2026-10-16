# "Your style in four emojis": personas, draft for founder markup

Approved October 16, 2026 (founder: "looks good, ship it"). Dresses use 🪩 instead of 💃 so they never clash with heels. Reworks the captions on the four-emoji card ([emoji-signals-draft.md](emoji-signals-draft.md)). The signals, thresholds and picking rules stay the same. What changes is what the card shows.

## What changes

- **Emoji** shows the behaviour or identity the data implies, not the object counted (😎 instead of 🕶️).
- **Persona** is a fixed, approved name for that behaviour. Code picks it from this table; the model never invents one.
- **Aside** is the only part the model writes: a short bracketed line that carries the person's number and the joke, e.g. **olympic shopper** (45 stores, still training).
- The counted fact still backs every card: the aside must contain the fact's exact numbers and no others (the existing check), and if the aside fails, the card falls back to the plain fact in brackets.
- Rules unchanged: nothing about bodies, age, money or motives.

## How to mark up

For each row: keep, strike or rewrite the emoji and persona. Where a row has more than one persona, pick one or keep several (code would rotate between them by person, so the same person always sees the same one). Add notes in the last column.

## The table

| Signal | Old | New emoji | Persona options | Example aside | Notes |
|---|---|---|---|---|---|
| Many different stores | 🛍️ | 🏋️ | olympic shopper | (45 stores, still training) | |
| Mostly one store | 🔁 | 💍 | married to [store] | (62% of orders, no prenup) | |
| Many orders, one store | 📦 | 🚚 | on first-name terms with the courier | (14 Uniqlo orders) | |
| Cycling kit | 🚲 | 🚴 | kit before watts · coffee ride regular | (15 pieces, bike pending) | |
| Running kit | 🏃 | 🏅 | runs for the merch · run club captain | (8 pieces, pace unknown) | |
| Studio pieces | 🧘 | 🧘 | studio regular | (6 pieces, namaste) | |
| Trail gear | 🏔️ | 🧭 | expedition ready (to the shops) | (5 pieces of trail gear) | |
| Swim | 🩱 | 🏝️ | always packed for the beach | (4 swim pieces) | |
| Shades | 🕶️ | 😎 | permanently on holiday | (5 pairs, sun benched) | |
| Sneakers | 👟 | 🧼 | keeps them box-fresh · sneakerhead | (9 pairs, all clean) | |
| Boots | 👢 | 🤠 | yeehaw-adjacent | (4 pairs, no horse) | |
| Heels | 👠 | 💃 | always going out-out | (5 pairs) | |
| Denim | 👖 | 🧵 | denim devotee | (7 denim pieces) | |
| Knits | 🧶 | 🐑 | personally sponsors a sheep | (12 knits) | |
| Coats and jackets | 🧥 | 🌧️ | weather-ready (indoors too) | (6 coats) | |
| Tailoring | 👔 | 💼 | dressed for the board meeting | (8 tailoring pieces) | |
| T-shirts | 👕 | 🧑‍🔬 | uniform dresser | (11 tees, one look) | |
| Hats and caps | 🧢 | 🎩 | hat collector | (4 hats, one head) | |
| Bags | 👜 | 🪆 | bags for your bags | (5 bags) | |
| Jewellery | 💍 | 🐉 | dragon's hoard | (6 pieces of jewellery) | |
| Dresses | 👗 | 💃 | always dressed for it | (7 dresses) | |
| Basics restocks | 🧦 | 🐿️ | stocks up for winter | (6 restocks) | |
| Same item on repeat | 👯 | 🤖 | found it, bought it forever | (same tee ×4) | |
| One item, many colours | 🎨 | 🖍️ | collects every colourway | (one hoodie, 5 colours) | |
| Nov–Dec orders | 🎄 | 🎅 | Santa's best customer | (41% of orders in Nov–Dec) | |
| Binge weeks | ⚡ | 🌪️ | haul season | (3 weeks with 4+ orders) | |
| Slow and steady | 🐢 | 🍷 | aged like wine | (4 years, never rushed) | |
| Second-hand | ♻️ | 🕵️ | thrift detective | (30% second-hand) | |
| Niche score high | 🗝️ | 🦄 | gatekeeper | (niche score 78) | |
| Deep-cut labels | 🔍 | 💿 | B-sides only | (3 deep-cut labels) | |
| Niche score low | 🏬 | 📣 | crowd favourite | (niche score 9) | |
| Luxury labels | 💎 | 👑 | label royalty | (45% luxury labels) | |
| Black | 🖤 | 🦇 | vampire hours | (74% black) | |
| White and cream | 🤍 | 👻 | friendly ghost | (44% white and cream) | |
| Grey | 🩶 | 🌫️ | fifty shades | (41% grey) | |
| Navy and blue | 💙 | ⚓ | ex-sailor | (48% navy and blue) | |
| Brown and camel | 🤎 | 🧸 | teddy-bear palette | (40% brown and camel) | |
| Pink | 🩷 | 🦩 | flamingo | (28% pink) | |
| Green | 🫒 | 🐸 | frog mode | (30% green) | |
| Many colours | 🌈 | 🦜 | parrot | (7 colour families) | |

## Open questions

- Emoji clashes: 💃 is used for both heels and dresses, and 🧘 is reused as-is for studio. Pick one new emoji for each, or accept the overlap (they can't both appear unless the picker blocks it).
- Shared version: the caption that goes out with a shared card names the person. Persona stays the same; only the aside gets the name?
