import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {markBought,markNotBought,wishlistPurchaseChat,purchaseEvidence,boughtMark,purchaseSource} from '../lib/wishlist-purchases.js';
import {groupWishlist} from '../lib/wishlist.js';
import {loadReceipts} from '../lib/evidence.js';
import {wardrobeView} from '../lib/wardrobe.js';
import {createWishlistHandler} from '../api/wishlist.js';

const owner='00000000-0000-4000-8000-000000000001';
const rows=()=>[{item_id:'00000000-0000-4000-8000-000000000002',reply_id:owner,source_image_id:owner,target:'loafer',name:'Suede penny loafer',
 links:[{url:'https://www.mrporter.com/loafer',verification_status:'verified'},{url:'https://nordstrom.com/loafer',verification_status:'verified'}]}];

// A store that keeps evidence and the purchase-history row in memory, like the database does.
function fakeStore({busy=false,entries=rows()}={}){
 const s={_rows:[],calls:[],history:null,entries};
 return Object.assign(s,{
  gmailImport:async()=>s.history,
  ensureGmailImport:async()=>{s.calls.push('ensure');s.history??={revision:1,data:{},token_ciphertext:null};},
  claimGmailImport:async()=>busy?null:{...s.history},
  finishGmailImport:async(_o,revision,data,_t,evidence=[])=>{s.history={...s.history,revision:revision+1,data};s._rows.push(...evidence.filter(e=>!s._rows.some(x=>x.id===e.id)));s.calls.push(['finish',evidence.length]);return true;},
  // As lib/store.js reads it: the rows of the given origins, in recorded order.
  evidence:async(_o,origins)=>s._rows.filter(e=>!origins||origins.includes(e.origin)),
  recordEvidence:async(_o,list)=>{s._rows.push(...list);s.calls.push(['record',list.map(e=>e.kind)]);},
  deleteEvidence:async(_o,origin,source)=>{s.calls.push(['delete',origin,source]);s._rows=s._rows.filter(e=>!(e.origin===origin&&e.source?.id===source));},
  disablePriceAlert:async(_o,group)=>s.calls.push(['alert-off',group]),
  updateWishlistEntries:async(_o,list,changes)=>{s.calls.push(['mark',changes]);for(const e of list)s.entries.find(r=>r.item_id===e.item_id&&r.reply_id===e.reply_id).bought=changes.wishlist_bought;},
  wishlistEntries:async()=>s.entries,
 });
}
const item=store=>groupWishlist(store.entries)[0];

test('marking a saved item bought stops its alert, moves it to Bought and adds it to the wardrobe',async()=>{
 const store=fakeStore();
 const result=await markBought(store,owner,item(store),{store:'mrporter.com',size:'10',via:'wishlist_page'});
 assert.equal(result.changed,true);assert.equal(result.bought.store,'mrporter.com');assert.equal(result.bought.size,'10');
 assert.deepEqual(store.calls[0],['alert-off',item(store).id]);
 assert.equal(store.calls[1][1].wishlist_removed,false);
 // Ensured a history row for someone who never imported email, then wrote under its lease.
 assert.ok(store.calls.includes('ensure'));
 assert.deepEqual(store._rows.map(e=>e.kind).sort(),['purchase_event','wishlist_event']);
 const event=store._rows.find(e=>e.kind==='wishlist_event');
 assert.equal(event.data.action,'bought');assert.equal(event.data.via,'wishlist_page');assert.equal(event.origin,'wishlist_purchase');
 // The wardrobe shows it, with only what the person said: no price, brand or color invented.
 const receipts=await loadReceipts(store,owner,store.history);
 const view=wardrobeView(receipts.state);
 assert.equal(view.items.length,1);
 const [owned]=view.items;
 assert.equal(owned.merchant,'mrporter.com');assert.equal(owned.size,'10');assert.equal(owned.product,'Suede penny loafer');
 assert.equal(owned.brand,null);assert.equal(owned.color,null);assert.equal(owned.from_wishlist,item(store).id);assert.ok(owned.bought_at);
 // The group now carries the mark.
 assert.equal(item(store).bought.store,'mrporter.com');
});

test('a repeated mark changes nothing',async()=>{
 const store=fakeStore();
 await markBought(store,owner,item(store),{});
 const before=store.calls.length;
 assert.equal((await markBought(store,owner,item(store),{})).changed,false);
 assert.equal(store.calls.length,before);
});

