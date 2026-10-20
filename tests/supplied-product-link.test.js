import test from 'node:test';
import assert from 'node:assert/strict';
import {listingRequestOptions} from '../lib/product-photos.js';
import {verifyListing} from '../lib/listings.js';
import {generateReply as agentReply} from '../lib/ai.js';
import {withConsent, agentTurns } from './helpers/agent.js';
// These tests cover tool routing; the consent check approves (its own tests are in agent.test.js).
const generateReply=(messages,env,fetcher,memory)=>agentReply(messages,env,withConsent(fetcher),memory);
import {agentTurn,tool,agentContext} from './helpers/agent.js';
const url='https://satisfyrunning.com/products/therocker-sterling-blue';
test('Satisfy uses the requested US storefront without overriding an explicit market or another store',()=>{
 assert.equal(listingRequestOptions(url).headers.get('Cookie'),'localization=US');
 for(const value of [url+'?currency=CAD',url.replace('/products/','/en-ca/products/'),'https://other.example/products/shirt'])assert.equal(listingRequestOptions(value).headers.get('Cookie'),null);
 assert.equal(listingRequestOptions(url,{headers:{Cookie:'localization=CA'}}).headers.get('Cookie'),'localization=CA');
});
test('a complete retailer result preserves genuine USD evidence and skips slower shopping providers',async()=>{
 const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'TheROCKER Sterling Blue',brand:'SATISFY',image:'https://satisfyrunning.com/photo.jpg',offers:{price:'290',priceCurrency:'USD'}})+'</script>';
 const check=await verifyListing(url,null,async(address,options)=>{
  assert.equal(address,url);assert.ok(options.headers.get('Cookie').includes('localization=US'));return new Response(html,{headers:{'content-type':'text/html'}});
 },async()=>assert.fail('Complete HTML requires no browser'),{SERPAPI_API_KEY:'test-only'},{recoveryOnly:true});
 assert.equal(check.status,'verified');assert.equal(check.price_snapshot.currency,'USD');assert.equal(check.price_snapshot.amount,290);
});
test('the intent model receives retrieved identity for supplied links and saves only with its interpreted consent',async()=>{
 for(const message of ['Please keep this on my wishlist '+url,'i want these '+url]){
  const history=[{direction:'inbound',body:message}],calls=[];
  const body=await generateReply(history,{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},async(address,options)=>{
   assert.equal(address,'https://api.openai.com/v1/responses');const options_=agentContext(options).pending_shopping.options;
   assert.equal(options_[0].name,'TheROCKER');assert.equal(options_[0].listing_check.status,'verified');assert.equal(options_[0].price_snapshot.currency,'USD');
   return agentTurn(tool('save_to_wishlist',{option_indices:[0],consent_context:'explicit_request'}));
  },{verifyLink:async()=>({status:'verified',url,product_name:'TheROCKER',product_brand:'SATISFY',price_snapshot:{amount:290,currency:'USD'}}),wishlistAction:async(action,state)=>{calls.push({action,state});return 'Saved';}});
  assert.equal(body,'Saved');assert.equal(calls.length,1);assert.equal(calls[0].action.consent,'wishlist');
 }
});
test('failed optional retrieval preserves the supplied reference rather than discarding or inventing product facts',async()=>{
 await generateReply([{direction:'inbound',body:'Save '+url}],{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},async(address,options)=>{
  const pending=agentContext(options).pending_shopping;assert.equal(pending.options[0].url,url);assert.equal(pending.options[0].price_snapshot,undefined);
  return agentTurn(tool('conversation_reply',{response:'A useful reply'}));
 },{verifyLink:async()=>{throw Error('Temporary timeout');},wishlistAction:async()=>assert.fail('No interpreted save consent')});
});

test('image follow-up acceptance requires an explicit outcome and executes sourcing before responding',async()=>{
 for(const answer of ['yes','please do','that sounds good']){
  const history=[{direction:'inbound',body:'Find this bag and sunglasses'},{direction:'outbound',status:'sent',body:'Would similar Lemaire bags and Jacques Marie Mage glasses work?'},{direction:'inbound',body:answer}];
  let sourced=0,recorded=0;
  await generateReply(history,{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},async(address,options)=>{
   const request=JSON.parse(options.body);
   if(request.tools?.some(t=>t.name==='conversation_reply')){assert.equal(request.tool_choice,'required');assert.ok(request.instructions.includes('accepts a prior offer to search'));assert.equal(agentTurns(request.input).at(-1).content,answer);
    return agentTurn(tool('find_products',{query:'Similar Lemaire hobo bags and Jacques Marie Mage sunglasses',use_image:true,image_message_id:'original-photo'}));}
   sourced++;throw Error('Controlled provider outage');
  },{imageReferences:[{id:'original-photo',caption:'Lemaire hobo bag'}],loadImages:async()=>{return [{mime_type:'image/jpeg',data:'test-image'}];},recordSearch:async result=>{assert.equal(result.status,'failed');recorded++;}});
  assert.equal(sourced,1);assert.equal(recorded,1);
 }
});
test('ordinary conversation remains natural through its explicit conversation outcome',async()=>{
 const result=await generateReply([{direction:'inbound',body:'Thanks, I love that silhouette'}],{OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'},async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'function_call',name:'conversation_reply',arguments:JSON.stringify({response:'The relaxed shape works especially well with a fitted top.'})}]})}));
 assert.equal(result,'The relaxed shape works especially well with a fitted top.');
});
