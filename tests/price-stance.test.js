import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textWishlistAction} from '../lib/text-wishlist.js';
import {updateProfile,MEMORY_PROMPT,PROFILE_TOOL} from '../lib/memory.js';
import {priceBand,priceFit,parseBudget,savedBudgets} from '../lib/price-stance.js';
import {rankDiscoveryProducts,fallbackOrder} from '../lib/discovery-ranking.js';
import {stylistConcepts} from '../lib/stylist.js';

// A tester said (October 17): "My budget for special pieces is up to 400-500, but I always prefer
// something cheaper. I like nice things." The model reads that statement; these tests check what code
// does with its reading across later turns.
const plan={continuation:false,mode:'discover',hard_constraints:[],guidance:[],keep_option_indices:[],exclude_option_indices:[],price:{min:null,max:null,currency:null,budget_key:null}};
const usd=amount=>({amount,currency:'USD'});
const item=(id,amount,extra={})=>({brand:'Label '+id,name:'Top '+id,url:'https://www.example-store.com/products/'+id,match:'likely_match',sourcing_status:'store_found',price_snapshot:amount===null?null:usd(amount),listing_check:{status:'verified',product_name:'Top '+id},...extra});
const statement={id:'7a1f5c2e-7d2b-4b8e-9a51-1c3f0f4b2d10',direction:'inbound',created_at:'2026-10-17T15:00:00Z',body:'My budget for special pieces is up to 400-500, but I always prefer something cheaper. I like nice things.'};
function memoryStore(){
  let profile={facts:[],version:0};const evidence=[];
  return {evidence,profile:async()=>profile,recordEvidence:async(_id,rows)=>{evidence.push(...rows);},saveProfile:async(_id,version,facts)=>{if(version!==profile.version)return false;profile={facts,version:version+1};return true;}};
}
// The model's reading of her statement, as update_profile arguments.
const reading={changes:[
  {action:'remember',field:'budget',key:'special pieces/unknown',value:'-500',quote:'My budget for special pieces is up to 400-500'},
  {action:'remember',field:'spending',key:'prefers_lower',value:'always prefers something cheaper',quote:'I always prefer something cheaper'},
  {action:'remember',field:'spending',key:'quality',value:'likes nice things',quote:'I like nice things'}],acknowledgment:''};
async function savedStance(){
  const store=memoryStore();
  const saved=await updateProfile(store,'conversation',statement,reading);
  assert.equal(saved.saved,3);assert.deepEqual(saved.rejected,[]);
  return {store,facts:(await store.profile()).facts};
}
async function search(products,{facts=[],state=null,searchPlan=plan,forSomeoneElse=false,rank=async x=>x,env={}}={}){
  let result;const queries=[];
  const reply=await textWishlistAction({action:'start',query:'minimal luxe going-out tops',search_plan:searchPlan,for_someone_else:forSomeoneElse},{state,env,facts,record:async r=>{result=r;},search:async query=>{queries.push(query);return {products};},rank,stylist:async()=>[],shop:async()=>null,sizeKeys:async()=>[]});
  return {reply,result,queries,shown:result.text_wishlist_state?.options?.map(o=>o.url.split('/').at(-1))??[]};
}

test('her budget, "prefer cheaper" and "nice things" are saved as one structured stance with evidence',async()=>{
  const {store,facts}=await savedStance();
  const budget=facts.find(f=>f.field==='budget');
  assert.equal(budget.key,'special pieces/unknown');assert.equal(budget.value,'-500');assert.equal(budget.format,'range');
  assert.ok(facts.every(f=>f.evidence_ids.length===1&&f.source_id===statement.id));
  assert.equal(store.evidence.length,3);
  assert.deepEqual(facts.filter(f=>f.field==='spending').map(f=>f.key).sort(),['prefers_lower','quality']);
  // The currency she didn't state is her market's; she named no floor.
  const band=priceBand({facts,plan:{...plan,price:{...plan.price,budget_key:'special pieces/unknown'}}});
  assert.deepEqual({min:band.min,max:band.max,currency:band.currency,prefers_lower:band.prefers_lower,quality:band.quality,source:band.source},{min:null,max:500,currency:'USD',prefers_lower:true,quality:true,source:'saved'});
  assert.equal(band.evidence_ids.length,3);
  // A spending stance must be one of the known stances; a budget must be a MIN-MAX range.
  const bad=await updateProfile(store,'conversation',statement,{changes:[{action:'remember',field:'spending',key:'cheap',value:'x',quote:'I always prefer something cheaper'},{action:'remember',field:'budget',key:'special pieces/usd',value:'400 to 500 dollars',quote:'My budget for special pieces is up to 400-500'}]});
  assert.equal(bad.saved,0);assert.equal(bad.rejected.length,2);
});

