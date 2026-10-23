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

// Ratchet on everything the chat model reads as instructions (CHAT-DEVELOPMENT.md, October 22, 2026):
// the prompt blocks, the feature guides loaded from app state, and the tool and field descriptions.
// Each part stays within its budget in tests/fixtures/chat-prompt-budget.json. Growing a part needs a
// raise with a reason (it shows in the PR); shrinking one needs the budget lowered in the same PR.
const budgetFile = JSON.parse(fs.readFileSync(new URL('./fixtures/chat-prompt-budget.json', import.meta.url), 'utf8'));
const GUIDE_MODULES = ['outfit-photos', 'liked-items', 'receipt-chat', 'purchase-texts', 'waitlist', 'order-screenshots', 'memory', 'goes-with', 'screenshot-products', 'return-windows'];
const TOOL_MODULES = ['ai', ...GUIDE_MODULES, 'interview', 'onboarding'];
const countWords = s => String(s).split(/\s+/).filter(Boolean).length;
const descriptionWords = o => !o || typeof o !== 'object' ? 0 : Object.entries(o).reduce((n, [k, v]) => n + (k === 'description' && typeof v === 'string' ? countWords(v) : descriptionWords(v)), 0);
const exportsOf = async names => (await Promise.all([...new Set(names)].map(m => import(`../lib/${m}.js`)))).flatMap(mod => Object.entries(mod));
const SLACK = 25;
test('chat instructions stay within their word budget', async () => {
  const guides = (await exportsOf(GUIDE_MODULES)).filter(([k, v]) => /GUIDE/.test(k) && typeof v === 'string');
  const tools = new Map((await exportsOf(TOOL_MODULES)).filter(([k, v]) => /_TOOL$/.test(k) && v && typeof v === 'object'));
  // Example conversations are exempt (CHAT-DEVELOPMENT.md rule 5): an example that replaces a rule is progress.
  const current = {
    prompt_blocks: Object.entries(PROMPT_BLOCKS).filter(([name]) => name !== 'examples').reduce((n, [, s]) => n + countWords(s), 0),
    feature_guides: guides.reduce((n, [, s]) => n + countWords(s), 0),
    tool_descriptions: [...tools.values()].reduce((n, t) => n + descriptionWords(t), 0),
  };
  // Fewer, clearer tools (rule 6): the count may not grow; a new capability extends or replaces a tool.
  const toolCount = new Set([...tools.values()].map(t => t.name)).size;
  assert.ok(toolCount <= budgetFile.max_tools, `${toolCount} chat tools, limit ${budgetFile.max_tools}. Extend or merge an existing tool instead of adding one.`);
  assert.ok(toolCount === budgetFile.max_tools, `${toolCount} chat tools: lower max_tools to ${toolCount} so the merge stays merged.`);
  for (const r of budgetFile.raises) assert.ok(r.part in current && Number.isInteger(r.words) && r.words > 0 && typeof r.reason === 'string' && r.reason.trim().length >= 20, 'a raise names a part, its words and a reason');
  for (const [part, words] of Object.entries(current)) {
    const allowed = budgetFile.budget[part] + budgetFile.raises.filter(r => r.part === part).reduce((n, r) => n + r.words, 0);
    assert.ok(words <= allowed, `${part}: ${words} words, budget ${allowed}. Cut or merge a rule, prefer a code check or structured field, or add a raise with a reason.`);
    assert.ok(words >= allowed - SLACK, `${part}: ${words} words, budget ${allowed}. Lower the budget to ${words} (and drop spent raises) so the cut stays cut.`);
  }
});
