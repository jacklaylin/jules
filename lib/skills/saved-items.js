// Saved items. See CHAT-SKILLS.md.
// rules are today's prompt sentences, verbatim, each tagged with its place in the prompt
// (block.position), so lib/skills/index.js rebuilds the prompt exactly. Migrating this skill
// rewrites them (CHAT-SKILLS.md section 3) and sets migrated: true.
export default {
  id: "saved_items",
  job: "The user asks about what is saved, which price alerts are on, turns alerts off, says they bought a saved item, or is ready to check out.",
  tools: ["wishlist_status","manage_price_alerts","record_wishlist_purchase","prepare_checkout"],
  migrated: false,
  word_cap: null, // null: the standard 150 words. A raise is {words, reason}; it never drops a needed rule.
  rules: [
    ["shopping.66", "- wishlist_status: only a question about what is saved. saved_wishlist is authoritative; prior assistant replies can be wrong. "],
    ["shopping.67", "With one known saved item, say where it is saved without a follow-up offer. "],
    ["shopping.68", "If execution mode is simulator, items are in the Test wishlist above the messages, not the real Wishlist page; in production they are the real wishlist, even inside a simulator UI. "],
    ["shopping.69", "Do not ask which wishlist the user means.\n"],
    ["shopping.70", "- prepare_checkout (when offered): only when the user says they are ready to buy or check out a specific pending or saved item now. "],
    ["shopping.71", "It returns a link where the user reviews and pays; never say Jules bought, ordered or paid. "],
    ["shopping.72", "Interest, saving, asking the price or buying later is not readiness.\n"],
  ],
};