test('undo removes the purchase from the wardrobe, clears the mark and keeps an audit event',async()=>{
 const store=fakeStore();
 await markBought(store,owner,item(store),{store:'Nordstrom'});
 assert.equal((await markNotBought(store,owner,item(store))).changed,true);
 assert.ok(store.calls.some(c=>c[0]==='delete'&&c[1]==='wishlist_purchase'&&c[2]===purchaseSource(item(store).id)));
 assert.equal(item(store).bought??null,null);
 assert.deepEqual(store._rows.map(e=>[e.kind,e.data.action??null]),[['wishlist_event','unbought']]);
 const receipts=await loadReceipts(store,owner,store.history);
 assert.equal(wardrobeView(receipts.state).items.length,0);
 assert.equal((await markNotBought(store,owner,item(store))).changed,false);
});

test('while an import holds the history, the purchase is written directly',async()=>{
 const store=fakeStore({busy:true});
 await markBought(store,owner,item(store),{},{pause:async()=>{}});
 assert.ok(store.calls.some(c=>c[0]==='record'&&c[1].includes('purchase_event')));
 assert.equal(store.calls.some(c=>c[0]==='finish'),false);
});

test('store and size are trimmed and optional; the source is one of the known ways',()=>{
 const mark=boughtMark({store:'  Mr   Porter ',size:'',via:'sneaky'},'2026-10-20T00:00:00.000Z');
 assert.deepEqual(mark,{at:'2026-10-20T00:00:00.000Z',store:'Mr Porter',size:null,via:'wishlist_page'});
 const [purchase]=purchaseEvidence({id:'g',name:'Loafer',links:[]},mark);
 assert.equal(purchase.data.values.merchant,'Mr Porter');assert.equal(purchase.data.values.size_label,null);assert.equal(purchase.data.price,undefined);
});

test('the chat tool reports only what persisted, on the person\'s own items',async()=>{
 const store=fakeStore();
 assert.match(await wishlistPurchaseChat(store,owner,'bought',['not-theirs']),/couldn’t find/);
 const reply=await wishlistPurchaseChat(store,owner,'bought',[item(store).id],{store:null,size:'10'});
 assert.match(reply,/marked Suede penny loafer as bought/);assert.match(reply,/store wasn’t recorded/);assert.match(reply,/price stays unknown/);
 assert.equal(store._rows.find(e=>e.kind==='wishlist_event').data.via,'chat');
 assert.match(await wishlistPurchaseChat(store,owner,'not_bought',[item(store).id]),/back on the wishlist/);
});

test('the latest mark on any of a group\'s entries is the group\'s',()=>{
 const two=[...rows(),{...rows()[0],item_id:'00000000-0000-4000-8000-000000000003',bought:{at:'2026-10-02T00:00:00Z',store:'B'}}];
 two[0].bought={at:'2026-10-01T00:00:00Z',store:'A'};
 assert.equal(groupWishlist(two)[0].bought.store,'B');
 assert.equal(groupWishlist(rows())[0].bought,null);
});

function req(body){return Object.assign(Readable.from([JSON.stringify(body)]),{method:'POST',url:'/api/wishlist',headers:{authorization:'Bearer test','content-type':'application/json'}});}
function res(){return {setHeader(){},end(value){this.value=value;}};}
test('the page actions need a signed-in owner and an item on their wishlist',async()=>{
 for(const status of [401,200]){
  const store=fakeStore({entries:[]});
  const handler=createWishlistHandler({env:{WISHLIST_ENABLED:'true'},auth:async()=>({status,conversation:owner}),storeFactory:()=>store});
  const response=res();await handler(req({action:'bought',group:'00000000-0000-4000-8000-0000000000aa'}),response);
  assert.equal(response.statusCode,status===401?401:404);assert.equal(store.calls.length,0);
 }
 const store=fakeStore();
 const handler=createWishlistHandler({env:{WISHLIST_ENABLED:'true'},auth:async()=>({status:200,conversation:owner}),storeFactory:()=>store});
 let response=res();await handler(req({action:'bought',group:item(store).id,store:'mrporter.com',via:'remove_toast'}),response);
 assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.value).bought.via,'remove_toast');
 response=res();await handler(req({action:'unbought',group:item(store).id}),response);
 assert.equal(response.statusCode,200);assert.equal(item(store).bought??null,null);
});
