import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchPlan,textWishlistAction} from '../lib/text-wishlist.js';
import {shoppingContext,burstLinks} from '../lib/shopping-context.js';
import {applyReference,pagePrice,referenceFromLink,dupeReference} from '../lib/dupe-reference.js';

// October 21: the tester sent a Mytheresa link to a Jil Sander half-zip, then a second later "can you
// find a dupe for a better price?". The link's own turn was set aside for the newer message, whose
// search never saw the link: it searched the URL's words and showed the same brand's sweater, sold out.
// Founder rule from the report: a dupe means other brands; the exact item comes back only when it is
// found for less money. The linked item now stays on the plan with the price its page showed.

const ORIGINAL='https://www.mytheresa.com/us/en/men/jil-sander-wool-half-zip-sweater-red-p01198547';
const at=s=>`2026-10-21T16:33:${String(s).padStart(2,'0')}Z`;
const page=(url,brand,name,amount,currency='USD',extra={})=>({brand,name,url,match:'similar',sourcing_status:'store_found',
 listing_check:{status:'verified',retrieval:'http',product_name:name,product_brand:brand,availability:'InStock',...(amount?{price_snapshot:{amount,currency}}:{})},
 ...(amount?{price_snapshot:{amount,currency}}:{}),...extra});
const linked=(amount=890)=>({...page(ORIGINAL,'Jil Sander','Wool half-zip sweater',amount),reference_provenance:'user_link'});
const reference=(amount=890)=>referenceFromLink(linked(amount));

test('a link sent just before the request reaches it; a reply, a sent answer or a long gap in between keeps them apart',()=>{
 const link={id:'l',direction:'inbound',body:ORIGINAL,created_at:at(14)};
 const placeholder={id:'g',direction:'outbound',status:'generating',body:'AI reply is being prepared.',created_at:at(14)};
 const ask={id:'a',direction:'inbound',body:'I love this but can you find a dupe for a better price? Ideally under $800 ish',created_at:at(15)};
 assert.deepEqual(burstLinks([link,placeholder,ask],ask),[ORIGINAL]);
 const state=shoppingContext([link,placeholder,ask],null);
 assert.deepEqual(state.supplied_links,[ORIGINAL]);
 assert.equal(state.options[0].reference_provenance,'user_link');
 // A message in between with no link of its own is still part of the burst.
 const more={id:'m',direction:'inbound',body:'in red',created_at:at(15)};
 assert.deepEqual(burstLinks([link,more,ask],ask),[ORIGINAL]);
 // Jules already answered: the link was handled by its own turn.
 assert.deepEqual(burstLinks([link,{id:'s',direction:'outbound',status:'sent',body:'found it.',created_at:at(14)},ask],ask),[]);
 // Long ago, or a threaded reply naming its own target.
 assert.deepEqual(burstLinks([{...link,created_at:'2026-10-21T16:20:00Z'},ask],ask),[]);
 assert.deepEqual(burstLinks([link,{...ask,reply_context:{resolved:true,messages:[]}}],{...ask,reply_context:{resolved:true,messages:[]}}),[]);
 // The newest message's own link wins.
 const other='https://example.com/products/other';
 assert.deepEqual(shoppingContext([link,{...ask,body:'this one instead '+other}],null).supplied_links,[other]);
});

test('only a price read from the page counts; a search-index price or a range does not',()=>{
 assert.deepEqual(pagePrice(linked()),{amount:890,currency:'USD'});
 assert.equal(pagePrice({...linked(),price_snapshot:{amount:890,currency:'USD',evidence_level:'indexed'}}),null);
 assert.equal(pagePrice({...linked(),listing_check:{...linked().listing_check,verification_basis:'search_index'}}),null);
 assert.equal(pagePrice(page(ORIGINAL,'Jil Sander','x',null)),null);
 assert.equal(referenceFromLink({url:ORIGINAL,name:'Item from mytheresa.com',brand:'',reference_provenance:'user_link'}).page,'unread');
});

