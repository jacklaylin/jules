# Saved-item rich previews

Single-item text-save confirmations include a signed product-preview URL. Photon sends the confirmation followed by native `richlink` content. Preview-send failures are logged and do not undo the save or fail the confirmation. Multi-item saves retain the collection link for now.

The preview endpoint validates an HMAC before reading one item. It exposes only its sourced name and product photo. Original images, outfit crops, custom display names, profile facts, account identifiers and prices are excluded. Removed/missing items return an unavailable response. Opening the link redirects to the private wishlist; normal account authentication and ownership checks still apply.

Existing product JPEGs are resized with Sharp and cached in the function and CDN. Missing photos use the “Have to have it? Text jules.” campaign artwork while keeping the saved product title. There are no new search/model requests, services, tables or credentials. HMACs use the existing server-only Supabase service key with a preview-specific signing context. Rotating that key invalidates existing preview URLs. Cached product images may remain available until the CDN cache expires; they contain no user photos or profile data.

`SITE_ORIGIN`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must already be configured for the existing wishlist. Vercel bundles the fallback PNG with the preview function. No additional founder setup is required.

Regression tests cover signature tampering, malformed URLs, missing/removed items, metadata escaping, private-image exclusion, image sizing, cross-account deep links, sign-in continuity and native rich-link sends. Actual Apple rendering and phone receipt require a real newly saved-item message; mocked provider acceptance does not establish those outcomes. Existing messages do not gain new previews retroactively.

## Public and style links

The homepage uses `public/brand/previews/fallback-v1.png` with “Have to have it? Text Jules.” and the description “Your personal shopper, in iMessage.” The wishlist collection uses the same image with “Your wishlist.” The style page uses `style-v1.png`, a yellow field with the outlined Jules logo, and “Your style reading.” Both images are 1200×630 and contain only public brand artwork.

Photon adds a best-effort native rich card for one distinct supported public destination in the outgoing answer: `/`, `/style`, or `/wishlist` on `SITE_ORIGIN`. The original text and URL remain usable if card delivery fails. Multiple destinations remain ordinary links. Links with credentials, query parameters, fragments, or another origin are not promoted by this public-link formatter. This is URL formatting, not conversational intent routing; it does not add readiness claims or change the answer. Existing signed saved-item previews retain their validation and product-specific behavior.

Rebuild art with `node scripts/build-link-previews.js`; set `CHROME_PATH` if Chrome is installed somewhere other than the standard macOS location. The script uses the bundled Instrument Serif font and existing wordmark outlines. Change the image filename version and metadata references when replacing artwork. Static metadata currently uses the existing production origin `https://jules-gamma.vercel.app`; update those references if the public domain changes.

Verification: all 415 application tests passed after this change, including public URL validation, card-send failure, metadata, image size, signed-item privacy and fallback handling. Both generated images were visually inspected. Deployment and a fresh real iMessage preview remain necessary to verify Apple’s final rendering; no real messages were sent during these checks.
