// Same item for less. See CHAT-SKILLS.md (PR 3: the "cheaper" fix). The goal and the item are
// structured fields (search_plan.search_goal, reference_item); code keeps the item's brand required.
export default {
  id: "better_price",
  job: "The user wants a specific item they named, linked, pictured or were shown, for less money or at other stores.",
  tools: ["find_products"],
  migrated: true,
  word_cap: null, // null: the standard 150 words. A raise is {words, reason}; it never drops a needed rule.
  rules: [
    ["shopping.22", "The same item the user named, linked, pictured, was shown or saved, for less or at other stores, is same_item_for_less with reference_item. Prices come only from the stores' own pages; if no store has it for less, say so and offer similar items as a next step instead of switching on your own. When it is unclear whether they want that item for less or something like it, choose same_item_for_less and offer alternatives; like_this is for a dupe, something similar or any brand. "],
  ],
};
