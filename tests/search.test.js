import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSearch,formatSearch,searchProducts,publicURL} from '../lib/search.js';
import {generateReply} from '../lib/ai.js';
const url='https://retailer.example/products/waxed-jacket';
const result={intro:'I can’t confirm the exact jacket; here is a similar option.',products:[{brand:'Example',name:'Waxed jacket',url,match:'similar',reason:'Dark waxed cotton with a corduroy collar.'}],needs_review:false};
const response=(output)=>({ok:true,json:async()=>({status:'completed',output})});
const output=[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{url}]}},{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(result)}]}];
test('product links require completed live search and retrieved source URLs; invented and duplicate URLs are dropped',()=>{
  const verified=validateSearch({output},{...result,products:[...result.products,{...result.products[0],url:'https://retailer.example/invented'},result.products[0]]});
  assert.equal(verified.products.length,1);assert.equal(verified.status,'found');
  assert.match(formatSearch(verified),/Similar alternative/);assert.match(formatSearch(verified),/not confirmed/);
  assert.throws(()=>validateSearch({output:[]},result));
  const missing=validateSearch({output}, {...result,products:[{...result.products[0],url:'https://retailer.example/invented'}]});
  assert.equal(missing.status,'needs_review');assert.match(formatSearch(missing),/won’t guess a link/);
});
test('unsafe links cannot be exposed as product sources',()=>{
  for(const value of ['javascript:alert(1)','http://retailer.example/item','https://localhost/item','https://127.0.0.1/item','https://user:secret@retailer.example/item','https://retailer.invalid/item'])assert.equal(publicURL(value),null);
});
test('product sourcing sends the referenced image, requires live web search, and retains citations with timestamp',async()=>{
  const found=await searchProducts('Find this waxed jacket',[{mime_type:'image/jpeg',data:'fake-image-bytes'}],{OPENAI_API_KEY:'fake'},async(endpoint,options)=>{
    const request=JSON.parse(options.body);assert.equal(request.tools[0].type,'web_search');assert.equal(request.tool_choice,'required');
    assert.equal(request.include[0],'web_search_call.action.sources');assert.equal(request.store,false);
    assert.equal(request.input[0].content[1].type,'input_image');return response(output);
  });
  assert.equal(found.products[0].url,url);assert.equal(found.sources[0],url);assert.ok(found.checked_at);
});
test('explicit follow-up can source the recent image without attaching it to ordinary conversation turns',async()=>{
  let calls=0,loaded=0,recorded;
  const text=await generateReply([{direction:'inbound',body:'Find that jacket and send links'}],{OPENAI_API_KEY:'fake',SEARCH_ENABLED:'true'},async(endpoint,options)=>{
    const request=JSON.parse(options.body);
    if(++calls===1){assert.equal(request.tools[0].name,'search_products');return response([{type:'function_call',name:'search_products',arguments:JSON.stringify({query:'Dark waxed jacket with corduroy collar',use_image:true})}]);}
    assert.equal(request.input[0].content[1].type,'input_image');return response(output);
  },{loadImages:async()=>{loaded++;return [{mime_type:'image/jpeg',data:'fake'}];},recordSearch:async r=>recorded=r});
  assert.equal(calls,2);assert.equal(loaded,1);assert.equal(recorded.products.length,1);assert.match(text,/https:\/\/retailer.example/);
});
test('search errors are recorded for review and never generate invented links',async()=>{
  let calls=0,recorded;
  const text=await generateReply([{direction:'inbound',body:'Send jacket links'}],{OPENAI_API_KEY:'fake',SEARCH_ENABLED:'true'},async()=>{
    if(++calls===1)return response([{type:'function_call',name:'search_products',arguments:'{"query":"Waxed jacket","use_image":false}'}]);
    return {ok:false,status:503};
  },{recordSearch:async r=>recorded=r});
  assert.equal(recorded.status,'failed');assert.match(text,/manual review/);assert.ok(!text.includes('https://'));
});
test('unsourced URLs returned outside the sourcing tool are not delivered',async()=>{
  const text=await generateReply([{direction:'inbound',body:'Find jacket links'}],{OPENAI_API_KEY:'fake',SEARCH_ENABLED:'true'},async()=>response([{type:'message',role:'assistant',content:[{type:'output_text',text:'Buy it at https://retailer.example/invented'}]}]));
  assert.ok(!text.includes('https://'));assert.match(text,/source product links/);
});

test('OpenAI source tracking does not reject a real listing; product variants remain distinct',()=>{
  const tracked=[{type:'web_search_call',status:'completed',action:{sources:[{url:url+'?color=black&utm_source=openai&utm_medium=referral'}]}}];
  const found=validateSearch({output:tracked},{...result,products:[{...result.products[0],url:url+'?color=black'}]});
  assert.equal(found.products.length,1);assert.equal(found.products[0].url,url+'?color=black');
  const wrongVariant=validateSearch({output:tracked},{...result,products:[{...result.products[0],url:url+'?color=olive'}]});
  assert.equal(wrongVariant.products.length,0);
});
test('unverified links in narrative text cannot bypass source validation',()=>{
  const found=validateSearch({output},{...result,intro:'See [a jacket](https://unverified.example/fake).',products:[{...result.products[0],reason:'Also https://unverified.example/fake'}]});
  const text=formatSearch(found);assert.ok(text.includes(url));assert.ok(!text.includes('unverified.example'));
});
