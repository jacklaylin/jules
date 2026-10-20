import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withoutRepeats} from '../lib/ai.js';

// October 20: a turn that saved one item and ran two searches sent their drafts joined, so the same
// "still considering" options and the same closing question appeared twice. Repeated paragraphs are
// kept once; everything else, and the order, stays as drafted.
const kept='still considering: 1. Biker blouson; 2. Leather biker jacket';
const close='which feel closest? tell me what to keep, rule out, or change—or ask for more.';

test('a paragraph repeated across joined drafts is kept once, and the closing question stays last',()=>{
 const shoes=['a few options to start with.','3. Event derby, brown · $555.00\nhttps://shop.example/derby-brown','4. Event derby, black · $555.00\nhttps://shop.example/derby-black'];
 const belts=['a few options to start with.','3. Drivers belt, black croc · $205.00\nhttps://shop.example/belt'];
 const joined=['already in your wishlist.',kept,...shoes,close,kept,...belts,close].join('\n\n');
 const out=withoutRepeats(joined).split('\n\n');
 assert.equal(out.filter(p=>p===kept).length,1);assert.equal(out.indexOf(kept),1,'kept options stay where they first appear');
 assert.equal(out.filter(p=>p===close).length,1);assert.equal(out.at(-1),close,'the reply still ends with its question');
 assert.equal(out.filter(p=>p==='a few options to start with.').length,1);
 for(const p of [...shoes.slice(1),...belts.slice(1)])assert.ok(out.includes(p),'every option is kept');
});

test('repeats differing only in spacing or case count as the same; different text never merges',()=>{
 assert.equal(withoutRepeats('Which one?\n\nlink A\n\nwhich  one?'),'link A\n\nwhich  one?');
 assert.equal(withoutRepeats('want the black one?\n\nwant the brown one?'),'want the black one?\n\nwant the brown one?');
});

test('single drafts, line breaks inside a paragraph, and empty text are unchanged',()=>{
 for(const text of ['sure.','1. a\n1. a','one\n\ntwo\n\nthree',''])assert.equal(withoutRepeats(text),text);
 assert.equal(withoutRepeats('one\n\n\n\ntwo'),'one\n\ntwo');
});
