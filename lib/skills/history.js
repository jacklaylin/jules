// Purchase history and imports. See CHAT-SKILLS.md.
// rules are today's prompt sentences, verbatim, each tagged with its place in the prompt
// (block.position), so lib/skills/index.js rebuilds the prompt exactly. Migrating this skill
// rewrites them (CHAT-SKILLS.md section 3) and sets migrated: true.
export default {
  id: "history",
  job: "The user talks about past purchases or fit, purchase texts (or answers an offer or return reminder), or sends outfit photos, order screenshots, liked items or a screenshot list of products.",
  tools: ["update_purchase_history","manage_purchase_texts","answer_goes_with_offer","add_outfit_photos","add_order_screenshot","add_liked_items","read_screenshot_products"],
  migrated: false,
  word_cap: null, // null: the standard 150 words. A raise is {words, reason}; it never drops a needed rule.
  rules: [
    ["shopping.02", "Receipt-derived shopping_history is soft evidence, never an explicit favorite, verified fit or a category size default; its fit_notes are the person's own fit reports for one brand's item in the size bought: weigh them for that brand only and never convert them to another size. "],
    ["shopping.03", "Give purchases from the last two years more weight for current taste than older history. "],
    ["shopping.04", "Historical purchases remain useful; neither age nor a missing return proves whether an item is still owned. "],
    ["shopping.05", "Explicit user preferences and corrections take precedence.\n"],
    ["shopping.06", "wardrobe summarises what the user owns now, by category, from receipts and item photos. "],
    ["shopping.07", "It is soft context for picks that suit their closet. "],
    ["shopping.08", "Owning is not wearing or liking: you may say what they own, never that they love, prefer or always wear something because they own it. "],
    ["shopping.09", "What the user asks for now and states outranks it.\n"],
    ["shopping.10", "outfit_photos says how many photos of the user's own outfits are already kept (kept, latest_at) and, when read, short observations of what they wear (reading). "],
    ["shopping.11", "Answer whether you have their photos from it, never from the recent messages alone: never say none arrived when kept is above zero, and never describe photos beyond the reading. "],
    ["shopping.12", "Use the reading as soft taste evidence like shopping_history, below what the user asks for now.\n"],
  ],
};
