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
  assert.match(formatSearch(verified),/similar options/);
  assert.throws(()=>validateSearch({output:[]},result));
  const missing=validateSearch({output}, {...result,products:[{...result.products[0],url:'https://retailer.example/invented'}]});
  assert.equal(missing.status,'needs_review');assert.match(formatSearch(missing),/closer photo/);
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
  assert.equal(found.products.length,0);assert.equal(found.sources[0],url);assert.ok(found.checked_at);
});
test('explicit follow-up can source the recent image without attaching it to ordinary conversation turns',async()=>{
  let calls=0,loaded=0,recorded;
  const text=await generateReply([{direction:'inbound',body:'Find that jacket and send links'}],{OPENAI_API_KEY:'fake',SEARCH_ENABLED:'true'},async(endpoint,options)=>{
    const request=JSON.parse(options.body);
    if(++calls===1){assert.equal(request.tools[0].name,'search_products');return response([{type:'function_call',name:'search_products',arguments:JSON.stringify({query:'Dark waxed jacket with corduroy collar',use_image:true})}]);}
    assert.equal(request.input[0].content[1].type,'input_image');return response(output);
  },{loadImages:async()=>{loaded++;return [{mime_type:'image/jpeg',data:'fake'}];},recordSearch:async r=>recorded=r});
  assert.equal(calls,2);assert.equal(loaded,1);assert.equal(recorded.products.length,0);assert.match(text,/closer photo/);
});
test('search errors are recorded for review and never generate invented links',async()=>{
  let calls=0,recorded;
  const text=await generateReply([{direction:'inbound',body:'Send jacket links'}],{OPENAI_API_KEY:'fake',SEARCH_ENABLED:'true'},async()=>{
    if(++calls===1)return response([{type:'function_call',name:'search_products',arguments:'{"query":"Waxed jacket","use_image":false}'}]);
    return {ok:false,status:503};
  },{recordSearch:async r=>recorded=r});
  assert.equal(recorded.status,'failed');assert.match(text,/try again/);assert.ok(!text.includes('https://'));
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

 test('generic visual resemblance is withheld for identification and retained only for explicit alternatives',()=>{
  const guessed={...result,products:[{...result.products[0],match:'likely_match'}]};
  const strict=validateSearch({output},guessed,new Date(),{image:true});
  assert.equal(strict.products.length,0);assert.equal(strict.status,'needs_review');
  const alternatives=validateSearch({output},guessed,new Date(),{image:true,allowSimilar:true});
  assert.equal(alternatives.products[0].match,'similar');
  assert.ok(!formatSearch(alternatives).includes('Likely match'));
 });
 test('matching readable identifiers permit an uncertain match; conflicting construction rejects it',()=>{
  const identified={...result,products:[{...result.products[0],match:'likely_match',identity:{visible_identifier:'Example Model 123',listing_identifier:'Example Model 123',contradictions:[]}}]};
  assert.equal(validateSearch({output},identified,new Date(),{image:true}).products.length,1);
  identified.products[0].identity.contradictions=['Listing has a chest pocket absent in the image'];
  assert.equal(validateSearch({output},identified,new Date(),{image:true}).products.length,0);
 });

test('completed empty identification can request a closer photo without claiming search failure',()=>{
  const empty=validateSearch({output:[]},{intro:'Cannot read a model identifier.',products:[],needs_review:true},new Date(),{image:true});
  assert.equal(empty.status,'needs_review');assert.match(formatSearch(empty),/closer photo/);
  assert.ok(!formatSearch(empty).includes('didn’t finish'));
});

test('prose from hosted search is structured separately while original sources still gate URLs',async()=>{
  let calls=0;
  const found=await searchProducts('Find similar jackets',[],{OPENAI_API_KEY:'fake'},async(endpoint,options)=>{
    const request=JSON.parse(options.body);
    if(++calls===1){
      assert.equal(request.text,undefined);assert.equal(request.tools[0].type,'web_search');
      assert.match(request.instructions,/Do not format JSON/);
      return response([{type:'web_search_call',status:'completed',action:{sources:[{url}]}},{type:'message',role:'assistant',content:[{type:'output_text',text:'A real jacket listing: '+url}]}]);
    }
    assert.equal(request.tools,undefined);assert.equal(request.text.format.type,'json_schema');
    return response([{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({...result,products:[result.products[0],{...result.products[0],url:'https://retailer.example/invented'}]})}]}]);
  });
  assert.equal(calls,2);assert.equal(found.products.length,1);assert.equal(found.products[0].url,url);
});

test('shopper result layout removes technical labels, repeats no brand, and separates a bonus',()=>{
 const text=formatSearch({intro:'That looks like a possible match.',products:[{brand:'Example',name:'Example Jacket',reason:'A dark checked finish.',url,match:'likely_match',role:'primary'},{brand:'Example',name:'Long Coat',reason:'A longer related style.',url:url+'-long',match:'similar',role:'bonus'}]});
 assert.match(text,/1\. Example Jacket: A dark checked finish\.\nPrice unavailable\nhttps:/);
 assert.match(text,/Bonus: Example Long Coat\. A longer related style/);
 assert.ok(!text.includes('Example Example'));assert.ok(!text.includes('Likely match; unconfirmed'));assert.ok(!text.includes('These are sourced links'));
});

test('transient search server failure retries once with the same request',async()=>{
  const requests=[];
  const found=await searchProducts('Trail sneakers',[],{},async(url,options)=>{
    requests.push(options);
    return requests.length===1?{ok:false,status:500}:response([{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({intro:'No verified listing.',products:[],needs_review:true})}]}]);
  });
  assert.equal(requests.length,2);assert.equal(requests[0].body,requests[1].body);
  assert.notEqual(requests[0].signal,requests[1].signal);assert.equal(found.products.length,0);
});
test('search retries are bounded and do not retry authentication or quota failures',async()=>{
  for(const status of [500,502,503,504,400,401,403,429]){
    let calls=0;
    await assert.rejects(searchProducts('Trail sneakers',[],{},async()=>{calls++;return {ok:false,status};}),/Product search failed/);
    assert.equal(calls,[500,502,503,504].includes(status)?2:1);
  }
});