test('the same item elsewhere is shown only when its page price is lower in the same currency',async()=>{
 const cheaper=page('https://www.ssense.com/en-us/men/product/jil-sander/red-half-zip/1','JIL SANDER','Red Half-Zip Sweater',640);
 const pricier=page('https://www.farfetch.com/shopping/men/jil-sander-half-zip-item-1.aspx','Jil Sander','Half-zip jumper',950);
 const euro=page('https://www.luisaviaroma.com/en-it/p/jil-sander/men/1','Jil Sander','Half zip',600,'EUR');
 const sameStore=page('https://www.mytheresa.com/us/en/men/jil-sander-half-zip-red-p2','Jil Sander','Wool half-zip',700);
 const dupe=page('https://www.sunspel.com/products/half-zip','Sunspel','Merino half-zip',245);
 const own={...page(ORIGINAL,'Jil Sander','Wool half-zip sweater',890)};
 const copies=[cheaper,pricier,euro,sameStore];
 const same=async list=>[[0,...copies.map(c=>list.indexOf(c))]];
 const {value,record}=await applyReference({products:[own,...copies,dupe]},reference(),{same});
 assert.deepEqual(value.products.map(p=>p.url),[cheaper.url,dupe.url]);
 assert.deepEqual(value.products[0].reference_saving,{amount:250,currency:'USD',reference_price:890});
 assert.equal(value.products[1].reference_saving,undefined,'another brand is a dupe, not the same piece');
 assert.deepEqual(Object.fromEntries(record.withheld.map(w=>[w.url,w.reason])),{[ORIGINAL]:'reference_page',[pricier.url]:'not_lower',[euro.url]:'other_currency',[sameStore.url]:'same_store'});
});

test('with the original price unread, nothing that could be the same item is shown',async()=>{
 const copy=page('https://www.ssense.com/en-us/men/product/jil-sander/red-half-zip/1','Jil Sander','Red Half-Zip Sweater',640);
 const dupe=page('https://www.sunspel.com/products/half-zip','Sunspel','Merino half-zip',245);
 const unread=referenceFromLink({url:ORIGINAL,name:'Item from mytheresa.com',brand:'',reference_provenance:'user_link'});
 // The page named no brand: the plan's reference brand stands in.
 const {value,record}=await applyReference({products:[copy,dupe]},unread,{fallbackBrand:'Jil Sander',same:async()=>[[0,1]]});
 assert.deepEqual(value.products.map(p=>p.url),[dupe.url]);
 assert.equal(record.withheld[0].reason,'reference_price_unread');
});

test('another piece from the same brand follows the price rule unless the user shops within that brand',async()=>{
 const other=page('https://www.ssense.com/en-us/men/product/jil-sander/crewneck/2','Jil Sander','Wool crewneck',950);
 const cheaperOther=page('https://www.ssense.com/en-us/men/product/jil-sander/vest/3','Jil Sander','Wool vest',400);
 const none=async()=>[];
 const looser=await applyReference({products:[other,cheaperOther]},reference(),{same:none});
 assert.deepEqual(looser.value.products.map(p=>p.url),[cheaperOther.url],'could be the same item under another name: only cheaper');
 assert.equal(looser.value.products[0].reference_saving,undefined,'never called the same piece without the identity check');
 const within=await applyReference({products:[other,cheaperOther]},reference(),{requiredBrands:['Jil Sander'],same:none});
 assert.deepEqual(within.value.products.map(p=>p.url),[other.url,cheaperOther.url]);
});

const raw=(mode,continuation='new_request',brands=[{name:'Jil Sander',role:'reference'}])=>({continuation,mode,named_model:null,brands,level:'premium',hard_constraints:[],guidance:[],keep_option_indices:[],exclude_option_indices:[],price:{min:null,max:800,currency:'USD',budget_key:null}});

async function run(args,state,{products,same=async()=>[]}){
 let result;
 const body=await textWishlistAction(args,{state,env:{},facts:[],record:async r=>{result=r;},stylist:async()=>[],owned:async()=>[],rank:async list=>list,same,
  search:async()=>({status:'found',products})});
 return {body,result};
}

