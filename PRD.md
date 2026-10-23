# PRD — AI Personal Shopper V0

**Status:** Prototype  
**Goal:** Working product in ≤1 weekend  
**Initial users:** Founder + 5–10 invited testers  
**Budget:** ≤$250 to launch  
**Primary interface:** iMessage via Photon (founder-approved change; SMS/RCS fallback is not the Milestone 1 test)
**Working name:** TBD

**October 7, 2026 founder decision:** Jules must be a self-supported application with no human intervention required to fulfill shopping requests. Milestone 7 (human fallback) is deprioritized and will not be implemented. This supersedes the earlier operator-assisted sourcing plan. Unsupported requests must receive an honest, useful automated response; self-supported operation does not authorize fabricated commerce facts or autonomous purchases.

## 1. Product thesis

The internet solved access to inventory. It did not solve shopping.

Fashion inventory is fragmented across brands, department stores, boutiques, marketplaces, resale platforms, and geographic markets. Consumers can theoretically access more products than ever, but finding the *right* product requires substantial browsing, comparison, taste judgment, price research, and transaction management.

Existing retailers and marketplaces primarily organize shopping around inventory:

**Retailer → assortment → filters → product → checkout**

We want to invert that hierarchy:

**Person → taste → intent → product → best source → transaction**

The product is:

> **A personal shopper that knows your taste and shops the entire internet for you.**

Longer-term, the company aims to:

> **Collapse the fragmented retail internet into a personalized execution layer.**

## 2. What we are testing

This is an experiment, **not production software**. Prefer the simplest implementation possible. No premature infrastructure.

The central hypothesis is not “Can AI recommend clothing?” It is:

> **If an agent understands someone's taste well enough, will that person delegate meaningful shopping intent to it?**

We want to observe users progressing through increasing levels of delegation:

**Ask → Recommend → Source → Monitor → Proactively discover → Purchase**

Strong early behavior includes persistent mandates such as:
- “Keep looking for these in a 48.”
- “Tell me whenever you see something like this.”
- “I need outfits for Italy next month. Handle it.”
- “If these ever drop below $400, tell me.”

V0 does **not** need to support autonomous purchasing.

## 3. Target users

Do not optimize around one ICP yet.

### Archetype A — The expert shopper
Knows brands, designers, sizing, and personal taste. Pain point: excessive time searching, comparing retailers, and monitoring inventory/prices.

### Archetype B — The affluent shopping avoider
High disposable income, wants to look good, but dislikes shopping or lacks confidence. Pain point: decision overload.

### Archetype C — The fashion enthusiast
Strong aesthetic preferences and follows fashion/social accounts. Pain point: wants newness, discovery, and access.

### Archetype D — The hunter
Knows exactly what they want. Pain point: item is sold out, rare, geographically fragmented, or difficult to locate.

### Archetype E — The optimizer
Already knows what they want but wants the best transaction. Pain point: price, sales, shipping, duties, returns, and retailer fragmentation.

## 4. Product principles

### 4.1 Conversation over interface
The primary interface is iMessage via Photon. Users communicate naturally and the system should infer and remember context. A small companion web wishlist lets users revisit items and links Jules has already sent; shopping requests still start in the conversation. This is the first step toward a digital closet, not a full consumer dashboard.

Conversation behavior must follow intent and expected outcome, not phrase triggers. Interpret each message using the current choices, recent conversation, relevant images, and saved preferences. The model proposes a structured interpretation; application code validates evidence, product references, and consent before acting. Do not use keyword or regex rules to choose conversational responses, reactions, or state transitions.

Users may choose one variant, several, all, none, or express a tentative preference. Preserve that set and its uncertainty and offer the next useful step. Do not restart sourcing or repeat a list when the user has already narrowed it. Ask for clarification only when it materially affects what happens next. For example, interest in two colors should lead to an offer to wishlist both and a question about price-drop reminders for both, rather than forcing a single color. Offers are not completed actions; saving and reminders require clear consent scoped to the intended set.

Conversational continuity is a trust requirement. Regression tests must cover varied wording and multi-turn outcomes, including subsets, all/none, corrections, uncertainty, topic changes, and consent. Examples illustrate behavior; they are not required commands or exact response templates.

### 4.2 Taste before catalog
Do not show large result sets. Default to **3 products**, maximum **5** unless explicitly requested.

### 4.3 Remember everything useful
Users should not repeatedly specify sizes, brands, price sensitivity, aesthetic preferences, retailer preferences, owned items, or rejected recommendations. Persistent understanding is central.

### 4.4 Search broadly, recommend narrowly
The agent should consider many candidates but expose very few. The value proposition is: **“I looked everywhere so you don't have to.”**

### 4.5 Be opinionated
Avoid generic assistant language. Make judgments and explain relevant tradeoffs.

### 4.6 Never fabricate commerce information
Never invent prices, inventory, size availability, shipping costs, duties, retailer policies, or discounts. Flag uncertainty and offer a useful next step within the conversation.

## 5. V0 user journey

### Acquisition
User encounters an Instagram/TikTok/social post with a CTA such as:

> **Meet your new personal shopper. Text [NUMBER].**

No app download.

## 6. Onboarding

Optimize for **time-to-magic**, not profile completeness.

### Message 1
> Hey — I'm your personal shopper. I learn what you like and shop the internet for you.
>
> Start by sending me 3–5 screenshots of outfits or pieces you love. Instagram, Pinterest, camera roll—anything.

### Initial taste interpretation
Analyze the images and return a concise, specific interpretation that feels perceptive rather than generic. Ask how accurate the read is.

### Revealed preference
Ask:
> Now send me a photo of something you actually wear constantly.

Use this to distinguish aspirational taste from actual behavior.

### Basic constraints
Collect typical top size, pants size, shoe size, and rough price sensitivity without forcing a detailed questionnaire.

### Immediate shopping
Finish with:
> Got it. Give me something to shop for.

Target time to first shopping request: approximately **5 minutes**.

## 7. Core V0 capabilities

### FIND
Interpret an open-ended need using the taste profile, search the web, gather candidates, evaluate them, and return the best 3.

Each recommendation should include, when available:
- image
- brand
- product
- price
- retailer
- link
- concise rationale

### SOURCE
Given a link, screenshot, product name, or image, search for matching listings and requested sizes. Return retailer, price, availability, shipping information when available, and link. If confidence is insufficient, retain supported partial results, explain what could not be verified, and ask for additional evidence only when it would materially help. Do not create an operator sourcing task.

### SAVE — companion wishlist
Automatically retain items and product links sent in response to explicit image-identification requests. Let users revisit them in a private, mobile-friendly web grid, inspect product details and the original inspiration image, and return to the same retailer links. See Section 25 for the scoped wishlist milestone.

### OPTIMIZE
For a known product, search alternative sources and compare item price, sale price, shipping, estimated duties when reliable, return policy, availability, and retailer credibility. Explicitly flag unknowns.

### WATCH
Allow users to define a product/variant/size and target price. Store the watch and periodically check known URLs or search again. Notify when the condition is met.

### DISCOVER
Eventually initiate proactive recommendations based on taste and standing intent. Proactive discovery remains deferred until separately assigned; the core shopping loop must not depend on an operator initiating recommendations. Do not build continuous automated fashion discovery yet.

## 8. Feedback loop

Make feedback lightweight:
- 👍 Love it
- 🤔 Maybe
- 👎 Not me

For negative feedback, optionally ask what missed: shape, color, brand, price, too basic, too weird, or other.

Taste profiles should evolve from explicit statements, inspiration images, purchases, reactions, and repeated behavior. Purchases and repeated behavior should generally outweigh initial inspiration.

## 9. Taste profile schema

Maintain a structured persistent profile plus a free-text model-generated taste summary.

```json
{
  "aesthetic_summary": "",
  "style_attributes": [],
  "preferred_silhouettes": [],
  "avoided_silhouettes": [],
  "preferred_colors": [],
  "avoided_colors": [],
  "core_brands": [],
  "aspirational_brands": [],
  "value_brands": [],
  "disliked_brands": [],
  "sizes": {
    "tops": null,
    "pants": null,
    "shoes": null,
    "brand_specific": {}
  },
  "price_preferences": {},
  "retailer_preferences": [],
  "owned_and_loved": [],
  "owned_and_disliked": [],
  "influences": [],
  "current_intents": [],
  "standing_intents": [],
  "recommendation_feedback": []
}
```

Do not rely solely on conversation history.

## 10. Minimum data model

### users
- id
- phone_number
- name
- created_at
- onboarding_state

### taste_profiles
- user_id
- structured_profile JSON
- summary TEXT
- updated_at

### messages
- id
- user_id
- direction
- body
- media_urls
- timestamp

### shopping_intents
- id
- user_id
- type
- query
- constraints JSON
- status
- created_at

Intent types: `FIND`, `SOURCE`, `OPTIMIZE`, `WATCH`, `DISCOVER`.

### products
- id
- brand
- name
- retailer
- url
- image_url
- price
- currency
- metadata JSON
- last_verified_at

