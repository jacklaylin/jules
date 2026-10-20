import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSearch,formatSearch,searchProducts,publicURL} from '../lib/search.js';
import {generateReply} from '../lib/ai.js';
import {tool,restating} from './helpers/agent.js';
const url='https://retailer.example/products/waxed-jacket';
const result={intro:'I can’t confirm the exact jacket; here is a similar option.',products:[{brand:'Example',name:'Waxed jacket',url,match:'similar',reason:'Dark waxed cotton with a corduroy collar.'}],needs_review:false};
const response=(output)=>({ok:true,json:async()=>({status:'completed',output})});
const output=[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{url}]}},{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(result)}]}];
test('failed category URLs are excluded on refinement and their page checks survive profile filtering',async()=>{
 const category='https://www.prada.com/us/en/mens/shoes/speedrock/c/10851US';let calls=0;
 const found=await searchProducts('Prada Speedrock',[],{},async(endpoint,options)=>{
  const request=JSON.parse(options.body);assert.equal(request.tool_choice,'required');calls++;
  if(calls===2){assert.ok(request.input[0].content[0].text.includes(category));return response([{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({intro:'None found.',products:[],needs_review:true})}]}]);}
  return response([{type:'web_search_call',status:'completed',action:{sources:[{url:category}]}},{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({...result,products:[{...result.products[0],brand:'Prada',name:'Speedrock sneakers',url:category}]})}]}]);
 },{range:'men'});
 assert.equal(calls,2);assert.equal(found.initial_checks[0].checks[0].reason,'category_page');assert.equal(found.initial_checks[0].url,category);
});
test('product links require completed live search and retrieved source URLs; invented and duplicate URLs are dropped',()=>{
  const verified=validateSearch({output},{...result,products:[...result.products,{...result.products[0],url:'https://retailer.example/invented'},result.products[0]]});
  assert.equal(verified.products.length,1);assert.equal(verified.status,'found');
  assert.match(formatSearch(verified),/this is a similar option\./);
  assert.throws(()=>validateSearch({output:[]},result));
  const missing=validateSearch({output}, {...result,products:[{...result.products[0],url:'https://retailer.example/invented'}]});
  assert.equal(missing.status,'needs_review');assert.match(formatSearch(missing),/similar options/);
});
test('unsafe links cannot be exposed as product sources',()=>{
  for(const value of ['javascript:alert(1)','http://retailer.example/item','https://localhost/item','https://127.0.0.1/item','https://user:secret@retailer.example/item','https://retailer.invalid/item'])assert.equal(publicURL(value),null);
});
test('product sourcing sends the referenced image, validates live web search, and retains citations with timestamp',async()=>{
  const found=await searchProducts('Find this waxed jacket',[{mime_type:'image/jpeg',data:'fake-image-bytes'}],{OPENAI_API_KEY:'fake'},async(endpoint,options)=>{
    const request=JSON.parse(options.body);assert.equal(request.tools[0].type,'web_search');assert.equal(request.tool_choice,'auto');
    assert.equal(request.include[0],'web_search_call.action.sources');assert.equal(request.store,false);
    assert.equal(request.input[0].content[1].type,'input_image');return response(output);
  });
  assert.equal(found.products.length,0);assert.equal(found.sources[0],url);assert.ok(found.checked_at);
});
test('explicit follow-up can source the recent image without attaching it to ordinary conversation turns',async()=>{
  let calls=0,loaded=0,recorded;
  const text=await generateReply([{direction:'inbound',body:'Find that jacket and send links'}],{OPENAI_API_KEY:'fake',SEARCH_ENABLED:'true'},restating(async(endpoint,options)=>{
    const request=JSON.parse(options.body);
    if(++calls===1){assert.ok(request.tools.some(t=>t.name==='find_products'));return response([tool('find_products',{query:'Dark waxed jacket with corduroy collar',use_image:true})]);}
    assert.equal(request.input[0].content[1].type,'input_image');return response(output);
  }),{loadImages:async()=>{loaded++;return [{mime_type:'image/jpeg',data:'fake'}];},recordSearch:async r=>recorded=r});
  assert.equal(calls,2);assert.equal(loaded,1);assert.equal(recorded.products.length,0);assert.match(text,/similar options/);
});
test('search errors are recorded for review and never generate invented links',async()=>{
  let calls=0,recorded;
  const text=await generateReply([{direction:'inbound',body:'Send jacket links'}],{OPENAI_API_KEY:'fake',SEARCH_ENABLED:'true'},async()=>{
    if(++calls===1)return response([tool('find_products',{query:'Waxed jacket'})]);
    return {ok:false,status:503};
  },{recordSearch:async r=>recorded=r});
  assert.equal(recorded.status,'failed');assert.match(text,/try again/);assert.ok(!text.includes('https://'));
});
test('unsourced URLs written by the agent outside the sourcing tool are never delivered',async()=>{
  for(const output of [[tool('conversation_reply',{response:'Buy it at https://retailer.example/invented'})],[{type:'message',role:'assistant',content:[{type:'output_text',text:'Buy it at https://retailer.example/invented'}]}]])
    await assert.rejects(generateReply([{direction:'inbound',body:'Find jacket links'}],{OPENAI_API_KEY:'fake',SEARCH_ENABLED:'true'},async()=>response(output)));
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

test('completed empty identification offers a supported next step without claiming search failure',()=>{
  const empty=validateSearch({output:[]},{intro:'Cannot read a model identifier.',products:[],needs_review:true},new Date(),{image:true});
  assert.equal(empty.status,'needs_review');assert.match(formatSearch(empty),/similar options/);
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
  },{},true,'web');
  assert.equal(calls,2);assert.equal(found.products.length,1);assert.equal(found.products[0].url,url);
});

