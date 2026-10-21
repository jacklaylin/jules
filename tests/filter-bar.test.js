import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chipsFit,FIT_SLACK} from '../public/filter-bar.js';

test('chips show only while every chip, the count, the action and the gaps fit on one row',()=>{
 const row={chipsWidth:800,otherWidths:[90,140],gap:20};
 assert.equal(chipsFit({...row,available:1070,menuMode:false}),true);
 assert.equal(chipsFit({...row,available:1069,menuMode:false}),false);
});

test('switching back from the menu needs spare room, so a window on the limit does not flicker',()=>{
 const row={chipsWidth:800,otherWidths:[90,140],gap:20};
 assert.equal(chipsFit({...row,available:1070,menuMode:true}),false);
 assert.equal(chipsFit({...row,available:1070+FIT_SLACK,menuMode:true}),true);
});

test('the filter row never wraps, and both collection pages fit it',async()=>{
 const css=await readFile(new URL('../public/design-system.css',import.meta.url),'utf8');
 const rules=css.match(/\.filter-bar\{[^}]*\}|\.filter-chips\{[^}]*\}/g);
 assert.ok(rules.length>=2);
 for(const rule of rules)assert.doesNotMatch(rule,/flex-wrap:wrap/);
 for(const page of ['wishlist','wardrobe'])assert.match(await readFile(new URL(`../public/${page}.js`,import.meta.url),'utf8'),/fitFilterBar\(\$\('toolbar'\)\)/);
});
