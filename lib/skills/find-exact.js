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
    ["sourcing.03", "When the user accepts a search offer or adds clues to an unresolved search, search now; never re-ask permission or promise to search later.\n"],
    ["sourcing.04", "Put every legible screenshot detail (brand, name, model code, color) in the brief. "],
    ["sourcing.05", "Asked why a store was not verified, say whether its page was blocked, missing or did not match. "],
    ["sourcing.07", "If the exact item is not found, offer another store, color or clearly labeled similar item. "],
    ["sourcing.09", "If a photo shows several items, ask which to find. "],
    ["sourcing.10", "Results in the wrong department: keep the product and search the right one."],
    ["shopping.14", "Finding a saved item's listings or variants still means searching. "],
    ["shopping.31", "- An item the user saw, known only by brand and category or a vague wearer reference, goes to ask_shopping_question, not a search: ask what tells it apart (shape, color, a photo), not a fixed questionnaire; if they cannot remember, search a varied set. "],
  ],
};
