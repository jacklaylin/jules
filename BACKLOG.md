# Product backlog

Ideas the founder wants kept, not built yet. Nothing here is assigned work: build an item only when the founder asks. Go-live blockers (self-serve onboarding, silent-Jules alert, per-user cost caps) are tracked separately; see [GTM.md](GTM.md) "Before strangers can text Jules".

## Conversation and interface

- **Decision pages that hand back to iMessage.** A small page that answers one request instead of a whole app, e.g. three colorways side by side with "which one?". Tapping a choice returns the user to the Jules thread with the answer. Solves iMessage's weakness at visual comparison without building a browsing UI.
- **Apple Messages for Business.** Apple's business channel inside the native Messages app has built-in list pickers, rich links and Apple Pay. Poke uses it to appear as a third-party agent in Messages. Could replace some decision pages and later carry checkout. Needs Apple approval; unknown whether Photon supports it. Check with Photon first.

## Closet and planning (UI/UX inspiration: Alta)

- **Outfit and closet planner.** Builds on the wardrobe and evidence store. Take layout and interaction cues from Alta's closet and outfit views.
- **Trip planner.** "I'm going to Italy next month, handle it": a packing list from the closet plus gaps Jules shops for.

## Commerce

- **Checkout.** Later, as merchants expose agent checkout (MCPs, OpenAI's Agentic Commerce Protocol, Google's Universal Commerce Protocol, Shop). V0 still never completes purchases.
- **Affiliate revenue.** Moved out of the backlog: P0 after beta. See [AFFILIATE-LINKS.md](AFFILIATE-LINKS.md).

## Purchase history sources

- **Receipt forwarding address.** Users forward order emails (or set a Gmail filter to auto-forward them) to a Jules address. Captures new purchases from any store without the Gmail restricted-scope review.
- **Store data exports.** Amazon "Request your data" order history and similar exports, uploaded once. Slow (days) and clunky; lower priority.

## Discovery

- **Jules inside ChatGPT and Claude.** An app (MCP server) that lets an assistant hand off "keep watching this in my size" to Jules, and shows up when people ask those assistants for shopping help. Real build plus each platform's review. Revisit after launch; see [GTM.md](GTM.md) "Search and answer-engine discovery".