test('shopper result layout removes technical labels, repeats no brand, and separates a bonus',()=>{
 const text=formatSearch({intro:'That looks like a possible match.',products:[{brand:'Example',name:'Example Jacket',reason:'A dark checked finish.',url,match:'likely_match',role:'primary'},{brand:'Example',name:'Long Coat',reason:'A longer related style.',url:url+'-long',match:'similar',role:'bonus'}]});
 assert.match(text,/1\. Example Jacket: A dark checked finish\.\nprice unavailable\nhttps:/);
 assert.match(text,/bonus: Example Long Coat\. A longer related style/);
 assert.ok(!text.includes('Example Example'));assert.ok(!text.includes('Likely match; unconfirmed'));assert.ok(!text.includes('These are sourced links'));
});

test('transient search server failure retries once with the same request',async()=>{
  const requests=[];
  const found=await searchProducts('Trail sneakers',[],{},async(url,options)=>{
    requests.push(options);
    return requests.length===1?{ok:false,status:500}:response([{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({intro:'No verified listing.',products:[],needs_review:true})}]}]);
  },{},false,'web');
  assert.equal(requests.length,2);assert.equal(requests[0].body,requests[1].body);
  assert.notEqual(requests[0].signal,requests[1].signal);assert.equal(found.products.length,0);
});
test('search retries are bounded and do not retry authentication or quota failures',async()=>{
  for(const status of [500,502,503,504,400,401,403]){
    let calls=0;
    await assert.rejects(searchProducts('Trail sneakers',[],{},async()=>{calls++;return {ok:false,status};}),/Product search failed/);
    assert.equal(calls,[500,502,503,504].includes(status)?2:1);
  }
  // Exhausted quota is never retried; a short rate limit is waited out once (lib/model-call.js).
  const refused=code=>new Response(JSON.stringify({error:{code}}),{status:429,headers:{'retry-after-ms':'1'}});
  for(const [code,expected] of [['insufficient_quota',1],['rate_limit_exceeded',2]]){
    let calls=0;
    await assert.rejects(searchProducts('Trail sneakers',[],{},async()=>{calls++;return refused(code);}),/Product search failed/);
    assert.equal(calls,expected,code);
  }
});

test('hosted search uses its own verified model rather than inheriting the conversation model',async()=>{
 for(const override of [undefined,'gpt-4.1-mini']){
  await searchProducts('Trail sneakers',[],{OPENAI_MODEL:'conversation-model',OPENAI_SEARCH_MODEL:override},async(url,options)=>{
   assert.equal(JSON.parse(options.body).model,override??'gpt-4.1');
   return response([{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({intro:'No listing.',products:[],needs_review:true})}]}]);
  });
 }
});

