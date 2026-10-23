import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../lib/store.js';
import {shoppingContext} from '../lib/shopping-context.js';
import {sendGreeting} from '../lib/photon.js';
import {receiveInInbox} from '../lib/inbox.js';
import {generateReply} from '../lib/ai.js';
import {agentTurn,tool} from './helpers/agent.js';

// October 20: product cards (and a save's wishlist card) are their own iMessages. Their ids were never
// kept, so a reply threaded under a card ("love this, add it") resolved to nothing, the shopping state
// fell back to the saved list, and an old saved item was saved and watched instead of the card's
// product. Each extra message's id is now kept with its answer, and a reply under one resolves to that
// answer and the option it shows. A reply under a message Jules cannot see never means the saved list.

const quiet=()=>{};
// A fake conversation that numbers every message it sends.
function conversation(){
 const sent=[];let n=0;
 return {sent,send:async input=>{const content=typeof input==='string'?{type:'text',text:input}:input.build?await input.build().catch(()=>({type:'reply'})):input;sent.push(content);return {id:'m'+(++n)};}};
}
const deliver=(c,body,options={})=>sendGreeting({space:{phone:'test-only'},message:{sender:{id:'test-only'}}},body,{SITE_ORIGIN:'https://jules.example'},
 {connect:async()=>({stop:async()=>{}}),provider:Object.assign(()=>({user:async()=>({}),space:{create:async()=>c}}),{config:()=>({})}),log:quiet,...options});

test('the answer’s cards, captions and wishlist card are returned by id, with the option each one shows',async()=>{
 const c=conversation();
 const products=[{name:'Shirt A',url:'https://a.example/p',preview_url:'https://jules.example/go/a'},{name:'Shirt B',url:'https://b.example/p',preview_url:'https://jules.example/go/b',caption:'the boxy one'}];
 const sent=await deliver(c,'two options:\nhttps://jules.example/go/a\nhttps://jules.example/go/b',{products});
 assert.equal(sent.id,'m1');
 assert.deepEqual(sent.parts,[{id:'m2',kind:'card',option:1,url:'https://a.example/p'},{id:'m3',kind:'card',option:2,url:'https://b.example/p'},{id:'m4',kind:'card',option:2,url:'https://b.example/p'}]);
 // A save confirmation's wishlist card is kept too.
 const w=conversation();
 const saved=await deliver(w,'saved it. https://jules.example/wishlist');
 assert.deepEqual(saved.parts,[{id:'m2',kind:'preview'}]);
 // A plain answer has no parts.
 assert.equal((await deliver(conversation(),'sure.')).parts,undefined);
});

// The store, in memory: rows by provider id, and outbound rows found by a part id they kept.
const store=(messages,queries=[])=>createStore({SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake'},async url=>{
 const u=new URL(url);queries.push(u);const p=k=>u.searchParams.get(k);
 const inList=v=>v?.startsWith('in.(')?v.slice(4,-1).split(',').map(x=>JSON.parse(x)):null;
 let rows;
 const part=p('reply_diagnostics->sent_parts');
 if(part){const [{id}]=JSON.parse(part.slice(3));rows=messages.filter(m=>m.direction==='outbound'&&m.reply_diagnostics?.sent_parts?.some(s=>s.id===id));}
 else if(p('provider_id'))rows=messages.filter(m=>m.provider_id===p('provider_id').slice(3));
 else if(p('reply_provider_id')){const ids=inList(p('reply_provider_id'));rows=messages.filter(m=>ids.includes(m.reply_provider_id)&&m.id!==p('id').slice(4)&&(p('direction')?m.direction===p('direction').slice(3):true));}
 else rows=[...messages].reverse();
 return {ok:true,text:async()=>JSON.stringify(rows)};
});
const options=[{name:'Cropped cotton shirt',url:'https://brand.example/shirt'},{name:'Shop shirt, coal',url:'https://shop.example/shop-shirt'}];
const answer={id:'answer',provider_id:'p-answer',direction:'outbound',status:'sent',body:'two cropped shirts',created_at:'2026-10-20T20:30:53Z',reply_provider_id:null,
 search_result:{text_wishlist_state:{stage:'choice',options}},reply_diagnostics:{outcome:'sent',sent_parts:[{id:'p-card-1',kind:'card',option:1},{id:'p-card-2',kind:'card',option:2}]}};
