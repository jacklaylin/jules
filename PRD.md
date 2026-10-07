# PRD — AI Personal Shopper V0

**Status:** Prototype  
**Goal:** Working product in ≤1 weekend  
**Initial users:** Founder + 5–10 invited testers  
**Budget:** ≤$250 to launch  
**Primary interface:** iMessage via Photon (founder-approved change; SMS/RCS fallback is not the Milestone 1 test)
**Working name:** TBD

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

### 4.2 Taste before catalog
Do not show large result sets. Default to **3 products**, maximum **5** unless explicitly requested.

### 4.3 Remember everything useful
Users should not repeatedly specify sizes, brands, price sensitivity, aesthetic preferences, retailer preferences, owned items, or rejected recommendations. Persistent understanding is central.

### 4.4 Search broadly, recommend narrowly
The agent should consider many candidates but expose very few. The value proposition is: **“I looked everywhere so you don't have to.”**

### 4.5 Be opinionated
Avoid generic assistant language. Make judgments and explain relevant tradeoffs.

### 4.6 Never fabricate commerce information
Never invent prices, inventory, size availability, shipping costs, duties, retailer policies, or discounts. Flag uncertainty or request human review.

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
Given a link, screenshot, product name, or image, search for matching listings and requested sizes. Return retailer, price, availability, shipping information when available, and link. If confidence is insufficient, create a human sourcing task.

### SAVE — companion wishlist
Automatically retain items and product links sent in response to explicit image-identification requests. Let users revisit them in a private, mobile-friendly web grid, inspect product details and the original inspiration image, and return to the same retailer links. See Section 25 for the scoped wishlist milestone.

### OPTIMIZE
For a known product, search alternative sources and compare item price, sale price, shipping, estimated duties when reliable, return policy, availability, and retailer credibility. Explicitly flag unknowns.

### WATCH
Allow users to define a product/variant/size and target price. Store the watch and periodically check known URLs or search again. Notify when the condition is met.

### DISCOVER
Eventually initiate proactive recommendations based on taste and standing intent. For V0, proactive recommendations may be manually initiated by the operator. Do not build continuous automated fashion discovery yet.

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

### human_tasks
- id
- user_id
- shopping_intent_id
- reason
- status
- operator_notes
- created_at
- resolved_at

Keep the schema flexible.

## 11. Search architecture

V0 supports **automated web/product search with human fallback**.

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
     ↙ ↘
 High   Low
 ↓       ↓
Reply   Human review
```

The system does not need to comprehensively index fashion. Use external search/web capabilities initially.

## 12. Search philosophy

Separate:
1. **Product selection:** Which product is best for this person?
2. **Merchant selection:** Where should they buy it?

Long-term hierarchy:

**USER → TASTE → INTENT → PRODUCT → MERCHANT OPTIONS → TRANSACTION**

Do not architect the system around retailers.

### Future merchant ranking

This is future OPTIMIZE guidance, not a requirement for the current visual-search implementation.

First establish the product match and the requested variant and size. Compare merchants selling equivalent eligible products; a preferred retailer must not make the wrong product rank higher.

Official brands and reviewed retailers are useful defaults, not an absolute ordering. Merchant ranking should also consider:

- **Verified total delivered cost:** item price, applicable discounts, taxes, shipping, duties, and other fees, compared in the same currency for the user's destination. A small boutique can rank above the official brand when its verified total is lower. Unknown charges must remain unknown, never be treated as zero or used to claim a listing is cheaper.
- **Explicit shopping preferences:** persist preferred and avoided retailers structurally in `retailer_preferences`. A user who usually shops at Mr Porter may prefer it over the official brand, even at a modest premium. Substantial verified savings elsewhere may change the recommendation.
- **Loyalty preferences and benefits:** record preferences the user explicitly shares; count benefits only when their applicability is verified. Do not store retailer credentials or payment details.

Explain the tradeoff briefly, such as the user's usual store versus a cheaper verified option elsewhere. When the choice depends on how much extra the user will pay for a preferred store, ask for that preference rather than inventing a universal premium or savings threshold. Unfamiliar stores remain unreviewed until assessed; a lower price alone does not establish retailer credibility.

## 13. Human fallback

If the agent cannot confidently complete something, create a human task.

The operator researches manually, enters relevant listings/facts/recommendation, and the agent formats and sends the response.

Record what the human had to do. Repeated human work should inform future automation priorities.

## 14. Admin console

Keep it extremely simple.

### Customers
Show name/phone, onboarding status, taste summary, and current intents.

### Customer detail
Show conversation, taste profile, recommendation history, active watches, and human tasks. Allow the operator to edit the taste profile, send SMS, create a recommendation, and resolve a human task.

### Human queue
Show unresolved tasks oldest-first.

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
create_human_task(reason, context)
record_feedback(recommendation, feedback)
send_recommendation(products)
```

Implementation may change.

## 18. Commerce

V0 does **not** transact.

When a user says “Buy it,” return the best checkout link and log `PURCHASE_INTENT = TRUE`. Optionally follow up to record a confirmed purchase.

Do not store credit-card numbers, CVVs, or retailer passwords. Do not automate checkout.

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
- affiliate infrastructure
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

### Milestone 7 — Human fallback
Acceptance test: Difficult searches appear in admin and I can resolve them manually.

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
- human interventions/request
- time spent manually sourcing
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