### recommendations
- id
- user_id
- shopping_intent_id
- product_id
- reason
- rank
- feedback
- feedback_reason
- created_at

Keep the schema flexible.

## 11. Search architecture

V0 supports **self-supported automated web/product search**. No operator queue or manual sourcing is required to complete a user conversation.

Flow:

```text
User request
      ↓
Interpret intent
      ↓
Taste profile + constraints
      ↓
Web/product search
      ↓
Candidate products
      ↓
Validate commerce facts
      ↓
Rank against taste
      ↓
Confidence check
      ↓
Supported results → Reply with sourced findings
Insufficient evidence → Explain uncertainty + useful next step
Technical failure → Explain failure + supported recovery option
```

The system does not need to comprehensively index fashion. Use external search/web capabilities initially.

## 12. Search philosophy

Separate:
1. **Product selection:** Which product is best for this person?
2. **Merchant selection:** Where should they buy it?

Long-term hierarchy:

**USER → TASTE → INTENT → PRODUCT → MERCHANT OPTIONS → TRANSACTION**

Do not architect the system around retailers.

### Merchant ranking

Per-user retailer learning and preference ranking are tester-readiness requirements under Section 27. Full delivered-cost optimization and loyalty-benefit comparison below remain future OPTIMIZE guidance.

First establish the product match and the requested variant and size. Compare merchants selling equivalent eligible products; a preferred retailer must not make the wrong product rank higher.

Official brands and reviewed retailers are useful defaults, not an absolute ordering. Merchant ranking should also consider:

- **Verified total delivered cost:** item price, applicable discounts, taxes, shipping, duties, and other fees, compared in the same currency for the user's destination. A small boutique can rank above the official brand when its verified total is lower. Unknown charges must remain unknown, never be treated as zero or used to claim a listing is cheaper.
- **Explicit shopping preferences:** persist preferred and avoided retailers structurally in `retailer_preferences`. A user who usually shops at Mr Porter may prefer it over the official brand, even at a modest premium. Substantial verified savings elsewhere may change the recommendation.
- **Loyalty preferences and benefits:** record preferences the user explicitly shares; count benefits only when their applicability is verified. Do not store retailer credentials or payment details.

Explain the tradeoff briefly, such as the user's usual store versus a cheaper verified option elsewhere. When the choice depends on how much extra the user will pay for a preferred store, ask for that preference rather than inventing a universal premium or savings threshold. Unfamiliar stores remain unreviewed until assessed; a lower price alone does not establish retailer credibility.

## 13. Self-supported failure handling

Jules handles difficult searches within the conversation, without human sourcing or manual resolution. Preserve verified results when only part of a request succeeds. Distinguish insufficient identification evidence from a technical failure, explain the limitation briefly, and offer the next useful step using the current context.

Ask for a clearer image, identifying label, original product link, or other missing information only when it materially affects the next action. Offer alternatives when consistent with the user's intent and consent. Never present uncertain matches or unsupported commerce facts as verified, promise human follow-up, or claim an action succeeded before persistence.

Log failures and recovery outcomes for debugging and product learning. The admin console remains useful for development and observation, but is not a dependency of the user-facing shopping loop.

## 14. Admin console

Keep it extremely simple.

### Customers
Show name/phone, onboarding status, taste summary, and current intents.

### Customer detail
Show conversation, taste profile, recommendation history, active watches, and diagnostic search evidence. Retain existing owner tools for testing and debugging; fulfilling shopping requests must not require manual replies or profile edits.

The human task queue and manual sourcing/resolution workflow are deprioritized and will not be built.

Do not build analytics dashboards.

## 15. AI architecture

Use an OpenAI model capable of text reasoning, image understanding, structured output, and tool use.

Agent context should contain:

```text
SYSTEM PROMPT
+
TASTE PROFILE
+
RELEVANT SHOPPING INTENTS
+
RECENT CONVERSATION
+
CURRENT MESSAGE
```

Do not send the user's entire lifetime conversation on every turn.

## 16. Agent personality

The shopper should feel knowledgeable, decisive, concise, fashion-literate, perceptive, slightly opinionated, and not sycophantic.

Avoid generic praise and assistant filler. Prefer trusted judgment such as:
- “The first one is much more you.”
- “Skip the Prada pair. You're paying substantially more without getting a meaningfully better silhouette.”
- “This is technically within your brief, but I don't think you'll actually wear it.”

## 17. Conceptual model tools

Keep the action space small:

```text
search_products(query, constraints)
search_product_sources(product)
create_watch(product, size, target_price)
update_taste_profile(changes)
record_feedback(recommendation, feedback)
send_recommendation(products)
```

Implementation may change.

## 18. Commerce

V0 does **not** transact.

When a user says “Buy it,” return the best checkout link and log `PURCHASE_INTENT = TRUE`. Optionally follow up to record a confirmed purchase.

Do not store credit-card numbers, CVVs, or retailer passwords. Do not automate checkout.

**October 19, 2026 founder decision:** affiliate links are **P0 after beta**: the first item to build once the tester beta ends, before public launch. Not during beta. Use one affiliate network (no per-merchant deals), wrap links at the existing `/go/` redirect, disclose it, and never let commission affect product or store selection. See [AFFILIATE-LINKS.md](AFFILIATE-LINKS.md).

## 19. Suggested technology

Prefer a boring stack:
- **Frontend/admin:** Next.js
- **Hosting:** Vercel
- **Database:** Supabase/Postgres
- **SMS/MMS:** Twilio
- **AI:** OpenAI API
- **Source control:** GitHub

Choose simple, well-supported libraries and avoid unnecessary dependencies.

## 20. Explicitly DO NOT BUILD

Do not build:
- native iOS or Android apps
- consumer web dashboard beyond the scoped companion wishlist in Section 25
- custom authentication system
- retailer accounts
- autonomous checkout
- credit-card storage
- proprietary web crawler
- comprehensive fashion index
- retailer integrations
- affiliate infrastructure during beta (P0 after beta; see Section 18 and AFFILIATE-LINKS.md)
- social-network integrations
- Instagram/Pinterest login
- vector database unless clearly necessary
- recommendation ML
- custom computer vision model
- complex analytics
- multi-agent architecture
- elaborate queue infrastructure
- microservices
- Kubernetes
- premature scalability

**This is an experiment, not production software. Prefer the simplest implementation possible. No premature infrastructure.**

## 21. Build sequence

### Milestone 1 — iMessage loop
Acceptance test: A tester sends `hello` through iMessage and receives `Hello from your personal shopper.`

Implement Photon → Vercel webhook → structured logging → Photon SDK reply. Use the Free plan’s assigned shared line for each tester. This founder-approved change replaces Twilio for the current milestone.

### Milestone 2 — Admin
Acceptance test: I can see the conversation and manually respond.

### Milestone 3 — AI conversation
Acceptance test: The agent can respond naturally over SMS.

### Milestone 4 — Taste memory
Acceptance test: It remembers useful preferences across conversations using structured profile updates.

### Milestone 5 — Images
Acceptance test: I can send inspiration screenshots and the agent understands them.

### Milestone 6 — Product search
Acceptance test: I can ask for a product and receive real, current products with sourced commerce facts.

### Milestone 7 — Human fallback (deprioritized; will not be implemented)
Founder decision, October 7, 2026: remove this milestone from the active build sequence. Jules must support shopping requests without human intervention, as described in Section 13. No human queue, sourcing task table, or manual resolution workflow is required. Keep milestone numbering unchanged; Milestone 8 remains Watches.

### Milestone 8 — Watches
Acceptance test: The agent remembers an ongoing shopping intent and can notify me later.

The founder has separately requested a companion wishlist specification (Section 25). Its implementation requires a separate request; it does not authorize watches or other unassigned milestones.

Then **stop building and recruit users.**

## 22. Success criteria

Run V0 for approximately four weeks with 5–10 active testers.

Track:
- shopping requests/user
- recommendations/user
- positive recommendation rate
- purchase intent
- confirmed purchases
- repeat sessions
- watches created
- proactive recommendations accepted
- unsupported or failed requests/user
- automated recovery outcomes
- value of intended/confirmed purchases

Primary qualitative metric: **delegated intent**.

Strong signals include unsolicited instructions such as:
- “Keep looking.”
- “Watch these for me.”
- “Let me know if anything better comes up.”
- “Find me more things like this.”
- “I'm going to Mexico next month—start finding things.”

## 23. Kill / continue criteria

**Weak signal:** Users enjoy recommendations but continue doing most shopping independently.

**Interesting signal:** Users repeatedly use sourcing/search and make purchases from recommendations.

**Strong signal:** Users create persistent shopping intents and respond to proactive recommendations.

**Exceptional signal:** Users begin delegating categories of purchasing decisions, e.g. “You know what I like. Just handle this for me.”

## 24. Implementation instruction to Codex

Read this PRD completely before writing code.

This is a founder prototype for a maximum of 10 initial users, not a production application. Optimize for speed of iteration, simplicity, observability, and ease of changing product behavior.

