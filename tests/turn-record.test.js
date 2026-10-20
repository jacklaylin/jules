import test from 'node:test';
import assert from 'node:assert/strict';
import {withEarlierActions,RECORD_LIMIT} from '../lib/text-wishlist.js';

// October 20: the casual-shirts turn ran a search, then a selection; the selection's record replaced the search's.
const search={intent_action:'start',checked_at:'T1',products:[{url:'https://a.example/p/1'}],text_wishlist_diagnostics:{status:'shown',stylist:{status:'timeout'},closet:{status:'ok',duplicates:[]},
 candidates:Array.from({length:40},(_,i)=>({url:'https://a.example/p/'+i,checks:[{description:'x'.repeat(400)}]})),shown:[{source:'shop_catalog'}]}};
const selection={intent_action:'selection',checked_at:'T2',products:[],text_wishlist_state:{stage:'choice'}};

test('a later action in the turn keeps the earlier action’s diagnostics, compactly',()=>{
 const out=withEarlierActions(search,selection);
 assert.equal(out.intent_action,'selection','the newest action is still the record');
 assert.equal(out.earlier_actions.length,1);
 const kept=out.earlier_actions[0];
 assert.equal(kept.intent_action,'start');assert.deepEqual(kept.text_wishlist_diagnostics.stylist,{status:'timeout'});
 assert.equal(kept.text_wishlist_diagnostics.candidates,40,'the big candidate list is counted, not copied');
 assert.deepEqual(kept.products,['https://a.example/p/1']);
 // A third action keeps both.
 assert.deepEqual(withEarlierActions(out,{intent_action:'clarify_search'}).earlier_actions.map(a=>a.intent_action),['start','selection']);
});

test('nothing earlier, the same record again, or a record that would be too big leaves the record as it is',()=>{
 assert.equal(withEarlierActions(null,selection),selection);
 assert.equal(withEarlierActions(search,search),search);
 const huge={intent_action:'selection',text_wishlist_state:{options:'y'.repeat(RECORD_LIMIT)}};
 assert.equal(withEarlierActions(search,huge),huge,'never pushes the record past the database limit');
});
