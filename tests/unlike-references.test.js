import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankDiscoveryProducts} from '../lib/discovery-ranking.js';
import {textWishlistAction} from '../lib/text-wishlist.js';
import {auditProblems,auditClaims} from '../lib/compose.js';

// Founder decision, October 20: when the user names brands as the look, Jules shows fewer results
// rather than padding with brands far from them, and says so. The ranker marks candidates clearly
// unlike every named brand; code checks the marks and never leaves out a named brand's own candidate.
const p=(id,brand)=>({brand,name:'Flannel '+id,url:`https://${id}.example/products/flannel`,match:'similar',sourcing_status:'store_found',
 listing_check:{status:'verified',product_name:'Flannel '+id,product_brand:brand},price_snapshot:{amount:200,currency:'USD'}});
const designer=p('designer','Auralee'),close=p('close','Studio Nicholson'),mass=p('mass','Mass Label'),fast=p('fast','Fast Fashion Co');
const reply=answer=>async(_url,options)=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(answer)}]}]}),body:options.body});
const env={OPENAI_API_KEY:'test'};

test('candidates marked unlike the named brands are left out and counted; the named brand never is',async()=>{
 let body;const fetcher=async(u,o)=>{body=JSON.parse(o.body);return reply({indices:[0,1,2,3],rejected_indices:[],unlike_references_indices:[0,2,3]})(u,o);};
 const record={};
 const out=await rankDiscoveryProducts([designer,close,mass,fast],{query:'cropped flannels like auralee or dries',referenceBrands:['Auralee','Dries Van Noten'],env,fetcher,record});
 assert.deepEqual(out.map(x=>x.brand),['Auralee','Studio Nicholson'],'the Auralee listing stays even though it was marked');
 assert.equal(record.unlike_references,2);
 assert.deepEqual(JSON.parse(body.input[0].content).reference_brands,['Auralee','Dries Van Noten']);
 assert.match(body.instructions,/unlike_references_indices/);
});

test('without named brands, or with marks that name no ranked candidate, nothing is left out',async()=>{
 for(const [referenceBrands,unlike] of [[[],[2,3]],[['Auralee'],[9,-1]],[['Auralee'],[]]]){
  const record={};
  const out=await rankDiscoveryProducts([designer,close,mass,fast],{query:'flannels',referenceBrands,env,fetcher:reply({indices:[0,1,2,3],rejected_indices:[],unlike_references_indices:unlike}),record});
  assert.equal(out.length,4,JSON.stringify(unlike));assert.equal(record.unlike_references,0);
 }
 // A rejected candidate is already out; marking it as well counts nothing extra.
 const record={};
 const out=await rankDiscoveryProducts([designer,close,mass],{query:'flannels',referenceBrands:['Auralee'],env,fetcher:reply({indices:[0,1],rejected_indices:[2],unlike_references_indices:[2]}),record});
 assert.equal(out.length,2);assert.equal(record.unlike_references,0);
});

const plan={continuation:false,mode:'discover',hard_constraints:[],guidance:[],reference_brands:['Auralee','Dries Van Noten'],required_brands:[],keep_option_indices:[],exclude_option_indices:[]};
const turn=async rank=>{
 let result;
 const reply=await textWishlistAction({action:'start',query:'more flannels, auralee or dries or similar',search_plan:plan},{env:{},facts:[],record:async r=>{result=r;},
  stylist:async()=>[],search:async()=>({status:'found',products:[designer,mass,fast]}),rank,owned:async()=>[]});
 return {reply,result};
};

test('the reply says how many it left out for not being close to the named brands',async()=>{
 const {reply,result}=await turn(async(list,{record})=>{record.unlike_references=2;return list.filter(x=>x.brand==='Auralee');});
 assert.match(reply,/left out 2 that weren’t close to Auralee and Dries Van Noten/);
 assert.deepEqual(result.text_wishlist_state.options.map(o=>o.brand),['Auralee']);
 assert.equal(result.text_wishlist_diagnostics.rank.unlike_references,2);
 const one=await turn(async(list,{record})=>{record.unlike_references=1;return list.filter(x=>x.brand!=='Fast Fashion Co');});
 assert.match(one.reply,/left out one that wasn’t close to/);
});

test('when nothing found is close to the named brands, Jules says so instead of showing filler',async()=>{
 const {reply,result}=await turn(async(_list,{record})=>{record.unlike_references=3;return [];});
 assert.match(reply,/nothing i found is close enough to Auralee and Dries Van Noten yet/);
 assert.ok(!/https?:\/\//.test(reply),'no links to filler');
 assert.equal(result.text_wishlist_diagnostics.status,'unlike_references');
 // Plain ranking with nothing left out: no note.
 const plain=await turn(async list=>list);
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
