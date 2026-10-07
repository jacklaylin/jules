import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIdentificationTestHandler} from '../api/identification-test.js';
const operation='00000000-0000-4000-8000-000000000001';
const input={operation,query:'Find the shoes',image:Buffer.from([255,216,255,0]).toString('base64'),provider_sharing:true};
const req=body=>({method:'POST',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}});
const res=()=>({setHeader(){},end(body){this.body=JSON.parse(body);}});
const env={WISHLIST_ENABLED:'true',OPENAI_API_KEY:'fake',SERPAPI_API_KEY:'fake',ADMIN_EMAIL:'owner@example.invalid'};
test('identification tests reject nonowners before reading images or database',async()=>{
  const response=res();await createIdentificationTestHandler({auth:async()=>403,storeFactory:()=>assert.fail() })(req(input),response);assert.equal(response.statusCode,403);
});
test('identification tests require sharing approval and existing owner membership',async()=>{
  const handler=createIdentificationTestHandler({env,auth:async()=>200,storeFactory:()=>({wishlistMember:async()=>null})});
  const denied=res();await handler(req({...input,provider_sharing:false}),denied);assert.equal(denied.statusCode,400);
  const missing=res();await handler(req(input),missing);assert.equal(missing.statusCode,409);
});
test('completed search survives import failure and retry does not rerun providers',async()=>{
  let record=null,searches=0,imports=0;
  const store={wishlistMember:async()=>({conversation_id:'owner-conversation'}),
    reserveIdentificationTest:async(conversation,key,query,hash)=>{const created=!record;record??={id:'test-message',conversation_id:conversation,search_result:{test_status:'running',test_hash:hash}};return{created,record};},
    saveImages:async()=>{},finishIdentificationTest:async(id,result)=>{record.search_result=result;},
    identificationTestImages:async()=>[{id:'source-image'}],identificationTestPayload:async(id,payload)=>{record.wishlist_payload=payload;},
    importIdentificationTest:async()=>{imports++;if(imports===1)throw new Error('database unavailable');}
  };
  const handler=createIdentificationTestHandler({env,auth:async()=>200,storeFactory:()=>store,search:async()=>{searches++;return{status:'found',products:[{url:'https://example.com/shoes'}],checked_at:'2026-10-06T00:00:00Z'};},prepare:async()=>[{url:'https://example.com/shoes',source_image_id:'source-image'}]});
  const first=res();await handler(req(input),first);assert.equal(first.statusCode,503);
  const retry=res();await handler(req(input),retry);assert.equal(retry.statusCode,200);assert.equal(retry.body.saved,1);assert.equal(searches,1);assert.equal(imports,2);
  const changed=res();await handler(req({...input,query:'Find the bag'}),changed);assert.equal(changed.statusCode,409);assert.equal(searches,1);
});
test('in-progress test is not automatically reissued',async()=>{
  const store={wishlistMember:async()=>({conversation_id:'owner'}),reserveIdentificationTest:async(c,k,q,hash)=>({created:false,record:{conversation_id:c,search_result:{test_status:'running',test_hash:hash}}})};
  const response=res();await createIdentificationTestHandler({env,auth:async()=>200,storeFactory:()=>store,search:()=>assert.fail()})(req(input),response);assert.equal(response.statusCode,409);
});
test('owner text diagnostic uses fixed public query and never saves or sends messages',async()=>{
 let calls=0;
 const handler=createIdentificationTestHandler({env,auth:async()=>200,storeFactory:()=>assert.fail(),textSearch:async(query,images,settings,fetcher,constraints)=>{
 calls++;assert.match(query,/men's Prada/);assert.deepEqual(images,[]);assert.equal(settings.OPENAI_SEARCH_MODEL,'gpt-4.1');assert.equal(constraints.range,'men');return {products:[]};
 }});
 const response=res();await handler(req({action:'text_search_diagnostic',mode:'standard_auto',query:'ignored private text'}),response);assert.equal(response.statusCode,200);assert.equal(calls,1);
 const invalid=res();await handler(req({action:'text_search_diagnostic',mode:'arbitrary'}),invalid);assert.equal(invalid.statusCode,400);assert.equal(calls,1);
});
