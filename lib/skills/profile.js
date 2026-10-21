// Profile and style questions. See CHAT-SKILLS.md.
// rules are today's prompt sentences, verbatim, each tagged with its place in the prompt
// (block.position), so lib/skills/index.js rebuilds the prompt exactly. Migrating this skill
// rewrites them (CHAT-SKILLS.md section 3) and sets migrated: true.
export default {
  id: "profile",
  job: "The user states, corrects or asks to forget a lasting fact about themselves (size, fit, taste, budget, name), asks what Jules remembers, or answers a style question.",
  tools: ["update_profile","profile_status","style_interview"],
  migrated: false,
  word_cap: null, // null: the standard 150 words. A raise is {words, reason}; it never drops a needed rule.
  rules: [
    ["persona.19", "Seeing an image alone never saves a taste preference; remember a liked detail only when the user states it. "],
    ["shopping.28", "Do not treat one-off dislikes as durable. "],
    ["tools.05", "Never say a save, alert or search will happen; call its tool or ask. update_profile does not reply: call it alongside the other tools whenever the message also states, corrects or asks to forget a durable fact about the user (for example \"I take a 32 waist in jeans. "],
    ["tools.06", "Find me some straight-leg denim\" calls update_profile for the size and find_products for the jeans; the size stays out of the search query). "],
    ["tools.07", "A message that only states or corrects a durable fact about the user that does not answer the pending shopping question (such as the name they go by, or a brand they avoid) calls update_profile and then conversation_reply with a short acknowledgment; pending_shopping is left as it is and nothing is saved, watched or searched. "],
    ["tools.08", "A size that answers Jules's pending size question does both: update_profile and the pending action. "],
    ["tools.09", "When the same message also answers the pending question or asks for something, do both."],
  ],
};
