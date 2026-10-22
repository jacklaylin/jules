# User context layer

Everything Jules knows about a person, read in one place (`lib/user-context.js`) so every
search, recommendation and ranking works from the same picture.

## Why

Before this, each part of Jules picked its own subset of facts. The stylist, ranking, the search
relevance check and the style report each had their own list of fields, so a source could reach one
of them and silently miss another (outfit photos never reached the stylist; dislikes, inspirations
and liked items never reached search constraints).

## How it works

- `readUserContext(store, owner, env)` reads every source for a person, fresh on each request.
  There is no extra table or background job: a new receipt, closet edit or liked item counts on
  the next message. A source that fails to read is logged (`context_read_failed`) and left out;
  it never blocks a reply. Each read logs `user_context` with what was found.
- `tasteView(facts)` is the one taste view. Search constraints, the stylist and ranking all read it.
  Adding a source to the layer reaches all of them together.
- A request for someone else uses none of the person's own taste, in search, the stylist and ranking.

## Sources, strongest first

| Source | Field | Where it comes from |
|---|---|---|
| Stated facts | style, brand, avoid, size, budget, … | Chat and the signup form (`lib/memory.js`, `taste_profiles`) |
| Purchases | `shopping_history` | Gmail, Shop and order screenshots, with closet edits applied. Chat and search see a summary; ranking sees each item. |
| Wardrobe | `wardrobe` | What they own now by category (types, colours, patterns, fits, formality, recurring details), from the wardrobe view, item tags and photo tags (`lib/closet-summary.js`). Owning is not wearing or liking: soft context, never a filter or a preference. |
| Liked items | `liked_items` | Screenshots of likes and shown options the person liked |
| Outfit photos | `outfit_photos` | Outfit photos kept for the style reading |
| Wishlist | `wishlist` | Items they saved, distinct per item, newest save first (`lib/brand-taste.js`) |
| Brand taste | `brand_taste` | One reading of the brands they like, from what they said, bought, saved and liked (below) |

Anything the person states outranks derived sources, which are soft evidence only: never a price,
stock, size or favorite-status claim.

## Brand taste

October 22 (founder): the saved "favorite brand" facts were three brands from one early message, copied again
by the style pack, and the stylist read them as fixed taste. `brand_taste` combines every source per brand:
`said` (the statement and its date; a copy never makes it newer, and `from` names a non-chat source),
`bought` and `bought_recently`, `bought_as` (what kinds of items they were, from the closet's item tags, basics left out), `wishlisted` and `last_wishlisted`, and `liked`. A brand is strong context for requests of the kinds it was bought as and much weaker for others: gym brands inform gym clothes, not a shirt (founder, October 22). Brands are
ordered by behaviour: a save or like counts more than a receipt line, purchases are capped so gym kit or
socks don't swamp them, and every stated brand stays in the list. The October 8 style-pack copies of brand statements (`style-pack/…`) were soft-deleted from the one profile that had them; nothing writes them any more. The stylist reads it as `brand_taste` (in
place of the raw favourites), and the ranker sees each candidate brand's entry. With it present, `tasteView`
leaves out the raw brand statements. It is soft taste: never a filter or a loyalty claim, and avoids and
corrections stated elsewhere still win.

## Next steps

1. ~~One layer and one taste view for chat, search, the stylist and ranking.~~
2. ~~Wishlist saves as a source.~~ (October 22, with brand taste)
3. ~~Style report and proactive texts read the same layer.~~ (October 22) The style reading (`api/style.js`) reads
   the layer's taste view, with brands as one `brand_taste` line. The questions Jules texts after a purchase import
   (Gmail, Shop and other sources, and the daily purchase check) read it through `contextForImport`, which
   skips the purchase sources because the import is the purchases. Taste coverage (the early read and the interview)
   counts wishlist saves as a brand source. The Wrapped style report stays purchase-only on purpose: it counts what
   was bought.
4. An admin view of what Jules knows about a person, from the layer.
