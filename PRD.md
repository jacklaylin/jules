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
There is no consumer dashboard in V0. The product lives in SMS/MMS. Users communicate naturally and the system should infer and remember context.

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
- consumer web dashboard
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
