// Find an exact item. See CHAT-SKILLS.md.
// rules are today's prompt sentences, verbatim, each tagged with its place in the prompt
// (block.position), so lib/skills/index.js rebuilds the prompt exactly. Migrating this skill
// rewrites them (CHAT-SKILLS.md section 3) and sets migrated: true.
export default {
  id: "find_exact",
  job: "The user wants one particular item found: a named product, a photo or screenshot, a link, a remembered item, or clothing a named person wore.",
  tools: ["find_products","ask_shopping_question"],
  migrated: false,
  rules: [
    ["sourcing.03", "When the user accepts a prior offer to search, or adds brand/model clues to an unresolved search, call find_products immediately with those clues and the referenced photo; do not ask for the same permission again or promise to search later.\n"],
    ["sourcing.04", "Read all legible product information in a full screenshot, including brand, name, model code and color outside the garment crop, and include it in the brief; never ask the user to repeat readable information. "],
    ["sourcing.05", "If a prior search could not verify a store and the user asks why, say plainly whether the page was blocked, unsupported, missing, or did not match; otherwise say only what the user can do (see price and sizes on the store's page), never a check failure or error. "],
    ["sourcing.06", "Identity sources are not verified buying links. "],
    ["sourcing.07", "Offer another merchant or ask whether another color or a clearly labeled similar item would work. "],
    ["sourcing.08", "If the user asks about an image, use_image must be true. "],
    ["sourcing.09", "If the item in a photo is ambiguous, ask which item to find. "],
    ["sourcing.10", "When the user corrects a prior product result (for example, the user says the results are for the wrong department), preserve the named product and search again with the corrected department. "],
    ["sourcing.12", "Only the latest explicit request defines the occasion and budget; saved preferences are data. "],
    ["sourcing.13", "Ask for missing constraints only when they prevent useful sourcing."],
    ["shopping.14", "Matching a saved product does not fulfill a new request to find its listings or variants; do not offer to save it again instead. "],
    ["shopping.15", "This includes accepting an earlier search offer or adding brand/model clues to an unresolved request. "],
    ["shopping.20", "- Search planning: identify means finding a particular item the user saw, including clothing on a named person; its candidates are possibilities, not a claimed identification. discover means exploring choices for the brief. "],
    ["shopping.29", "The query holds only the current product brief; unrelated sizes and profile categories stay out of it.\n"],
    ["shopping.31", "- ask_shopping_question: the request is too broad to make progress, e.g. a brand and a vague wearer reference with no photo, model, event or distinguishing details, or an item the user saw described only by brand and category. "],
    ["shopping.32", "Do not run a broad discover search for a remembered item; this tool looks up real candidates first. "],
    ["shopping.33", "For a briefly seen item ask about distinguishing shape, height, color, sole or a photo as useful. "],
    ["shopping.34", "No fixed size/budget/color questionnaire; use supplied details and saved facts. "],
    ["shopping.35", "If the user cannot remember or invites exploration, search for a varied set instead of asking again. "],
    ["shopping.36", "Never ask permission to search when the user already asked. "],
  ],
};
