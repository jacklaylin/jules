import core from './core.js';
import findExact from './find-exact.js';
import betterPrice from './better-price.js';
import explore from './explore.js';
import options from './options.js';
import saveOrWatch from './save-or-watch.js';
import savedItems from './saved-items.js';
import profile from './profile.js';
import history from './history.js';
import conversation from './conversation.js';

// The chat agent's rules, grouped by the job they serve (CHAT-SKILLS.md). Until the router and
// selective loading land, every turn still gets every rule: each block is rebuilt from its tagged
// sentences in their original order, so the prompt is exactly what it was before the split.
export const SKILLS = [core, findExact, betterPrice, explore, options, saveOrWatch, savedItems, profile, history, conversation];
export const BLOCKS = ['persona', 'offline', 'sourcing', 'shopping', 'tools', 'turn'];

const block = name => SKILLS.flatMap(s => s.rules).filter(([slot]) => slot.startsWith(name + '.'))
  .sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join('');
export const PROMPT_BLOCKS = Object.fromEntries(BLOCKS.map(name => [name, block(name)]));
