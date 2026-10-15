# Personal Shopper Prototype

## Project goal

Build the smallest possible prototype described in `PRD.md`.

This is an experiment for a maximum of 10 initial users, not a production system.

## How to work

- Read `PRD.md` before making architectural decisions.
- Prefer simple implementations over scalable ones.
- Do not add infrastructure unless it is required for the current milestone.
- Do not implement future milestones speculatively.
- Explain external setup steps clearly for a non-engineer.
- Never commit API keys, credentials, phone numbers, or secrets to the repository.
- Use environment variables for secrets and provide a `.env.example` with placeholder values only.
- Add automated tests for important application logic where practical.
- Before declaring a milestone complete, verify its acceptance criteria.
- If a requested feature materially increases complexity, explain the tradeoff before implementing it.
- Never fabricate product prices, inventory, sizing, shipping, duties, discounts, or retailer policies.
- Handle unsupported requests within the application: explain uncertainty, preserve supported partial results, and ask for useful clarification when needed. Do not rely on human review or invent facts.

## Product priorities

In order:

1. Speed of learning
2. Quality of the user experience
3. Observability
4. Ease of iteration
5. Cost
6. Scalability

Scalability is not currently a priority.

## Engineering principles

- Keep the architecture boring and easy to understand.
- Avoid microservices and unnecessary abstraction.
- Keep dependencies minimal.
- Keep product-search logic separable from taste/ranking logic.
- Keep product selection conceptually separate from merchant selection.
- Persist important taste information structurally rather than relying only on chat history.
- Log enough information to understand failures and automated recovery outcomes.
- Design for self-supported automated search without an operator sourcing or resolution dependency.
- V0 must not store payment-card details or retailer credentials.
- V0 must not autonomously complete purchases.

## Conversation operating principle

Build around user intent and the expected conversational outcome. Each turn should move the current conversation forward while preserving context and trust.

- Do not use specific phrases, keyword lists, or regular expressions to decide Jules' conversational intent, reaction, response, or next action. User examples describe behavior, not commands to match.
- Use the model to interpret the message, relevant image, recent conversation, and pending choices into a structured intent and proposed outcome. Code validates product references, supported facts, permissions, and consent before executing an action; it does not infer intent from wording.
- Selection can mean one item, several, all, none, tentative preferences, exclusions, or a request for other options. Preserve the user's intended set and uncertainty; do not force every reply into a single numbered choice.
- Progress from the current state. Do not restart search, repeat a full list, or ask the same question when the user has already supplied useful information. Clarify only when ambiguity materially affects the next action.
- Offer the next useful step without claiming it has already happened. For multiple desired variants, offer to save the set and ask whether price-drop reminders should apply to that set; obtain clear consent before saving or enabling reminders.
- Tests assert intent, state transitions, supported actions, and conversational progress across varied language. Do not make exact phrasing the acceptance criterion. Include multi-turn cases for subsets, all, none, corrections, uncertainty, topic changes, and consent scope.
- Treat a conversational misstep as a trust defect. Fix the underlying interpretation/state model, not the single sentence in the bug report. Review existing phrase-based routing when changing the affected flow.

## Tester-readiness requirements

Founder decisions recorded in `TESTER-READINESS.md` and PRD Section 27 supersede narrower earlier sizing, receipt-learning, and clarification requirements.

- Interpret unstructured sizes using the message, relevant image, reply target, and product context across all clothing/accessory categories. Preserve the original size label and any stated system/length. A category size defaults across brands unless the user establishes an exception; never invent a conversion or verified fit/stock. A suit image with “I’m a 50R” establishes the general suit size 50R, not a shoe size or a brand-only exception.
- Learn retailer preferences from uploaded receipts and conversation as well as explicit declarations. Keep receipt-derived shopping history distinct from an explicit preference; it may guide merchant ranking without claiming loyalty or favorite status. Explicit preferences, avoidance and corrections take precedence. Rank a preferred merchant higher for the same eligible product/variant with verified availability in the user's size. Never let merchant preference outrank product identity or invent availability.
- Model-interpreted intent routes to supported application actions. No phrase/keyword/regex-based conversational routing, reactions, memory-semantic gates, or intent grading. Deterministic validation of technical formats, evidence references, ownership, permissions and consent remains required. For unclear intent, take a reversible, supported next step or ask a useful question; do not guess permission for saves, alerts or destructive changes.
- Founder exception (October 13, 2026): developer feedback is declared, not inferred. A message that starts with the `#dev` marker, or a 👎 tapback on a message, is saved as developer feedback by code before the agent runs (`lib/developer-feedback.js`). This is a command format the tester uses on purpose, like a slash command; it is the only marker-based routing allowed. Do not add others, and do not let the agent save developer feedback from unmarked wording. Output-quality signals (Jules missed what the user wanted) remain model-interpreted (an independent quality check, `qualityCheck` in `lib/ai.js`).
- Monitoring is a supported capability when configured: chat must create, inspect, change and cancel item/set alerts, and report actual persisted monitoring status. Capability instructions must match enabled tools and deployment configuration.
- Product feedback and corrections form a structured learning loop. Distinguish a bad product match, unavailable merchant, wrong size, current-request constraint and lasting preference; update only the appropriate scope. Support correction, replacement, wishlist removal, alert cancellation and forgetting profile facts.
- Preserve threaded reply references and resolve them against their original messages, images and product sets. A reply to an older message must not silently apply to the newest product. Support rapid messages, multiple selections, exclusions, recipient changes and topic changes.
- Ask about missing decision-relevant attributes surfaced by sourcing, not a fixed color/size questionnaire. Use attributes already supplied. Options may differ in color, material, length, fit, model, finish or other dimensions; avoid inventing variants.
- Persist newly established category sizes, brand exceptions and store preferences with evidence so future searches use them. Temporary selections and requests for someone else must not overwrite the user's general profile.

## Current milestone

Follow the milestone explicitly assigned by the user.

Do not proceed to the next milestone without being asked.

Milestone 7 (human fallback) is deprioritized by founder decision on October 7, 2026 and will not be implemented. Jules must handle the user-facing shopping loop without human intervention; keep unsupported facts unknown and provide a useful next step within the conversation.

For Milestone 1, the acceptance test is:

> A tester sends `hello` through iMessage to their Photon-assigned line, the application receives the message, and the tester receives `Hello from your personal shopper.`

Do not implement AI, taste profiles, product search, or other later-stage features until Milestone 1 passes.

## Working with the founder

Assume the founder is a product manager, not an experienced software engineer.

When an external action is required:
1. explain why it is needed;
2. give the exact action to take;
3. state what value or credential will be produced;
4. explain where that value should be stored;
5. never ask the founder to paste secrets into source code or commit them to Git.

When there are multiple reasonable technical options, recommend one rather than presenting an exhaustive menu unless the tradeoff materially affects the product experiment.

## Shared web design system

For companion web-app UI work, read `DESIGN-SYSTEM.md` and reuse `public/design-system.css` and `public/design-system.js`. Extend shared primitives/components when UI repeats; do not copy headers or redefine global layout, typography, logo, or controls in page stylesheets. Keep page content aligned to the shared full-width layout and gutters. Verify both wishlist and style pages on desktop and phone, including logo rest/hover, compact header, forms, dialogs, and browser errors, before deploying shared changes.
