import test from 'node:test';
import assert from 'node:assert/strict';
import {readScreenshotProducts,findListedProduct,SCREENSHOT_PRODUCTS_TOOL} from '../lib/screenshot-products.js';
import {generateReply as agentReply} from '../lib/ai.js';
import {textWishlistAction} from '../lib/text-wishlist.js';
import {agentTurn,tool,toolNames,toolOutputs,withConsent,isClaimAudit} from './helpers/agent.js';

const env={OPENAI_API_KEY:'test',SEARCH_ENABLED:'true',PRICE_ALERTS_ENABLED:'true'};
const q=value=>({value,quote:value}),none={value:null,quote:null};
const shot=n=>({mime_type:'image/png',data:Buffer.from('list'+n).toString('base64')});
const line=text=>({text,personal:false});
const tile=(brand,title,category)=>({brand:brand?q(brand):none,title:title?q(title):none,category,colors:[],details:[],status:'unknown',status_quote:null});
// Two screenshots of a wishlist on a store's site, as the reader returns them (any store; no store name written).
const FIRST={lines:['KAMIYA','Black Chino Straight Trousers','Size S - Only 1 remaining','$540','OUR LEGACY','Black Third Cut Jeans','Size 31','$460','STOCKHOLM (SURFBOARD) CLUB','Navy Relaxed Fit Trousers'].map(line),platform:none,
 items:[tile('KAMIYA','Black Chino Straight Trousers','trousers'),tile('OUR LEGACY','Black Third Cut Jeans','jeans'),tile('STOCKHOLM (SURFBOARD) CLUB','Navy Relaxed Fit Trousers','trousers'),
  // A tile whose name is cut off: only what is visible stays, and it is listed as unclear rather than guessed.
  tile(null,null,'t-shirt')]};
const SECOND={lines:['MFPEN','Black Croc Drivers Belt','Size L','$175','Black Scout Derbys','Size 45','$485','CURRENTLY OUT OF STOCK'].map(line),platform:none,
 items:[tile('MFPEN','Black Croc Drivers Belt','belt'),tile('MFPEN','Black Scout Derbys','boat shoes')]};
const page=(brand,name,url,amount)=>({brand,name,url,identity:'exact',match:'likely_match',sourcing_status:'store_found',merchant_options:[],
 listing_check:{status:'verified',url,product_name:name,product_brand:brand,price_snapshot:{amount,currency:'USD',source_url:url}},price_snapshot:{amount,currency:'USD',source_url:url}});
const PAGES={
 'Black Chino Straight Trousers':page('KAMIYA','Black Chino Straight Trousers','https://www.ssense.com/en-us/men/product/kamiya/black-chino/1',540),
 'Black Third Cut Jeans':page('Our Legacy','Third Cut Jeans Black','https://www.ourlegacy.com/third-cut-black',460),
 'Navy Relaxed Fit Trousers':page('Stockholm (Surfboard) Club','Navy Relaxed Fit Trousers','https://www.ssense.com/en-us/men/product/stockholm/navy/3',385),
 'Black Croc Drivers Belt':page('MFPEN','Drivers Belt - Black Croc','https://mfpen.com/products/drivers-belt-black-croc',205),
};
const reads=[FIRST,SECOND];
const reader=()=>{let n=0;return async()=>reads[n++];};
// The store-page lookup: found pages for four items; the boat shoes have no exact page (only a different derby).
const finder=async item=>PAGES[item.title]??null;

test('a screenshot list is read tile by tile into pending options with a save offer, nothing saved',async()=>{
 const read=await readScreenshotProducts({images:[shot(1),shot(2)],env,read:reader(),find:finder});
 assert.equal(read.state.stage,'offer_set');
 // Brand and product stay as written in the screenshot; the page supplies the link and price.
 assert.deepEqual(read.options.map(o=>[o.brand,o.name]),[['KAMIYA','Black Chino Straight Trousers'],['OUR LEGACY','Black Third Cut Jeans'],['STOCKHOLM (SURFBOARD) CLUB','Navy Relaxed Fit Trousers'],['MFPEN','Black Croc Drivers Belt']]);
 assert.ok(read.options.every(o=>o.reference_provenance==='screenshot'&&o.listing_check.status==='verified'));
 assert.deepEqual(read.state.offered_urls,read.options.map(o=>o.url));
 assert.equal(read.state.confirmed_consent,null);
 // Partial results: the unmatched and unreadable items are kept and reported, never filled in.
 assert.deepEqual(read.unmatched.map(u=>[u.title,u.reason]),[['Black Scout Derbys','not_found'],[null,'not_readable']]);
 assert.deepEqual(read.state.screenshot_unmatched,read.unmatched);
 assert.match(read.body,/nothing is saved yet/);assert.match(read.body,/Black Scout Derbys/);assert.match(read.body,/t-shirt/);
 assert.ok(!/\$|540|Size S|https?:/.test(read.body),'no prices, sizes or links from the screenshot in the draft');
});

