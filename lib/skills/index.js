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
// The message-writing half of TURN. With CHAT_NARRATE on, the writer (lib/narrate.js) gets these rules and
// the agent gets TURN without them: the model that runs the tools no longer writes the message.
export const WRITING_SLOTS = ['turn.08', 'turn.09', 'turn.10', 'turn.11', 'turn.12', 'turn.13'];
export const ruleText = slot => SKILLS.flatMap(s => s.rules).find(([s]) => s === slot)?.[1] ?? '';
export const AGENT_TURN = SKILLS.flatMap(s => s.rules).filter(([slot]) => slot.startsWith('turn.') && !WRITING_SLOTS.includes(slot))
  .sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join('');
