# Sent product link recovery — October 9, 2026

The wishlist could retain a supplied link as “Item from [host]” with no price or photo because the product reader used the merchant-ranking registry as an access allowlist. Automatic photo recovery then used that placeholder as the product name, without repairing the missing metadata.

Public HTTPS stores and observed product-image CDNs can now be read independently of ranking. New hosts use DNS-checked, address-pinned HTTPS requests; private addresses, unsafe redirects, invalid images and oversized bodies remain blocked. The registry still controls sourcing priority and merchant preference. Page metadata must establish the product; model-generated URLs or facts do not establish it. Variant query parameters must match the structured evidence. Unknown/ambiguous prices and availability remain unknown.

New consented link saves read product metadata and photos before persistence. On wishlist load, the existing authenticated background recovery also repairs unverified user-saved links, including those that already have a photo. It preserves existing images, updates owned item/encounter records, and refreshes card titles/prices and an open detail dialog. Each request handles at most two eligible items; failed attempts wait five minutes before another visit retries them. Additional items can recover on subsequent visits. No schema, credential, service or deployment setting is added.

Verification:

- Deterministic regressions cover off-registry stores/CDNs, new saves, variant isolation, private-network rejection, DNS pinning, existing-image preservation and retry cooldowns.
- Local desktop (1365px) and phone (390px) browser checks with synthetic data verified that background recovery updates both the card and the open dialog without page errors.
- A read-only live request to the founder's everybody.world link established Rib Long Sleeve / EVERYBODY.WORLD, a sourced USD 48 snapshot, and two successfully decoded photos. Mixed variant availability remained unknown. This is retrieval verification, not production persistence acceptance.

Deployment remains pending. After deploying through the existing project workflow, reload the wishlist to start recovery; no SQL or new secret is required. Blocking/unsupported pages may still retain honest partial results. Hosted browser rendering remains limited to the existing supported browser domains, with exact-URL search-index evidence available when configured.
