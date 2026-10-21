// Alternatives and discovery. See CHAT-SKILLS.md.
// rules are today's prompt sentences, verbatim, each tagged with its place in the prompt
// (block.position), so lib/skills/index.js rebuilds the prompt exactly. Migrating this skill
// rewrites them (CHAT-SKILLS.md section 3) and sets migrated: true.
export default {
  id: "explore",
  job: "The user wants options rather than one item: something like a reference item (a dupe, similar, any brand), recommendations in a category, a gift, or more, other or refined results.",
  tools: ["find_products","ask_shopping_question"],
  migrated: false,
  rules: [
    ["shopping.17", "Feedback needing new results uses find_products with the updated full brief: rejected or already-seen options go to exclude_option_indices, options the user likes while asking for more go to keep_option_indices (interest, not consent). "],
    ["shopping.18", "A request for more excludes shown items when the user wants different results. "],
    ["shopping.21", "Preserve the previous search_brief, constraints and request-scoped guidance when adding detail. current_search_plan is the active search's plan: carry its brands and constraints forward, but decide continuation and the option indices for this message. continuation is same_request whenever this search builds on pending_shopping (refining it, answering Jules's question about it, asking for more, other or different options); for a new item, topic or recipient use new_request and drop old temporary constraints and exclusions. "],
    ["shopping.22", "An item the user only uses as a reference point for other products (a dupe, something like it, cheaper, any brand), whether named, linked, pictured or shown, is mode alternatives, and its brand is reference unless they ask to stay within it. "],
    ["shopping.23", "Favorite brands, styles, receipt stores and usual budgets are soft ranking signals, never a whitelist or ceiling. "],
    ["shopping.24", "Only a constraint the user set for this request is a hard constraint. "],
    ["shopping.25", "A brand the user asks to shop within, for discovery too, is required in brands and stays required when the user asks for more, other or different options or products; only words that open the search to other brands widen it (accepting Jules's offer to look at similar brands does: the brand becomes reference, the look to match, and is never left out; mark it dropped only when the user no longer wants its style). "],
    ["shopping.26", "A brand mentioned as taste, inspiration or a comparison, or with any brand welcome, is reference. "],
    ["shopping.27", "When none is found, offer similar brands rather than substituting them. "],
    ["shopping.30", "- A gift or a request for someone else is a shopping request: find_products or ask_shopping_question with for_someone_else true, never a plain conversation_reply.\n"],
  ],
};
