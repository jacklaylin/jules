# Saved-item rich previews

Single-item text-save confirmations include a signed product-preview URL. Photon sends the confirmation followed by native `richlink` content. Preview-send failures are logged and do not undo the save or fail the confirmation. Multi-item saves retain the collection link for now.

The preview endpoint validates an HMAC before reading one item. It exposes only its sourced name and product photo. Original images, outfit crops, custom display names, profile facts, account identifiers and prices are excluded. Removed/missing items return an unavailable response. Opening the link redirects to the private wishlist; normal account authentication and ownership checks still apply.

Existing product JPEGs are resized with Sharp and cached in the function and CDN. Missing photos use the existing outlined Jules logo. There are no new search/model requests, services, tables or credentials. HMACs use the existing server-only Supabase service key with a preview-specific signing context. Rotating that key invalidates existing preview URLs. Cached product images may remain available until the CDN cache expires; they contain no user photos or profile data.

`SITE_ORIGIN`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must already be configured for the existing wishlist. Vercel bundles the fallback wordmark with the preview function. No additional founder setup is required.

Regression tests cover signature tampering, malformed URLs, missing/removed items, metadata escaping, private-image exclusion, image sizing, cross-account deep links, sign-in continuity and native rich-link sends. Actual Apple rendering and phone receipt require a real newly saved-item message; mocked provider acceptance does not establish those outcomes. Existing messages do not gain new previews retroactively.