const saved=[{id:'old',name:'Logo waffle tee',links:[{url:'https://old.example/tee'}]}];

test('a reply under a product card resolves to its answer and that option, never the saved list',async()=>{
 for(const body of ['Love this. Add to my wishlist and set an alert','this one in large please','not this one, something less boxy','save it']){
  const current={id:'current',provider_id:'p-current',direction:'inbound',body,created_at:'2026-10-20T20:32:26Z',reply_provider_id:'p-card-2'};
  const queries=[];
  const rows=await store([answer,current],queries).context('owner','p-current');
  const now=rows.find(m=>m.id==='current');
  assert.equal(now.reply_context.resolved,true,body);
  assert.deepEqual(now.reply_context.messages.map(m=>[m.id,m.replied_to_part]),[['answer',{kind:'card',option:2}]]);
  assert.equal(now.reply_context.messages[0].reply_diagnostics,undefined,'diagnostics stay out of the agent context');
  // The state is that answer's options, not the saved item.
  assert.deepEqual(shoppingContext(rows,null,saved).options.map(o=>o.url),options.map(o=>o.url));
  assert.ok(queries.every(q=>q.searchParams.get('conversation_id')==='eq.owner'),'lookups stay in the conversation');
 }
});

test('later replies under the same card stay in its thread; a reply under the answer itself still resolves',async()=>{
 const first={id:'first',provider_id:'p-first',direction:'inbound',body:'love this',created_at:'2026-10-20T20:31:00Z',reply_provider_id:'p-card-1'};
 const current={id:'current',provider_id:'p-current',direction:'inbound',body:'actually in black?',created_at:'2026-10-20T20:32:00Z',reply_provider_id:'p-card-1'};
 const rows=await store([answer,first,current]).context('owner','p-current');
 assert.deepEqual(rows.find(m=>m.id==='current').reply_context.messages.map(m=>m.id),['answer','first']);
 const direct={id:'current',provider_id:'p-current',direction:'inbound',body:'the second',created_at:'2026-10-20T20:32:00Z',reply_provider_id:'p-answer'};
 const plain=(await store([answer,direct]).context('owner','p-current')).find(m=>m.id==='current');
 assert.equal(plain.reply_context.resolved,true);assert.equal(plain.reply_context.messages[0].replied_to_part,undefined);
});

test('a reply under a message Jules cannot see leaves nothing selected instead of the saved list',async()=>{
 const current={id:'current',provider_id:'p-current',direction:'inbound',body:'Add to my wishlist',created_at:'2026-10-20T21:54:21Z',reply_provider_id:'p-unknown'};
 const rows=await store([answer,current]).context('owner','p-current');
 assert.equal(rows.find(m=>m.id==='current').reply_context.resolved,false);
 assert.equal(shoppingContext(rows,null,saved),null);
 // Without a reply, the saved list still stands in when nothing is pending.
 const loose=[{...current,reply_provider_id:null}];
 assert.equal(shoppingContext(loose,null,saved).options[0].saved_item_id,'old');
});

test('the inbox keeps the sent parts with the answer’s diagnostics',async()=>{
 const writes=[];
 const st={receive:async()=>'conversation',claimAI:async()=>true,context:async()=>[{id:'c1',provider_id:'p-hi',direction:'inbound',body:'hi',created_at:'2026-10-20T20:00:00Z'}],
  prepareAI:async()=>{},finish:async()=>{},searchResult:async()=>{},replyDiagnostics:async(_op,d)=>writes.push(d),recordDelivery:async()=>{}};
 const parts=[{id:'p-card-1',kind:'card',option:1}];
 await receiveInInbox({space:{phone:'line'},message:{id:'p-hi',sender:{id:'tester'},content:{type:'text',text:'hi'},attachments:[]}},{AI_ENABLED:'true',OPENAI_API_KEY:'fake'},{store:st,
  generate:(m,e,_f,memory)=>generateReply(m,e,async()=>agentTurn(tool('conversation_reply',{response:'hey.'})),memory),
  send:async()=>({id:'sent',parts}),progress:async()=>async()=>{}});
 assert.deepEqual(writes.at(-1).sent_parts,parts);
 assert.equal(writes.at(-1).outcome,'sent');
});
