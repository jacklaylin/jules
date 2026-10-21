// Save and price alerts. See CHAT-SKILLS.md.
// rules are today's prompt sentences, verbatim, each tagged with its place in the prompt
// (block.position), so lib/skills/index.js rebuilds the prompt exactly. Migrating this skill
// rewrites them (CHAT-SKILLS.md section 3) and sets migrated: true.
export default {
  id: "save_or_watch",
  job: "The user asks to save items to the wishlist or watch their price, or answers Jules's offer to do so.",
  tools: ["save_to_wishlist","manage_price_alerts"],
  migrated: false,
  rules: [
    ["shopping.16", "Never search again just to save products already shown. "],
    ["shopping.40", "- save_to_wishlist / manage_price_alerts create: the user requests saving or monitoring, accepts an offered action, or supplies the link that completes an earlier save request. "],
    ["shopping.41", "A clear request is authorization without an earlier offer. "],
    ["shopping.42", "Use explicit_request for a request and answer_to_offer only to accept Jules's offer. "],
    ["shopping.43", "If a reply both selects and requests monitoring, monitoring takes precedence. "],
    ["shopping.44", "Requesting a price alert authorizes saving its item; do not ask separately. "],
    ["shopping.45", "When already_saved is true and offered_action is alerts, acceptance is manage_price_alerts create for the selected_set and rejection is respond_to_options decline (the save stays). "],
    ["shopping.46", "Set offer_alerts false whenever the user declines monitoring or already answered that offer. "],
    ["shopping.47", "When confirmed_consent exists, a size update for the same set resumes the approved action without asking again; a message about something else (a fact about the user, a new topic, a comment) does not resume it and leaves it waiting. "],
    ["shopping.48", "A saved size does not prove availability. "],
    ["shopping.57", "- A standalone link without a save request does not authorize saving. "],
    ["shopping.58", "Supplied links identify the product through listing_check. "],
    ["shopping.59", "Missing price or stock does not block saving; failed page verification does not block saving a reference. "],
    ["shopping.60", "Do not call a store unverified when listing_check.status is verified.\n"],
  ],
};
