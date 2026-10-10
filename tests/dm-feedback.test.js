import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSizeOffers,readSizeOffers} from '../lib/price-alerts.js';
import {interpretPending} from '../lib/pending-intent.js';
import {textWishlistAction} from '../lib/text-wishlist.js';
import {createWishlistHandler} from '../api/wishlist.js';
const url='https://satisfyrunning.com/products/therocker-sterling-blue';
const variants=[{name:'TheROCKER - Sterling Blue / US M11 / US W12 / UK10½ / EU45 / JP29',sku:'size-45',offers:{url:url+'?variant=45',price:'290',priceCurrency:'USD',availability:'https://schema.org/InStock'}},{name:'TheROCKER - Sterling Blue / US M12 / US W13 / UK11½ / EU46½ / JP30',sku:'size-12',offers:{url:url+'?variant=12',price:'290',priceCurrency:'USD',availability:'https://schema.org/OutOfStock'}}];
const html=(rows=variants)=>'<script type="application/ld+json">'+JSON.stringify({'@type':'ProductGroup',name:'TheROCKER',brand:{name:'SATISFY'},hasVariant:rows})+'</script>';
test('Satisfy official variant labels establish prices and stock without generic size conversions',()=>{
 const rows=parseSizeOffers(html(),'SATISFY TheROCKER',url);
 const eu=rows.find(r=>r.size==='EU 45'),us=rows.find(r=>r.size==='US men 12');
 assert.equal(rows.length,10);assert.equal(eu.amount,290);assert.equal(eu.currency,'USD');assert.equal(eu.available,true);assert.equal(us.available,false);assert.notEqual(eu.retailer_sku,us.retailer_sku);
 assert.ok(rows.some(r=>r.size==='UK 10.5'));
 assert.deepEqual(parseSizeOffers(html(),'Lemaire slippers',url),[]);
 assert.ok(parseSizeOffers(html(),'TheROCKER',url+'?variant=12').every(r=>r.retailer_sku==='size-12'));
 const unrelated=[{...variants[0],offers:{...variants[0].offers,url:'https://satisfyrunning.com/products/unrelated?variant=45'}}];assert.deepEqual(parseSizeOffers(html(unrelated),'TheROCKER',url),[]);
});
test('size reading falls back to a rendered blocked page, preserves market and rejects changed products',async()=>{
 const link={url,name:'SATISFY TheROCKER',market_country:'US',market_currency:'USD'};let calls=0;
 const fetcher=async(_url,options)=>{assert.equal(options.headers.get('Cookie'),'localization=US');return new Response('',{status:403});};
 const result=await readSizeOffers(link,fetcher,{render:async()=>{calls++;return {url,html:html()};}});
 assert.equal(calls,1);assert.equal(result.offers.length,10);
 assert.deepEqual((await readSizeOffers({...link,market_currency:'EUR'},fetcher,{render:async()=>({url,html:html()})})).offers,[]);
 assert.equal((await readSizeOffers(link,fetcher,{render:async()=>({url:url+'-other',html:html()})})).status,'unavailable');
 await readSizeOffers(link,async()=>new Response('',{status:404}),{render:()=>assert.fail('A missing page must not be replaced')});
});
test('an alert request selecting an item repairs invalid offer classification using the original message',async()=>{
 const text='Yes those are the ones. Can you set an alert?',state={stage:'choice',options:[{url,name:'TheROCKER'}]};
 const base={action:'selection',decision:'confirm',option_indices:[0],consent:'wishlist_alerts',consent_context:'answer_to_offer'};let calls=0;
 const intent=await interpretPending([{direction:'inbound',body:text}],state,{OPENAI_API_KEY:'test'},async(_url,options)=>{
  calls++;const body=JSON.parse(options.body),data=JSON.parse(body.input[0].content);assert.equal(data.newest_message,text);
  if(calls===2)assert.equal(data.saved_wishlist.validation_feedback.proposed_intent.consent,'wishlist_alerts');
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...base,consent_context:calls===1?'answer_to_offer':'explicit_request'})}]}]})};
 });assert.equal(calls,2);assert.equal(intent.consent_context,'explicit_request');assert.equal(intent.consent,'wishlist_alerts');
});
test('invalid consent interpretation remains bounded and cannot authorize a save',async()=>{
 let calls=0;await assert.rejects(interpretPending([{direction:'inbound',body:'those look interesting'}],{stage:'choice',options:[{url}]},{OPENAI_API_KEY:'test'},async()=>{calls++;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({action:'selection',decision:'confirm',option_indices:[0],consent:'wishlist_alerts',consent_context:'answer_to_offer'})}]}]})};}));assert.equal(calls,2);
});
test('variant research preserves exact product identity and does not restart consent',async()=>{
 const primary={brand:'LEMAIRE',name:'Piped Crepe Slipper Loafers',url:'https://www.ssense.com/en-us/men/product/lemaire/black-piped-crepe-slipper-loafers/19440991',match:'likely_match',sourcing_status:'store_found',listing_check:{status:'verified',product_name:'Piped Crepe Slipper Loafers',color:'Black'}};
 let calls=0,result;
 await textWishlistAction({action:'start',query:'Lemaire loafers with the seam up the middle'},{env:{},record:async r=>{result=r;},search:async()=>{calls++;return {products:calls===1?[primary]:[{...primary,url:primary.url+'/brown',listing_check:{...primary.listing_check,color:'Brown'}},{...primary,name:'Leather boots',url:primary.url+'/boots',listing_check:{status:'verified',product_name:'Leather boots'}}]};}});
 assert.equal(calls,2);assert.equal(result.text_wishlist_state.options.length,2);assert.deepEqual(result.text_wishlist_state.options.map(p=>p.listing_check.color),['Black','Brown']);assert.equal(result.user_confirmed,undefined);
});
const id='00000000-0000-4000-8000-000000000001';
const req={method:'POST',url:'/api/wishlist',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({action:'recover-alerts'}));}};
const res=()=>({setHeader(){},end(text){this.body=JSON.parse(text);}});
test('pending alert baseline repair is owned, revision checked and never sends or re-enables an alert',async()=>{
 let reads=0,writes=0,current=true;const alert={id,revision:id,group_id:id,size:'EU 45',links:[{url,name:'TheROCKER'}]};
 const store={pendingPriceAlerts:async owner=>{assert.equal(owner,id);reads++;return [alert];},priceAlertCurrent:async()=>current,recordPriceCheck:async(_id,_revision,result,notified,baselines)=>{writes++;assert.equal(notified,false);assert.equal(result.status,'baseline_established');assert.equal(baselines[0].amount,290);assert.equal(baselines[0].drop_percent,0);},enablePriceAlert:()=>assert.fail('No new consent or alert activation')};
 const handler=createWishlistHandler({env:{WISHLIST_ENABLED:'true',PRICE_ALERTS_ENABLED:'true'},storeFactory:()=>store,auth:async()=>({status:200,conversation:id}),inspect:async links=>{assert.equal(links[0].name,'TheROCKER');assert.equal(links[0].market_currency,'USD');return {checks:[{offers:parseSizeOffers(html(),'TheROCKER',url)}]};}});
 const first=res();await handler(req,first);assert.equal(first.statusCode,200);assert.deepEqual(first.body.recovered,[id]);assert.equal(writes,1);
 current=false;await handler(req,res());assert.equal(writes,1);
 alert.last_checked_at=new Date().toISOString();await handler(req,res());assert.equal(writes,1);
 const denied=createWishlistHandler({env:{WISHLIST_ENABLED:'true',PRICE_ALERTS_ENABLED:'true'},storeFactory:()=>store,auth:async()=>({status:401})});await denied(req,res());assert.equal(reads,3);
});

