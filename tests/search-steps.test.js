import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchProducts} from '../lib/search.js';
import {textWishlistAction} from '../lib/text-wishlist.js';

// October 21: a "find this cheaper" turn ran out of time inside the product search, and the turn's
// trace showed only that the search had started. The search now notes each stage it reaches, so a
// turn that runs out of time shows which stage it was in.
const response=output=>({ok:true,json:async()=>({status:'completed',output})});
const category='https://www.prada.com/us/en/mens/shoes/speedrock/c/10851US';
const product={brand:'Prada',name:'Speedrock sneakers',url:category,match:'likely_match',reason:'x'};

test('the search notes its stages, through a second pass, and keeps them out of the shopping constraints',async()=>{
 const notes=[],bodies=[];let calls=0;
 await searchProducts('Prada Speedrock',[],{},async(_endpoint,options)=>{
  bodies.push(options.body);calls++;
  if(calls===2)return response([{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({intro:'None found.',products:[],needs_review:true,requested_alternatives:false})}]}]);
  return response([{type:'web_search_call',status:'completed',action:{sources:[{url:category}]}},{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({intro:'Found.',products:[product],needs_review:false,requested_alternatives:false})}]}]);
 },{range:'men',step:n=>notes.push(n)});
 assert.ok(notes.includes('search:model_done'));
 assert.ok(notes.indexOf('search:page_checks')<notes.indexOf('search:page_checks_done'));
 assert.ok(notes.includes('search:second_pass'));
 // The second pass notes its own stages on the same trace.
 assert.ok(notes.filter(n=>n==='search:model_done').length>=2,JSON.stringify(notes));
 assert.ok(bodies.every(b=>!b.includes('"step"')),'the step callback never reaches the model');
});

test('a search with no step callback still runs',async()=>{
 const found=await searchProducts('Prada Speedrock',[],{},async()=>response([{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({intro:'None.',products:[],needs_review:true,requested_alternatives:false})}]}]),{range:'men'});
 assert.equal(found.products.length,0);
});

test('a sourcing turn passes the search’s stages to the turn trace',async()=>{
 const steps=[];
 await textWishlistAction({action:'start',query:'Prada Speedrock sneakers',search_plan:{continuation:false,mode:'identify',required_brands:['Prada'],reference_brands:[],level:null,hard_constraints:[],guidance:[],keep_option_indices:[],exclude_option_indices:[]}},
  {env:{},facts:[],record:async()=>{},step:s=>steps.push(s),search:async(_q,_i,_e,_f,options)=>{options.step('search:model_done');return {status:'needs_review',products:[]};}});
 assert.ok(steps.includes('sourcing:search'));
 assert.ok(steps.includes('sourcing:search:model_done'),JSON.stringify(steps));
});