Before implementing anything, propose:
1. the simplest architecture that satisfies the PRD;
2. required external accounts/API keys;
3. database schema;
4. repository structure;
5. implementation plan corresponding to the milestones above.

Flag anything in this PRD that would materially increase complexity and suggest a simpler alternative.

Then implement **Milestone 1 only**.

Do not proceed to later milestones until Milestone 1 has been tested successfully.


## 25. Companion wishlist — first step toward a digital closet

**Status:** Founder authorized the wishlist MVP implementation; live acceptance pending.
**Goal:** Give items Jules finds a lasting home so users can return to them without searching an iMessage thread.
**Initial scope:** The same maximum of 10 invited testers, using a simple mobile-friendly web app.

### User story and core loop

> I send Jules an outfit and ask it to find the jacket and bag. Jules sends possible matches and product links. Those items appear automatically in my wishlist. Later, I open the wishlist, tap the bag, see the original outfit and Jules's identification, and open the links it sent me.

Sending an inspiration image alone does not trigger identification or saving. Reuse the existing explicit-request behavior and its limit of up to three outfit pieces. A wishlist is a record of interest, not a statement that the user owns an item, endorses it, or intends to buy it.

### What already exists and what is new

The broader PRD already specifies image input, SOURCE, persisted recommendations, and product links. The current implementation also retains incoming images privately, stores structured search results on replies, and compares candidate product thumbnails with requested outfit pieces. Visual results include possible-match/similar-alternative labels and may include other merchants for the same product. Live recognition and phone acceptance remain pending in the README; saved results do not establish recognition accuracy.

The new work is a user-facing private wishlist, durable associations between each sent item and its source image/reply, and an item-detail view. Reuse the existing app, database, and search results. Do not rerun search just to populate or open the wishlist.

### Saving behavior

- Automatically save each distinct product actually included in an accepted outbound identification reply. Save the jacket and bag as separate items, associated with the same source outfit.
- Group retailer links for the same identified product under one item. Keep distinct products or explicitly requested similar alternatives separate, preserving their labels.
- Save only results sent to the user, not rejected candidates, clarification requests, or unresolved pieces. A partially successful outfit search saves the sent items only.
- Keep exactly the product links included in the reply, their ordering, the identification wording/uncertainty, and the date found. Internal candidates and merchant options that were not sent are not user wishlist links.
- Webhook retries must not create duplicate items. Repeat encounters with a confidently identical product should reuse its item and retain the additional source image/reply associations; do not merge on generic names or visual resemblance alone.
- A reply-send failure must not create visible wishlist items. A save failure after a successful send must be logged and repairable from the stored reply/search result without resending the message. Do not claim an item is saved until persistence succeeds.
- Provide one easy way to open the user's wishlist from iMessage, initially on the first successful save and on an explicit request such as “show my wishlist.” Avoid adding the web link to every response.
- Start saving new identification results when enabled. Historical backfill and manual URL entry are outside the first version.

### Wishlist grid

**Founder scope: dead simple.** The first version has only login/logout, the product grid, and product details opened from that grid. No dashboard, navigation menu, search, filters, folders, settings page, or visible alert controls. Login should use a simple existing or managed authentication mechanism, not a custom authentication system. Successful login opens the grid directly; logout ends access to the private collection.

The landing view is a visual grid of saved items, newest first. Each tile has an item image, a short product name, and a visible possible-match or similar-alternative label. The grid should feel like a small personal collection: generous space, quiet backgrounds, and subtle motion can give pieces a floating feel. It must remain easy to scan and tap on a phone, with reduced-motion support.

**Agreed first-version image approach:** Reuse the actual matched product photos already returned by the visual-search flow and sent by Jules. If unavailable, reuse a clearly labeled outfit-item crop, then a simple placeholder. The existing search flow already creates rectangular garment crops; neither these crops nor the returned product thumbnails guarantee background removal. Persist the selected display image privately for later retrieval rather than depending solely on temporary search-thumbnail URLs. This adds image persistence and display work, not a new image-generation or background-removal pipeline. Never generate a replacement that changes the product's appearance.

**Optional visual exploration:** Isolate products on transparent backgrounds for a more playful closet-like grid. Background removal adds processing, cost, and failure cases, so it is not a first-version acceptance requirement. If explored later, preserve the original photo and fall back when a cutout clips or distorts an item. No custom vision model, draggable canvas, or physics engine is required.

An empty wishlist explains: “Ask Jules to find a piece in a photo. Items Jules sends you will appear here.”

### UI direction — sleek, simple, with playful interactions

**Founder direction:** Take inspiration from SSENSE's fashion-retail presentation, with more color and motion in interactive elements. Use it as a visual reference, not a requirement to reproduce its navigation or shopping features.

- Keep the page background white. Let product imagery, generous whitespace, a disciplined grid, and restrained black typography carry the interface. Avoid heavy card borders, decorative panels, and crowded controls.
- Keep navigation minimal: wishlist grid, item detail, and login/logout. Product details provide the retailer links; no additional management actions are required. Product names and match labels must remain readable without hovering.
- Add personality through active buttons and interactive text: a small accent palette, animated underlines, or a brief color transition on hover, focus, press, or selection. Reserve these treatments for elements users can act on; ordinary text remains quiet.
- Use subtle motion for tile entry, opening an item, and button feedback. The floating feel should come from spacing and gentle transitions, with items remaining still while browsing. Avoid continuous bobbing, flashing, or animations that delay navigation.
- Touch interactions must receive the same clear feedback as desktop interactions. Preserve visible keyboard focus, sufficient text contrast, and reduced-motion support. Color alone must not communicate match uncertainty or an active future price alert.
- Keep the first version's palette and animation choices small and consistent. Explore the exact accent colors and transition style in the UI design pass before implementation; no new animation framework is required for this direction.


### Item detail

Tapping a tile opens:

- The item photo and available brand/product name, without invented attributes.
- Jules's match label and concise identification explanation, including uncertainty.
- The original outfit/source image and date found; multiple source encounters remain accessible when present.
- Every product link sent for this item, with retailer labels and the original ordering.
- Price/currency only if sourced and recorded, alongside the date checked. Otherwise omit the price or show “Price not checked.” Availability, sizes, shipping, and policies stay unknown unless verified.
- No item-management controls in the first version. Removal can be added later if testers need it; the initial product view is for revisiting images and links.

These are saved findings, not live inventory. Opening a wishlist item does not refresh commerce facts or promise that a link still works. Retain old links and their dates; an unavailable product is not silently replaced by another product.

### Privacy and access

Each user can view only their own items and source images. Reuse existing identity and hosting where practical, but do not expose the operator inbox or reuse an admin credential for consumer access. Choose the simplest existing or managed login mechanism during implementation planning, with a visible logout action. Sessions/access tokens must be unguessable, revocable, and treated as credentials. A public URL or user ID alone is insufficient authorization. No phone numbers or credentials in frontend bundles or source control.

### Minimum persistent information

This is a conceptual requirement, not a mandate to implement all of Section 10's proposed tables. Adapt the existing schema with the fewest necessary additions:

- Wishlist item: owner, stable ID, product identity when supported, display name/brand, match label, explanation, image reference, and saved timestamp.
- Sent links: URL, retailer label, order, and any verified commerce facts with their check time. Keep these separate from product identity.
- Source encounters: original inbound message/image reference, sent reply reference, and search-result/item reference sufficient to reconstruct what was sent and deduplicate retries.

Preserve owner authorization across items, images, and source encounters. Save useful structure rather than rebuilding the collection from chat text on every page load.

### Acceptance criteria for the wishlist milestone

1. A tester sends an outfit and explicitly asks Jules to find its jacket and bag. When both are returned in an accepted reply, two items appear in that tester's wishlist with the same source outfit. When only one is found, only that item appears.
2. The tester can open the wishlist from iMessage, return later, and see the persisted items in a usable phone-sized grid.
3. Tapping either item shows its image, original outfit, date, identification uncertainty, and all and only the product links sent for that item. The links open the same destinations as the reply.
4. Another tester cannot retrieve those items or images, including by changing an item/image ID or using an expired or revoked session. Logout prevents subsequent access through that session.
5. Duplicate delivery/retry does not duplicate tiles; a failed reply does not appear as a sent finding. A save failure is observable and can be repaired without another iMessage send.
6. Missing product images have a usable fallback, and unverified prices or availability are never invented. The only first-version surfaces are login, the product grid with logout, and product details; there are no extra navigation or management screens.
7. The first version requires no cutouts, new search provider, price-monitoring service, or public image library. Verify the existing phone-identification flow as part of live acceptance; automated wishlist tests alone do not establish matching quality.

### Future extension — price-drop notifications

The wishlist should eventually become the home for price-drop notifications as well as saved findings. A user can see which saved items have an active price-drop notification and open an item to inspect or change that notification.

When the WATCH milestone is explicitly assigned, connect watches to wishlist item IDs rather than creating a separate product collection. The grid can show a clear “Price alert on” indicator; item detail can show the watched variant/size, target price or drop condition, notification status, and last check time. Jules can continue creating alerts through conversation, with the wishlist providing a place to review and eventually manage them. Multiple eligible merchant links can belong to the same watched item, but comparison must respect variant, currency, and verified costs as described in Section 12.