test('SSENSE native selector supplies only explicit retailer size and stock, never EU/IT conversions',()=>{
 const url='https://www.ssense.com/en-us/men/product/lemaire/black-piped-crepe-slipper-loafers/19440991';
 const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Black Piped Crepe Slipper Loafers',brand:{name:'LEMAIRE'},offers:{price:695,priceCurrency:'USD',availability:'https://schema.org/InStock',url}})+'</script><select id="size-dropdown"><option value="" disabled>SELECT A SIZE</option><option value="205" disabled="">IT 39 - Sold Out</option><option value="365">IT 45 - Only 2 remaining</option></select>';
 const rows=parseSizeOffers(html,'LEMAIRE Black Piped Crepe Slipper Loafers',url);
 assert.deepEqual(rows.map(r=>r.size),['IT 39','IT 45']);assert.equal(rows[0].available,false);assert.equal(rows[1].available,true);assert.equal(rows[1].amount,695);assert.equal(rows[1].currency,'USD');
 assert.deepEqual(parseSizeOffers(html,'Leather boots',url),[]);
});

test('legacy unqualified alert size is model-bound to one identical retailer code without conversions',async()=>{
 const {resolveAlertSizeLabel}=await import('../lib/alert-size-label.js');
 const offer={url,size:'IT 45',key:'IT 45',checked_at:'2026-10-09',amount:695,currency:'USD',available:true};
 const alert={size:'45',links:[{url,name:'Loafers'}]},checks=[{offers:[offer]}];let calls=0;
 const fetcher=async()=>{calls++;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({size:'IT 45'})}]}]})};};
 const recovered=await resolveAlertSizeLabel(alert,checks,[],{OPENAI_API_KEY:'test'},fetcher);
 assert.equal(recovered.checks[0].offers[1].key,'45');assert.equal(recovered.checks[0].offers[1].retailer_size,'IT 45');assert.equal(recovered.links[0].verified_size_mappings[0].retailer_size,'IT 45');
 for(const size of ['EU 45','US men 12'])assert.deepEqual((await resolveAlertSizeLabel({...alert,size},checks,[],{OPENAI_API_KEY:'test'},fetcher)).checks,checks);
 assert.deepEqual((await resolveAlertSizeLabel(alert,[{offers:[offer,{...offer,size:'EU 45',key:'EU 45'}]}],[],{OPENAI_API_KEY:'test'},fetcher)).links,alert.links);assert.equal(calls,1);
});

