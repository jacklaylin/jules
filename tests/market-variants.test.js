import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyListing} from '../lib/listings.js';
import {shopifyColorOptions} from '../lib/product-variants.js';
import {inferImportedMarket,shoppingMarket,saveImportedMarket} from '../lib/shopping-market.js';
import {enrichWishlistItem} from '../lib/wishlist-details.js';
import {selectionOutcome} from '../lib/wishlist-selection.js';
import {createStore} from '../lib/store.js';
import {repairWishlistPhotos} from '../lib/wishlist-photos.js';
const url='https://shop.example.org/products/shirt';
const product={'@type':'Product',name:'Shirt',url,image:'https://shop.example.org/default.jpg',offers:{price:71,priceCurrency:'CAD',url}};
const html=(p,country='US')=>`<script>Shopify.country = "${country}";</script><script type="application/ld+json">${JSON.stringify(p)}</script>`;
test('retailer market follows the user country rather than server geography and verifies currency',async()=>{
 const requests=[];
 const check=await verifyListing(url,null,async(u,options)=>{requests.push({u,options});return new Response(html({...product,offers:{...product.offers,price:u.includes('country=US')?48:71,priceCurrency:u.includes('country=US')?'USD':'CAD'}},u.includes('country=US')?'US':'CA'),{headers:{'content-type':'text/html'}});},undefined,{});
 assert.equal(check.price_snapshot.amount,48);assert.equal(check.price_snapshot.currency,'USD');assert.ok(requests[1].u.includes('country=US'));assert.ok(requests[0].options.headers.get('Cookie').includes('localization=US'));
 const foreign=await verifyListing(url,null,async()=>new Response(html(product),{headers:{'content-type':'text/html'}}),undefined,{});assert.equal(foreign.price_snapshot,null);
 const canada=await verifyListing(url,null,async()=>new Response(html(product,'CA'),{headers:{'content-type':'text/html'}}),undefined,{SHOPPING_COUNTRY:'CA',SHOPPING_CURRENCY:'CAD'});assert.equal(canada.price_snapshot.currency,'CAD');
});
test('retailer option metadata supplies colors and bound photos without product-specific rules',()=>{
 const data={title:'Shirt',options:['Size','Colour'],variants:[{id:1,options:['S','Ocean'],featured_image:{src:'//shop.example.org/ocean.jpg'}},{id:2,options:['M','Ocean']},{id:3,options:['S','Clay'],featured_image:{src:'//shop.example.org/clay.jpg'}}]};
 const options=shopifyColorOptions('<script>context={product: '+JSON.stringify(data)+'};</script>',url,product);
 assert.deepEqual(options.map(c=>c.color),['Ocean','Clay']);assert.equal(options[0].image,'https://shop.example.org/ocean.jpg');assert.ok(options[1].url.endsWith('variant=3'));
});
test('model-selected color persists through interest and subsequent scoped save without assuming a size',async()=>{
 const option={name:'Shirt',url,reference_provenance:'user_link',listing_check:{status:'verified',product_name:'Shirt',color_options:[{color:'Ocean',url:url+'?variant=1'}]}};
 const args={decision:'interest',option_indices:[0],color_choices:[{option_index:0,color_index:0}],consent:'none'};
 let offered;
 const respond=(body,state,extra)=>({body,state,extra});
 offered=await selectionOutcome(args,{state:{stage:'choice',options:[option]},facts:[],env:{},constraints:{},respond,verify:async()=>({status:'verified',url:url+'?variant=1',product_name:'Shirt - Ocean / S',color:'Ocean',availability:'InStock'})});
 assert.equal(offered.state.selected_set[0].selected_color,'Ocean');assert.equal(offered.state.selected_set[0].listing_check.availability,null);
});
test('legacy recovery binds interpreted color to its original reply and replaces the whole wrong photo set',async()=>{
 let updated,images;
 const store={wishlistItem:async()=>({product:{url,name:'Shirt',image:{data:'red'},additional_images:[{data:'red2'}],links:[{url}]},wishlist_encounters:[{reply_id:'save'}]}),messages:async()=>({messages:[{id:'request',direction:'inbound',body:'The blue one please'},{id:'save',direction:'outbound',body:'Saved'},{id:'later',direction:'inbound',body:'A red bag next'}]}),correctWishlistProduct:async(_c,_i,u)=>updated=u,saveWishlistPhotos:async(_c,_i,u)=>images=u};
 const color={color:'Ocean',url:url+'?variant=1'};
 await enrichWishlistItem(store,'owner','item',{verify:async u=>({status:'verified',url:u,product_name:'Shirt',color:u.includes('variant')?'Ocean':null,color_options:[color],product_images:['https://shop.example.org/ocean.jpg']}),resolveColor:async context=>{assert.equal(context.messages.length,2);return color;},assets:async()=>[{mime_type:'image/jpeg',data:'blue'}],env:{SHOPPING_COUNTRY:'US'}});
 assert.equal(updated.selected_color,'Ocean');assert.equal(updated.links[0].url,color.url);assert.equal(images.image.data,'blue');assert.deepEqual(images.additional_images,[]);
});
test('import deduplicates orders and separates foreign purchase currency from country evidence',()=>{
 const r=(order,kind,value)=>({order_key:order,kind,value,source_id:order,evidence:'cited'});
 assert.equal(inferImportedMarket([r('a','delivery_country','US'),r('a','delivery_country','US')]).country,null);
 const result=inferImportedMarket([r('a','delivery_country','US'),r('b','delivery_country','US'),r('c','delivery_country','US'),r('d','delivery_country','FR'),r('a','transaction_currency','USD'),r('b','transaction_currency','USD')]);
 assert.equal(result.country.value,'US');assert.equal(result.currency.value,'USD');
 assert.equal(inferImportedMarket([r('a','delivery_country','US'),r('b','delivery_country','CA')]).country,null);
 assert.equal(inferImportedMarket([r('a','transaction_currency','USD'),r('b','transaction_currency','USD')]).country,null);
});
test('explicit country corrections outrank imported evidence and unsupported import quotes cannot persist',async()=>{
 const facts=[{field:'country',key:'primary',value:'US',source:'message',updated_at:'2020'},{field:'country',key:'primary',value:'CA',source:'email_import',updated_at:'2026'}];assert.equal(shoppingMarket(facts).country,'US');
 let saved;
 const store={profile:async()=>({facts,version:3}),saveProfile:async(_c,v,f)=>{assert.equal(v,3);saved=f;}};
 const records=['a','b'].map(id=>({order_key:id,source_id:id,kind:'transaction_currency',value:'USD',evidence:'USD'}));
 await saveImportedMarket(store,'owner',records,[{id:'a',text:'USD'},{id:'b',text:'USD'}]);assert.equal(saved.find(f=>f.field==='currency').value,'USD');assert.equal(saved[0].value,'US');
 saved=null;await saveImportedMarket(store,'owner',records,[{id:'a',text:'not the cited quote'}]);assert.equal(saved,null);
});
test('legacy context is retrieved around the owned original save even beyond the latest conversation page',async()=>{
 const urls=[],reply='11111111-1111-4111-8111-111111111111';
 const store=createStore({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'},async u=>{
  urls.push(u);return new Response(JSON.stringify(urls.length===1?[{id:reply,created_at:'2026-10-01T00:00:00Z'}]:[{id:reply,direction:'outbound',body:'Saved'},{id:'earlier',direction:'inbound',body:'Blue please'}]));
 });
 const context=await store.wishlistConversationContext('owner',[reply]);
 assert.ok(urls.every(u=>u.includes('conversation_id=eq.owner')));assert.ok(urls[1].includes('created_at=lte.2026-10-01'));assert.equal(context[0].body,'Blue please');
});
test('failed older repairs enter a persisted cooldown so later items can be recovered',async()=>{
 const now=Date.now(),items=new Map(['first','second','third'].map(id=>[id,{url:url+'/'+id,name:'Shirt',details_revision:2,market_country:'US',image:{data:'existing'},links:[{url:url+'/'+id}]}])),attempts=[];
 const store={wishlistItem:async(_c,id)=>({product:items.get(id)}),saveWishlistPhotos:async(_c,id,u)=>Object.assign(items.get(id),u),correctWishlistProduct:async(_c,id,u)=>Object.assign(items.get(id),u)};
 const rows=()=>[...items].map(([id,p])=>({item_id:id,has_image:true,...p}));
 const verify=async u=>{attempts.push(u);if(!u.endsWith('third'))throw Error('Interpretation unavailable');return {status:'verified',url:u,product_name:'Shirt'};};
 await repairWishlistPhotos(rows(),{conversation:'owner',store,verify,now});await repairWishlistPhotos(rows(),{conversation:'owner',store,verify,now:now+1000});
 assert.equal(attempts.length,3);assert.equal(items.get('third').details_revision,3);assert.equal(items.get('first').photo_attempted_revision,3);
});
test('database photo repair writes the cooldown revision to both item and encounter snapshots',async()=>{
 const writes=[];
 const store=createStore({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'},async(_u,options)=>{
  if(options.method==='GET')return new Response(JSON.stringify([{product:{name:'Shirt'},wishlist_encounters:[{reply_id:'reply',product:{name:'Shirt'}}]}]));
  writes.push(JSON.parse(options.body));return new Response('null');
 });
 await store.saveWishlistPhotos('owner','item',{photo_attempted_revision:3,photo_attempted_at:'2026-10-09T00:00:00Z'});
 assert.equal(writes.length,2);assert.ok(writes.every(w=>w.product.photo_attempted_revision===3));
});