test('lookups that fail or run out of time are partial results; an unreadable screenshot keeps nothing',async()=>{
 const slow=async item=>item.title==='Black Third Cut Jeans'?new Promise(()=>{}):item.title==='Navy Relaxed Fit Trousers'?Promise.reject(Error('down')):PAGES[item.title]??null;
 const read=await readScreenshotProducts({images:[shot(1)],env,read:async()=>FIRST,find:slow,timeoutMs:20});
 assert.deepEqual(read.options.map(o=>o.name),['Black Chino Straight Trousers']);
 assert.deepEqual(read.unmatched.map(u=>u.reason),['timed_out','failed','not_readable']);
 const failed=await readScreenshotProducts({images:[shot(1)],env,read:async()=>{throw Error('model down');},find:finder});
 assert.equal(failed.state,null);assert.match(failed.body,/could not be read/);
 const nothing=await readScreenshotProducts({images:[shot(1)],env,read:async()=>({lines:[],platform:none,items:[]}),find:finder});
 assert.equal(nothing.state,null);
 // Nothing found at all: no save offer, but the items read are still kept for the next answer.
 const unfound=await readScreenshotProducts({images:[shot(2)],env,read:async()=>SECOND,find:async()=>null});
 assert.equal(unfound.state.stage,'search_clarification');assert.equal(unfound.state.options.length,0);assert.equal(unfound.unmatched.length,2);
});

test('a tile is matched only to the exact product of its written brand, one option for every store selling it',async()=>{
 const derby=page('MFPEN','Event Derby - Black Crust','https://mfpen.com/products/event-derby-black-crust',555);
 const belt=page('MFPEN','Drivers Belt - Black Croc','https://mfpen.com/products/drivers-belt-black-croc',205);
 const beltSsense=page('MFPEN','Black Croc Drivers Belt','https://www.ssense.com/en-us/men/product/mfpen/black-croc-drivers-belt/1',175);
 const search=async brief=>({products:brief.includes('Derbys')?[{...derby,identity:'similar',match:'similar'}]
  :[belt,beltSsense,{...page('Other Brand','Black Croc Drivers Belt','https://other.example/belt',90)}]});
 assert.equal(await findListedProduct({brand:'MFPEN',title:'Black Scout Derbys'},{env,search}),null,'a similar derby is not the scout derby');
 const found=await findListedProduct({brand:'MFPEN',title:'Black Croc Drivers Belt'},{env,search});
 // One belt, lowest verified price first, the other store kept with it; another brand's belt is dropped.
 assert.equal(found.url,beltSsense.url);assert.deepEqual(found.merchant_options.map(m=>m.url),[belt.url]);
});

// The agent: the scripted tool call, then a reply once its result is back.
const scripted=(call,seen)=>async(url,options)=>{
 if(isClaimAudit(options))return {ok:false};
 const outputs=toolOutputs(options);
 if(outputs.length){seen.outputs=outputs;return agentTurn(tool('conversation_reply',{response:'i read 4 of them. save all 4, or which ones?'}));}
 seen.tools=toolNames(options);seen.instructions=JSON.parse(options.body).instructions;return agentTurn(call);
};