test('monitoring an owned saved item reuses its record and verifies ownership before activation',async()=>{
 const {finishTextWishlist}=await import('../lib/text-wishlist.js');const {groupWishlist}=await import('../lib/wishlist.js');
 const rows=[{reply_id:'earlier',item_id:id,name:'TheROCKER',links:[{url}],messages:{created_at:'2026-10-09'}}],group=groupWishlist(rows)[0].id;let activated=0;
 const store={wishlistReplyId:()=>assert.fail('No new save is required'),wishlistEntries:async()=>rows,enablePriceAlert:async()=>{activated++;return {active:true};}};
 const result={identification_policy:'text_wishlist',user_confirmed:true,existing_saved_groups:[group],alert_requests:[{url,size:'EU 45',baselines:[{amount:290}],links:[{url}]}]};
 await finishTextWishlist({store,result,env:{},conversationId:id});assert.equal(activated,1);
 await assert.rejects(finishTextWishlist({store,result:{...result,existing_saved_groups:['unowned']},env:{},conversationId:id}));assert.equal(activated,1);
});

test('an expired sourcing budget cannot launch a browser',async()=>{
 const {renderListing}=await import('../lib/rendered-listing.js');const controller=new AbortController();controller.abort();
 await assert.rejects(renderListing('https://www.ssense.com/en-us/men/product/lemaire/example/19440991',{signal:controller.signal}),error=>error.name==='AbortError');
});