test('a dupe of a linked item never leads with the original, keeps it on the plan and names a cheaper copy',async()=>{
 const copy=page('https://www.ssense.com/en-us/men/product/jil-sander/red-half-zip/1','JIL SANDER','Red Half-Zip Sweater',640);
 const pricier=page('https://www.farfetch.com/shopping/men/jil-sander-half-zip-item-1.aspx','Jil Sander','Half-zip jumper',950);
 const dupe=page('https://www.sunspel.com/products/half-zip','Sunspel','Merino half-zip',245);
 const state={stage:'reference',options:[linked()],supplied_links:[ORIGINAL]};
 const args={action:'start',query:'red wool half-zip sweater like the Jil Sander one, other brands, under $800',search_plan:searchPlan(raw('alternatives'))};
 const {body,result}=await run(args,state,{products:[page(ORIGINAL,'Jil Sander','Wool half-zip sweater',890),pricier,copy,dupe],same:async list=>[[0,list.findIndex(p=>p.url===copy.url),list.findIndex(p=>p.url===pricier.url)]]});
 const shown=result.products.map(p=>p.url);
 assert.ok(!shown.includes(ORIGINAL),'the linked page is the reference, not an option');
 assert.ok(!shown.includes(pricier.url),'the same item for more is left out');
 assert.deepEqual(shown.sort(),[copy.url,dupe.url].sort());
 assert.match(body,/\$250 less/);
 const plan=result.text_wishlist_state.search_plan;
 assert.equal(plan.reference_product.url,ORIGINAL);
 assert.deepEqual(plan.reference_product.price,{amount:890,currency:'USD'});
 assert.ok(result.text_wishlist_state.excluded_urls.includes(ORIGINAL));
 const diag=result.text_wishlist_diagnostics.reference;
 assert.equal(diag.withheld.find(w=>w.url===pricier.url).reason,'not_lower');

 // "Other brands, cheaper": the same request continues, read as discover this time; the reference stays.
 const next=await run({action:'start',query:'other brands, cheaper',search_plan:searchPlan(raw('discover','same_request',[]))},result.text_wishlist_state,{products:[pricier,dupe]});
 assert.equal(next.result.text_wishlist_state.search_plan.reference_product.url,ORIGINAL);
 assert.ok(!next.result.products.some(p=>p.url===pricier.url));
 // A new request drops it.
 const fresh=await run({action:'start',query:'white sneakers',search_plan:searchPlan(raw('discover','new_request',[]))},result.text_wishlist_state,{products:[pricier]});
 assert.equal(fresh.result.text_wishlist_state.search_plan.reference_product,undefined);
 assert.ok(fresh.result.products.some(p=>p.url===pricier.url));
});

test('a linked page whose price cannot be read: the same item elsewhere is left out and the reply says so',async()=>{
 const copy=page('https://www.ssense.com/en-us/men/product/jil-sander/red-half-zip/1','Jil Sander','Red Half-Zip Sweater',640);
 const dupe=page('https://www.sunspel.com/products/half-zip','Sunspel','Merino half-zip',245);
 const state={stage:'reference',options:[{url:ORIGINAL,name:'Item from mytheresa.com',brand:'',match:'unverified',sourcing_status:'store_not_found',merchant_options:[],reference_provenance:'user_link'}],supplied_links:[ORIGINAL]};
 const {body,result}=await run({action:'start',query:'red wool half-zip like the Jil Sander one',search_plan:searchPlan(raw('alternatives'))},state,{products:[copy,dupe],same:async()=>[[0,1]]});
 assert.deepEqual(result.products.map(p=>p.url),[dupe.url]);
 assert.match(body,/couldn’t read the price on the page you sent/);
 assert.doesNotMatch(body,/check those there/,'the generic unread-link note is not added on top');
});

test('a linked item searched for itself (not a dupe) is still offered first, unchanged',async()=>{
 const other=page('https://www.ssense.com/en-us/men/product/jil-sander/red-half-zip/1','Jil Sander','Red Half-Zip Sweater',640);
 const state={stage:'reference',options:[linked()],supplied_links:[ORIGINAL]};
 const {result}=await run({action:'start',query:'Jil Sander wool half-zip sweater red',search_plan:searchPlan(raw('identify','new_request',[{name:'Jil Sander',role:'required'}]))},state,{products:[{...other,match:'likely_match'}]});
 assert.equal(result.products[0].url,ORIGINAL);
 assert.equal(result.text_wishlist_state.search_plan.reference_product,undefined);
 assert.equal(dupeReference({alternatives:false,continuation:false,supplied:[linked()]}),null);
});
