# Saved-item rich previews

Single-item text-save confirmations include a signed product-preview URL. Photon sends the confirmation followed by native `richlink` content. Preview-send failures are logged and do not undo the save or fail the confirmation. Multi-item saves retain the collection link for now.

The preview endpoint validates an HMAC before reading one item. It exposes only its sourced name and product photo. Original images, outfit crops, custom display names, profile facts, account identifiers and prices are excluded. Removed/missing items return an unavailable response. Opening the link redirects to the private wishlist; normal account authentication and ownership checks still apply.

Existing product JPEGs are resized with Sharp and cached in the function and CDN. Missing photos use the “Have to have it? Text jules.” campaign artwork while keeping the saved product title. There are no new search/model requests, services, tables or credentials. HMACs use the existing server-only Supabase service key with a preview-specific signing context. Rotating that key invalidates existing preview URLs. Cached product images may remain available until the CDN cache expires; they contain no user photos or profile data.

`SITE_ORIGIN`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must already be configured for the existing wishlist. Vercel bundles the fallback PNG with the preview function. No additional founder setup is required.

Regression tests cover signature tampering, malformed URLs, missing/removed items, metadata escaping, private-image exclusion, image sizing, cross-account deep links, sign-in continuity and native rich-link sends. Actual Apple rendering and phone receipt require a real newly saved-item message; mocked provider acceptance does not establish those outcomes. Existing messages do not gain new previews retroactively.

## Public and style links

The homepage uses `public/brand/previews/fallback-v1.png` with “Have to have it? Text Jules.” and the description “Your personal shopper, in iMessage.” The wishlist collection uses the same image with “Your wishlist.” The style page uses `style-v1.png`, a yellow field with the outlined Jules logo, and “Your style reading.” Both images are 1200×630 and contain only public brand artwork.

Photon adds a best-effort native rich card for one distinct supported public destination in the outgoing answer: `/`, `/style`, or `/wishlist` on `SITE_ORIGIN`. The original text and URL remain usable if card delivery fails. Multiple destinations remain ordinary links. Links with credentials, query parameters, fragments, or another origin are not promoted by this public-link formatter. This is URL formatting, not conversational intent routing; it does not add readiness claims or change the answer. Existing signed saved-item previews retain their validation and product-specific behavior.

Rebuild art with `node scripts/build-link-previews.js`; set `CHROME_PATH` if Chrome is installed somewhere other than the standard macOS location. The script uses the bundled Instrument Serif font and existing wordmark outlines. Change the image filename version and metadata references when replacing artwork. Static metadata uses the production origin `https://textjules.com`; update those references (and `public.site_origin()` in `db/039_site_origin.sql`) if the public domain changes.

Verification: all 415 application tests passed after this change, including public URL validation, card-send failure, metadata, image size, signed-item privacy and fallback handling. Both generated images were visually inspected. Deployment and a fresh real iMessage preview remain necessary to verify Apple’s final rendering; no real messages were sent during these checks.

## Product links (`/go/…`)

Every store link in a sourcing or checkout reply is sent as a signed `/go/<token>` link, whether or not `LINK_CLICK_TRACKING` is on. The token points at a position in the reply's stored search result, so the link can only reach a product Jules actually showed.

- **A person tapping it** gets an instant 302 to the store. The tap is recorded in `adoption_events` only when `LINK_CLICK_TRACKING=true`.
- **A preview fetcher** (iMessage's, by user agent; this is a technical header check, not conversational routing) gets a small page with Open Graph tags: the product's brand and name as the title, followed by " · <store>" unless the title already names the store (iMessage shows only the title and domain, not the subtitle). No price, size, stock or shipping appears, so a card can't go stale or overclaim. Stores that block preview bots (e.g. SSENSE) still preview, because Apple never has to fetch the store.
- **The photo** is the product's Google Lens thumbnail (photo searches; only `encrypted-tbn*.gstatic.com`, via `fetchProductPhoto`), else the first photo from the store page Jules verified for that product (`listing_check.product_images`, via `fetchProductAssets`; text searches). It is placed on an 800×800 white square and cached in the function and CDN. Lens thumbnails are small, so those card images are soft. A product with no photo, or one that can't be fetched, has no image at all (founder decision: repeated brand art would get annoying).

The card shows the Jules domain, not the store's. Links stop working if the stored reply row is deleted or the Supabase service key is rotated. No migration, service or credential is added.

iMessage only previews a bubble that is just one link, so links inside a multi-link answer stay plain text. So after the answer, each product the answer links (the first 3, in result order) goes out as its own `richlink` card for that product's `/go/` link:

- **Text searches:** one card per product, sent right after the answer, with no caption.
- **Photo searches:** the composer's caption (or a factual "Option N: name. Possible match./Similar alternative." label) threads under the answer, and the card threads under the caption in place of the product photo.
- **If a card fails**, the product photo is sent instead, under the caption that was already sent. A text-search product has no photo to fall back to, so its text link stands. The answer itself is never changed or resent. Logged as `product_rich_preview_sent` / `product_rich_preview_failed`.

A product linked only through a merchant option or checkout link gets a card for that link. Products beyond the first 3 stay as text links.
