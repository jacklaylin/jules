import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateChanges,updateProfile,profileCheck,MEMORY_MODEL,TASTE_GUIDE,PROFILE_TOOL,MEMORY_PROMPT} from '../lib/memory.js';
import {stylistConcepts} from '../lib/stylist.js';
import {rankDiscoveryProducts} from '../lib/discovery-ranking.js';
const id='11111111-1111-4111-8111-111111111111';
const message={id,direction:'inbound',created_at:'2026-10-19T00:00:00Z',body:'I like that it’s slouchy — Kate Moss at a music festival vibes. I have a very tall  mostly lean frame, so I’m particular about inseams. The CurveComfy thing looks like a fake company, the photos are AI generated looking.'};
const change=(field,key,value,quote)=>({field,key,value,action:'set',source_id:id,evidence:quote});

test('taste is saved as separate keyed facts: inspiration, fit, avoid and the rest',()=>{
 const saved=validateChanges([
  change('inspiration','kate moss','slouchy, a little grungy but put together','Kate Moss at a music festival vibes'),
  change('fit','height','very tall, mostly lean; particular about inseams','very tall mostly lean frame'),
  change('avoid','dropship-looking stores','fake-looking companies with AI-generated photos','looks like a fake company'),
  change('occasion','nights out','wants going-out tops with more pizazz','Kate Moss'),
  change('owned','mulberry buckle bag','faded black leather','slouchy'),
  change('store','leisure center','luxury consignment','slouchy'),
 ],[message]);
 assert.deepEqual(saved.map(f=>f.field),['inspiration','fit','avoid','occasion','owned','store']);
 assert.ok(saved.every(f=>f.basis==='stated'&&f.evidence_ids.length===1));
});

test('a quote only differing in curly quotes, dashes, spacing or case still proves the fact; other words do not',()=>{
 assert.equal(validateChanges([change('style','aesthetic','slouchy',"i like that it's SLOUCHY - kate moss")],[message]).length,1);
 assert.equal(validateChanges([change('fit','height','tall','very tall mostly lean frame')],[message]).length,1);
 assert.throws(()=>validateChanges([change('fit','height','tall','very tall and lean frame')],[message]),/Unsupported memory fact/);
});

test('one unprovable taste fact is rejected without losing the rest',async()=>{
 const store={profile:async()=>({facts:[],version:0}),saveProfile:async()=>true,recordEvidence:async()=>{}};
 const result=await updateProfile(store,'c',message,{changes:[
  {action:'remember',field:'inspiration',key:'kate moss',value:'festival grunge',quote:'Kate Moss at a music festival vibes'},
  {action:'remember',field:'avoid',key:'prints',value:'no prints',quote:'I hate prints'}]});
 assert.equal(result.saved,1);assert.equal(result.rejected.length,1);
});

test('the taste guide reaches both the chat tool and the background reader, and the checker uses the taste model',async()=>{
 for(const text of [PROFILE_TOOL.description,MEMORY_PROMPT])assert.ok(text.includes(TASTE_GUIDE));
 let body;
 await profileCheck([message],[],{OPENAI_API_KEY:'k',OPENAI_MODEL:'gpt-4.1-mini'},async(url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"changes":[]}'}]}]})};});
 assert.equal(body.model,MEMORY_MODEL);
});

test('saved taste reaches the stylist and the ranker',async()=>{
 const facts=[{field:'inspiration',key:'the row',value:'eclectic, chic, understated'},{field:'fit',key:'height',value:'very tall'},{field:'avoid',key:'dropship stores',value:'AI-looking photos'},{field:'occasion',key:'nights out',value:'needs going-out tops'},{field:'owned',key:'mulberry bag',value:'faded black'},{field:'store',key:'depop',value:'shops vintage'}];
 let input;
 await stylistConcepts({query:'going out top',plan:{mode:'discover'},facts,env:{OPENAI_API_KEY:'k'},fetcher:async(url,options)=>{input=JSON.parse(JSON.parse(options.body).input);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"concepts":[]}'}]}]})};}});
 assert.deepEqual(input.saved_profile.map(f=>f.field).sort(),['avoid','fit','inspiration','occasion','owned','store']);
 let ranked;
 await rankDiscoveryProducts([{brand:'A',name:'Top',url:'https://a.example/p'}],{query:'top',facts,env:{OPENAI_API_KEY:'k'},fetcher:async(url,options)=>{ranked=JSON.parse(JSON.parse(options.body).input[0].content);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"indices":[0],"rejected_indices":[]}'}]}]})};}});
 assert.deepEqual(ranked.taste.map(f=>f.field).sort(),['avoid','fit','inspiration','occasion','owned','store']);
});
