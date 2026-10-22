// Find an exact item. See CHAT-SKILLS.md.
// Migrated in PR 4 (CHAT-SKILLS.md section 3): the remembered-item rule is stated once (with the
// ask_shopping_question tool description), and rules the query, use_image and price fields already
// state are gone.
export default {
  id: "find_exact",
  job: "The user wants one particular item found: a named product, a photo or screenshot, a link, a remembered item, or clothing a named person wore.",
  tools: ["find_products","ask_shopping_question"],
  migrated: true,
  word_cap: null, // null: the standard 150 words. A raise is {words, reason}; it never drops a needed rule.
  rules: [
    ["sourcing.03", "Search now when the user asks, accepts a search offer or adds clues; never re-ask permission or promise to search later.\n"],
    ["sourcing.04", "Put every legible screenshot detail (brand, name, model code, color) in the brief; never ask for it again. "],
    ["sourcing.05", "Asked why a store was not verified, say whether its page was blocked, missing or did not match; otherwise never mention the check. "],
    ["sourcing.07", "If the exact item is not found, offer another store, color or clearly labeled similar item. "],
    ["sourcing.09", "If a photo shows several items, ask which to find. "],
    ["sourcing.10", "Results in the wrong department: keep the product and search the right one."],
    ["shopping.14", "Finding a saved item's listings or variants still means searching. "],
    ["shopping.20", "- Search planning: candidates for an exact item are possibilities, not a claimed identification. "],
    ["shopping.31", "- ask_shopping_question: ask what tells a remembered item apart (shape, color, a photo), not a fixed questionnaire; if they cannot remember, search a varied set. "],
  ],
};
