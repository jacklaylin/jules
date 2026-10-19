import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {groupWishlist,stockState,STOCK_FRESH_MS} from '../lib/wishlist.js';
import {createWishlistHandler} from '../api/wishlist.js';
import {decidePriceCheck} from '../lib/alert-decision.js';

const id='00000000-0000-4000-8000-000000000001';
const now=Date.parse('2026-10-19T12:00:00Z');
const link=(url,availability,checked_at='2026-10-18T09:00:00Z',verification_status='verified')=>({url,availability,verification_status,stock_checked_at:checked_at});
const row=links=>({reply_id:id,item_id:id,target:'shirt',name:'Oxford shirt',checked_at:'2026-10-18T09:00:00Z',links});
function request(body){const req=Readable.from([JSON.stringify(body)]);Object.assign(req,{method:'POST',url:'/api/wishlist',headers:{authorization:'Bearer test','content-type':'application/json'}});return req;}
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.value=value;}};}

test('an item is sold out only when every store was checked and reported sold out',()=>{
 const all=stockState([link('https://a.example/1','OutOfStock'),link('https://b.example/1','SoldOut','2026-10-17T09:00:00Z')],now);
 assert.deepEqual(all,{status:'sold_out',stores:2,checked_at:'2026-10-17T09:00:00.000Z',fresh:true});
 // One store in stock, unknown, or never verified keeps the item from being called sold out.
 assert.equal(stockState([link('https://a.example/1','OutOfStock'),link('https://b.example/1','InStock')],now),null);
 assert.equal(stockState([link('https://a.example/1','OutOfStock'),link('https://b.example/1',null)],now),null);
 assert.equal(stockState([link('https://a.example/1','OutOfStock'),link('https://b.example/1','OutOfStock',undefined,'unverified')],now),null);
 assert.equal(stockState([],now),null);
});

test('a sold-out reading older than three days, or without a date, is not current',()=>{
 const old=new Date(now-STOCK_FRESH_MS-1000).toISOString();
 assert.equal(stockState([link('https://a.example/1','OutOfStock',old)],now).fresh,false);
 const undated=stockState([link('https://a.example/1','OutOfStock',null)],now);
 assert.equal(undated.checked_at,null);assert.equal(undated.fresh,false);
});

test('the wishlist reports each store’s check time and the item’s stock state',()=>{
 const [item]=groupWishlist([row([{url:'https://a.example/shirt',availability:'OutOfStock'},{url:'https://b.example/shirt',availability:'OutOfStock',price_snapshot:{amount:98,currency:'USD',source_url:'https://b.example/shirt',checked_at:'2026-10-18T10:00:00Z'}}])],{now});
 assert.equal(item.links[0].stock_checked_at,'2026-10-18T09:00:00Z');
 assert.equal(item.links[1].stock_checked_at,'2026-10-18T10:00:00Z');
 assert.equal(item.links[0].stock_fresh,true);
 assert.equal(item.stock.status,'sold_out');assert.equal(item.stock.stores,2);
 const [mixed]=groupWishlist([row([{url:'https://a.example/shirt',availability:'OutOfStock'},{url:'https://b.example/shirt',availability:'InStock'}])],{now});
 assert.equal(mixed.stock,null);
});

test('a size sold out at every store can be watched for its return, and texts when it comes back',async()=>{
 const url='https://a.example/shirt',rows=[row([{url,availability:'OutOfStock'}])],group=groupWishlist(rows)[0].id;
 const soldOut={size:'M',key:'M',url,name:'Oxford shirt',amount:98,currency:'USD',available:false};
 let saved;
 const handler=createWishlistHandler({env:{WISHLIST_ENABLED:'true',PRICE_ALERTS_ENABLED:'true'},auth:async()=>({status:200,conversation:id}),
  storeFactory:()=>({wishlistEntries:async()=>rows,enablePriceAlert:async input=>{saved=input;return {active:true,size:input.p_size};}}),
  inspect:async()=>({sizes:['M'],checks:[{url,offers:[soldOut]}]})});
 const res=response();await handler(request({action:'alert-enable',group,size:'M'}),res);
 assert.equal(res.statusCode,200);
 assert.deepEqual(JSON.parse(res.value),{active:true,size:'M',restock:true});
 assert.equal(saved.p_baselines.length,1);assert.equal(saved.p_baselines[0].available,false);
 // The saved reference reads as sold out, so the size coming back is a restock text.
 const alert={name:'Oxford shirt',size:'M',links:[{url}],baselines:saved.p_baselines};
 const decision=decidePriceCheck(alert,[{url,offers:[{...soldOut,available:true}]}]);
 assert.equal(decision.status,'restock');
});
