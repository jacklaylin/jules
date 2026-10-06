import { readFileSync } from 'node:fs';

// The actual document is included in Vercel functions; there is no second prompt copy.
export const VOICE = readFileSync(new URL('../VOICE.md', import.meta.url), 'utf8');
export const SEARCH_FAILURE_REPLY = 'I couldn’t finish the search just now. Could you try again?';
export const NO_MATCH_REPLY = 'I couldn’t confidently identify that item. Could you send a closer photo of the label or the original post?';
