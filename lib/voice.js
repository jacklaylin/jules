import { readFileSync } from 'node:fs';

// The actual document is included in Vercel functions; there is no second prompt copy.
export const VOICE = readFileSync(new URL('../VOICE.md', import.meta.url), 'utf8');
export const SEARCH_FAILURE_REPLY = 'i couldn’t finish the search just now. could you try again?';
export const NO_MATCH_REPLY = 'i couldn’t confidently identify that item. could you send a closer photo of the label or the original post?';