test('the stance carries into a later search where she does not restate it: over-ceiling left out, far-below last',async()=>{
  const {facts}=await savedStance();
  // October 19: "mix in some minimal luxe", no price in the message or hard constraints.
  const products=[item('the-row',720),item('tee',12.99),item('khaite',380),item('toteme',260),item('cos',90)];
  const {reply,result,queries,shown}=await search(products,{facts,searchPlan:{...plan,hard_constraints:['size 8'],price:{...plan.price,budget_key:'special pieces/unknown'}}});
  assert.ok(!shown.includes('the-row'));assert.deepEqual(shown,['cos','toteme','khaite']);
  assert.match(reply,/left out one over your \$500 budget/);
  assert.match(queries[0],/price range for this item: up to \$500, leaning to the lower end/);
  assert.match(queries[0],/well-made pieces/);
  assert.equal(result.text_wishlist_diagnostics.price_band.max,500);
  assert.deepEqual(result.text_wishlist_diagnostics.over_budget.map(p=>p.url),[products[0].url]);
  assert.deepEqual(result.text_wishlist_diagnostics.price_fit,['in_band','in_band','in_band']);
});

test('a far-below listing is a soft signal, not a filter, and every option shows its price or says it is unknown',async()=>{
  const {facts}=await savedStance();
  const products=[item('tee',12.99),item('unpriced',null),item('toteme',260)];
  const {reply,shown}=await search(products,{facts,searchPlan:{...plan,price:{...plan.price,budget_key:'special pieces/unknown'}}});
  assert.deepEqual(shown,['unpriced','toteme','tee']);
  assert.match(reply,/Top tee · \$12\.99/);assert.match(reply,/Top toteme · \$260/);
  assert.match(reply,/Top unpriced · price not confirmed, check the store page/);
  assert.ok(!/\$\d+[^\n]*Top unpriced|Top unpriced[^\n]*\$\d/.test(reply));
});

test('with room left, one over-ceiling option is shown last and labelled over budget',async()=>{
  const {facts}=await savedStance();
  const {reply,shown}=await search([item('the-row',720),item('toteme',260),item('loewe',1900)],{facts});
  assert.deepEqual(shown,['toteme','the-row']);
  assert.match(reply,/Top the-row · \$720\.00 · over your \$500 budget/);
  assert.match(reply,/left out one over your \$500 budget/);
  // A ranker cannot move it ahead of an in-budget option.
  const reversed=await search([item('the-row',720),item('toteme',260)],{facts,rank:async x=>x.toReversed()});
  assert.deepEqual(reversed.shown,['toteme','the-row']);
});

test('"prefer cheaper" orders in-band options cheapest first; without it the search order stands',async()=>{
  const {facts}=await savedStance();
  const products=[item('a',450),item('b',200),item('c',480),item('d',300),item('e',150)];
  assert.deepEqual((await search(products,{facts})).shown,['e','b','d']);
  const noPreference=facts.filter(f=>!(f.field==='spending'&&f.key==='prefers_lower'));
  assert.deepEqual((await search(products,{facts:noPreference})).shown,['a','b','c']);
  // The ranker's fallback order applies the same preference.
  const band=priceBand({facts});
  assert.deepEqual(fallbackOrder(products,{facts,band}).map(p=>p.url.split('/').at(-1)),['e','b','d','a','c']);
});

test('everyday and special-piece budgets apply by the scope the plan names',async()=>{
  const facts=[
    {field:'budget',key:'everyday/usd',value:'-80',format:'range',evidence_ids:['e1']},
    {field:'budget',key:'special pieces/usd',value:'-500',format:'range',evidence_ids:['e2']}];
  const products=[item('silk',300),item('tank',40)];
  const scoped=key=>search(products,{facts,searchPlan:{...plan,price:{...plan.price,budget_key:key}}});
  assert.deepEqual((await scoped('everyday/usd')).shown,['tank','silk']);
  assert.match((await scoped('everyday/usd')).reply,/Top silk · \$300\.00 · over your \$80 budget/);
  assert.deepEqual((await scoped('special pieces/usd')).shown,['silk','tank']);
  // A key that isn't saved is ignored: the widest saved ceiling applies, so nothing in any budget is hidden.
  assert.equal(priceBand({facts,plan:{price:{...plan.price,budget_key:'shoes/usd'}}}).max,500);
  // A price stated for this request wins over any saved budget.
  const stated=await search(products,{facts,searchPlan:{...plan,price:{min:null,max:200,currency:'USD',budget_key:'special pieces/usd'}}});
  assert.match(stated.reply,/over your \$200 budget/);
});

