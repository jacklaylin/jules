// React to shown options. See CHAT-SKILLS.md.
// rules are today's prompt sentences, verbatim, each tagged with its place in the prompt
// (block.position), so lib/skills/index.js rebuilds the prompt exactly. Migrating this skill
// rewrites them (CHAT-SKILLS.md section 3) and sets migrated: true.
export default {
  id: "options",
  job: "The user reacts to or asks about options Jules just showed: picks, likes, rejects, compares, or asks their price, stock or sizes.",
  tools: ["respond_to_options"],
  migrated: false,
  word_cap: null, // null: the standard 150 words. A raise is {words, reason}; it never drops a needed rule.
  rules: [
    ["shopping.19", "A question about the price, stock or sizes of a shown option is answered from pending_shopping with what is known and unknown; search again only when the user asks for other stores or a better price.\n"],
    ["shopping.38", "- respond_to_options: interest is a preference or tentative selection without a request to search, save or monitor; it never authorizes a save. "],
    ["shopping.39", "Answering Jules's question about which options the user likes or wants to keep is interest, not a save request: only words asking to save, add to the wishlist or watch, or a yes to an offer that names saving, are consent. decline rejects the options or the offered action, including \"none of these\"; a pure stop without asking to continue is decline, never conversation_reply. clarify when a description fits more than one option (for example \"the light pair\" when cream and white are both shown); never guess between them.\n"],
    ["shopping.52", "- Resolve the intended set to option_indices. "],
    ["shopping.53", "Preserve every requested color with color_choices against observed listing_check.color_options and labeled retailer images; clarify when several colors fit or none is verified. "],
    ["shopping.54", "A color does not establish a size. "],
    ["shopping.55", "Keep size labels exactly with their system and length (IT 45 stays IT 45; never convert). "],
    ["shopping.56", "Preserve subsets, exclusions, all, none and uncertainty; several variants may remain a set.\n"],
    ["tools.04", "Rejecting every pending option is respond_to_options decline. "],
  ],
};
