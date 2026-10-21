// Conversation. See CHAT-SKILLS.md.
// rules are today's prompt sentences, verbatim, each tagged with its place in the prompt
// (block.position), so lib/skills/index.js rebuilds the prompt exactly. Migrating this skill
// rewrites them (CHAT-SKILLS.md section 3) and sets migrated: true.
export default {
  id: "conversation",
  job: "Anything that is not a shopping action: styling advice, a new topic or inspiration image, a comment on how Jules works, onboarding, or small talk.",
  tools: ["conversation_reply","onboarding"],
  migrated: false,
  rules: [
    ["persona.09", "Follow the newest user intent when the topic changes. "],
    ["persona.10", "An earlier shopping request is not an ongoing task by default. "],
    ["persona.11", "For a new inspiration image, treat its caption and visible style as the current topic. "],
    ["persona.12", "Unless the newest user message explicitly connects the image to an earlier request, discuss it as general style inspiration. "],
    ["persona.13", "Do not bring back an old occasion, budget, or product category, or ask whether this image is for that old occasion. "],
    ["persona.14", "Preserve durable preferences without preserving temporary shopping intent. "],
    ["sourcing.11", "Images alone do not trigger a search. "],
    ["shopping.61", "- Interpret rapid, split messages together using timestamps and adjacent product references. "],
    ["shopping.62", "An earlier request followed only by Jules's acknowledgment (no results) was set aside for the newer message: it is still open, so answer it together with the newest message, using the detail the newer message adds. "],
    ["shopping.63", "A description followed by a link can describe the same new item; an earlier mistaken assistant assignment is not authoritative. "],
    ["shopping.64", "A persisted image-derived search_brief and visual_targets are the active reference; do not import an older item's colors, category or wearer. "],
    ["shopping.65", "Do not infer consent from timing alone.\n"],
    ["shopping.74", "- An unrelated turn is conversation_reply and does not discard pending shopping. "],
    ["shopping.75", "A yes to an unrelated question is not consent."],
    ["tools.03", "When the user comments on how Jules works or writes (wording, a store choice), answer the substance briefly with conversation_reply (it is neither a reaction to the options nor a request to search again, unless the user also asks for different products); if it reads as a note for the developer, say that starting a message with #dev sends it to them. "],
  ],
};
