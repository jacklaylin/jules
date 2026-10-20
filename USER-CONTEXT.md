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
| Liked items | `liked_items` | Screenshots of likes and shown options the person liked |
| Outfit photos | `outfit_photos` | Outfit photos kept for the style reading |

Anything the person states outranks derived sources, which are soft evidence only: never a price,
stock, size or favorite-status claim.

## Next steps

1. ~~One layer and one taste view for chat, search, the stylist and ranking.~~
2. Wishlist saves as a source.
3. Style report and proactive texts read the same layer.
4. An admin view of what Jules knows about a person, from the layer.