Saving an item does not automatically enable a price alert. A saved price snapshot is not a monitor, and the first version must not show an active-alert indicator until a real watch exists. Notification delivery, monitoring frequency, verified price changes, and alert-management behavior belong to the later WATCH specification. No monitoring jobs or alert controls are required for the initial wishlist milestone.

### Learning goals and boundaries

Observe successful saves, wishlist returns, item opens, retailer-link opens, and save failures using minimal existing logging. The key question is whether testers return to saved findings and use them to continue shopping. Do not build an analytics dashboard for this experiment.

Out of scope: item removal/management controls, search/filter controls, settings pages, owned wardrobe tracking, purchase-state management, outfit building, collections/folders, sharing or social features, bulk imports, retailer-account connections, live stock/price refresh, sale alerts, autonomous purchases, and automatic taste inference from saving. The digital closet can expand after we learn whether a simple wishlist is useful.


### Wishlist refinement — October 6, 2026 (supersedes candidate-tile/detail-copy requirements above)

**October 7 text wishlist extension (founder authorized):** Expressing interest in a named product starts sourcing without an image. Present sourced color choices or ask which checked listing the user means; do not invent product identity, colors, popularity, or taste fit. Carry the selected variant through price verification and save/alert consent. A decline does not save. Explicit confirmation saves a private text-origin item with sourced links and optional product imagery, without attaching an unrelated old outfit. Reuse an identical URL on repeat saves. Text-created alerts notify on any verified decrease in an available price for the selected color/size/currency, using the existing three-day check cadence. Keep unknown costs and size conversions unknown. If color or size-bound pricing cannot be verified, offer save-only and explain that an alert is unavailable. A saved price is not an active watch; acknowledge activation only after durable writes succeed.

The founder requested one grid tile per isolated/requested item in a source image. Different potential product matches and merchants are nested as link previews in that item's detail view, not separate tiles. A jacket and bag from the same outfit remain separate requested items. Retain candidate evidence internally, but remove the visible “Original outfit · Possible match · unconfirmed” labels and generated identification explanations. Titles describe the requested piece (e.g. “Jacket”), without implying that one candidate's brand/model is established.

Item detail contains the image, the date the user sent it, a price range calculated only from sourced price snapshots, and the list of possible product links. Keep different currencies separate; missing prices stay unavailable. Each link preview displays its saved product title, retailer domain, and sourced price when present. Do not fetch arbitrary preview pages or invent prices merely to fill the interface. Generic site-sharing metadata may describe Jules but must not expose private items/images.

Remove image zoom on hover. Use restrained opacity transitions and button/text feedback, with reduced-motion support. Motion is the recommended future microanimation library; the initial interaction refinement can use CSS without adding a dependency. Reuse loaded private images between grid and detail; show a loading state until an image actually fails.

Wishlist interaction refinement: open product details with a brief fade and upward settle, and use a subtle skeleton wipe while the collection, detail metadata, and images load. Stop image placeholders only after decoding or failure; respect reduced motion. Cards show the sourced price range and supported product name. If identity is uncertain, show a short description from observed features instead; a founder-confirmed display name may override historical candidate titles.

Wishlist visual polish: crop grid imagery to fill each card, use a restrained card lift on pointer hover, and show each link's saved product photo or an explicitly sourced retailer image. Never substitute the outfit photo as a product-link preview. At widths up to 800px the detail view fills the viewport with edge-to-edge imagery; retain a visible close control. Escape and desktop backdrop clicks close it; scrolling inside stays usable.

Desktop details use a fixed-height overlay with a stationary close control and a fully contained main image. Only the right-hand product details and link pane scrolls, including keyboard scrolling. Mobile retains one full-screen scroll area with a sticky close control.

Pressed buttons and product links briefly use a randomly selected bright neon gradient with a subtle glow. Apply feedback only while pressed; preserve ordinary text contrast at rest and system colors in forced-color mode.

PDP main imagery also fills its frame with cover cropping, removing internal grey bars. This supersedes the fully contained main-image requirement; retain the fixed desktop image pane and independently scrolling details.

Neon interaction feedback uses darker saturated gradients for readability and applies only to text, with no glow or highlight around the full link card. Keyboard focus is indicated around the text area.
The darker text-only gradient also appears on pointer hover, choosing a random palette on entry and staying stable while the pointer remains inside a control. Touch retains pressed feedback.
The wishlist header stays at the top during page scrolling and compacts after scrolling down, restoring its full size near the top. Keep the logo and logout visible, with reduced-motion support.

Wishlist sign-in persists in the same browser using a saved access/refresh token pair, renewing the short-lived access token automatically before protected requests. Rotate and persist both tokens together; coordinate refresh across tabs. Logout clears the saved browser session and revokes the server session. Temporary network failures do not discard a valid refresh token. Existing access-only sessions require one fresh sign-in to enable persistence.

Header refinement: begin minimizing after the first 8px of scrolling and reduce the Jules row to half its original height (100→50px desktop, 76→38px mobile). Preserve the page's top spacing during collapse to prevent scroll-position jumps or oscillation.

Wishlist refinement: product identity can be retained with `store_not_found` when visual evidence is sufficient but no recommended merchant is found. Identification sources are separate from shopping links. Product photos come from the highest-confidence match’s structured merchant listing where supported, with compared thumbnails as fallback and the original photo always separately labeled. Merchant preferences do not establish availability or destination validity.

Retailer verification — October 6, 2026: check every shopping link at sourcing time and when viewing the wishlist. Fetch and verify a live matching product detail page; sold-out listings remain eligible and are labeled when the retailer provides that state. Check retailer pricing on every verified page and persist an amount/currency/timestamp only when unambiguous. Missing or varying prices remain unavailable. Withhold category redirects, missing pages, unsupported merchants and failed checks as shopping links, while retaining product identity separately. This supersedes the earlier links-only pricing restriction and authorizes price verification, without price monitoring.

## 26. Personal style / starter pack — October 7, 2026

Founder authorized implementation after reviewing the requirements and sample content in `STYLE-REPORT-CONTENT-TEST.md`. Promise: show Jules what you buy and wear, get a personal style read, and improve future shopping requests.

The current milestone adds a private `/style` tab to the companion web app: personal outfit and inspiration uploads, selected receipt images/PDFs, user context, evidence-backed adaptive cards, correction/confirmation, selected preferences in structured taste memory, Be nice/Balanced/Roast me tone controls, and previewed flat-image sharing. Starter packs describe existing style, not products to buy. `VOICE.md` remains authoritative; stronger fashion vocabulary is welcome when supported by evidence, with further editorial refinement deferred.

Separate actual outfits, inspiration, purchases and explicit preferences. Budgets can vary by category and brand. Wear-frequency hypotheses require confirmation. Returns need matched completed-return evidence, and missing commerce data must remain unknown. Users choose what is remembered and shared; never comment on bodies or appearance. Sharing includes a Jules watermark and the configured signup address, with native image/text/link sharing where supported and download/copy fallback.

This separately authorizes the style screen and upload/report/export scope previously excluded from the wishlist milestone. It does not authorize inbox scanning, Instagram integration, color-season classification, virtual closet ownership, public registration, automated outbound campaigns or purchases. Reuse the current infrastructure. Implementation and exact production setup/acceptance are recorded in `STYLE-MVP.md`; live acceptance remains pending.

### Personal style iteration — October 7, 2026

Founder-authorized improvements: shared readable loading across pages, inline validation, reset-and-confirm uploads, a single preference editor, phone-sized horizontal final stories, gradient/header font variety, explicit brand coverage, garment evidence on relevant cards, and a starter pack built from each user's strongest supported style ingredients. The starter pack may include observed colors and explicitly stated brands, interests, objects, or style-related places. It represents the existing profile, not a shopping list or a fixed founder persona. Object illustrations are symbolic; brand names are typography, not copied official logos. Garment images are reviewed rectangular crops for this iteration; precise background removal remains future work.

Keep the intake form for the tester experiment. A later iteration should accept mixed photo batches and one conversational description, then ask only for missing information. Inbox scanning, Instagram account integration, and virtual closet population remain future work. New brand/interest extraction requires a new analysis; stored confirmed reads get a starter collage from their existing approved evidence without paid regeneration or new memory confirmation.

Founder follow-up: larger right-side desktop evidence collages with subtle pointer hover; chosen header palette Clash Display, Panchang, Pally, Comico, Array, Styro, Boxing, Teko. Specialized outfits may support tentative activity interests and conditional wear contexts, requiring confirmation. They must not establish everyday uniforms or frequency. Store activity context structurally and scope confirmed shopping preferences accordingly; retain previous reports until the user rebuilds them.

Founder follow-up: remove the 12-file limit and support bulk uploads by category, with batch-wide optional notes/occasion, progress, resumable partial failures, and saved files grouped by category.

Founder follow-up: remove Pally from active font choices. Keep image captions close to their visible assets; exported collages should fill the remaining space beneath text with varied sizes, freeform placement and modest overlap, rather than a strict grid.


