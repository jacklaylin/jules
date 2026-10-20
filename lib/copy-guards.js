// Backstops for model-written report copy (The Read, the receipt and other style report cards).
// Each card's own prompt asks for the same; code drops any line that still matches.

// Lines shown on a shared report never talk to the reader.
export const SECOND_PERSON=/\b(you|your|yours|you're|you’re|yourself)\b/i;
// Habit and loyalty claims that purchase history can't support.
const CLAIM_WORDS='favou?rite|loyal|always|every ?time|obsess|addict';
export const CLAIMS=new RegExp(`\\b(${CLAIM_WORDS})`,'i');
// Money and worth, for copy about someone's outfit.
export const MONEY=/[$€£]|\b(price|cost|costs|spent|expensive|cheap|dollars?|pounds?|euros?|budget|rich|poor|salary)\b/i;
// Receipt-style cards: the claims above, a claim to a complete history, or money.
export const BANNED=new RegExp(`\\b(${CLAIM_WORDS}|complete history|\\$|€|£|dollars?|pounds?|euros?|cost|spent|price)`,'i');
