import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SKILLS, BLOCKS, PROMPT_BLOCKS } from '../lib/skills/index.js';
import { FIND_PRODUCTS_TOOL, ASK_SHOPPING_QUESTION_TOOL, RESPOND_TO_OPTIONS_TOOL, SAVE_TO_WISHLIST_TOOL, MANAGE_PRICE_ALERTS_TOOL, WISHLIST_PURCHASE_TOOL, WISHLIST_STATUS_TOOL, CHECKOUT_TOOL, QUALITY_SIGNAL_TOOL, CONVERSATION_TOOL } from '../lib/ai.js';
import { LIKED_ITEMS_TOOL } from '../lib/liked-items.js';
import { STYLE_INTERVIEW_TOOL } from '../lib/interview.js';
import { ORDER_SCREENSHOT_TOOL } from '../lib/order-screenshots.js';
import { PROFILE_TOOL, PROFILE_STATUS_TOOL } from '../lib/memory.js';
import { ONBOARDING_TOOL } from '../lib/onboarding.js';
import { PURCHASE_HISTORY_TOOL } from '../lib/receipt-chat.js';
import { OUTFIT_PHOTOS_TOOL } from '../lib/outfit-photos.js';
import { PURCHASE_TEXTS_TOOL } from '../lib/purchase-texts.js';
import { SCREENSHOT_PRODUCTS_TOOL } from '../lib/screenshot-products.js';
import { GOES_WITH_TOOL } from '../lib/goes-with.js';

// The prompt as it was before the split into skills (October 21, 2026). A skill migration changes
// its own rules on purpose: update this fixture in that PR, so the review shows the prompt diff.
const before = JSON.parse(fs.readFileSync(new URL('./fixtures/chat-prompt-blocks.json', import.meta.url), 'utf8'));

test('skills rebuild every prompt block exactly', () => {
  assert.deepEqual(BLOCKS, Object.keys(before));
  for (const name of BLOCKS) assert.equal(PROMPT_BLOCKS[name], before[name], name);
});

test('every rule has one place in the prompt and one skill', () => {
  const slots = SKILLS.flatMap(s => s.rules.map(([slot]) => slot));
  assert.equal(new Set(slots).size, slots.length);
  assert.ok(slots.every(slot => BLOCKS.includes(slot.split('.')[0])));
  assert.equal(new Set(SKILLS.map(s => s.id)).size, SKILLS.length);
});

test('every chat tool belongs to a skill, and the router can read each job', () => {
  const tools = [FIND_PRODUCTS_TOOL, ASK_SHOPPING_QUESTION_TOOL, RESPOND_TO_OPTIONS_TOOL, SAVE_TO_WISHLIST_TOOL, MANAGE_PRICE_ALERTS_TOOL, WISHLIST_PURCHASE_TOOL, WISHLIST_STATUS_TOOL, CHECKOUT_TOOL, QUALITY_SIGNAL_TOOL, CONVERSATION_TOOL,
    LIKED_ITEMS_TOOL, STYLE_INTERVIEW_TOOL, ORDER_SCREENSHOT_TOOL, PROFILE_TOOL, PROFILE_STATUS_TOOL, ONBOARDING_TOOL, PURCHASE_HISTORY_TOOL, OUTFIT_PHOTOS_TOOL, PURCHASE_TEXTS_TOOL, SCREENSHOT_PRODUCTS_TOOL, GOES_WITH_TOOL].map(t => t.name);
  const owned = new Set(SKILLS.flatMap(s => s.tools));
  assert.deepEqual(tools.filter(name => !owned.has(name)), []);
  assert.deepEqual([...owned].filter(name => !tools.includes(name)), []);
  for (const s of SKILLS) assert.ok(s.job.length > 20 && s.job.length <= 200, s.id);
});

// Founder rule (October 21, 2026): a migrated skill stays within 150 words and states each rule once.
// The cap stops the rules growing back; it never forces out a rule the evals need. A skill that needs
// more says so in its file (word_cap: {words, reason}), so the raise shows in the PR for review.
const capOf = s => s.word_cap?.words ?? 150;
test('migrated skills keep the rule budget', () => {
  const words = s => s.rules.map(([, text]) => text).join(' ').split(/\s+/).filter(Boolean).length;
  for (const s of SKILLS) {
    if (s.word_cap !== null) assert.ok(Number.isInteger(s.word_cap?.words) && s.word_cap.words > 150 && typeof s.word_cap.reason === 'string' && s.word_cap.reason.trim().length >= 20, `${s.id}: a raised cap needs words above 150 and a reason`);
    if (s.migrated) assert.ok(words(s) <= capOf(s), `${s.id}: ${words(s)} words, cap ${capOf(s)}`);
  }
  const texts = SKILLS.filter(s => s.migrated).flatMap(s => s.rules.map(([, text]) => text.trim()));
  assert.equal(new Set(texts).size, texts.length);
});