test('the exact Google query runs first: a verified exact match answers without waiting for the model search, in any mode',async()=>{
  const page='https://www.prada.com/us/en/p/speed-rock-sneakers/2EG400';
  const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Prada Speed Rock sneakers',brand:{name:'Prada'},offers:{price:'990',priceCurrency:'USD',availability:'https://schema.org/InStock',url:page}})+'</script>';
  const run=async({organic,mode=null})=>{
    const calls={serp:0,openai:0,order:[],aborted:0};
    const fetcher=async(url,options={})=>{
      if(String(url).startsWith('https://serpapi.com/')){calls.serp++;calls.order.push('serp');return new Response(JSON.stringify({organic_results:organic}));}
      if(String(url).startsWith('https://api.openai.com/')){calls.openai++;calls.order.push('openai');options.signal?.addEventListener('abort',()=>calls.aborted++);return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({intro:'none',products:[],needs_review:true})}]}]}));}
      return new Response(html,{headers:{'content-type':'text/html'}});
    };
    const result=await searchProducts('Prada Speed Rock sneakers',[],{OPENAI_API_KEY:'test',SERPAPI_API_KEY:'structured-fixture',SEARCH_DEADLINE_MS:'5000'},fetcher,{search_brief:'Prada Speed Rock sneakers',search_mode:mode}).catch(error=>({error}));
    return {calls,result};
  };
  const hit=await run({organic:[{link:page,title:'Prada Speed Rock sneakers | PRADA'}]});
  assert.equal(hit.result.structured_first,true);assert.equal(hit.result.products[0].url,page);assert.equal(hit.result.products[0].match,'likely_match');
  assert.equal(hit.result.sourcing.answered_by,'exact_search');assert.equal(hit.result.sourcing.exact_found_first_attempt,true);
  assert.equal(hit.calls.order[0],'serp');
  const miss=await run({organic:[]});assert.ok(miss.calls.openai>=1);
  assert.equal(miss.result.sourcing.first_attempt,'exact_search');assert.equal(miss.result.sourcing.exact_found_first_attempt,false);
  // A named model is found the same way when the request was read as discovery.
  const discovery=await run({organic:[{link:page,title:'Prada Speed Rock sneakers'}],mode:'discover'});
  assert.equal(discovery.result.sourcing.answered_by,'exact_search');assert.equal(discovery.result.products[0].url,page);
  // A stylist direction turns the exact pass off: the brief is not typed into Google, and the model
  // search is never cancelled (later structured recovery may still run).
  const run2=async exact=>{const calls={exact:0,aborted:0};const fetcher=async(url,options={})=>{
    if(String(url).startsWith('https://serpapi.com/')){if(new URL(url).searchParams.get('q')==='Prada Speed Rock sneakers')calls.exact++;return new Response(JSON.stringify({organic_results:[{link:page,title:'Prada Speed Rock sneakers'}]}));}
    if(String(url).startsWith('https://api.openai.com/')){options.signal?.addEventListener('abort',()=>calls.aborted++);return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({intro:'none',products:[],needs_review:true})}]}]}));}
    return new Response(html,{headers:{'content-type':'text/html'}});};
    const result=await searchProducts('Prada Speed Rock sneakers',[],{OPENAI_API_KEY:'test',SERPAPI_API_KEY:'structured-fixture',SEARCH_DEADLINE_MS:'5000'},fetcher,{search_brief:'Prada Speed Rock sneakers',search_mode:'discover',exact}).catch(error=>({error}));
    return {calls,result};};
  const direction=await run2(false);
  assert.equal(direction.calls.exact,0);assert.equal(direction.calls.aborted,0);assert.notEqual(direction.result.sourcing?.answered_by,'exact_search');
  assert.ok((await run2(undefined)).calls.exact>=1,'the same request without the flag does type the brief into Google');
  // A blocked page known only by its search title and no price never answers: it may be a category page.
  const blocked=async(url,options={})=>{
    if(String(url).startsWith('https://serpapi.com/'))return new Response(JSON.stringify({organic_results:[{link:'https://www.urbanoutfitters.com/womens-going-out-tops',title:"Women's Going Out Tops | Urban Outfitters"}]}));
    if(String(url).startsWith('https://api.openai.com/')){const body=JSON.parse(options.body??'{}');if(body.text?.format?.name==='judge'||JSON.stringify(body).includes('retrieved store listing'))return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({candidates:[{index:0,brand:'',match:'meets_brief'}]})}]}]}));
      return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({intro:'none',products:[],needs_review:true})}]}]}));}
    return new Response('blocked',{status:403});};
  const titleOnly=await searchProducts("women's going-out tops",[],{OPENAI_API_KEY:'test',SERPAPI_API_KEY:'structured-fixture',SEARCH_DEADLINE_MS:'5000'},blocked,{search_brief:"women's going-out tops"}).catch(error=>({error}));
  assert.notEqual(titleOnly.sourcing?.answered_by,'exact_search');
});
