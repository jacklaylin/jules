# Shop integration

Status: October 13, 2026. Founder-requested. Shop (shop.com, Shopify's agent service) is used as **one source among several**, because its catalog only covers Shopify stores. A check on the same day found 28 of the 120 registry stores in Shop's catalog (for example Aimé Leon Dore, Stüssy, Lemaire, Kith, Bodega and The Webster). None of the luxury houses or department stores were there. For luxury items, Shop mostly returns resellers.

Each part has its own setting and is off by default.

| Setting | What it does | Setup |
|---|---|---|
| `SHOP_CATALOG_ENABLED=true` | Searches Shop's catalog alongside web search. If the user requires a brand whose own store is on Shopify, Shop searches that store directly. | None. No account or key. |
| `CHECKOUT_LINKS_ENABLED=true` | When the user says they're ready to buy, Jules replies with a link. For a store in Shop's catalog, the link opens that store's cart with the user's exact size already added. For any other store, it's the product page. | None. |
| `SHOP_ORDERS_ENABLED=true` | Adds "Add your Shop orders" to `/onboarding`, next to Gmail. | Run `db/022_history_sources.sql`. Requires the Gmail pilot settings (Shop's sign-in is stored with the same encryption key). |

Shop order history is the first *connected source*. It runs on shared purchase-history rails that future MCPs can reuse; see "Adding a purchase-history source" in [ARCHITECTURE.md](ARCHITECTURE.md).

## Neutrality rules (enforced in code)

- Shop never ranks merchants. Its results are candidate links. Each one passes the same page check as any other store, then is interleaved with web results. Market and taste ranking decide the order.
- Shop links carry tracking and variant parameters. Jules checks and shows the plain product page instead.
- Checkout links never change which store was recommended. Shop groups the same product across many sellers. If Shop offers another seller's cart for that size, Jules reports the size as unavailable at the chosen store.
- Sizes are never converted. If the user's size doesn't exactly match one of the store's sizes, Jules lists the store's sizes and asks which one.
- Logs (`text_wishlist_sources`) and the admin replay report count shown merchants by source. Watch these after turning on `SHOP_CATALOG_ENABLED`.

## Turning it on

1. Set `SHOP_CATALOG_ENABLED=true` in Vercel. Run the replay suite on `/admin/replays` and compare "Shown merchants by source" with a run from before the change.
2. Set `CHECKOUT_LINKS_ENABLED=true`. Run the routing eval on the same page. Its checkout cases check that liking an item, saving it or asking its price never produces a checkout link.
3. For order history, run `db/022_history_sources.sql` in the Supabase SQL Editor, set `SHOP_ORDERS_ENABLED=true`, and deploy. Then open `/onboarding`, tick the consent box, and click **Connect Shop**. Shop shows a code. Approve "Jules" in the Shop app, and the page imports up to 100 orders from the last five years. Follow-up questions arrive by text, as they do for Gmail.

No new secrets are needed. Shop's sign-in token is encrypted with `GMAIL_TOKEN_KEY` and stored with the Gmail import data. It is never sent to the browser or to OpenAI. Only order records are sent to OpenAI, under the consent shown on the page.

## Checking a Shop import

- **Admin → People → a person → purchase history.** Each item shows which sources found it (for example "Gmail + Shop"), and the "Found by" filter can show items found by more than one source. "Connected sources" shows what Shop returned page by page and why listing stopped. It also lists each Shop record with a short summary (no addresses or contact details) and what was found: purchases, links to another source's item, or nothing.
- **Matching across sources:** a Shop record links to an existing item when the store's order number matches. If Shop has no store order number, it links to an item from the same store bought within 14 days, provided the product names agree and no stated size, colour or SKU differs. Gmail-to-Gmail matching still requires the order number.
- **Re-read all Shop orders** (on `/onboarding`) reads every Shop record again with the current rules and replaces earlier Shop results. Gmail history is untouched.

## Keeping the store list current

`lib/shopify-stores.json` records which registry stores Shop carries. Refresh it monthly, or after editing `lib/source-registry.js`:

```bash
node scripts/shopify-stores.js
```

Review the diff, then commit the updated file.

## Before relying on order history

- **Terms:** Jules uses Shop's public sign-in client, which is meant for a person's own assistant (the `personal_agent` permission). Jules is one service acting for several testers. Confirm with Shopify that this use is allowed before inviting testers beyond yourself.
- **No live order test yet:** Shop doesn't publish the format of its order records. Jules reads each order with the same model-plus-validation step used for Gmail, so it doesn't depend on exact field names. Still, the first real import should be your own account. Check the found items on `/onboarding` before inviting anyone else.
- Disconnecting deletes Jules's copy of the token, but Shop has no revoke endpoint for this client. Users remove "Jules" in the Shop app's settings. **Delete imported history** removes both Gmail and Shop evidence.

## Not built

- Purchases inside Jules (Shop's spend requests). This would need the PRD's no-autonomous-checkout rule changed first.
- Telling users when Shop ignored a search filter. Jules records these in diagnostics. Today it only sends Shop a store filter, and brand checks enforce that independently, so no user-facing note is needed yet.
