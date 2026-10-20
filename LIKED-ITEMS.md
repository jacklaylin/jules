# Liked items (taste without the wishlist)

Status: October 19, 2026. Founder-requested after a tester sent a screenshot of her Depop likes, most of them sold.

Testers can text Jules screenshots of their likes, favorites or saves on a resale or shopping app (Depop, The RealReal, Vestiaire, Grailed…). Jules keeps those items as **taste signals**: what she likes, not things to buy. They never go on the wishlist and never get price alerts. Many are sold, one-of-a-kind or used, so Jules offers to find similar items instead.

There's no button or keyword. The chat agent decides what the screenshot shows:

| Screenshot shows | Tool | Where it goes |
|---|---|---|
| Things they liked or saved | `add_liked_items` | Taste signals (this feature) |
| Their own orders or receipts | `add_order_screenshot` | Purchase history / wardrobe (existing) |
| Their own outfits | `add_outfit_photos` | Style photos (existing) |
| An item to find | `find_products` | Search (existing) |

If it isn't clear whether they liked or bought the items, Jules asks once. When they also ask for "anything with this vibe", Jules keeps the likes and searches in the same turn.

Shown options a tester says she likes ("I like the 1st most") are kept the same way. Liking is still not a save: saving needs her to ask.

## What is kept

- One vision call per screenshot reads the tiles. Brand, title, app name and the "Sold" label are kept only when that text is written in the screenshot. A brand is never guessed from how an item looks.
- Garment type, up to 3 colors and up to 4 visible details (sheer, lace trim, asymmetric hem) are short descriptions of what's visible.
- Prices, sizes, seller handles and names are never kept.
- Rows are stored as evidence (origin `chat`, ids starting `liked:`). **No database migration is needed.**
- The agent, the stylist and the discovery ranker see a summary (top brands, garments, details, recent items). It is labelled soft evidence, ranked below anything the tester says.

## Forgetting

"Forget my Depop likes" removes them (one set of screenshots, or all). Wishlist items and stated preferences are untouched.

## Not built yet

- Showing liked items on the `/style` or profile page.
- Connecting Depop or The RealReal accounts directly. Neither offers buyers an API: Depop's API is invitation-only and for sellers, and The RealReal's is for vendors. Scraping breaks their terms and would need retailer passwords, which V0 must not store. Orders from these stores still arrive through the Gmail import (order emails) or order screenshots.
