import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textWishlistAction,searchPlan} from '../lib/text-wishlist.js';
import {auditProblems,auditClaims} from '../lib/compose.js';

// Founder decision, October 20: when the user names brands as the look, Jules shows fewer results
// rather than padding with brands far from them, and says so. The look check marks candidates clearly
// unlike every named brand (lib/look-check.js); a named brand's own candidate is never checked.
const p=(id,brand)=>({brand,name:'Flannel '+id,url:`https://${id}.example/products/flannel`,match:'similar',sourcing_status:'store_found',
 listing_check:{status:'verified',product_name:'Flannel '+id,product_brand:brand},price_snapshot:{amount:200,currency:'USD'}});
const designer=p('designer','Auralee'),mass=p('mass','Mass Label'),fast=p('fast','Fast Fashion Co');
const env={OPENAI_API_KEY:'test'};

// The check itself (one listing per call) is tested in tests/look-check.test.js; here, the turn.
const unlikeOf=brands=>async(list,{record})=>{const out=new Map(list.filter(x=>brands.includes(x.brand)).map(x=>[x.url,{brand:x.brand,nearest:''}]));record.look_check={unlike:[...out.keys()]};return out;};

const plan={continuation:false,mode:'discover',hard_constraints:[],guidance:[],reference_brands:['Auralee','Dries Van Noten'],required_brands:[],keep_option_indices:[],exclude_option_indices:[]};
const turn=async(look,products=[designer,mass,fast])=>{
 let result,asked;
 const reply=await textWishlistAction({action:'start',query:'more flannels, auralee or dries or similar',search_plan:plan},{env:{},facts:[],record:async r=>{result=r;},
  stylist:async()=>[],search:async()=>({status:'found',products}),rank:async list=>list,look:async(list,input)=>{asked=input.look;return look(list,input);},owned:async()=>[]});
 return {reply,result,asked};
};

test('the reply says how many it left out for not being close to the named brands',async()=>{
 const {reply,result,asked}=await turn(unlikeOf(['Mass Label','Fast Fashion Co']));
 assert.deepEqual(asked,{brands:['Auralee','Dries Van Noten'],level:null,basis:'request'});
 assert.match(reply,/left out 2 that weren’t close to Auralee and Dries Van Noten/);
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.brand),['Auralee']);
 assert.equal(result.text_wishlist_diagnostics.rank.unlike_references,2);
 const one=await turn(unlikeOf(['Fast Fashion Co']));
 assert.match(one.reply,/left out one that wasn’t close to/);
});

test('when nothing found is close to the named brands, Jules says so instead of showing filler',async()=>{
 const {reply,result}=await turn(unlikeOf(['Auralee','Mass Label','Fast Fashion Co']));
 assert.match(reply,/nothing i found is close enough to Auralee and Dries Van Noten yet/);
 assert.ok(!/https?:\/\//.test(reply),'no links to filler');
 assert.equal(result.text_wishlist_diagnostics.status,'unlike_references');
 // Plain ranking with nothing left out: no note.
 const plain=await turn(async()=>new Map());
 assert.ok(!/left out/.test(plain.reply));
});

// October 20: "those cropped flannels are already in your wishlist" when the items already saved were a
// jacket and boots. A reply about items already saved must name those items.
test('a reply naming different items as already saved is a problem; naming the right ones is not',()=>{
 const facts={saved_now:false,alerts_turned_on:false,alerts_turned_off:false,already_saved_items:['LEMAIRE Black Leather Biker Jacket','Desperado boots']};
 const audit=(other)=>({texts_about_purchases_changed:false,saved_now:false,alerts_turned_on:false,alerts_turned_off:false,names_other_saved_item:other,shop_statements:[]});
 const problems=auditProblems(audit(true),facts);
 assert.equal(problems.length,1);assert.match(problems[0],/already saved: LEMAIRE Black Leather Biker Jacket; Desperado boots/);
 assert.deepEqual(auditProblems(audit(false),facts),[]);
 // A new save keeps its own check and message.
 assert.match(auditProblems({...audit(true),saved_now:true},{saved_now:true,saved_items:['Flannel shirt']})[0],/Only these were saved: Flannel shirt/);
});

test('the audit reads already-saved items as the items to compare with',async()=>{
 let input;
 const fetcher=async(_u,o)=>{input=JSON.parse(o.body).input;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({texts_about_purchases_changed:false,saved_now:false,alerts_turned_on:false,alerts_turned_off:false,names_other_saved_item:true,shop_statements:[]})}]}]})};};
 const audit=await auditClaims({reply:'those cropped flannels are already in your wishlist.',facts:{already_saved_items:['LEMAIRE Black Leather Biker Jacket']},results:'already in your wishlist.',env,fetcher});
 assert.equal(audit.names_other_saved_item,true);
 assert.match(input[0].content,/SAVED_ITEMS \(data\): \["LEMAIRE Black Leather Biker Jacket"\]/);
});

// October 21: "look at luxury brands" was stored as a brand called "luxury brands", so the filter above had
// no real brand to hold results to and a small novelty label's store was shown. A level is its own field.
test('a level asked for holds results to it, with no brands named',async()=>{
 const levelPlan={...plan,reference_brands:[],level:'luxury'};
 let asked;
 const kept=await textWishlistAction({action:'start',query:'tiger stripe sherpa fleece',search_plan:levelPlan},{env:{},facts:[],record:async()=>{},stylist:async()=>[],search:async()=>({status:'found',products:[designer,mass]}),
  rank:async list=>list,look:async(list,input)=>{asked=input.look;return unlikeOf(['Mass Label'])(list,input);},owned:async()=>[]});
 assert.deepEqual(asked,{brands:[],level:'luxury',basis:'request'});
 assert.match(kept,/left out one that wasn’t close to the luxury level you asked for/);
 const none=await textWishlistAction({action:'start',query:'tiger stripe sherpa fleece',search_plan:levelPlan},{env:{},facts:[],record:async()=>{},stylist:async()=>[],search:async()=>({status:'found',products:[mass]}),
  rank:async list=>list,look:unlikeOf(['Mass Label']),owned:async()=>[]});
 assert.match(none,/nothing i found is close enough to the luxury level you asked for yet/);assert.match(none,/curated stores/);
});

test('the plan keeps a valid level and drops anything else; old plans without one are unchanged',()=>{
 const base={continuation:'new_request',mode:'discover',named_model:null,brands:[],hard_constraints:[],guidance:[],keep_option_indices:[],exclude_option_indices:[],price:null};
 for(const level of ['luxury','premium','affordable'])assert.equal(searchPlan({...base,level}).level,level);
 for(const level of [null,'luxury brands','cheap',3])assert.equal(searchPlan({...base,level}).level,null);
 assert.ok(!Object.hasOwn(searchPlan({...base}),'level'));
});
