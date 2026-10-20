import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wishlistPreviewURL,splitWishlistPreview} from '../lib/wishlist-preview.js';
import {splitLinkPreview} from '../lib/link-preview.js';
import {composeReply} from '../lib/compose.js';
import {generateReply} from '../lib/ai.js';
import {agentTurn,tool,toolOutputs,isAgentRequest,isConsentCheck,consentResponse} from './helpers/agent.js';

// The saved item's signed preview link is sent as a picture card. Writers never see it, and wherever a
// rewritten message still puts it, it is taken out of the text (with a line that only introduced it).
const item='12345678-1234-1234-1234-123456789abc';
const env={SITE_ORIGIN:'https://jules.example',SUPABASE_SERVICE_ROLE_KEY:'test-only-key',OPENAI_API_KEY:'test',SEARCH_ENABLED:'true'};
const preview=wishlistPreviewURL(item,true,env);
const store='https://www.brand-store.example/products/ripped-tee-red';

test('the preview link is taken out of the text wherever it sits, with a line that only introduced it',()=>{
 for(const body of [
  `saved Ripped Tee to your wishlist.\n${store}\n${preview}`,
  `saved Ripped Tee to your wishlist.\n${store}\n\nhere's a preview image:\n${preview}\n\nwould you like a price alert for it?`,
  `saved Ripped Tee to your wishlist.\n${store}\n\npreview: ${preview}\n\nwould you like a price alert for it?`,
  `saved Ripped Tee to your wishlist.\n${store}\n${preview}.\nwould you like a price alert for it?`,
 ]){
  const split=splitWishlistPreview(body,env);
  assert.equal(split.preview,preview,body);
  assert.ok(!split.body.includes('/api/image'),body);assert.doesNotMatch(split.body,/preview/);
  assert.ok(split.body.includes(store));assert.doesNotMatch(split.body,/\n{3,}/);
  assert.equal(splitLinkPreview(body,env).kind,'wishlist');
 }
 // A tampered or foreign link stays ordinary text.
 const tampered=preview.replace(/sig=./,'sig=x');
 assert.deepEqual(splitWishlistPreview(`saved.\n${tampered}\nmore?`,env),{body:`saved.\n${tampered}\nmore?`});
 assert.deepEqual(splitWishlistPreview(`saved.\nhttps://other.example/api/image?preview=1\nmore?`,env),{body:`saved.\nhttps://other.example/api/image?preview=1\nmore?`});
});

test('the composer never shows the preview link to the model and puts it back last',async()=>{
 const draft=`saved Ripped Tee to your wishlist.\n${store}\nwould you like a price alert for it?\n${preview}`;
 let seen;
 const fetcher=async(_url,options)=>{seen=options.body;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:`done, the ripped tee is on your wishlist.\n${store}\nwant a price alert on it?`,claims:{saved_now:true,alerts_turned_on:false,alerts_turned_off:false},photo_captions:[]})}]}]})};};
 const result=await composeReply({draft,facts:{saved_now:true,alerts_turned_on:false,alerts_turned_off:false},env,fetcher});
 assert.ok(!seen.includes('/api/image'));
 assert.equal(result.composed,true);assert.ok(result.body.endsWith('\n'+preview));
 assert.equal(splitLinkPreview(result.body,env).preview,preview);
 // With the model unavailable, the draft goes out as written, link last.
 assert.equal((await composeReply({draft,env,fetcher:async()=>{throw Error('offline');}})).body,draft);
});

test('in the chat loop the save result reaches the model without the link; the sent message ends with it',async()=>{
 const option={brand:'Brand',name:'Ripped Tee',url:store,match:'likely_match',listing_check:{status:'verified',product_name:'Ripped Tee',product_brand:'Brand',url:store}};
 let recorded=null,toldModel='';
 const memory={facts:[],wishlistState:{stage:'choice',query:'tees',options:[option]},
  wishlistAction:async()=>{recorded={user_confirmed:true};return 'i’ll add Ripped Tee to your wishlist.';},
  shoppingConfirmed:()=>recorded?.user_confirmed===true,
  commitWishlist:async()=>`saved Ripped Tee to your wishlist. would you like a price alert for it?\n${preview}`};
 for(const words of ['add the ripped tee to my wishlist','save that one','put the red tee on my list']){
  recorded=null;
  const fetcher=async(_url,options)=>{
   if(isConsentCheck(options))return consentResponse(true);
   if(!isAgentRequest(options))return {ok:false};
   const outputs=toolOutputs(options);
   if(!outputs.length)return agentTurn(tool('save_to_wishlist',{option_indices:[0]}));
   toldModel=JSON.stringify(outputs);
   return agentTurn(tool('conversation_reply',{response:'saved Ripped Tee to your wishlist. want a price alert on it?',claims:{saved_now:true,alerts_turned_on:false,alerts_turned_off:false}}));
  };
  const body=await generateReply([{direction:'inbound',status:'received',body:words}],env,fetcher,memory);
  assert.ok(!toldModel.includes('/api/image'),words);
  assert.ok(body.endsWith('\n'+preview),words);
  assert.equal(body.split(preview).length,2,words);
 }
});