## 27. Tester readiness — founder requirements, October 7, 2026

The founder requires a reliable, self-supported chat loop before recruiting testers. `TESTER-READINESS.md` records the scope, implementation gaps and release checks. These requirements supersede earlier shoe-only size handling, receipt-preference restrictions, and fixed color-selection journeys; they are requirements, not a claim of implementation or live acceptance.

### Unified shopping and learning loop

Interpret natural-language text, images, relevant profile evidence, recent state and explicit threaded replies into structured intent. Route that intent through supported search, clarification, selection, wishlist, alert, feedback and profile actions. Do not use phrases, keywords or regexes to infer conversational intent, reactions, durable-preference meaning or desired outcomes. Code checks evidence, identifiers, technical formats, user ownership, consent and action preconditions. If intent is uncertain, make a supported reversible move or ask a useful question. Never guess consent for a state-changing action.

Source real relevant product listings and their supported product photos, variant attributes, prices, currencies, sizes and availability. Keep identity/variant selection separate from merchant ranking and size-specific availability. Preserve partial results and unknown facts. Wishlist saving, alert activation/cancellation, later notifications and profile learning must work across both text and image requests with accurate confirmations after persistence.

### Size memory across categories and brands

Collect unstructured size statements using the relevant product/image/thread context across categories, including suits, jackets, trousers, tops and shoes. Preserve the user's raw label, category, stated system, length/fit modifiers, source and scope. For example, a suit image plus “I’m a 50R” saves suit size 50R as the user's category default across brands. Do not require a named brand or an explicit sizing system to remember it. Do not apply it to unrelated categories or infer a US/EU conversion.

A later brand-specific size is an exception; retain the category default. The most specific applicable confirmed size guides a request, with a current explicit override taking precedence. Establish general defaults unless the user identifies a narrower scope; do not silently make a general size brand-specific just because one brand is being discussed. Ambiguous category/recipient information may require a question. Saved size means a shopping preference, not proven fit or in-stock evidence. Match retailer labels using supported evidence and clarify genuinely ambiguous systems instead of inventing equivalence.

### Retailer learning

Begin with Jules's recommended stores, then learn per-user retailer preferences from chat, feedback and receipts uploaded in `/style`. Recognized SSENSE and Mr Porter receipts should contribute receipt-derived retailer affinity to that user's structured profile and future sourcing, without an extra favorite-store declaration. This supersedes the earlier restriction that purchase counts cannot contribute to preferences. Retain source IDs and distinguish shopping history from an explicit favorite, avoidance or loyalty statement. Duplicate receipts must not multiply the signal; identifiable gifts or another person's purchases must not become the user's shopping preferences. Receipt sizes are purchased-size evidence, not automatically confirmed fit.

For equivalent eligible product/variant offers, prefer a learned or explicitly preferred store when the requested size is verified available there. User corrections and avoided stores override learned affinity. A wrong product or unavailable size never wins because its merchant is preferred. Unknown size availability stays unknown. Keep item-price and delivered-cost claims distinct; future cost tradeoffs must use verified evidence rather than invented premium thresholds. Receipt deletion/correction must remove or revise dependent learning without erasing independent explicit chat preferences.

October 10 receipt-analysis decision: after analysis, surface at most five simple questions, prioritized by their impact on trustworthy closet contents and personal shopping learning, for consequential facts the evidence cannot establish, including item recipient, disputed purchases, ambiguous returns and conflicting item details. Use model interpretation rather than phrase rules. Select the five most important uncertainties rather than scheduling repeated batches; leave lower-priority facts unknown and do not automatically refill after answers or deferrals. Keep corrections scoped to items within mixed-recipient orders. Chat answers and later closet edits must use one provenance-backed feedback path; changes rebuild dependent receipt learning, preserve original evidence and prevent repeat questions. Unknown or deferred answers must not become personal sizes, confirmed fit, kept status, refunds or preferences. See `RECEIPT-ANALYSIS-FEEDBACK.md` for the private tool implementation. This does not authorize building or deploying the future closet UI.

### Conversation continuity and feedback

Preserve incoming and outgoing thread targets and their associated images, products and selected sets. Resolve a reply against its referenced message before using the newest active shopping state. Unknown or conflicting references need clarification. Support multiple desired items, exclusions, uncertain interest, recipient changes, topic changes and messages arriving while Jules is working.

Use product feedback to correct matches and learn preferences at the right scope. Wrong identity, wrong merchant, wrong size, dislike of a specific variant and a lasting category/style preference are different outcomes. Support replacing/removing saved items, cancelling item/set alerts and forgetting or correcting profile facts. Only established user sizes/preferences become durable facts; do not generalize a one-time rejection or an assistant suggestion into taste. New learning must affect later searches and be correctable.

### Adaptive clarification and monitoring

Clarification follows the current request and actual search evidence. Do not mandate a color question: the user may have supplied all necessary attributes. Ask only about differences that matter, such as model, material, length, fit, finish, color or size, without inventing variants. Preserve multi-item choices and scoped consent.

Jules can monitor supported products when monitoring is enabled. Chat must enable, inspect, change and disable alerts on the intended item/set and send verified qualifying notifications later. Instructions must describe actual enabled capabilities. Separate active monitoring with a verified baseline, waiting for evidence/availability, failed checks and cancellation; do not imply monitoring is operational when setup or evidence is missing. Alert conditions and check cadence follow the assigned WATCH behavior, not an invented promise.

### Meaning of clothing department

The existing internal `shopping_range` field means the clothing department the user wants to shop (for example men's, women's, unisex or any). It is separate from gender identity. Use an explicit request or saved clothing preference; do not infer it from appearance. Another recipient's department/size applies to that request rather than overwriting the user's profile.

## 28. Product-data sources and future iterations

**October 8 founder decision:** Combine independently sourced facts for the exact product and merchant variant rather than making a successful retailer-page fetch a prerequisite for a useful shopping conversation. Preserve the user's supplied link and save intent through retrieval failures. Every selected fact must retain its provider, source URL, retrieval time, product/variant scope and evidence level. Unknown values remain unknown; conflicting values remain recorded rather than silently merged. Product identity stays separate from merchant preference and availability in the user's size.

The current integration uses the existing SerpAPI account for Google organic search, Google Shopping, Google product offers and Google Images, alongside direct retailer-page and browser retrieval. Index data may supply product identity, photos and an explicitly labelled indexed price. It cannot establish current size availability, verified fit, shipping/returns policies or a qualifying price-alert event. Prefer retailer evidence for current commerce facts; preserve useful independently sourced fields when another source fails. Bound provider requests, cache public product data and log per-provider recovery results. Test exact URL/market/variant binding, conflicting prices, missing fields, provider outages and permanent regression fixes with real deployed checks as well as fixtures.

### Future iterations — not prerequisites for the current milestone

- **Retailer APIs and official catalogs:** Connect priority stores' authorized product/catalog endpoints when available. Use stable retailer SKU, model, GTIN and variant identifiers to combine identity and imagery without mixing different colors, materials, lengths or sizes. Retain merchant-specific prices, currencies and stock separately.
- **Affiliate/publisher product feeds:** Evaluate Awin, Rakuten Advertising and CJ for coverage of our priority retailers. Create a publisher account, obtain relevant advertiser/feed access and configure secrets only through deployment environment variables. Approval and actual coverage must be confirmed before promising a store is supported. Prefer incremental feed updates and use the feed's published update time; never treat commission as a product-ranking signal.
- **Additional shopping-data providers:** Add a second search/catalog provider when observed failures justify it. Compare coverage, freshness, exact-variant accuracy and request cost using the same regression cases before enabling it. Provider disagreement must be visible in evidence and cannot be resolved by selecting the cheapest value.
- **Managed browser or retrieval services:** Evaluate an authorized rendering/retrieval provider for stores that reject the hosted browser. Validate access to the actual failing pages before purchasing or integrating a plan. Keep requests bounded, avoid retailer-account credentials and do not make CAPTCHA solving or a human operator part of the user-facing loop.
- **Field-level refresh and monitoring:** Refresh price and size-stock evidence independently from stable names and images. Enable a watch only when its required evidence and configuration exist; keep waiting, failed and active states distinct. A stale/indexed price alone must not fire a price-drop message.

These integrations require explicit assignment and, where applicable, external account/access setup. Jules must continue to provide supported partial results while those sources are unavailable; no human sourcing fallback is planned.

### October 9 iteration: supplied links and storefront context

Read supplied product links before conversational interpretation so Jules can use the available identity, images and price without treating missing optional fields as a request for repeated save permission. Saving remains independent of price/stock verification. For the founder's USD request, market-neutral Satisfy links use the retailer's US storefront context throughout retrieval and monitoring; preserve explicitly supplied markets and genuine sourced currencies, and never invent a conversion. Require an explicit supported action or natural conversation outcome for search-enabled turns; accepted search offers and brand clues should execute sourcing in the same turn.

### October 9 DM feedback acceptance clarifications