test('screenshots sent for a save are read together through one tool, which never saves',async()=>{
 const seen={},calls=[];
 const history=[{id:'m1',direction:'inbound',status:'received',body:'Add these items to my wishlist',message_images:[{id:'i1'}]},{id:'m2',direction:'inbound',status:'received',body:'[Inspiration images]',message_images:[{id:'i2'}]}];
 const body=await agentReply(history,env,scripted({type:'function_call',name:'read_screenshot_products',arguments:JSON.stringify({image_message_ids:['m1','m2']})},seen),
  {images:[shot(2)],recentImageMessages:[{id:'m1',caption:'Add these items to my wishlist'},{id:'m2',caption:''}],
   screenshotProductsAction:async ids=>{calls.push(ids);return (await readScreenshotProducts({images:[shot(1),shot(2)],env,read:reader(),find:finder})).body;}});
 assert.ok(seen.tools.includes('read_screenshot_products'));assert.match(seen.instructions,/SCREENSHOT LISTS/);
 assert.ok(!seen.tools.includes('save_to_wishlist'),'an image turn has no save: the answer to the offer saves');
 assert.deepEqual(calls,[['m1','m2']]);assert.equal(seen.outputs[0].status,'done');
 assert.match(body,/save all 4/);
 let names;
 await agentReply([{direction:'inbound',status:'received',body:'hi'}],env,async(u,o)=>{names=toolNames(o);return agentTurn(tool('conversation_reply',{response:'hey'}));},{screenshotProductsAction:async()=>''});
 assert.ok(!names.includes('read_screenshot_products'),'offered only with a screenshot to read');
 assert.deepEqual(SCREENSHOT_PRODUCTS_TOOL.parameters.required,['image_message_ids']);
});

// The next turns: the answer to the offer runs through the real wishlist executor on the recorded state.
const facts=[{field:'gender',key:'identity',value:'man',basis:'stated'}];
async function afterScreenshot(){
 const {state}=await readScreenshotProducts({images:[shot(1),shot(2)],env,read:reader(),find:finder});
 // One item is from a women's department page: the user showed it, so Jules's preferences don't block it.
 state.options[3]={...state.options[3],listing_check:{...state.options[3].listing_check,shopping_range:'women'}};state.selected_set=state.options;
 let current=state,result;const history=[{direction:'inbound',status:'received',body:'Add these items to my wishlist'},{direction:'outbound',status:'sent',body:'i read 6 items. found 4 of them. save all 4, or which ones?'}];
 const say=async(text,call)=>{
  history.push({direction:'inbound',status:'received',body:text});result=undefined;
  const body=await agentReply([...history],env,withConsent(async()=>agentTurn(call)),{facts,wishlistState:current,
   wishlistAction:(args,s)=>textWishlistAction(args,{state:s,facts,env,record:async r=>{result=r;current=r.text_wishlist_state;},search:()=>assert.fail('no search when answering the offer')})});
  history.push({direction:'outbound',status:'sent',body});
  return {body,result,state:current};
 };
 return {say,state};
}

test('all: accepting the offer saves every item found, by the names in the screenshot',async()=>{
 const c=await afterScreenshot();
 const saved=await c.say('yes all of them',tool('save_to_wishlist',{option_indices:[0,1,2,3],consent_context:'answer_to_offer'}));
 assert.equal(saved.result.user_confirmed,true);
 assert.deepEqual(saved.result.products.map(p=>p.name),['Black Chino Straight Trousers','Black Third Cut Jeans','Navy Relaxed Fit Trousers','Black Croc Drivers Belt']);
 // What couldn't be found stays known after the save.
 assert.deepEqual(saved.state.screenshot_unmatched.map(u=>u.reason),['not_found','not_readable']);
});

test('a subset: only the items picked are saved, directly or after saying which ones they like',async()=>{
 const c=await afterScreenshot();
 const saved=await c.say('just the kamiya and the belt',tool('save_to_wishlist',{option_indices:[0,3],consent_context:'explicit_request'}));
 assert.deepEqual(saved.result.products.map(p=>p.name),['Black Chino Straight Trousers','Black Croc Drivers Belt']);
 const d=await afterScreenshot();
 const liked=await d.say('i like the two trousers',tool('respond_to_options',{decision:'interest',option_indices:[0,2]}));
 assert.equal(liked.result.user_confirmed,undefined,'liking is not a save');
 assert.deepEqual(liked.state.selected_set.map(p=>p.name),['Black Chino Straight Trousers','Navy Relaxed Fit Trousers']);
 const yes=await d.say('yes save those',tool('save_to_wishlist',{option_indices:[0,2],consent_context:'answer_to_offer'}));
 assert.equal(yes.result.user_confirmed,true);assert.equal(yes.result.products.length,2);
});

test('none: declining the offer saves nothing and clears it',async()=>{
 const c=await afterScreenshot();
 const declined=await c.say('actually none of them',tool('respond_to_options',{decision:'decline',option_indices:[]}));
 assert.equal(declined.result.user_confirmed,undefined);assert.equal(declined.state,null);
 assert.ok(!declined.result.products.length);
});