test('a request for someone else uses only its own price and does not touch her stance',async()=>{
  const {store,facts}=await savedStance();
  const before=JSON.stringify(await store.profile());
  const products=[item('scarf',150),item('gloves',60),item('the-row',720)];
  // Gift with a stated $100 limit: that limit applies, her "prefer cheaper" does not reorder it.
  const gift=await search(products,{facts,forSomeoneElse:true,searchPlan:{...plan,price:{min:null,max:100,currency:'USD',budget_key:null}}});
  assert.deepEqual(gift.shown,['gloves','scarf']);assert.match(gift.reply,/over your \$100 budget/);
  assert.equal(gift.result.text_wishlist_diagnostics.price_band.prefers_lower,false);
  // Gift with no stated price: her own budget is not applied.
  const open=await search(products,{facts,forSomeoneElse:true});
  assert.deepEqual(open.shown,['scarf','gloves','the-row']);assert.ok(!/budget/.test(open.reply));
  // Her saved stance is unchanged, and her next own search uses it again.
  assert.equal(JSON.stringify(await store.profile()),before);
  const own=await search(products,{facts,state:gift.result.text_wishlist_state,searchPlan:{...plan,price:{...plan.price,budget_key:'special pieces/unknown'}}});
  assert.deepEqual(own.shown,['gloves','scarf','the-row']);assert.match(own.reply,/over your \$500 budget/);
  // Memory instructions keep gift and one-request limits out of the saved budget.
  assert.match(MEMORY_PROMPT,/never one request's limit, a gift budget or someone else's/);
  assert.match(PROFILE_TOOL.description,/never one request's limit, a gift budget or someone else's/);
});

test('a budget saved before the structured form still works: its ceiling, in her market currency',async()=>{
  // Saved October 17 as key special/currency, value 400-500, with no format mark.
  const facts=[{field:'budget',key:'special/currency',value:'400-500',evidence_ids:['old']}];
  assert.deepEqual(savedBudgets(facts).map(({min,max,currency,legacy})=>({min,max,currency,legacy})),[{min:null,max:500,currency:null,legacy:true}]);
  const band=priceBand({facts});
  assert.deepEqual([band.min,band.max,band.currency,band.prefers_lower],[null,500,'USD',false]);
  assert.equal(priceFit(item('matte',75),band),'in_band');assert.equal(priceFit(item('knwls',618),band),'over');
  for(const [value,range] of [['-500',{min:null,max:500}],['150-300',{min:150,max:300}],['200-',{min:200,max:null}],['usually 100',{min:null,max:100}],['$1,200',{min:null,max:1200}],['nice things',null]])assert.deepEqual(parseBudget(value),range);
  // A market currency fact sets the band's currency; a price in another currency is never judged.
  const gb=priceBand({facts:[...facts,{field:'currency',key:'primary',value:'GBP'}]});
  assert.equal(gb.currency,'GBP');assert.equal(priceFit(item('usd',900),gb),'unknown');
});

test('the ranker and the stylist both receive the band; the ranker sees each candidate\'s price fit',async()=>{
  const {facts}=await savedStance();
  const band=priceBand({facts});
  let rankInput,stylistInput;
  await rankDiscoveryProducts([item('a',90),item('b',8)],{query:'tops',facts,band,env:{OPENAI_API_KEY:'test'},fetcher:async(_u,o)=>{rankInput=JSON.parse(JSON.parse(o.body).input[0].content);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({indices:[0,1],rejected_indices:[]})}]}]})};}});
  assert.deepEqual(rankInput.price_band,{range:'up to $500',currency:'USD',scope:'special pieces',source:'saved',prefers_lower:true,quality:true});
  assert.deepEqual(rankInput.candidates.map(c=>c.signals.price_fit),['in_band','below']);
  await stylistConcepts({query:'tops',plan,facts,band:{range:'up to $500'},env:{OPENAI_API_KEY:'test'},fetcher:async(_u,o)=>{stylistInput=JSON.parse(JSON.parse(o.body).input);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({concepts:[]})}]}]})};}});
  assert.deepEqual(stylistInput.price_band,{range:'up to $500'});
  assert.ok(stylistInput.saved_profile.some(f=>f.field==='spending'&&f.key==='quality'));
});