An explicit request for a product price alert includes permission to save that associated product; Jules must not ask separately for wishlist consent. Acknowledgment or interest alone is not permission. If structured interpretation fails consent validation, use the original context for at most one model correction before asking a useful question.

Sourcing should research and present verified variants in the current turn using supplied attributes and retailer evidence. Use singular language for one product and do not require a color choice when only one verified candidate exists. Supplemental research is bounded and preserves the primary supported result on failure.

Read per-SKU price/stock and explicit retailer size labels, including native selectors where structured product data omits sizes. An enabled alert with no baseline must have an automated recovery path; opening the wishlist may retry initial verification without toggling the alert or sending a price-drop notification. Never infer size conversions or treat unavailable retrieval as proof of unavailable stock.


### October 10: vague product discovery (founder assigned)

Distinguish identifying an item the user saw from exploring options. When a brief is too broad for useful results, ask one or two adaptive questions using supplied clues and saved facts; do not force a fixed questionnaire. If the user cannot recall more or welcomes exploration, offer a varied first set. Carry the brief and request-scoped feedback through clarification, results, accept/reject, more options and topic/recipient changes.

Taste facts, receipt-derived shopping history, favorite brands/stores and historical budgets guide ranking, not strict eligibility. Only current explicit constraints limit the requested search. Rank verified products against the current brief first, then personal preferences and useful diversity; new brands, styles and sources remain eligible. Preserve sourced facts and uncertainty. Return up to three discovery options and invite feedback. A plausible identification candidate is not a confirmed identity.

Rejecting or asking for different options excludes the referenced results from the next batch and preserves useful guidance. Temporary feedback must not overwrite durable taste. Acceptance without save/monitor intent establishes interest, not permission to save or enable alerts. Topic and recipient changes clear temporary exclusions/constraints. Failed research retains a retry brief without reviving old choices. No new infrastructure or human sourcing dependency.


### October 10: Gmail purchase-history import pilot (founder assigned)

Implement a real, invite-only, read-only Gmail connection in the existing onboarding flow. Begin with a one-time 90-day import of up to 200 matching shopping emails and their supported receipt PDFs. Consent must explain OpenAI analysis, private evidence storage and receipt-derived shopping learning. Preserve purchase, shipment, cancellation, return-request and refund distinctions, item variants, source references, original evidence and scoped corrections. Persist progress; disclose incomplete coverage and preserve supported partial results. Repeat imports must not duplicate unchanged evidence or erase feedback. Ask at most five prioritized unresolved questions. Web answers, conversation corrections and later closet controls share the feedback path. Gifts/disputed/cancelled purchases cannot teach personal tastes; purchased size is not confirmed fit or a general default. Use receipt observations as separately sourced shopping history, with explicit preferences taking precedence. Support disconnect and deletion of imported history without deleting independent facts.

Reuse existing infrastructure; no ongoing background sync or full closet UI is assigned. Verify connect → import → correction → repeat import → preserved correction and appropriate shopping learning against the real configured account before declaring live acceptance. See `GMAIL-IMPORT.md` for setup, implementation limits and acceptance checks.

October 10 response-quality clarification: omit non-actionable retailer metadata caveats from chat. Explain uncertainty when it materially changes the choice or requested action, and ask a useful question if clarification is needed. Keep missing department labels in diagnostics rather than automatically announcing them with results.


### October 12: prioritized Gmail import expansion

Founder requests five years of history and a maximum of 1,000 unique emails, prioritizing the last two years. Search transaction evidence first, then related orders and broader discovery; do not analyze every inbox email or exclude promotions wholesale. Extract bounded pages between discovery passes, preserve progress, deduplicate across passes, and preserve existing feedback. Aim for most salient evidence in the first 100 emails, but measure early yield and long-tail additions rather than claiming unvalidated 90% recall. Existing limited imports retain their approved scope; an expanded import requires updated consent. Show partial findings after the first 100 and retain older purchases without inferring current ownership or disposal. No new durable background queue is assigned in this expansion.

### October 13: price-alert reliability (founder assigned)

The goal is helping the user save money on something they want. An alert texts when the watched size drops in price or comes back in stock after being verified sold out. Unreadable stores are unknown, never sold out. A lower item price at the same store qualifies. A lower price at another store qualifies only when that store lists an unconditional shipping rate to the user's country and the item-plus-shipping total is lower. Otherwise it is recorded as an unconfirmed saving and explained when the user asks about the alert. Taxes and duties stay unknown and are stated as excluded. Weekly, and after three consecutive failed checks, the scheduler searches Google Shopping for other registry stores. A store joins the watch only when its own page matches the full product name and known color and lists a priced offer in the watched size. Discovery is bounded per run and metered. Owners can rehearse decisions with supplied offers without changing the alert. Test texts go only to the designated test conversation and are labelled as tests.

### October 21: low-stock alerts (founder assigned)

The goal is making wishlist alerts something users notice and act on: a text when a saved item is nearly sold out in their size, for example "heads up: SSENSE shows only 1 left of your saved Third Cut Jeans in Blue, size 32." Founder decisions:

- **Verified only.** Low means the store's own page or data states 1–3 left for the watched size and color: a per-size count (Shopify variant inventory that Shopify tracks and won't oversell, Prada's per-size quantity) or the store's own per-size note (SSENSE's "Only 2 remaining"). Never inferred from other sizes selling out, an unreadable size, indexed (Google Shopping) data, or a store that fails to load; those are unknown. A count must belong to this exact product's own variants; an ambiguous color or two disagreeing counts are unknown.
- **Consent.** An existing price/restock alert on an item covers low-stock texts for that same item and size; consent stays scoped to the items the user chose. Alert copy says it includes "nearly sold out", and the user can turn off just the low-stock part in chat.
- **Once per episode.** One text per item while it stays low. The episode ends only when a check verifies more than 3 left or the size sold out; an unreadable check keeps it open. A low reading in the same check as a price drop or restock goes out with that text, not as a second one.
- **Link and wishlist.** The text links to the store's page, like other alerts. The wishlist card shows "Only 1 left · In 32 at SSENSE · checked Oct 21"; after one check interval it reads as history ("…when checked Oct 21").
- **Chat control.** Chat can inspect low-stock status and turn off only the low-stock texts, keeping price alerts on.
- **Shared rules.** Low-stock texts count as price alerts under the shared rules for unprompted texts (founder decision, October 21): the person asked for the alert, so they are not held by the nudge cap or quiet hours, and a day with one blocks that day's nudge. STOP still stops every text. No separate cap or quiet-hours system.

Store survey (October 21): of 173 registry stores, about 10 state a per-size count that step 1 reads (SSENSE, Prada, and the Shopify stores Kith, Bodega, Khaite, Studio Nicholson, MFPEN, Goldwin, Natalino and Rejina Pyo; Canada Goose shows counts without saying Shopify tracks them, so they stay unknown), about 6 more show per-size labels that would need their own reader (END., Slam Jam, Haven, Proenza Schouler, Dries Van Noten, Chloé), and 90 could not be surveyed (blocked or no product page found, including MR PORTER, NET-A-PORTER, Farfetch, Nordstrom, Saks).

Step 2 (shipped after the founder runs `db/048_low_stock_alerts.sql`): a verified low reading texts once per episode, as a price alert (`price-alert:` operation). A low reading in the same check as a price drop or restock is added to that text. The per-alert switch `price_alerts.low_stock_alerts` (on by default) lets chat turn off or back on only the nearly-sold-out texts (`manage_price_alerts` `low_stock_off` / `low_stock_on`); chat status reports the last verified low reading and whether it was texted. An episode opened during step 1's read-only release, or a text that wasn't delivered, doesn't count as texted. The owner rehearsal sends a labelled low-stock test only to the designated test conversation.

Step 3 (October 22): Slam Jam (`data-quantity` on each size) and Dries Van Noten (`data-qty` on each size) publish real per-size counts in their size picker, bound to the page's verified product; these now feed the same decision. Not added: END. ("Few Items Left" states no number, so it never sends), Haven ("LAST ONE") and Proenza Schouler ("Only 1 left"), whose pages carry no structured product data, so the page can't be confirmed as the watched item and their price checks are unreadable too.

Measurement (October 22): alert texts store which alert and kind they were (`messages.search_result.alert`) and send their store link through Jules's tracked `/go/` link, so a tap is counted against that text (when `LINK_CLICK_TRACKING=true`; link previews don't count). Admin › Adoption › Alert texts shows, per kind over 30 days: texts, delivered, not delivered (failed or STOP), people, link taps within 7 days, replies within a day, and items marked bought within 14 days.

Steps: (1) read and log only — every scheduled check records its stated counts and a would-send/skip decision with the reason, the wishlist and admin show verified low readings, and the owner rehearsal previews the decision from a typed count; no low-stock text is sent. (2) send texts (as price alerts under the shared rules), chat inspect/turn-off, and labelled test texts to the designated test conversation. (3) optional label readers for more stores if step 1's logs show alerts land there.

### Proactive nudges (founder decision, October 15; rules decided and step 1 assigned October 21)

