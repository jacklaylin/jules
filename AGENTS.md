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
- Prefer a human-review fallback over unreliable automation.

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
- Log enough information to understand failures and human interventions.
- Design for automated search with human fallback.
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

## Current milestone

Follow the milestone explicitly assigned by the user.

Do not proceed to the next milestone without being asked.

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