Texts nobody asked for follow one shared set of rules (`lib/nudges.js`). Today these are the "goes with your new purchase" offer and the fit check; any later nudge joins the same rules.

- **Which events count.** Only a genuinely new purchase found by the daily Gmail check (`lib/purchase-texts.js`): the person's own, bought in the last 7 days, never one from the first big import of older history, never a gift, return, cancellation or duplicate, and only clothing, shoes, bags and accessories (not basics or other things). Receipts texted to Jules and wishlist "I bought this" get no nudge: the person is already in the conversation.
- **Limits.** At most one unprompted text a day (the person's local day) and three in any 7 days, counting the offer and fit checks together. Price alerts are never held, because the person asked for them, but no nudge goes out on a day a price alert did.
- **Quiet hours.** Only 9am–8pm in the person's time zone (the one their browser reported on the style report page). With no known time zone, only noon–8pm US Eastern, which is daytime across the US. A held nudge waits for the next day's check while the purchase is still within 7 days.
- **Opt-out.** STOP stops every text. One switch, "texts about your purchases", turns off the offer and fit checks; people ask in their own words and the model calls `manage_purchase_texts`. Declining one offer applies to that item only.
- **Ignored nudges.** No follow-up text, ever. After 2 nudges in a row (offer or fit check) with no message from the person within 2 days of the newer one, no nudge for 14 days. Any message from them resets it (`ignored_backoff` in the log).
- **Content.** Plain and true: "saw your new Our Legacy jeans from SSENSE in your email. want me to find a couple of things that go with it?" The item is named as the purchase evidence states it, with no price, size, stock or shipping, no jokes and no AI branding. The model picks which new purchase to offer about and may decide none suits an offer. No search runs until the person says yes.
- **The reply** is an ordinary turn read by the model (no keyword routing). The offer stays open for two days (`data.nudges.open`, `lib/goes-with.js`). While it is open the agent sees it as `goes_with_offer` and records the answer with `answer_goes_with_offer`. A yes returns a search brief, and the agent searches in the same turn with `find_products`. The search is for 2–3 other kinds of pieces that go with the item, in the person's saved sizes; the purchased size is never used as a general size. It runs through the existing sourcing and ranking (search separate from taste ranking, favoured stores and blocked stores apply). No and not now get a short reply with no search. A correction (a gift, a return) goes to the purchase history as before.
- **Reply outcomes.** The first reply after the offer settles it once: accepted, declined or not_now from the agent; stopped when the turn turned purchase texts off; otherwise an independent model reading of the reply, used only for the log (accepted / declined / not_now / unrelated). A reply that ends in a fallback leaves the offer open for the next message.
- **Logs.** Every decision about a real candidate (sent, held, or skipped, with the reason) is written as a `nudge` log event and kept on the person's history row (`data.nudges.log`, last 50). No migration.
- **Admin.** Admin › Adoption › **Purchase nudges** shows, per tester, offers sent, answered (yes / no / not now / turned off), other replies, no reply, fit checks, holds by reason and the latest decision, plus the 40 most recent decisions. Test sends are left out of the rates.
- **Testing.** Admin › person › **Purchase nudges…** shows the decision log. For the designated test conversation (`PRICE_ALERT_TEST_CONVERSATION_ID`) it sends the offer about any wardrobe item, labelled `[test nudge]`, outside the limits and quiet hours, without counting toward them. It can be sent again without a reset.

Build order, one PR each, checked live before the next: (1, shipped October 21) shared rules, the offer text, the decision log and the admin test send; (2, October 21) a yes leads into sourcing seeded by the purchased item, in their sizes, with 2–3 picks, and each reply's outcome (yes / no / not now / unrelated / stop) is logged, with multi-turn tests; (3, October 21) back-off after ignored nudges and an admin view of nudge history and reply rates.

Related: the daily purchase check (`lib/purchase-texts.js`, 17:00 UTC) reads new shopping mail for everyone with Gmail connected. Correction (October 22): the Google app is **In production** (unverified), not in testing mode, so Gmail sign-ins no longer expire after 7 days. A sign-in given while the app was still in testing may keep that 7-day limit; when Google refuses one, the person reconnects once (the existing reconnect prompt), and the new sign-in does not expire. Unverified apps with the restricted `gmail.readonly` scope are capped at 100 users; verification is a go-live item.

Also part of this nudge work, not yet assigned: a nudge for people who skip connecting accounts. If someone taps "Not now" on the connect page and never connects Gmail or Shop, Jules could later offer once to connect them. Decide this with the other nudges (frequency, opt-out, which events justify a text). Until then, Jules sends nothing after a skip and keeps working from photos and links.

### Return-window reminders (founder decisions, October 22; steps 1–2 assigned)

The goal is saving people money and showing that Jules looks out for them: when a recent purchase's return window is about to close, Jules texts once, for example "heads up: for your CHERRY LA Wide Leg Cargo Pants, the return window closes saturday, oct 31 (14 days, and you bought it in store on oct 17). keeping it?"

- **Evidence only.** A deadline comes only from what the order, shipping or delivery email, receipt, order screenshot or Shop order states. Jules never looks up or assumes a store's return policy, never uses a returns-policy link, and never estimates a delivery date (not "shipped plus a few days"). For each stated term, in order:
  - a stated return-by date;
  - a period counted from the order: the order's date;
  - a period counted from delivery or shipping: the delivery or shipping email's date;
  - **bought in store** (founder, October 22): the purchase date, whatever the period counts from, since they left with it. Receipt reading records how they got the item (in store, picked up, shipped, unknown) with a quote; only a quoted "in store" counts;
  - otherwise **the order date as a floor** (founder, October 22): the period can't start before the order, so the window closes no earlier than order date + the period. The text says "at least until", never that it is the deadline.
  - Final sale: no reminder. Business-day periods stay unknown. With several terms, the earliest deadline counts. The day of an email-dated event is the person's local day.
- **Reading.** Receipt reading returns, per line, `return_by`, `return_window`, what the window counts from, `final_sale` and `fulfillment`, each with a quote. Code keeps a term only when its quote is in the email and contains the value. It parses the date or period from the quote: a date without a year is the first such day after the email, and an ambiguous numeric date like 03/04 stays unknown. It counts the window's start only when the quote itself names it. Lines quoting the same return sentence share its start, and the email's fulfillment applies to all its lines. Terms are kept with the item, per email, with their quotes, so every deadline shows which email said what. Emails read with these rules carry `returns_version` 2.
- **Timing.** From 3 days before the last return day (or the floor) to the day before. Never on or after it. One reminder per item. Several items due the same day share one text (up to 3); the rest wait for the next day.
- **Send rules.** Daily, before the purchase check, for everyone with purchase history (`runReturnReminders`). Reminders count like alerts under the shared rules for unprompted texts: the daily/weekly nudge cap and the ignored-nudge back-off don't hold them, and a day with one has no other nudge (`return-window:` ledger key). Unlike price alerts, quiet hours apply (9am–8pm local, else noon–8pm Eastern); a held reminder goes out at the next daily run while it is still due. STOP stops them. Cost caps apply.
- **Opt-out.** Its own setting, "return reminders" (`data.return_reminders`). The model reads the request; the existing `manage_purchase_texts` tool takes `which`: purchase texts, return reminders or both, so the chat tool count holds. Turning off purchase texts leaves reminders on unless the person means all such texts.
- **Replies.** Read by the model, with no keyword routing. While a reminder is open (until the last deadline plus 2 days), the agent sees it as `return_reminder`, and the purchase-history reader sees its items as `return_reminders`.
  - Keeping it → `report_kept` (newly allowed from chat).
  - Returning it → `report_return`, so it leaves the wardrobe.
  - A size reason ("too short") also records a fit note for that item and brand; a fit the reader puts on the return is recorded as its own `report_fit`. Any other reason adds nothing, and nothing changes the general profile.
  - "Not sure yet" records nothing, and Jules doesn't ask which item.
  - Silence changes nothing, and there's never a follow-up text.
- **Logs.** Every recent purchase's decision is written to the Vercel log as `return_window`, and `return_reminder` for each send. It's kept on the history row when it changes (`data.returns.log`, last 50). Decisions: due / sent / held (quiet hours, already today, next text) / skipped (no terms, final sale, too early, deadline passed, already reminded, kept, returned, reminders off, STOP…). Items reminded: `data.returns.reminded`. No migration.
- **Admin.** Admin › person › **Return windows…** lists purchases from the last 120 days with their stated terms (quotes), the deadline (or floor), today's decision, their setting and the change log. **Re-read emails** re-reads the order, shipping and delivery emails of the last 45 days of purchases for return terms and fulfillment, a few per request. Only those are saved, as attach-only evidence like the price and photo re-reads.
- **Outcome rates (step 3).** Admin › Adoption › **Return reminders** shows, per tester and in total: reminders sent, kept, returned (and returned in time, before the last day), fit notes, other reply, no reply, and still open. It also shows where their other recent purchases stand (no return terms, too early, window closed…) and the 40 most recent reminders with their outcome. Outcomes come from the purchase history itself, recorded after the reminder: the person's answer, or a later return email. "Other reply" means they texted Jules since but nothing was recorded for that item. Test reminders are counted apart and left out of the rates.
- **Testing.** For the designated test conversation (`PRICE_ALERT_TEST_CONVERSATION_ID`), **Send test reminder** texts the reminder about any wardrobe item, labelled `[test reminder]`. It uses the item's real deadline, or a typed rehearsal date when its emails state none. It ignores timing, quiet hours and once-per-item, never marks the item reminded, and can be sent again. It opens like a real one, so a reply goes through the same path.

Investigation (October 21–22): no stored purchase had return terms before step 1. The founder's re-read (October 22) found 30 purchases in the last 120 days, 4 with stated terms (Cherry LA ×2, Farfetch ×2: "within N days of receiving"; MFPEN: "14 days" with no start), and 0 with a deadline under step 1's rules, because none had a delivery email. The in-store rule and the order-date floor (step 2) are the founder's answer.

Build order, one PR each, checked live before the next: (1, October 22, PR #409) read return terms and log decisions, the admin view and re-read, no texts; (2, October 22) the in-store and floor rules, sending under the rules above, the opt-out, model-read replies, the `[test reminder]` admin send, and multi-turn tests and routing evals (keep / return / return with reason / unrelated / stop); (3, October 23) admin outcome rates (sent, kept, returned, returned in time, no reply, where other purchases stand).

## 29. Wardrobe tab — founder decision, October 15, 2026

The founder assigned a companion **Wardrobe** page (`/wardrobe`, header link between Wishlist and Your style). This supersedes the Section 25 exclusion of owned-wardrobe tracking and the Gmail section's "no full closet UI is assigned" for this scope only. Design: `design/wardrobe-brief.md` and the "Jules Wardrobe" design canvas.

Purpose: show what Jules counts as the person's own, so they can trust it and correct it. It is built from the existing purchase history (Gmail receipts, Shop orders) and uses the same structured feedback path as text answers (`closet_edit` source); it adds no new store of facts.

- **In the wardrobe:** purchases that are not disputed, not duplicates, not for someone else, not returned or cancelled, and not marked as no longer owned. Recipient "unknown" stays in, with its open question.
- **Cards:** the shared product card, with name and brand · size bought. Size bought is never presented as fit or as the person's general size. No price.
- **Photos:** the order's own photo when it has one; otherwise a searched photo the owner has confirmed; otherwise the category outline.
- **Order photos (October 15, step 1 of photo lookup):** when the receipt email or Shop order itself contains the item's picture, the wardrobe shows that picture (the bought item, in the bought colour). The model may only point at a picture or product link found in the source, by reference; code checks the reference, https, and that the image isn't a tracking pixel, icon or banner. Each photo is stored once, privately, keyed to the item, and is never replaced by a later import. Items without one keep the outline: no photo is better than a wrong one. The item's product-page link is kept for the next lookup step. No search or lookalikes.
- **Suggested photos (founder decision, October 19, step 2 of photo lookup):** the photo-lookup accuracy test (102 wardrobe items, founder-reviewed) found about 80% of searched photos were right, short of the 90% needed to show them as fact, and two rounds of rule changes did not raise it. So a searched photo is only ever a suggestion. For an item with no order photo, Jules searches Google Shopping for brand, product and colour (then one image search naming the store it was bought from), never takes a resale or person-to-person listing, and accepts a candidate only when the model matches, a blind colour check (the photo's colour named without seeing the receipt) agrees with the receipt colour, and the listing title does not name a different edition, collab or finish. The suggestion appears on the card and item detail labelled *Suggested photo* with **Is this yours? Yes / No**; it becomes the item's photo only after Yes. No hides it and Jules looks once more, skipping that photo; two No answers, or two searches that find nothing, end the suggestions for that item. Suggestions and answers are append-only evidence under the `wardrobe` origin, deleted with imported history and kept across Gmail/Shop re-reads. This supersedes "no search or lookalikes" for this confirm-first flow only.
- **Sharper photos (founder request, October 19):** order emails often link a 90–160px thumbnail. When the image host serves the same picture at other sizes (Shopify, Amazon, Scene7, Mr Porter/YNAP, Cloudinary-style paths, width parameters), Jules stores the large copy of that same picture — no search, no lookalike — and a one-off repair re-fetched existing thumbnails (run in October; the script has since been removed). An order photo still under 200px is offered a sharper searched photo through the same "Is this yours?" thumbs, matched against the order photo as a reference; no keeps the order photo. Small photos are shown at up to twice their size instead of stretched.
- **Photo tags (October 20, step 1 of learning from the wardrobe):** Jules reads each item's confirmed photo — the order's own photo, or a searched photo the owner said Yes to; never a pending suggestion — for colour family, pattern, fit, silhouette, apparent fabric, formality and up to four visible details. A confirmed searched photo's colour is used only when the receipt named a colour (the blind colour check compared them); otherwise its colour may differ from the one bought and is left out. Readings are a cache on the purchase history, keyed by item and photo version, never a belief or a product fact, never shown as fact, and deleted with imported history. For now only the style report uses them, counting a photo's colour where the receipt text gave none (text colour always wins). Search, the stylist and ranking do not use them yet.
- **Closet summary (October 20, step 2 of learning from the wardrobe):** the stylist and search read a compact summary of what the person owns now, by item type (shirts, tops, knitwear, activewear…) — types, main colours, patterns, fits, how dressy, recurring details — built from the wardrobe (no gifts, returns, removed or never-bought items; underwear and socks get no category line) and its item and photo tags. It is soft context so picks suit the closet they have; it is never a hard filter, the current request and anything stated outrank it, and owning is never presented as liking or wearing. A request for someone else uses none of it. Duplicate-aware and "goes with what you own" ranking are a later step.
- **Closet-aware ranking (October 20, step 3 of learning from the wardrobe):** a ranking step only, run beside the discovery ranker on the same candidates. It marks a candidate that is essentially something the person owns (same kind, colour, pattern and cut) and pushes it below the others — never removes it — unless the request asks for another of, a replacement for or a variant of something they own (the model's reading of the request). For each shown pick it may name up to two owned pieces it could go with; code checks every id is in the wardrobe, and the reply words it as a suggestion ("could go with your black Dries Van Noten jeans"), never a habit or a preference. Names come from the receipt's brand and colour and the item's tag. A request for someone else uses none of it; a turn without time for it skips it. Each turn records what was pushed down (and which owned piece it duplicates) and which pairings were proposed and passed the check.
- **Questions:** Jules' open receipt questions (at most five) appear as one-tap answers. "Not sure" defers without guessing.
- **Item detail:** size, colour, store and date; **What goes with this?** opens iMessage to Jules with the question written; **Fix details** (brand, name, size, colour); **Remove**, which asks why: returned it, a gift for someone else, no longer have it, never bought it. Each reason maps to its own correction, so a gift never teaches taste and a return is not a dislike. Every removal is undoable and restorable from **Removed**.
- **Adding items:** through Gmail and Shop on the account page. Texting Jules a photo to add an item is not supported yet, so the page does not offer it.
- **Out of scope:** outfits, wear tracking, photo upload, prices, background-removed cutouts.

## 30. Outfit photos into the wardrobe — founder decision, October 19, 2026

The founder assigned adding owned items from outfit photos the person texts to Jules (mirror pics, photos of clothes). This supersedes Section 29's "texting Jules a photo to add an item is not supported yet" and its "adds no new store of facts" for photo-sourced items only. Purchase history stays the record for bought items.

Why: a competitor test (October 19) redrew each garment as a studio image. The redraws changed the products (pockets, colour, cut, a striped sneaker became a checkerboard one) and brands were mostly missing. Jules shows only real images: the person's own photo, or a store photo of the same product.

- **Photo shown, in order:** (1) a store photo, only when Jules identified the exact product with distinctive evidence (readable brand or model text, a logo or trademark, or a signature design detail seen in both images); (2) otherwise the person's own crop of that piece. Never a generated or redrawn image. The crop is the person's original pixels, cropped tight to the garment and without their face.
- **Brand and model** stay blank unless identified that way or readable. A generic piece (a plain white tank, plain dark jeans) is added as the person's crop with no brand rather than matched to a lookalike.
- **Every visible piece** is considered: garments, shoes, bags and accessories, not layers that barely show.
- **Linking to receipts:** when a photographed piece is probably an item already in the wardrobe from a receipt or Shop order, the model proposes the link. Code checks the item is the person's own. A confident link attaches the crop to that item instead of creating a duplicate; an unsure one is asked once. A photo never changes a receipt's size, colour or store.
- **Consent scope:** only photos the person texts to Jules as their own outfits or clothes. Photos uploaded for the style report are not added without asking.
- Corrections use the existing `closet_edit` feedback path; every addition is removable and restorable.

Build order, one PR each, checked live before the next: (1) stricter visual identification, so generic pieces are not called matches, and coverage of every visible piece in an outfit; (2) texted outfit photos become wardrobe items with their crop or matched photo, linked to receipt items. Out of scope: redrawn or "prettified" images, outfit building, wear tracking, web photo upload.
